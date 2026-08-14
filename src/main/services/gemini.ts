import type {
  AgentMessage,
  GeminiModel,
  ScenePlan,
  TopicDraft,
  VideoStyle
} from '@shared/types'
import { OMNI_DURATIONS, snapDuration } from '@shared/types'

/**
 * The only outbound network call Day Deck ever makes, and it lives in the main
 * process so the API key never has to exist in the renderer.
 *
 * Gemini is asked for one thing: an ordered list of topics with effort
 * estimates. It is explicitly *not* asked for dates — see services/scheduler.ts
 * for why.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export type GeminiErrorKind =
  | 'offline'
  | 'auth'
  | 'rate'
  | 'server'
  | 'truncated'
  | 'parse'
  | 'unknown'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function classifyNetworkError(err: unknown): GeminiError {
  const message = err instanceof Error ? err.message : String(err)
  if (/abort|timeout/i.test(message)) {
    return new GeminiError(
      'Gemini took too long to respond. Check your connection and try again.',
      'offline'
    )
  }
  return new GeminiError(
    'Could not reach Gemini. Day Deck works offline — everything except plan generation still functions.',
    'offline'
  )
}

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  /** Retries only apply to transient failures (429 and 5xx). */
  attempts?: number
}

/** 1s, 3s — a blip either clears on its own that fast or is not a blip. */
const backoffMs = (attempt: number): number => 1_000 * 3 ** attempt

/**
 * How long to ride out an overloaded model, and how many times.
 *
 * 503 is the one server status that is not breakage. The request was fine and
 * the key was fine; Gemini shed it because the model had more work than
 * capacity at that instant, and the identical request usually lands a little
 * later. Sharing the generic 5xx schedule meant giving up about four seconds
 * in, which is nowhere near how long a model stays shed under load — so
 * Google's busy minute reached the user as a failed plan and read like a limit
 * they had done something wrong to hit.
 *
 * Three retries at 2s, 4s, 8s: roughly fifteen seconds of patience, jittered.
 * The jitter matters because a board is a run of these calls — retrying in
 * lockstep is how a queue that was clearing gets hit by the whole batch again.
 * Past that, saying so is worth more than a fourth wait the user cannot see.
 */
const OVERLOAD_RETRIES = 3
const overloadWaitMs = (retry: number): number =>
  Math.round(2_000 * 2 ** retry * (0.75 + Math.random() * 0.5))

/**
 * Said in full because this is the message that has already cost the user an
 * afternoon: the number they can change is not the number that refused them.
 */
const OVERLOADED =
  'Gemini is overloaded right now (503) — Google shed the request instead of queueing it. ' +
  "That is Google's own serving capacity, not a quota and not Day Deck's rate limit, so raising calls per minute in Settings cannot clear it. " +
  'Day Deck already retried for about 15 seconds. Give it a minute and plan again, or switch the model in Goals Admin — a different model is a different pool.'

/**
 * The longest we will sit on a retry before handing the wait back to the user.
 *
 * A 429 that asks for a minute is not a queue that is about to move — it is a
 * quota window, usually tokens-per-minute rather than requests-per-minute.
 * Sleeping through it burns another request from the same quota on the far side
 * for no better odds, so past this point saying how long is worth more than
 * trying again.
 */
const MAX_WAIT_MS = 15_000

/**
 * How long Gemini itself asked us to wait.
 *
 * A 429 body carries a `RetryInfo` detail with the real window. Ignoring it and
 * retrying on our own schedule is what turns one refused call into three, each
 * one spending quota that was already exhausted — which reads to the user as a
 * limit they cannot raise, because the limit being hit is not the one the app's
 * own setting controls.
 */
function askedToWaitMs(detail: string): number | null {
  const match = /retry[_-]?delay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(detail)
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : null
}

