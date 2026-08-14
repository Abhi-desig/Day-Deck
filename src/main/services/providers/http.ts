import type { AiProvider } from '@shared/types'

/**
 * The one place Day Deck touches the network, and the one place that knows how
 * a refused request should read.
 *
 * Everything vendor-shaped lives in the adapters beside this file; what stays
 * here is the part that is the same whoever is being called — how long to wait,
 * what is worth retrying, and how to say what went wrong without making the
 * user guess whose limit they hit.
 */

export type AiErrorKind =
  | 'offline'
  | 'auth'
  | 'rate'
  | 'server'
  | 'truncated'
  | 'parse'
  | 'config'
  | 'unknown'

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AiError'
  }
}

/** Who is being called, and how to reach them. */
export interface CallContext {
  provider: AiProvider
  /** The provider's human name. Every message below says it out loud. */
  label: string
  /** Fully-resolved, no trailing slash. */
  baseUrl: string
  apiKey: string
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function classifyNetworkError(err: unknown, ctx: CallContext): AiError {
  const message = err instanceof Error ? err.message : String(err)
  if (/abort|timeout/i.test(message)) {
    return new AiError(
      `${ctx.label} took too long to respond. Check your connection and try again.`,
      'offline'
    )
  }
  return new AiError(
    `Could not reach ${ctx.label} at ${ctx.baseUrl}. Day Deck works offline — everything except generation still functions.`,
    'offline'
  )
}

export interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /** Retries only apply to transient failures (429 and 5xx). */
  attempts?: number
}

/** 1s, 3s — a blip either clears on its own that fast or is not a blip. */
const backoffMs = (attempt: number): number => 1_000 * 3 ** attempt

/**
 * How long to ride out an overloaded model, and how many times.
 *
 * Overload is the one server status that is not breakage. The request was fine
 * and the key was fine; the provider shed it because the model had more work
 * than capacity at that instant, and the identical request usually lands a
 * little later. Sharing the generic 5xx schedule meant giving up about four
 * seconds in, which is nowhere near how long a model stays shed under load — so
 * a busy minute reached the user as a failed plan and read like a limit they
 * had done something wrong to hit.
 *
 * Three retries at 2s, 4s, 8s: roughly fifteen seconds of patience, jittered.
 * The jitter matters because a board is a run of these calls — retrying in
 * lockstep is how a queue that was clearing gets hit by the whole batch again.
 */
const OVERLOAD_RETRIES = 3
const overloadWaitMs = (retry: number): number =>
  Math.round(2_000 * 2 ** retry * (0.75 + Math.random() * 0.5))

/**
 * The statuses that mean "busy", by provider convention.
 *
 * Google says 503 and Anthropic says 529 for the same condition, and both mean
 * something different from the 500 that means a server actually broke.
 */
const isOverloaded = (status: number): boolean =>
  status === 503 || status === 529

/**
 * A rejected key, whatever status the vendor chose to say it with.
 *
 * 401 is the obvious one, but Gemini answers a bad key with a **400** and the
 * sentence "API key not valid" — so status alone would file the single most
 * common failure here as a malformed request and print it without the one piece
 * of advice that resolves it. Which is exactly what happened to the key that
 * prompted all of this: a Grok key sent to Google came back 400, and the app
 * said the request was wrong rather than that the key belonged to someone else.
 */
function isAuthFailure(status: number, detail: string): boolean {
  if (status === 401 || status === 403) return true
  if (status !== 400) return false
  // Specific phrasings only. A 400 is also how every adapter learns that a
  // field it sent does not exist, and mistaking one of those for a bad key
  // would turn a retreat it can recover from into a dead end.
  return /api[ _-]?key not valid|invalid[ _-]?api[ _-]?key|incorrect api[ _-]?key|api[ _-]?key expired|invalid authentication/i.test(
    detail
  )
}

/**
 * Said in full because this is the message that has already cost the user an
 * afternoon: the number they can change is not the number that refused them.
 */
const overloadedMessage = (ctx: CallContext, status: number): string =>
  `${ctx.label} is overloaded right now (${status}) — it shed the request instead of queueing it. ` +
  `That is ${ctx.label}'s own serving capacity, not a quota and not Day Deck's rate limit, so raising calls per minute in Settings cannot clear it. ` +
  'Day Deck already retried for about 15 seconds. Give it a minute and try again, or switch the model in Settings — a different model is a different pool.'

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
 * How long the provider itself asked us to wait.
 *
 * Two conventions, because the vendors disagree: OpenAI-shaped APIs and
 * Anthropic send a `retry-after` header in seconds, Gemini buries a `RetryInfo`
 * detail in the body. Ignoring both and retrying on our own schedule is what
 * turns one refused call into three, each one spending quota that was already
 * exhausted — which reads to the user as a limit they cannot raise, because the
 * limit being hit is not the one the app's own setting controls.
 */
