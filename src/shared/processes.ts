import type { KeySlot } from './types'

/**
 * Every AI process in the app, as data rather than as prose buried in a builder.
 *
 * The problem this solves, stated first because it is the reason the shape is
 * odd: every prompt in this app is **assembled**, not stored. The prompt writer
 * interleaves a fixed opening instruction, live data (the brief, the whole
 * board, the cast, the style, the batch) and a fixed RULES list. You cannot
 * hand the user "the prompt" as one editable string without either losing the
 * data interleaving or inventing a template language — and a template language
 * in Settings is a way to break the app from Settings.
 *
 * So the split is: **the parts that are prose become data; the parts that are
 * assembly stay code.** Each process declares a spec, and only the prose halves
 * of it — the role and the rules — are overridable. The schema, the data
 * blocks, and the parse and clamp code are the contract between the prompt and
 * the app, and are not editable at all.
 *
 * `PROCESS_DEFAULTS` holds the exact text the builders used before this
 * existed, moved out of `services/ai.ts` verbatim. Two consequences worth
 * having: there is no behaviour change on first run, and the defaults are
 * visible and resettable in Settings from day one.
 */

export const PROCESS_IDS = [
  'curriculum.decompose',
  'curriculum.subdivide',
  'day.agent',
  'board.scenes',
  'board.prompts',
  'board.revision',
  'board.cut',
  'style.sort',
  'cast.portrait',
  'cast.pack'
] as const

export type ProcessId = (typeof PROCESS_IDS)[number]

export const isProcessId = (value: unknown): value is ProcessId =>
  (PROCESS_IDS as readonly string[]).includes(value as string)

export interface ProcessRule {
  text: string
  /**
   * A rule the parser depends on. Editable in wording, not removable.
   *
   * Editing *"Return each prompt with its scene number"* out of the rules while
   * `parsePrompts` still keys on the scene number is a feature that breaks the
   * app from Settings. Pinning is what stops that being possible, while still
   * letting the sentence be reworded — which is the part a user might actually
   * want to change.
   */
  pinned?: boolean
}

/**
 * The knobs that decide what a call costs and how it batches.
 *
 * These numbers carry hard-won reasoning and are **clamped**, not trusted:
 * `output` is what a credit-metered provider reserves up front, `minOutput` is
 * how far that ask may be cut to fit a thin balance, and `batch` exists because
 * fifteen scenes reserving 12k output tokens were refused outright on a balance
 * covering 4.4k. A user who sets `output: 100` otherwise gets truncated JSON
 * and a parse error with no clue why.
 */
export interface ProcessLimits {
  timeoutMs: number
  output: number
  minOutput: number
  thinking: number
  /** Only the processes that batch have one. */
  batch?: number
}

export interface ProcessSpec {
  id: ProcessId
  label: string
  /** Where in the app it runs, so a box in Settings can be found by feel. */
  where: string
  slot: KeySlot
  /** The opening instruction — who the model is and what it is doing. */
  role: string
  /** The RULES list. The half of a prompt that is policy. */
  rules: ProcessRule[]
  limits: ProcessLimits
  /**
   * What the rules block is titled.
   *
   * Two spellings in the app today — `Rules:` in the goals prompts and the day
   * agent, `RULES:` in the storyboard ones — and they are kept rather than
   * unified because unifying them would be a behaviour change on first run for
   * no benefit anyone asked for.
   */
  rulesHeading: string
  /**
   * The `{name}` placeholders this process's rules may use.
   *
   * Not a template language: a fixed, per-process list of names the builder
   * substitutes, listed here so the panel can show what is available. A
   * placeholder the builder does not supply is left in the text literally
   * rather than erroring, because a rule with a typo in it should read oddly,
   * not fail the call.
   */
  vars?: readonly string[]
}

/** One process as the renderer sees it: resolved, plus what it cannot edit. */
export interface ResolvedProcess extends ProcessSpec {
  /** True when the user has saved an override over the default. */
  modified: boolean
  /** The JSON schema this process's answer must match. Read-only. */
  schema: string
  /** What is deliberately not editable here, said in the panel. */
  fixed: string[]
}