async function request(
  path: string,
  apiKey: string,
  { method = 'GET', body, timeoutMs = 30_000, attempts = 3 }: RequestOptions = {}
): Promise<unknown> {
  let waitMs = 0
  /**
   * Two counts, because the two waits are not the same kind of wait. `retries`
   * is the caller's budget, spent on a refused quota or a broken server. An
   * overloaded model is neither — nothing is wrong and nothing is exhausted —
   * so it is given its own, longer count rather than eating a budget sized for
   * failures that do not heal.
   */
  let retries = 0
  let overloads = 0

  for (;;) {
    if (waitMs > 0) await sleep(waitMs)

    let response: Response
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'x-goog-api-key': apiKey,
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      // A dead network will not heal inside a backoff; fail fast.
      throw classifyNetworkError(err)
    }

    if (response.ok) return response.json()

    const detail = await response.text().catch(() => '')

    if (response.status === 401 || response.status === 403) {
      throw new GeminiError(
        'Gemini rejected the API key. Check it in Goals Admin.',
        'auth',
        response.status
      )
    }
    if (response.status === 400) {
      throw new GeminiError(
        `Gemini rejected the request: ${trimDetail(detail)}`,
        'unknown',
        400
      )
    }
    if (response.status === 429) {
      const asked = askedToWaitMs(detail)
      const error = new GeminiError(
        asked === null
          ? "Gemini's own quota refused the call — this is Google's limit, not Day Deck's, so raising the rate in Settings will not clear it."
          : `Gemini's own quota is exhausted for about ${Math.ceil(
              asked / 1_000
            )}s — this is Google's limit, not Day Deck's, so raising the rate in Settings will not clear it.`,
        'rate',
        429
      )
      // Retrying inside a window Gemini has already priced is spending the
      // quota that refused us.
      if (asked !== null && asked > MAX_WAIT_MS) throw error
      if (retries >= attempts - 1) throw error
      waitMs = asked ?? backoffMs(retries)
      retries += 1
      continue
    }
    if (response.status === 503) {
      const error = new GeminiError(OVERLOADED, 'server', 503)
      if (overloads >= OVERLOAD_RETRIES) throw error
      waitMs = overloadWaitMs(overloads)
      overloads += 1
      continue
    }
    if (response.status >= 500) {
      const error = new GeminiError(
        `Gemini had a server error (${response.status}): ${trimDetail(detail)}`,
        'server',
        response.status
      )
      if (retries >= attempts - 1) throw error
      waitMs = backoffMs(retries)
      retries += 1
      continue
    }

    throw new GeminiError(
      `Gemini returned ${response.status}: ${trimDetail(detail)}`,
      'unknown',
      response.status
    )
  }
}

function trimDetail(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    /* fall through to the raw text */
  }
  return detail.slice(0, 300) || 'no detail provided'
}

/* ----------------------------------------------------------------- models */

interface RawModel {
  name: string
  displayName?: string
  inputTokenLimit?: number
  supportedGenerationMethods?: string[]
}

/** Models that exist but cannot do what Goals Admin needs. */
const NON_TEXT = /embedding|aqa|imagen|veo|tts|computer-use|live|image/i

/**
 * Read the model list at runtime rather than hardcoding it — Google deprecates
 * and adds models continuously, and a stale constant would silently break plan
 * generation months from now.
 */
export async function listModels(apiKey: string): Promise<GeminiModel[]> {
  const data = (await request('/models?pageSize=200', apiKey, {
    timeoutMs: 20_000
  })) as { models?: RawModel[] }

  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      displayName: m.displayName ?? m.name.replace(/^models\//, ''),
      inputTokenLimit: m.inputTokenLimit ?? null
    }))
    .filter((m) => !NON_TEXT.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function testConnection(apiKey: string): Promise<number> {
  const models = await listModels(apiKey)
  return models.length
}

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
 * `kind` decides what a cut-off response means. Half a JSON document is
 * unusable and has to fail loudly; half an answer is still an answer, so the
 * agent keeps what arrived rather than throwing away a useful reply over its
 * last sentence.
 */
function extractText(payload: unknown, kind: 'json' | 'prose' = 'json'): string {
  const data = payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }>
    promptFeedback?: { blockReason?: string }
  }

  const blocked = data.promptFeedback?.blockReason
  if (blocked) {
    throw new GeminiError(
      `Gemini declined to answer this (${blocked}).`,
      'unknown'
    )
  }

  const candidate = data.candidates?.[0]
  if (!candidate) {
    throw new GeminiError('Gemini returned no candidates.', 'parse')
  }

  const text = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  if (candidate.finishReason === 'MAX_TOKENS') {
    if (kind === 'json' || !text) {
      throw new GeminiError(
        'The response was cut off before it finished. Ask for less in one go — a shorter curriculum, or fewer scenes on the board.',
        'truncated'
      )
    }
    return `${text}…`
  }

  if (!text) throw new GeminiError('Gemini returned an empty response.', 'parse')
  return text
}

