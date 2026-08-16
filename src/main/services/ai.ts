import type {
  AgentMessage,
  KeySlot,
  ScenePlan,
  TopicDraft,
  VideoStyle
} from '@shared/types'
import { OMNI_DURATIONS, snapDuration } from '@shared/types'
import type { Db } from '../db'
import { AiError, callContext, generateJson, generateText } from './providers'
import { generateJsonWithFiles } from './providers/gemini'

/**
 * What Day Deck asks a model for, in Day Deck's own terms.
 *
 * Everything here is provider-independent: the prompts, the schemas, the
 * parsing, and the budget each job is worth. Which vendor actually receives it
 * — and what shape the request has to take on the wire — is
 * services/providers/, and the split is what lets the same curriculum
 * breakdown run against Gemini, Grok, GPT or a local server without any of the
 * prompts below knowing that happened.
 *
 * Each function knows which key slot it belongs to, because that is a fixed
 * property of the feature rather than something a caller should have to
 * remember: goals plan against the goals slot, the day card asks on the agent
 * slot, and so on.
 */

/* ------------------------------------------------------------ decompose */

const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'integer' },
          module: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          est_minutes: { type: 'integer' }
        },
        required: ['seq', 'title', 'est_minutes'],
        propertyOrdering: ['seq', 'module', 'title', 'detail', 'est_minutes']
      }
    }
  },
  required: ['topics']
} as const

function buildPrompt(opts: {
  title: string
  rawText: string
  minutesPerDay: number
  targetTopics: number
}): string {
  return `You are turning a study curriculum into an ordered list of single-sitting topics.

GOAL: ${opts.title}

CURRICULUM:
"""
${opts.rawText}
"""

Rules:
- Preserve the author's intended order. Reuse their module or section names in "module" when the curriculum has them.
- Each topic must be one focused sitting of about ${opts.minutesPerDay} minutes or less. Split anything larger into explicitly numbered parts (e.g. "Shaders, part 2").
- "est_minutes" is your realistic estimate of focused work for that one topic.
- "detail" is at most one short sentence describing what finishing it looks like. Omit it when it would only restate the title.
- Number "seq" from 1 upward with no gaps, in study order.
- Do NOT assign dates, days, weeks, or any schedule. Scheduling happens elsewhere.
- Do NOT invent material the curriculum does not imply.
- Aim for roughly ${opts.targetTopics} topics, but prefer sensible granularity over hitting that number exactly.`
}

/**
 * Structured output should be clean JSON, but a stray code fence is cheap to
 * survive.
 */
function parseTopics(text: string): TopicDraft[] {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AiError(
      'The model returned something that was not valid JSON.',
      'parse'
    )
  }

  const raw = (parsed as { topics?: unknown }).topics
  if (!Array.isArray(raw)) {
    throw new AiError(
      'The model returned JSON without a "topics" array.',
      'parse'
    )
  }

  const topics: TopicDraft[] = []
  raw.forEach((item, i) => {
    const t = item as Record<string, unknown>
    const title = typeof t.title === 'string' ? t.title.trim() : ''
    if (!title) return

    const est = Number(t.est_minutes)
    topics.push({
      seq: Number.isFinite(Number(t.seq)) ? Number(t.seq) : i + 1,
      module: typeof t.module === 'string' && t.module.trim() ? t.module.trim() : null,
      title,
      detail: typeof t.detail === 'string' && t.detail.trim() ? t.detail.trim() : null,
      // Clamp rather than trust: a 9000-minute "topic" would wreck the spread.
      estMinutes: Number.isFinite(est) ? Math.min(600, Math.max(5, Math.round(est))) : 45
    })
  })

  if (topics.length === 0) {
    throw new AiError(
      'The model did not return any usable topics from that curriculum.',
      'parse'
    )
  }

  // Renumber so `seq` is authoritative regardless of what came back.
  return topics.map((t, i) => ({ ...t, seq: i + 1 }))
}

/**
 * What one structured-JSON call is allowed to spend.
 *
 * `thinking` is the number that moves the bill. Left unset, a model decides for
 * itself how long to reason before answering, and those tokens are charged as
 * output — on prompts this size routinely several times the visible answer.
 * That is what puts a board's worth of calls through a tokens-per-minute quota
 * long before it goes near a requests-per-minute one, which is why raising the
 * calls-per-minute setting does not help a run that keeps being refused.
 *
 * Every caller states its own budget, because how much thought a job is worth
 * is a per-job answer: breaking a brief into shots deserves some, sorting the
 * user's own words into named boxes deserves none.
 *
 * `output` caps thinking and answer together, so it can never be set below the
 * answer plus its thinking budget.
 */
interface JsonBudget {
  timeoutMs: number
  output: number
  /**
   * How far `output` may be cut to fit a balance that cannot reserve it.
   *
   * A credit-metered provider holds the whole ceiling before it runs anything,
   * so the generous worst case above is what gets refused — not the answer,
   * which is usually a fraction of it. Stating a floor is what lets the adapter
   * re-ask for less instead of failing the run, and stating it *per job* is
   * what stops it re-asking for less than the job can be done in: fifteen
   * prompts and one style sort do not become impossible at the same number.
   */
  minOutput: number
  thinking: number
}