/** Which area a box belongs to, so eleven boxes read as four groups. */
export const PROCESS_GROUPS = [
  { id: 'goals', label: 'Goals', ids: ['curriculum.decompose', 'curriculum.subdivide'] },
  { id: 'today', label: 'Today', ids: ['day.agent'] },
  {
    id: 'storyboards',
    label: 'Storyboards',
    ids: ['board.scenes', 'board.prompts', 'board.revision', 'board.cut', 'style.sort']
  },
  { id: 'cast', label: 'Cast', ids: ['cast.portrait', 'cast.pack'] }
] as const satisfies readonly {
  id: string
  label: string
  ids: readonly ProcessId[]
}[]

/**
 * What a limit may be set to.
 *
 * Clamped rather than validated-and-refused: a number outside the range is a
 * user experimenting, and pulling it back to the edge keeps the app working
 * where an error would just be a dead Settings panel.
 */
export const LIMIT_BOUNDS = {
  timeoutMs: { min: 10_000, max: 600_000 },
  output: { min: 256, max: 65_536 },
  minOutput: { min: 128, max: 65_536 },
  thinking: { min: 0, max: 32_768 },
  batch: { min: 1, max: 20 }
} as const

/** Ceilings on the prose itself, so an override cannot become the whole call. */
export const MAX_ROLE_CHARS = 4_000
export const MAX_RULE_CHARS = 600
export const MAX_RULES = 40

const r = (text: string, pinned = false): ProcessRule =>
  pinned ? { text, pinned: true } : { text }

