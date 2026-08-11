import type { AgentMessage, GeminiModel, TopicDraft } from '@shared/types'

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

async function request(
  path: string,
  apiKey: string,
  { method = 'GET', body, timeoutMs = 30_000, attempts = 3 }: RequestOptions = {}
): Promise<unknown> {
  let lastError: GeminiError | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // 0.6s, 1.8s, 5.4s — enough to clear a short rate-limit window.
      await sleep(600 * 3 ** (attempt - 1))
    }

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
      lastError = classifyNetworkError(err)
      // A dead network will not heal in 600ms; fail fast.
      throw lastError
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
      lastError = new GeminiError(
        'Gemini rate limit reached. Waiting before retrying.',
        'rate',
        429
      )
      continue
    }
    if (response.status >= 500) {
      lastError = new GeminiError(
        `Gemini had a server error (${response.status}).`,
        'server',
        response.status
      )
      continue
    }

    throw new GeminiError(
      `Gemini returned ${response.status}: ${trimDetail(detail)}`,
      'unknown',
      response.status
    )
  }

  throw (
    lastError ??
    new GeminiError('Gemini could not be reached after retries.', 'unknown')
  )
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
        'The response was cut off before it finished. Try a shorter curriculum, or a model with a larger output limit.',
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
 * One structured-JSON call, retried on the older `responseSchema` field.
 *
 * Both schema fields express the same thing; which one an endpoint accepts
 * depends on how new it is, and the only way to find out is to be rejected. The
 * fallback is worth one extra round trip because the alternative is plan
 * generation failing outright on an older surface.
 */
async function generateJson(
  apiKey: string,
  model: string,
  prompt: string,
  schema: unknown,
  timeoutMs: number
): Promise<string> {
  const base = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 32_768
    }
  }

  const path = `/models/${encodeURIComponent(model)}:generateContent`

  let payload: unknown
  try {
    // The newer full-JSON-Schema field.
    payload = await request(path, apiKey, {
      method: 'POST',
      timeoutMs,
      body: {
        ...base,
        generationConfig: {
          ...base.generationConfig,
          responseJsonSchema: schema
        }
      }
    })
  } catch (err) {
    // Older API surfaces only accept `responseSchema` (the OpenAPI subset).
    // Our schemas fit both, so a 400 here is worth one retry on the old field.
    if (!(err instanceof GeminiError) || err.status !== 400) throw err

    payload = await request(path, apiKey, {
      method: 'POST',
      timeoutMs,
      body: {
        ...base,
        generationConfig: {
          ...base.generationConfig,
          responseSchema: schema
        }
      }
    })
  }

  return extractText(payload)
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
    await generateJson(
      opts.apiKey,
      opts.model,
      buildPrompt(opts),
      TOPIC_SCHEMA,
      180_000
    )
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
      120_000
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