/**
 * One structured-JSON call, against whichever provider the slot is set to.
 *
 * The retreats that used to live here — dropping a thinking field an older
 * endpoint rejects, swapping one schema field for another — did not go away;
 * they moved into the adapters, because which fields exist is exactly the part
 * that differs by vendor. What is left is the part that never did: which slot
 * pays, what to ask, and what it is worth.
 */
const askForJson = (
  db: Db,
  slot: KeySlot,
  model: string,
  prompt: string,
  schema: unknown,
  budget: JsonBudget
): Promise<string> =>
  generateJson(db, slot, { model, prompt, schema, ...budget })

export async function decomposeCurriculum(opts: {
  db: Db
  model: string
  title: string
  rawText: string
  minutesPerDay: number
  targetTopics: number
}): Promise<TopicDraft[]> {
  return parseTopics(
    await askForJson(opts.db, 'goals', opts.model, buildPrompt(opts), TOPIC_SCHEMA, {
      timeoutMs: 180_000,
      // A whole curriculum's worth of topics; the cap stays where it was
      // because truncation here fails the entire plan.
      output: 32_768,
      // A short curriculum genuinely fits in a quarter of that, and a plan is
      // worth having on a thin balance. Below this the topic list starts
      // arriving half-written, which fails the plan either way.
      minOutput: 8_192,
      // Deciding how a subject breaks up is genuinely a reasoning job, so this
      // is the most generous budget in the file — bounded, not unlimited.
      thinking: 4_096
    })
  )
}

/* ----------------------------------------------------------- subdivide */

const POINTS_SCHEMA = {
  type: 'object',
  properties: {
    breakdowns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } }
        },
        required: ['id', 'points'],
        propertyOrdering: ['id', 'points']
      }
    }
  },
  required: ['breakdowns']
} as const

export interface SubdivideInput {
  id: string
  title: string
  module: string | null
  detail: string | null
  estMinutes: number
}

function buildSubdividePrompt(opts: {
  goalTitle: string
  curriculumExcerpt: string
  topics: SubdivideInput[]
}): string {
  const list = opts.topics
    .map(
      (t) =>
        `- id: ${t.id}\n  title: ${t.title}` +
        (t.module ? `\n  module: ${t.module}` : '') +
        (t.detail ? `\n  done when: ${t.detail}` : '') +
        `\n  budget: ${t.estMinutes} minutes`
    )
    .join('\n')

  return `You are breaking study topics into the specific things a learner has to actually understand or do.

GOAL: ${opts.goalTitle}

WHAT THE LEARNER'S CURRICULUM SAYS:
"""
${opts.curriculumExcerpt}
"""

TOPICS:
${list}

For every topic above, return 3 to 6 learning points.

Rules:
- Copy each topic's "id" back exactly as given. Never invent an id.
- A point names one concrete thing to learn, build or verify — "Write a fragment shader that samples a texture", not "Understand shaders".
- Keep every point under 12 words, sentence case, no trailing full stop, no numbering.
- Together the points must fit the topic's stated minute budget. Fewer, larger points for a short topic.
- Stay inside what the curriculum above implies. Do NOT introduce tools, libraries, courses or subjects it never mentions.
- Do NOT restate the topic title as a point, and do NOT mention dates, days or scheduling.`
}

function parseBreakdowns(
  text: string
): Array<{ topicId: string; points: string[] }> {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AiError(
      'The model returned something that was not valid JSON.',
      'parse'
    )
  }

  const raw = (parsed as { breakdowns?: unknown }).breakdowns
  if (!Array.isArray(raw)) {
    throw new AiError(
      'The model returned JSON without a "breakdowns" array.',
      'parse'
    )
  }

  const out: Array<{ topicId: string; points: string[] }> = []
  for (const item of raw) {
    const b = item as Record<string, unknown>
    const topicId = typeof b.id === 'string' ? b.id.trim() : ''
    if (!topicId || !Array.isArray(b.points)) continue

    const points = b.points
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim().replace(/^[-•*\d.)\s]+/, ''))
      .filter(Boolean)
      // A runaway list is worse than a short one — it turns the day card into
      // a wall of text and stops being a summary of the task.
      .slice(0, 8)

    if (points.length > 0) out.push({ topicId, points })
  }

  return out
}

/**
 * Break a batch of topics into learning points.
 *
 * Kept as its own call rather than folded into `decomposeCurriculum` for two
 * reasons. A single call producing both the topic list and every topic's points
 * is far more likely to hit the output limit and fail the whole plan, and
 * separating them means an existing goal made before this feature existed can
 * be backfilled with exactly the same code path.
 */