/** Structured output should be clean JSON, but a stray code fence is cheap to survive. */
function parseTopics(text: string): TopicDraft[] {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new GeminiError(
      'Gemini returned something that was not valid JSON.',
      'parse'
    )
  }

  const raw = (parsed as { topics?: unknown }).topics
  if (!Array.isArray(raw)) {
    throw new GeminiError(
      'Gemini returned JSON without a "topics" array.',
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
    throw new GeminiError(
      'Gemini did not return any usable topics from that curriculum.',
      'parse'
    )
  }

  // Renumber so `seq` is authoritative regardless of what came back.
  return topics.map((t, i) => ({ ...t, seq: i + 1 }))
}

/**
 * What one structured-JSON call is allowed to spend.
 *
 * `thinking` is the number that moves the bill. Left unset, Gemini decides for
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
  thinking: number
}

/**
 * A surface that predates a field says so by name, and the name is the only
 * reliable way to tell which retreat is worth a round trip. Anything else a 400
 * can mean — a prompt over the input limit, a model id that does not exist — is
 * the same rejection whatever we send next, so retrying it only spends another
 * request from the quota to be told the same thing.
 */
const REJECTED_THINKING = /thinking/i
const REJECTED_SCHEMA = /unknown name|json[_-]?schema/i

/**
 * One structured-JSON call, degrading only on what the API actually rejected.
 *
 * Both schema fields express the same thing; which one an endpoint accepts
 * depends on how new it is, and the only way to find out is to be rejected. The
 * same is true of the thinking budget. Each retreat is taken at most once, so a
 * call costs at most three round trips and usually one.
 */
async function generateJson(
  apiKey: string,
  model: string,
  prompt: string,
  schema: unknown,
  budget: JsonBudget
): Promise<string> {
  const path = `/models/${encodeURIComponent(model)}:generateContent`

  let thinking = true
  let newSchemaField = true

  for (;;) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: budget.output,
        ...(thinking
          ? { thinkingConfig: { thinkingBudget: budget.thinking } }
          : {}),
        ...(newSchemaField
          ? { responseJsonSchema: schema }
          : { responseSchema: schema })
      }
    }

    try {
      return extractText(
        await request(path, apiKey, {
          method: 'POST',
          timeoutMs: budget.timeoutMs,
          body
        })
      )
    } catch (err) {
      if (!(err instanceof GeminiError) || err.status !== 400) throw err

      // Order matters: an unknown-field 400 for thinkingConfig also reads as a
      // schema rejection, and dropping the budget is the cheaper retreat.
      if (thinking && REJECTED_THINKING.test(err.message)) {
        thinking = false
        continue
      }
      if (newSchemaField && REJECTED_SCHEMA.test(err.message)) {
        newSchemaField = false
        continue
      }
      throw err
    }
  }
}