export const PROCESS_DEFAULTS: Record<ProcessId, ProcessSpec> = {
  'curriculum.decompose': {
    id: 'curriculum.decompose',
    rulesHeading: 'Rules:',
    label: 'Break a goal into topics',
    where: 'Goals Admin → plan',
    slot: 'goals',
    role: 'You are turning a study curriculum into an ordered list of single-sitting topics.',
    vars: ['minutesPerDay', 'targetTopics'],
    rules: [
      r(
        "Preserve the author's intended order. Reuse their module or section names in \"module\" when the curriculum has them."
      ),
      r(
        'Each topic must be one focused sitting of about {minutesPerDay} minutes or less. Split anything larger into explicitly numbered parts (e.g. "Shaders, part 2").'
      ),
      r('"est_minutes" is your realistic estimate of focused work for that one topic.', true),
      r(
        '"detail" is at most one short sentence describing what finishing it looks like. Omit it when it would only restate the title.'
      ),
      r('Number "seq" from 1 upward with no gaps, in study order.', true),
      r('Do NOT assign dates, days, weeks, or any schedule. Scheduling happens elsewhere.'),
      r('Do NOT invent material the curriculum does not imply.'),
      r(
        'Aim for roughly {targetTopics} topics, but prefer sensible granularity over hitting that number exactly.'
      )
    ],
    limits: {
      timeoutMs: 180_000,
      output: 32_768,
      minOutput: 8_192,
      thinking: 4_096
    }
  },

  'curriculum.subdivide': {
    id: 'curriculum.subdivide',
    rulesHeading: 'Rules:',
    label: 'Break topics into learning points',
    where: 'Goals Admin → learning points',
    slot: 'goals',
    role: 'You are breaking study topics into the specific things a learner has to actually understand or do.',
    rules: [
      r("Copy each topic's \"id\" back exactly as given. Never invent an id.", true),
      r(
        'A point names one concrete thing to learn, build or verify — "Write a fragment shader that samples a texture", not "Understand shaders".'
      ),
      r(
        'Keep every point under 12 words, sentence case, no trailing full stop, no numbering.'
      ),
      r(
        "Together the points must fit the topic's stated minute budget. Fewer, larger points for a short topic."
      ),
      r(
        'Stay inside what the curriculum above implies. Do NOT introduce tools, libraries, courses or subjects it never mentions.'
      ),
      r(
        'Do NOT restate the topic title as a point, and do NOT mention dates, days or scheduling.'
      )
    ],
    limits: { timeoutMs: 120_000, output: 32_768, minOutput: 4_096, thinking: 2_048 }
  },

  'day.agent': {
    id: 'day.agent',
    rulesHeading: 'Rules:',
    label: 'The day assistant',
    where: 'Today → the assistant on a day card',
    slot: 'agent',
    role: `You are the study assistant built into Day Deck, a daily planner. You answer questions about ONE specific day in the user's own plan.

The DAY CONTEXT you are given is the complete set of facts you may use: the day's tasks, the goal each task belongs to, that goal's curriculum, the AI-generated learning points for each task, and any reminders on the day.`,
    rules: [
      r(
        "Answer only from the DAY CONTEXT. It is the user's own plan and it outranks anything you know about the subject.",
        true
      ),
      r(
        "When asked what a task is, what to learn, or what to do, ground the answer in that task's learning points and its goal."
      ),
      r(
        'You may explain, clarify and give brief worked context for something already in the plan. That is teaching, and it is welcome.'
      ),
      r(
        'You may NOT add topics, resources, courses, tools or exercises the plan does not contain, and you may NOT propose changes to the schedule, the order, or the deadline. If the user wants that, tell them it is a Goals Admin decision.'
      ),
      r(
        'If the question is not covered by the DAY CONTEXT, say so plainly in one sentence and name what the day does cover.'
      ),
      r(
        'Be brief and concrete. Under 150 words unless asked to go deeper. Plain sentences and short lists, no headings, no markdown tables.'
      )
    ],
    limits: { timeoutMs: 60_000, output: 1_024, minOutput: 256, thinking: 0 }
  },

  'board.scenes': {
    id: 'board.scenes',
    rulesHeading: 'RULES:',
    label: 'Plan scenes',
    where: 'Storyboards → Plan scenes',
    slot: 'scenes',
    role: 'You are a cinematographer breaking a creative brief into the fewest continuous shots that can tell it. Every cut must earn itself: a shot that can carry the next beat should carry it.',
    rules: [
      r(
        'duration_sec must be exactly one of: 4, 6, 8, 10. Nothing else is renderable.',
        true
      ),
      r('Default to 10. Shorten only when the shot genuinely has nothing left to do:'),
      r(
        '  - 10s: the default — a developing action, a full camera move, or two beats held in one frame'
      ),
      r(
        '  - 8s: an action carried by a camera move, or one beat with a clear settle after it'
      ),
      r('  - 6s: one complete small action with no room left after it'),
      r('  - 4s: a single beat — a look, a cut-in, a reveal, one gesture'),
      r(
        'Use the fewest scenes that cover the brief. Before adding one, ask whether the previous shot could hold the action with a camera move or a reframe instead. If it can, extend it.'
      ),
      r(
        'Cut only when the location, the time, the subject or the framing must change. Do not cut for variety, emphasis or pacing.'
      ),
      r('A scene is one continuous shot. No cuts inside a scene.'),
      r('title is a short shot name, 2-5 words, no numbering.'),
      r(
        'description says what happens: subject, action, camera move if any, and where the shot starts and where it ends. One or two sentences.'
      ),
      r(
        'Order the scenes as they will be cut together, and hand each one off to the next — end where the following shot can begin.'
      ),
      r('Do not write generation prompts. That is a later, separate step.')
    ],
    limits: { timeoutMs: 180_000, output: 8_192, minOutput: 2_048, thinking: 1_024 }
  },

  'board.prompts': {
    id: 'board.prompts',
    rulesHeading: 'RULES:',
    label: 'Write prompts',
    where: 'Storyboards → Write prompts',
    slot: 'prompts',
    role: 'You are a cinematographer writing one generation prompt per shot for an AI video model. The prompt is everything the model gets: it has not seen the other shots and it cannot read this board.',
    rules: [
      r(
        'Every prompt stands alone. Never "as established", "same style" or "continuing from the previous shot" — restate the look and the people in full.'
      ),
      r(
        'One order, every time: subject, action, camera move, lens, lighting, environmental motion, grade, film stock, aspect. A generator reads the front of a prompt hardest, so what is in frame goes first and how it was finished goes last.'
      ),
      r(
        'Name the camera move, its speed, and where it starts and ends — static, slow push, handheld follow, pan, tilt, dolly. A move with no end point generates as drift.'
      ),
      r(
        'Give the frame depth: what sits in the foreground, where the subject falls, what drops off behind. State focus behaviour only when it changes — a rack, a follow focus.'
      ),
      r(
        'Describe the motion the shot needs and nothing else. One clear action plus one environmental motion — breath, cloth, steam, traffic, a light shift — reads as real; three actions read as chaos.'
      ),
      r(
        'Movement obeys weight and contact: feet land, cloth lags, liquid settles, the camera has mass. Do not ask for motion the frame cannot physically produce.'
      ),
      r(
        'Match the amount of action to the length in brackets. A 4s shot is one beat; a 10s shot can carry a developing action or a full move.'
      ),
      r(
        'Keep the look wording identical across prompts — same lens, same lighting, same grade, same stock. Consistency across shots is the whole job.'
      ),
      r(
        'Hold continuity with the shots either side: same wardrobe, same location, same time of day, same light direction.'
      ),
      r(
        'Cut adjectives that do not change the image. "Beautiful", "stunning", "cinematic", "masterpiece" cost tokens and buy nothing. A concrete noun beats a modifier.'
      ),
      r(
        "Use a scene's wired references by name only when the shot genuinely uses them; film-wide references apply to every shot."
      ),
      r('Return each prompt with its scene number.', true)
    ],
    limits: {
      timeoutMs: 180_000,
      output: 4_096,
      minOutput: 2_048,
      thinking: 512,
      /**
       * Four at a time. Fifteen scenes reserved 12,288 output tokens up front
       * and were refused outright on a balance covering about 4,400 — the
       * answer was never anywhere near 12k, the reservation was. Batching
       * smaller fixed the refusal and the ceiling followed the batch down.
       */
      batch: 4
    }
  },

  'board.revision': {
    id: 'board.revision',
    rulesHeading: 'RULES:',
    label: 'Revise one prompt',
    where: 'Storyboards → a scene row → Revise',
    slot: 'prompts',
    role: 'You are a director revising one generation prompt for an AI video generator.',
    rules: [
      r(
        'Change what was asked for and nothing else. Every other clause keeps its exact wording.'
      ),
      r(
        'The look, the film stock, the aspect and any character description are not yours to reword. They are what makes this shot cut together with the others.'
      ),
      r(
        'Keep the order: subject, action, camera move, lens, lighting, environmental motion, grade, film stock, aspect.'
      ),
      r('Still one continuous shot, and still sized to the length in brackets.'),
      r(
        'Return the whole revised prompt, not a diff and not a description of what you changed.',
        true
      )
    ],
    limits: { timeoutMs: 180_000, output: 4_096, minOutput: 2_048, thinking: 512 }
  },

  'board.cut': {
    id: 'board.cut',
    rulesHeading: 'RULES:',
    label: 'Choose cut points',
    where: 'Storyboards → Timeline → AI cut',
    slot: 'prompts',
    role: 'You are an editor choosing cut points. The clips are attached in the order they appear below, one per shot.',
    rules: [
      r(
        'Watch each clip. Choose start and end times that keep the strongest part of the action and drop dead air at the head and tail.'
      ),
      r(
        'Times are in seconds from the start of that clip, and must lie inside its length as given above.',
        true
      ),
      r('Keep the clips in the order listed. You are trimming, not reordering.'),
      r(
        'A clip may appear more than once if two separate moments in it are both worth keeping. It may be left out entirely if nothing in it is.'
      ),
      r(
        'Never return a segment shorter than half a second — it reads as a glitch rather than a cut.'
      ),
      r(
        'Give one short, concrete reason per segment, about what is in the frame. "Tightens the pacing" says nothing; "starts as she turns, drops the empty tail" does.'
      )
    ],
    limits: { timeoutMs: 180_000, output: 4_096, minOutput: 2_048, thinking: 1_024 }
  },

  'style.sort': {
    id: 'style.sort',
    rulesHeading: 'RULES:',
    label: 'Sort a look into fields',
    where: 'Storyboards → Styles → Sort into fields',
    slot: 'scenes',
    role: 'You are filing a film look description into fixed fields. You are a sorter, not a writer.',
    rules: [
      r(
        'Use only words and phrases that appear in the description. Do not add, infer, or embellish anything.',
        true
      ),
      r(
        'A field the description says nothing about must be an empty string. Empty is the correct answer, not a failure.',
        true
      ),
      r('Do not repeat the same phrase into several fields; put it in the one it fits best.'),
      r(
        "Keep the user's own wording. Reordering and joining their phrases is fine; new adjectives are not."
      )
    ],
    // Moving the user's own words into named boxes needs no deliberation at all.
    limits: { timeoutMs: 60_000, output: 1_024, minOutput: 512, thinking: 0 }
  },

  'cast.portrait': {
    id: 'cast.portrait',
    rulesHeading: 'RULES:',
    label: 'Generate a portrait',
    where: 'Storyboards → Cast → Generate portrait',
    slot: 'image',
    role: 'You are a visual-development photographer shooting the identity reference for one character. Every later shot of this person is matched to this frame, so it has to read cleanly before it reads beautifully.',
    rules: [
      r('One person only. Nobody else in frame, no crowd, no second face in a reflection.'),
      r(
        'Head and shoulders, facing the camera, eyes open and visible, neutral expression.'
      ),
      r(
        'Portrait lens look — around 85mm, shot at eye level. No wide-angle distortion of the face.'
      ),
      r(
        'Soft key from the front with gentle fill, even across both sides of the face. No hard shadow across the features, no silhouette, no extreme backlight, no coloured gel.'
      ),
      r(
        'Plain, uncluttered background sitting behind the subject so the head separates from it. Nothing back there that has to be matched later.'
      ),
      r('Sharp on the eyes. Shallow depth is fine; the face is not.'),
      r(
        'Photoreal, with natural skin texture and colour. No illustration, no 3D render, no retouching, no text, watermark, border or collage.'
      ),
      r(
        'Follow the description exactly. Do not add accessories, tattoos, scars or hair colour it does not mention.'
      )
    ],
    // An image call has no token budget of its own; the numbers are here so
    // every process reads the same and the timeout is still adjustable.
    limits: { timeoutMs: 120_000, output: 0, minOutput: 0, thinking: 0 }
  },

  'cast.pack': {
    id: 'cast.pack',
    rulesHeading: 'RULES:',
    label: 'Build a reference angle',
    where: 'Storyboards → Cast → after approving a portrait',
    slot: 'image',
    role: "The attached image is this character's identity reference. Photograph the same person from a different camera angle, matched frame for frame in everything else.",
    rules: [
      r(
        'Identity comes from the attached image, not from the description. Same face, same bone structure, same hair, same skin, same age. The description confirms what you are looking at; it never overrides it.',
        true
      ),
      r(
        'Change the camera angle only. Same wardrobe, same lighting direction and quality, same background treatment, same lens character, same distance from the subject.'
      ),
      r(
        'The new angle must be physically consistent with the first: the light comes from the same place in the room, so shadows fall where the move puts them.'
      ),
      r('Keep the eyes sharp and the face readable at the new angle.'),
      r(
        'One person only, photoreal, no text, no watermark, no border, no collage, no side-by-side comparison.'
      )
    ],
    limits: { timeoutMs: 120_000, output: 0, minOutput: 0, thinking: 0 }
  }
}

/**
 * Substitute the `{name}` placeholders a process declares.
 *
 * Deliberately not a template language: no expressions, no conditionals, no
 * loops, and a name the caller did not supply is left in the text as it stands
 * rather than throwing. A rule with a typo in it should read oddly; it should
 * not be able to fail a call from Settings.
 */
export function fillVars(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  )
}

/**
 * The rules block, as the builders emit it.
 *
 * A rule whose text starts with whitespace is a **continuation** of the one
 * above it and keeps its own indentation instead of being given a bullet —
 * which is how the per-length guidance under "Choose per scene by what the shot
 * needs:" stays laid out the way it is today while still being editable.
 */
export function renderRules(
  spec: ProcessSpec,
  vars: Record<string, string | number> = {}
): string[] {
  return [
    spec.rulesHeading,
    ...spec.rules.map((rule) => {
      const text = fillVars(rule.text, vars)
      return /^\s/.test(rule.text) ? text : `- ${text}`
    })
  ]
}