export async function subdivideTopics(opts: {
  db: Db
  model: string
  goalTitle: string
  curriculumExcerpt: string
  topics: SubdivideInput[]
}): Promise<Array<{ topicId: string; points: string[] }>> {
  if (opts.topics.length === 0) return []

  return parseBreakdowns(
    await askForJson(
      opts.db,
      'goals',
      opts.model,
      buildSubdividePrompt(opts),
      POINTS_SCHEMA,
      // Fifteen topics' worth of short bullet points — roomy above, and still
      // workable well below, since the answer is lists of half-sentences.
      { timeoutMs: 120_000, output: 32_768, minOutput: 4_096, thinking: 2_048 }
    )
  )
}

/* --------------------------------------------------------------- agent */

/**
 * The day-card assistant's standing instructions.
 *
 * The constraint that matters is the last one. A model asked "what should I
 * learn today?" with no boundary will happily invent a better curriculum than
 * the one the user planned, which is worse than useless — it competes with the
 * plan the whole app exists to keep. So the context it is given is the *only*
 * thing it may answer from, and admitting the gap is an allowed answer.
 */
const AGENT_SYSTEM = `You are the study assistant built into Day Deck, a daily planner. You answer questions about ONE specific day in the user's own plan.

The DAY CONTEXT you are given is the complete set of facts you may use: the day's tasks, the goal each task belongs to, that goal's curriculum, the AI-generated learning points for each task, and any reminders on the day.

Rules:
- Answer only from the DAY CONTEXT. It is the user's own plan and it outranks anything you know about the subject.
- When asked what a task is, what to learn, or what to do, ground the answer in that task's learning points and its goal.
- You may explain, clarify and give brief worked context for something already in the plan. That is teaching, and it is welcome.
- You may NOT add topics, resources, courses, tools or exercises the plan does not contain, and you may NOT propose changes to the schedule, the order, or the deadline. If the user wants that, tell them it is a Goals Admin decision.
- If the question is not covered by the DAY CONTEXT, say so plainly in one sentence and name what the day does cover.
- Be brief and concrete. Under 150 words unless asked to go deeper. Plain sentences and short lists, no headings, no markdown tables.`

/**
 * Ask about one day. Plain text out, not JSON — this is prose for a human.
 *
 * `history` is passed through as real conversation turns rather than pasted
 * into the prompt so follow-ups like "and the second one?" resolve against what
 * was actually said.
 */
export async function askAgent(opts: {
  db: Db
  model: string
  context: string
  history: AgentMessage[]
  question: string
}): Promise<string> {
  return generateText(opts.db, 'agent', {
    model: opts.model,
    system: AGENT_SYSTEM,
    history: opts.history,
    question: `DAY CONTEXT:\n${opts.context}\n\nQUESTION: ${opts.question}`,
    timeoutMs: 60_000,
    output: 1_024,
    // The one place a trim is nearly free: prose keeps whatever arrived, so a
    // shorter answer on a thin balance is a shorter answer, not a failure.
    minOutput: 256
  })
}

/* -------------------------------------------------------- storyboards */

/**
 * Stage one asks for the breakdown only — what happens, shot by shot. Prompts
 * are deliberately absent from the schema: they are stage two's job, run after
 * the user has approved the scenes, so a rejected breakdown never costs the
 * tokens of prompts nobody wanted.
 */
const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          // Constrained here *and* snapped after parsing. An enum in the schema
          // is a strong hint, not a guarantee, and a seven-second scene is not
          // something the model can render.
          duration_sec: { type: 'integer', enum: [...OMNI_DURATIONS] }
        },
        required: ['title', 'description', 'duration_sec'],
        propertyOrdering: ['title', 'description', 'duration_sec']
      }
    }
  },
  required: ['scenes']
} as const

export interface ScenePlanInput {
  db: Db
  model: string
  brief: string
  visualStyle: string
  /** The look to write the prompts in, when one has been placed on the board. */
  style: VideoStyle | null
  /** What is already on the board, so the model can be told to respect it. */
  existing: { title: string; description: string; hasPrompt: boolean }[]
  /** References wired to the board, named so prompts can call for them. */
  references: string[]
  /** The cast, so the breakdown can refer to people by name. */
  characters: SheetLine[]
}

/** One member of the cast, flattened to what a prompt needs to know. */
export interface SheetLine {
  name: string
  description: string
}

/**
 * The cast, as a prompt block.
 *
 * Returns an empty array when there is no cast, so the caller can spread it
 * unconditionally and a board with no characters produces no empty heading.
 */
function renderCast(characters: readonly SheetLine[], rule: string): string[] {
  const named = characters.filter((c) => c.name.trim() && c.description.trim())
  if (named.length === 0) return []

  return [
    '',
    'CAST — the people in this film:',
    ...named.map((c) => `- ${c.name.trim()}: ${c.description.trim()}`),
    rule
  ]
}

/**
 * The style, flattened into the order a prompt should state it.
 *
 * Built here rather than in the renderer because it is the same assembly whether
 * the model is writing the prompt or a person is reading the style back — and two
 * copies of "what a style says" would drift.
 */