export async function decomposeCurriculum(opts: {
  apiKey: string
  model: string
  title: string
  rawText: string
  minutesPerDay: number
  targetTopics: number
}): Promise<TopicDraft[]> {
  return parseTopics(
    await generateJson(opts.apiKey, opts.model, buildPrompt(opts), TOPIC_SCHEMA, {
      timeoutMs: 180_000,
      // A whole curriculum's worth of topics; the cap stays where it was
      // because truncation here fails the entire plan.
      output: 32_768,
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
    throw new GeminiError(
      'Gemini returned something that was not valid JSON.',
      'parse'
    )
  }

  const raw = (parsed as { breakdowns?: unknown }).breakdowns
  if (!Array.isArray(raw)) {
    throw new GeminiError(
      'Gemini returned JSON without a "breakdowns" array.',
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
  apiKey: string
  model: string
  goalTitle: string
  curriculumExcerpt: string
  topics: SubdivideInput[]
}): Promise<Array<{ topicId: string; points: string[] }>> {
  if (opts.topics.length === 0) return []

  return parseBreakdowns(
    await generateJson(
      opts.apiKey,
      opts.model,
      buildSubdividePrompt(opts),
      POINTS_SCHEMA,
      { timeoutMs: 120_000, output: 32_768, thinking: 2_048 }
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
  apiKey: string
  model: string
  context: string
  history: AgentMessage[]
  question: string
}): Promise<string> {
  const contents = [
    ...opts.history.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }]
    })),
    {
      role: 'user',
      parts: [{ text: `DAY CONTEXT:\n${opts.context}\n\nQUESTION: ${opts.question}` }]
    }
  ]

  const payload = await request(
    `/models/${encodeURIComponent(opts.model)}:generateContent`,
    opts.apiKey,
    {
      method: 'POST',
      timeoutMs: 60_000,
      body: {
        contents,
        systemInstruction: { parts: [{ text: AGENT_SYSTEM }] },
        generationConfig: { temperature: 0.3, maxOutputTokens: 1_024 }
      }
    }
  )

  return extractText(payload, 'prose')
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
  apiKey: string
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
    throw new GeminiError('Gemini did not return usable JSON for the scenes.', 'parse')
  }

  const scenes = (parsed as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes)) {
    throw new GeminiError('Gemini returned JSON without a "scenes" array.', 'parse')
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
    throw new GeminiError(
      'Gemini did not return any usable scenes for that brief.',
      'parse'
    )
  }

  return out
}

export async function planScenes(opts: ScenePlanInput): Promise<ScenePlan[]> {
  return parseScenes(
    await generateJson(
      opts.apiKey,
      opts.model,
      buildScenePrompt(opts),
      SCENE_SCHEMA,
      {
        timeoutMs: 180_000,
        // A breakdown is a title, a sentence or two and a number per shot. Even
        // a forty-shot film is a few thousand tokens; the old 32k ceiling was
        // room for a runaway rather than room for an answer.
        output: 8_192,
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
  apiKey: string
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
    throw new GeminiError('Gemini did not return usable JSON for the prompts.', 'parse')
  }

  const prompts = (parsed as { prompts?: unknown }).prompts
  if (!Array.isArray(prompts)) {
    throw new GeminiError('Gemini returned JSON without a "prompts" array.', 'parse')
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
    throw new GeminiError(
      'Gemini did not return a prompt for any of those scenes.',
      'parse'
    )
  }

  return out
}

export async function planPrompts(
  opts: PromptPlanInput
): Promise<Map<number, string>> {
  return parsePrompts(
    await generateJson(
      opts.apiKey,
      opts.model,
      buildPromptWriterPrompt(opts),
      PROMPT_SCHEMA,
      {
        timeoutMs: 180_000,
        // PROMPT_BATCH prompts, each a paragraph that restates the look and any
        // cast in it. Generous for fifteen of those, nowhere near 32k.
        output: 12_288,
        // Most of this job is restating settled wording in a fixed order, which
        // is close to transcription — it does not need long deliberation.
        thinking: 512
      }
    ),
    opts.write
  )
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
  apiKey: string
  model: string
  text: string
}): Promise<StyleSortResult> {
  const raw = await generateJson(
    opts.apiKey,
    opts.model,
    buildStyleSortPrompt(opts.text),
    STYLE_SORT_SCHEMA,
    // Moving the user's own words into named boxes. The output is a handful of
    // short fields and there is nothing here to reason about — anything the
    // model thought up would be thrown away by keepGroundedFields anyway.
    { timeoutMs: 30_000, output: 2_048, thinking: 0 }
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GeminiError('Gemini did not return usable JSON for the sort.', 'parse')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new GeminiError('Gemini returned something other than fields.', 'parse')
  }

  return keepGroundedFields(parsed as Record<string, unknown>, opts.text)
}

/** Exported for their tests — the prompt is the feature. */
export { buildScenePrompt, buildPromptWriterPrompt, buildStyleSortPrompt }