export function askedToWaitMs(
  detail: string,
  headers?: Headers
): number | null {
  const header = headers?.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1_000)
  }

  const match = /retry[_-]?delay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(detail)
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : null
}

/**
 * One HTTP call to a provider, with the retry policy applied.
 *
 * `path` is appended to the context's base URL, so an adapter only ever states
 * the part of the URL that is its own business.
 */
export async function request(
  ctx: CallContext,
  path: string,
  { method = 'GET', body, headers = {}, timeoutMs = 30_000, attempts = 3 }: RequestOptions = {}
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
      response = await fetch(`${ctx.baseUrl}${path}`, {
        method,
        headers: {
          ...headers,
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      // A dead network will not heal inside a backoff; fail fast.
      throw classifyNetworkError(err, ctx)
    }

    if (response.ok) return response.json()

    const detail = await response.text().catch(() => '')

    if (isAuthFailure(response.status, detail)) {
      throw new AiError(
        `${ctx.label} rejected the API key: ${sentence(detail)} Check the key — and check that the provider beside it in Settings is the one the key came from, because a key from one vendor is always rejected by another.`,
        'auth',
        response.status
      )
    }
    if (response.status === 404) {
      // Worth its own sentence: on every provider here a 404 is overwhelmingly
      // a model id that does not exist on this account, not a broken URL.
      throw new AiError(
        `${ctx.label} has no such endpoint or model: ${trimDetail(detail)}. Pick a model from the list in Settings.`,
        'config',
        404
      )
    }
    if (response.status === 400 || response.status === 422) {
      throw new AiError(
        `${ctx.label} rejected the request: ${trimDetail(detail)}`,
        'unknown',
        400
      )
    }
    if (response.status === 429) {
      const asked = askedToWaitMs(detail, response.headers)
      const error = new AiError(
        asked === null
          ? `${ctx.label}'s own quota refused the call — this is ${ctx.label}'s limit, not Day Deck's, so raising the rate in Settings will not clear it.`
          : `${ctx.label}'s own quota is exhausted for about ${Math.ceil(
              asked / 1_000
            )}s — this is ${ctx.label}'s limit, not Day Deck's, so raising the rate in Settings will not clear it.`,
        'rate',
        429
      )
      // Retrying inside a window the provider has already priced is spending
      // the quota that refused us.
      if (asked !== null && asked > MAX_WAIT_MS) throw error
      if (retries >= attempts - 1) throw error
      waitMs = asked ?? backoffMs(retries)
      retries += 1
      continue
    }
    if (isOverloaded(response.status)) {
      const error = new AiError(
        overloadedMessage(ctx, response.status),
        'server',
        response.status
      )
      if (overloads >= OVERLOAD_RETRIES) throw error
      waitMs = overloadWaitMs(overloads)
      overloads += 1
      continue
    }
    if (response.status >= 500) {
      const error = new AiError(
        `${ctx.label} had a server error (${response.status}): ${trimDetail(detail)}`,
        'server',
        response.status
      )
      if (retries >= attempts - 1) throw error
      waitMs = backoffMs(retries)
      retries += 1
      continue
    }

    throw new AiError(
      `${ctx.label} returned ${response.status}: ${trimDetail(detail)}`,
      'unknown',
      response.status
    )
  }
}

/**
 * The sentence inside an error body.
 *
 * All three wire formats nest it the same way — `{ error: { message } }` — which
 * is the one thing the vendors happen to agree on.
 */
/**
 * A provider's own sentence, punctuated exactly once.
 *
 * Vendors are inconsistent about whether their message ends in a full stop, and
 * concatenating ours after one that does reads as a typo in the middle of the
 * only sentence the user is going to act on.
 */
function sentence(detail: string): string {
  const text = trimDetail(detail).trim()
  return /[.!?]$/.test(text) ? text : `${text}.`
}

export function trimDetail(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error?.message) return parsed.error.message
    if (parsed.message) return parsed.message
  } catch {
    /* fall through to the raw text */
  }
  return detail.slice(0, 300) || 'no detail provided'
}