export function renderStyle(style: VideoStyle): string {
  const named: [string, string][] = [
    ['Video style', style.videoStyle],
    ['Camera', style.camera],
    ['Lens', style.lens],
    ['Grade', style.grade],
    ['Lighting', style.lighting],
    ['Film stock', style.filmStock],
    ['Aspect', style.aspect]
  ]
  const lines = named
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `- ${label}: ${value.trim()}`)

  for (const extra of style.extras) {
    if (!extra.key.trim() || !extra.value.trim()) continue
    lines.push(`- ${extra.key.trim()}: ${extra.value.trim()}`)
  }

  return lines.join('\n')
}

/**
 * What each supported length is *for*.
 *
 * Keyed by the duration rather than by position. The sentence this replaced
 * described only the first and last entries, so every length added between them
 * would have been listed as legal and then left with no guidance at all —
 * exactly what happened when 4 and 8 arrived. A length with no entry here still
 * gets its line, so the two can never silently disagree.
 */
const DURATION_INTENT: Record<number, string> = {
  4: 'a single beat — a look, a cut-in, a reveal, one gesture',
  6: 'one complete small action, or a held moment with movement in it',
  8: 'an action carried by a camera move, or two beats that belong in one shot',
  10: 'a developing action, a long move, or a shot that has to breathe'
}

const renderDurationIntents = (): string[] =>
  OMNI_DURATIONS.map(
    (seconds) =>
      `  - ${seconds}s: ${DURATION_INTENT[seconds] ?? 'whatever the shot needs'}`
  )

/**
 * Turn a brief into scenes — the breakdown only.
 *
 * Prompts are not asked for here. The user approves the scene list first, then
 * a second call writes prompts for the scenes that survived. Duration is still
 * not a free number — it is one of the lengths the generator actually supports,
 * chosen per scene according to what the shot needs, which is why the prompt
 * explains what each length is *for* rather than just listing them.
 */
function buildScenePrompt(opts: ScenePlanInput): string {
  const parts: string[] = [
    'You are a director breaking a creative brief into individual shots for an AI video generator.',
    '',
    'CREATIVE BRIEF:',
    opts.brief.trim() || '(none given)'
  ]

  if (opts.visualStyle.trim()) {
    parts.push('', 'VISUAL STYLE (from the brief):', opts.visualStyle.trim())
  }

  if (opts.style) {
    parts.push(
      '',
      `LOOK — "${opts.style.name}". The film will be shot in this look; let it shape what shots are worth having:`,
      renderStyle(opts.style)
    )
  }

  parts.push(
    ...renderCast(
      opts.characters,
      'Refer to these people by name in a description. Do not re-describe how they look — that is settled here, once.'
    )
  )

  if (opts.references.length > 0) {
    parts.push(
      '',
      'REFERENCE MATERIAL available on this board (mention one in a description only if the shot genuinely uses it):',
      ...opts.references.map((r) => `- ${r}`)
    )
  }

  if (opts.existing.length > 0) {
    parts.push(
      '',
      'ALREADY ON THE BOARD, in order. Keep what works, in this order where you can:',
      ...opts.existing.map(
        (scene, i) =>
          `${i + 1}. ${scene.title || '(untitled)'} — ${
            scene.description || '(no description)'
          }${scene.hasPrompt ? ' [has a hand-written prompt]' : ''}`
      )
    )
  }

  parts.push(
    '',
    'RULES:',
    `- duration_sec must be exactly one of: ${OMNI_DURATIONS.join(', ')}. Nothing else is renderable.`,
    '- Choose per scene by what the shot needs:',
    ...renderDurationIntents(),
    '- A scene is one continuous shot. No cuts inside a scene.',
    '- title is a short shot name, 2-5 words, no numbering.',
    '- description says what happens in this scene: subject, action, camera move if any. One or two sentences, written for the person reading the board.',
    '- Order the scenes as they will be cut together.',
    '- Cover the whole brief. Use as many scenes as it genuinely needs and no more.',
    '- Do not write generation prompts. That is a later, separate step.'
  )

  return parts.join('\n')
}

/**
 * Parse defensively, then snap.
 *
 * `duration_sec` is snapped to the nearest supported length rather than rejected:
 * a model that returns 7 despite the enum has still done the useful part of the
 * job, and throwing away a whole plan over one number would be the wrong trade.
 */
function parseScenes(raw: string): ScenePlan[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('The model did not return usable JSON for the scenes.', 'parse')
  }

  const scenes = (parsed as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes)) {
    throw new AiError('The model returned JSON without a "scenes" array.', 'parse')
  }

  const out: ScenePlan[] = []
  for (const entry of scenes) {
    if (!entry || typeof entry !== 'object') continue
    const s = entry as Record<string, unknown>

    const description = typeof s.description === 'string' ? s.description.trim() : ''
    // A scene with no description is not a scene. A title tells nobody anything.
    if (!description) continue

    const seconds = Number(s.duration_sec)
    out.push({
      title: typeof s.title === 'string' ? s.title.trim() : '',
      description,
      // Stage one never writes prompts; the caller decides what a scene's
      // prompt is (a new scene has none, a paired one keeps its own).
      prompt: '',
      durationSec: Number.isFinite(seconds)
        ? snapDuration(seconds)
        : OMNI_DURATIONS[0]
    })
  }

  if (out.length === 0) {
    throw new AiError(
      'The model did not return any usable scenes for that brief.',
      'parse'
    )
  }

  return out
}

export async function planScenes(opts: ScenePlanInput): Promise<ScenePlan[]> {
  return parseScenes(
    await askForJson(
      opts.db,
      'scenes',
      opts.model,
      buildScenePrompt(opts),
      SCENE_SCHEMA,
      {
        timeoutMs: 180_000,
        // A breakdown is a title, a sentence or two and a number per shot. Even
        // a forty-shot film is a few thousand tokens; the old 32k ceiling was
        // room for a runaway rather than room for an answer.
        output: 8_192,
        minOutput: 2_048,
        thinking: 1_024
      }
    )
  )
}

/* ------------------------------------------------------- prompt writing */

/**
 * Stage two: prompts for scenes the user has already approved.
 *
 * Each prompt is returned against its scene number rather than positionally, so
 * a model that skips one cannot silently shift every prompt after it onto the
 * wrong card.
 */
const PROMPT_SCHEMA = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'integer' },
          prompt: { type: 'string' }
        },
        required: ['scene', 'prompt'],
        propertyOrdering: ['scene', 'prompt']
      }
    }
  },
  required: ['prompts']
} as const

export interface PromptPlanInput {
  db: Db
  model: string
  brief: string
  visualStyle: string
  /** The look every prompt must restate in full, when one is placed. */
  style: VideoStyle | null
  /** References wired to the brief — they inform every shot. */
  briefReferences: string[]
  /** The cast. Restated in full in every prompt whose shot shows them. */
  characters: SheetLine[]
  /** Every scene on the board, in cutting order. All of them, every call —
      the whole board is the context that keeps shot 12 consistent with shot 2. */
  scenes: {
    /** 1-based board position; the number prompts come back against. */
    number: number
    title: string
    description: string
    durationSec: number | null
    /** References wired to this scene specifically. */
    references: string[]
  }[]
  /** The scene numbers to write this call. A batch, not always the board. */
  write: number[]
}

/**
 * The whole board goes in every call; only a batch of prompts comes back.
 *
 * Consistency is the entire job here, which is why the style block is stated
 * once and the model is told to fold it into every prompt in the same wording —
 * a prompt that says "in the established style" is worthless the moment it
 * leaves this app, and leaving is the entire purpose of a prompt.
 */
function buildPromptWriterPrompt(opts: PromptPlanInput): string {
  const parts: string[] = [
    'You are a director writing generation prompts, one per shot, for an AI video generator.',
    '',
    'CREATIVE BRIEF:',
    opts.brief.trim() || '(none given)'
  ]

  if (opts.visualStyle.trim()) {
    parts.push('', 'VISUAL STYLE (from the brief):', opts.visualStyle.trim())
  }

  if (opts.style) {
    parts.push(
      '',
      `LOOK — "${opts.style.name}". Fold this look into every prompt, in full and in the same wording, so the shots cut together:`,
      renderStyle(opts.style)
    )
  }

  parts.push(
    ...renderCast(
      opts.characters,
      'When a shot shows one of these people, restate their description in full, in this exact wording, inside that prompt. Never "the same woman", never "as established" — the generator writing shot 9 has never seen shot 2.'
    )
  )

  if (opts.briefReferences.length > 0) {
    parts.push(
      '',
      'FILM-WIDE REFERENCES, wired to the brief. They inform every shot:',
      ...opts.briefReferences.map((r) => `- ${r}`)
    )
  }

  parts.push(
    '',
    'THE BOARD, in cutting order:',
    ...opts.scenes.map((scene) => {
      const duration = scene.durationSec == null ? '' : ` [${scene.durationSec}s]`
      const refs =
        scene.references.length > 0
          ? ` [references: ${scene.references.join(', ')}]`
          : ''
      return `${scene.number}. ${scene.title || '(untitled)'} — ${
        scene.description || '(no description)'
      }${duration}${refs}`
    }),
    '',
    `WRITE PROMPTS FOR SCENES: ${opts.write.join(', ')}. The rest are context — return nothing for them.`,
    '',
    'RULES:',
    '- Every prompt must stand alone. Describe the look in the prompt itself; never write "as established", "same style", or "continuing from the previous shot".',
    '- State it in this order, every time: subject, action, camera, lens, lighting, grade, film stock, aspect. A generator reads the front of a prompt hardest, so what is in the shot goes first and how it was finished goes last.',
    '- A prompt describes one continuous shot. No cuts inside a scene.',
    '- Keep the look wording identical across prompts. Consistency across shots is the whole job.',
    '- Match the amount of action to the length in brackets. A 4s shot is one beat and its prompt should describe one thing happening; a 10s shot can carry a developing action or a camera move. A prompt with three actions in it will not fit a short scene.',
    "- Use a scene's wired references by name only when the shot genuinely uses them; film-wide references apply to every shot.",
    '- Return each prompt with its scene number.'
  )

  return parts.join('\n')
}

/**
 * Keep only what was asked for.
 *
 * A prompt for a scene outside the batch is dropped, and a batch scene the
 * model skipped simply comes back missing — the caller leaves that card
 * untouched rather than inventing an empty prompt for it.
 */
function parsePrompts(raw: string, write: readonly number[]): Map<number, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('The model did not return usable JSON for the prompts.', 'parse')
  }

  const prompts = (parsed as { prompts?: unknown }).prompts
  if (!Array.isArray(prompts)) {
    throw new AiError('The model returned JSON without a "prompts" array.', 'parse')
  }

  const wanted = new Set(write)
  const out = new Map<number, string>()
  for (const entry of prompts) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    const scene = Number(p.scene)
    const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
    if (!Number.isInteger(scene) || !wanted.has(scene) || !prompt) continue
    out.set(scene, prompt)
  }

  if (out.size === 0) {
    throw new AiError(
      'The model did not return a prompt for any of those scenes.',
      'parse'
    )
  }

  return out
}

export async function planPrompts(
  opts: PromptPlanInput
): Promise<Map<number, string>> {
  return parsePrompts(
    await askForJson(
      opts.db,
      'prompts',
      opts.model,
      buildPromptWriterPrompt(opts),
      PROMPT_SCHEMA,
      {
        timeoutMs: 180_000,
        /**
         * PROMPT_BATCH prompts, each a paragraph that restates the look and any
         * cast in it. Four of those is around 1,200 tokens of answer, so this
         * is roughly three times the realistic need.
         *
         * It used to be 12,288, sized for a batch of fifteen — and that number
         * is what a credit-metered gateway reserved up front and refused, on an
         * account whose balance covered about 4,400. The answer was never
         * anywhere near 12k; the reservation was. Batching smaller fixed the
         * refusal and the ceiling followed the batch down.
         */
        output: 4_096,
        // Four complete prompts plus their thinking. Below this they start
        // arriving cut off mid-sentence, which is not a cheaper success.
        minOutput: 2_048,
        // Most of this job is restating settled wording in a fixed order, which
        // is close to transcription — it does not need long deliberation.
        thinking: 512
      }
    ),
    opts.write
  )
}

/* ---------------------------------------------------------- revising one */

const REVISION_SCHEMA = {
  type: 'object',
  properties: { prompt: { type: 'string' } },
  required: ['prompt']
} as const

export interface RevisionInput {
  db: Db
  model: string
  brief: string
  visualStyle: string
  style: VideoStyle | null
  characters: SheetLine[]
  /** This shot, as the board describes it. */
  scene: {
    number: number
    title: string
    description: string
    durationSec: number | null
    references: string[]
  }
  /** The prompt that produced the take being revised, verbatim. */
  current: string
  /** What the user wants changed, in their own words. */
  note: string
}

/**
 * Rewrite one prompt to a note.
 *
 * The instruction that matters is "change what was asked and nothing else".
 * A revision that quietly re-words the look breaks the shot's consistency with
 * every other shot on the board, which is the one thing the whole prompt stage
 * exists to protect — and it does it invisibly, because the prompt still reads
 * perfectly well on its own.
 */
function buildRevisionPrompt(opts: RevisionInput): string {
  const parts: string[] = [
    'You are a director revising one generation prompt for an AI video generator.',
    '',
    'CREATIVE BRIEF:',
    opts.brief.trim() || '(none given)'
  ]

  if (opts.visualStyle.trim()) {
    parts.push('', 'VISUAL STYLE (from the brief):', opts.visualStyle.trim())
  }

  if (opts.style) {
    parts.push(
      '',
      `LOOK — "${opts.style.name}". Every prompt on this board states it in this wording:`,
      renderStyle(opts.style)
    )
  }

  parts.push(
    ...renderCast(
      opts.characters,
      'When this shot shows one of these people, their description must survive the revision word for word.'
    )
  )

  const duration =
    opts.scene.durationSec == null ? '' : ` [${opts.scene.durationSec}s]`

  parts.push(
    '',
    `THE SHOT — scene ${opts.scene.number}${duration}: ${
      opts.scene.title || '(untitled)'
    } — ${opts.scene.description || '(no description)'}`,
    ...(opts.scene.references.length > 0
      ? [`References wired to it: ${opts.scene.references.join(', ')}`]
      : []),
    '',
    'THE PROMPT THAT PRODUCED THE CURRENT TAKE, verbatim:',
    '"""',
    opts.current.trim(),
    '"""',
    '',
    "WHAT TO CHANGE, in the director's own words:",
    '"""',
    opts.note.trim(),
    '"""',
    '',
    'RULES:',
    '- Change what was asked for and nothing else. Every other clause keeps its exact wording.',
    '- The look, the film stock, the aspect and any character description are not yours to reword. They are what makes this shot cut together with the others.',
    '- Keep the order: subject, action, camera, lens, lighting, grade, film stock, aspect.',
    '- Still one continuous shot, and still sized to the length in brackets.',
    '- Return the whole revised prompt, not a diff and not a description of what you changed.'
  )

  return parts.join('\n')
}

export async function reviseScenePrompt(
  opts: RevisionInput
): Promise<string> {
  const raw = await askForJson(
    opts.db,
    'prompts',
    opts.model,
    buildRevisionPrompt(opts),
    REVISION_SCHEMA,
    {
      timeoutMs: 180_000,
      // One prompt, so a quarter of a PROMPT_BATCH batch — and sized the same
      // way, because a credit-metered provider reserves this ceiling up front.
      // A revision must never be the call that fails on a thin balance.
      output: 4_096,
      minOutput: 2_048,
      // Mostly restating settled wording with one clause changed.
      thinking: 512
    }
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError(
      'The model did not return usable JSON for the revised prompt.',
      'parse'
    )
  }

  const prompt = (parsed as { prompt?: unknown }).prompt
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new AiError('The model returned no revised prompt.', 'parse')
  }
  return prompt.trim()
}

/* ------------------------------------------------------------- the cut */

const CUT_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          take_id: { type: 'string' },
          start_sec: { type: 'number' },
          end_sec: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['take_id', 'start_sec', 'end_sec', 'reason'],
        propertyOrdering: ['take_id', 'start_sec', 'end_sec', 'reason']
      }
    }
  },
  required: ['segments']
} as const

export interface CutClip {
  takeId: string
  /** The scene this clip belongs to, for the prompt's benefit. */
  sceneNumber: number
  sceneTitle: string
  description: string
  /** The clip's real length, as ffprobe measured it. */
  durationSec: number
  uri: string
  mimeType: string
}

export interface CutProposalRow {
  takeId: string
  startSec: number
  endSec: number
  /** Why this cut point. Shown beside the segment; never written to a row. */
  reason: string
}

function buildCutPrompt(opts: {
  brief: string
  clips: CutClip[]
  targetSec: number | null
}): string {
  const parts: string[] = [
    'You are an editor choosing cut points. The clips are attached in the order they appear below, one per shot.',
    '',
    'THE FILM:',
    opts.brief.trim() || '(no brief given)',
    '',
    'THE CLIPS, in cutting order:',
    ...opts.clips.map(
      (clip, i) =>
        `${i + 1}. take_id=${clip.takeId} — scene ${clip.sceneNumber}, "${
          clip.sceneTitle || 'untitled'
        }" — ${clip.description || 'no description'} [${clip.durationSec.toFixed(
          1
        )}s long]`
    )
  ]

  if (opts.targetSec) {
    parts.push(
      '',
      `TARGET LENGTH: about ${opts.targetSec} seconds for the finished film.`
    )
  }

  parts.push(
    '',
    'RULES:',
    '- Watch each clip. Choose start and end times that keep the strongest part of the action and drop dead air at the head and tail.',
    '- Times are in seconds from the start of that clip, and must lie inside its length as given above.',
    '- Keep the clips in the order listed. You are trimming, not reordering.',
    '- A clip may appear more than once if two separate moments in it are both worth keeping. It may be left out entirely if nothing in it is.',
    '- Never return a segment shorter than half a second — it reads as a glitch rather than a cut.',
    '- Give one short, concrete reason per segment, about what is in the frame. "Tightens the pacing" says nothing; "starts as she turns, drops the empty tail" does.'
  )

  return parts.join('\n')
}

/**
 * Ask for cut points, having watched the clips.
 *
 * The uploads are the caller's job — this only takes the URIs, so the thing
 * that costs bandwidth is decided by the code that knows which clips the user
 * selected rather than by the code that writes the prompt.
 */
export async function planCut(opts: {
  db: Db
  model: string
  brief: string
  clips: CutClip[]
  targetSec: number | null
}): Promise<CutProposalRow[]> {
  if (opts.clips.length === 0) return []

  const ctx = callContext(opts.db, 'prompts')
  const raw = await generateJsonWithFiles(
    ctx,
    {
      model: opts.model,
      prompt: buildCutPrompt(opts),
      schema: CUT_SCHEMA,
      // Three minutes: the model is watching video, not reading text, and the
      // first token takes noticeably longer to arrive than on a prose call.
      timeoutMs: 180_000,
      output: 4_096,
      minOutput: 2_048,
      // Genuinely a judgement call about what is in the frame, so more than the
      // 512 a restating job gets — but bounded, because it is still one answer.
      thinking: 1_024
    },
    opts.clips.map((clip) => ({ uri: clip.uri, mimeType: clip.mimeType }))
  )

  return parseCut(raw, opts.clips)
}

/**
 * Keep only segments that name a real clip and lie inside it.
 *
 * The clamping is not defensive tidiness — a start past the end of the file
 * becomes ffmpeg's `-ss`, and the export produces an empty segment that then
 * breaks the concat. A model that hallucinates a take id is dropped outright
 * for the same reason.
 */
function parseCut(raw: string, clips: readonly CutClip[]): CutProposalRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('The model did not return usable JSON for the cut.', 'parse')
  }

  const segments = (parsed as { segments?: unknown }).segments
  if (!Array.isArray(segments)) {
    throw new AiError('The model returned JSON without a "segments" array.', 'parse')
  }

  const lengthById = new Map(clips.map((c) => [c.takeId, c.durationSec]))
  const out: CutProposalRow[] = []

  for (const entry of segments) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const takeId = typeof row.take_id === 'string' ? row.take_id : ''
    const full = lengthById.get(takeId)
    if (!full) continue

    const startSec = Math.max(0, Math.min(Number(row.start_sec), full))
    const endSec = Math.max(0, Math.min(Number(row.end_sec), full))
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue
    // Half a second is the floor stated in the prompt; anything under it reads
    // as a glitch rather than a cut, and is more likely a mistake than intent.
    if (endSec - startSec < 0.5) continue

    out.push({
      takeId,
      startSec,
      endSec,
      reason: typeof row.reason === 'string' ? row.reason.trim() : ''
    })
  }

  if (out.length === 0) {
    throw new AiError(
      'The model did not return a usable cut for any of those clips.',
      'parse'
    )
  }

  return out
}

/* ------------------------------------------------------- style sorting */

/**
 * Sorting a look description into the named style fields.
 *
 * The one hard rule, stated three ways below because it is the entire feature:
 * the model may only move the user's words into boxes. A field the text never
 * mentioned stays empty, and a value that appears from nowhere is thrown away
 * by `keepGroundedFields` even if the model ignores the instruction.
 */
const STYLE_SORT_FIELDS = [
  ['video_style', 'the overall genre or treatment of the footage'],
  ['camera', 'camera body or movement — handheld, locked off, gimbal'],
  ['lens', 'focal length, anamorphic, zoom'],
  ['grade', 'colour grade or palette'],
  ['lighting', 'light sources and quality'],
  ['film_stock', 'a named film stock or sensor look'],
  ['aspect', 'aspect ratio']
] as const

const STYLE_SORT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    STYLE_SORT_FIELDS.map(([key]) => [key, { type: 'string' }])
  ),
  required: STYLE_SORT_FIELDS.map(([key]) => key)
} as const

function buildStyleSortPrompt(text: string): string {
  return [
    'You are filing a film look description into fixed fields. You are a sorter, not a writer.',
    '',
    'THE DESCRIPTION, verbatim:',
    '"""',
    text.trim(),
    '"""',
    '',
    'FIELDS:',
    ...STYLE_SORT_FIELDS.map(([key, hint]) => `- ${key}: ${hint}`),
    '',
    'RULES:',
    '- Use only words and phrases that appear in the description. Do not add, infer, or embellish anything.',
    '- A field the description says nothing about must be an empty string. Empty is the correct answer, not a failure.',
    '- Do not repeat the same phrase into several fields; put it in the one it fits best.',
    '- Keep the user\'s own wording. Reordering and joining their phrases is fine; new adjectives are not.'
  ].join('\n')
}

/** The camelCase patch keys, in STYLE_SORT_FIELDS order. */
const STYLE_SORT_KEYS = [
  'videoStyle',
  'camera',
  'lens',
  'grade',
  'lighting',
  'filmStock',
  'aspect'
] as const

export type StyleSortResult = Partial<
  Record<(typeof STYLE_SORT_KEYS)[number], string>
>

const wordsOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((w) => w.length >= 2)
  )

/**
 * The programmatic half of "nothing invented": a value none of whose words
 * appear in the source text cannot have come from it, so it is dropped even
 * though the model returned it. Exported for its tests.
 */
export function keepGroundedFields(
  raw: Record<string, unknown>,
  text: string
): StyleSortResult {
  const source = wordsOf(text)
  const out: StyleSortResult = {}

  STYLE_SORT_FIELDS.forEach(([snake], i) => {
    const value = raw[snake]
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    const words = [...wordsOf(trimmed)]
    if (words.length === 0 || !words.some((w) => source.has(w))) return
    out[STYLE_SORT_KEYS[i]] = trimmed
  })

  return out
}

export async function sortStyleText(opts: {
  db: Db
  model: string
  text: string
}): Promise<StyleSortResult> {
  const raw = await askForJson(
    opts.db,
    'scenes',
    opts.model,
    buildStyleSortPrompt(opts.text),
    STYLE_SORT_SCHEMA,
    // Moving the user's own words into named boxes. The output is a handful of
    // short fields and there is nothing here to reason about — anything the
    // model thought up would be thrown away by keepGroundedFields anyway.
    { timeoutMs: 30_000, output: 2_048, minOutput: 512, thinking: 0 }
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('The model did not return usable JSON for the sort.', 'parse')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new AiError('The model returned something other than fields.', 'parse')
  }

  return keepGroundedFields(parsed as Record<string, unknown>, opts.text)
}

/** Exported for their tests — the prompt is the feature. */
export { buildScenePrompt, buildPromptWriterPrompt, buildStyleSortPrompt }
