import type { AgentMessage, AiModel } from '@shared/types'
import { AiError } from './http'

/**
 * What every provider has to be able to do, expressed in Day Deck's terms
 * rather than any vendor's.
 *
 * Three calls, because three is all the app ever asks for: what models are
 * there, answer this in JSON, and answer this in prose. Everything else — the
 * prompts, the schemas, the parsing, the budgets — is provider-independent and
 * lives in services/ai.ts, which is the point of drawing the line here.
 */
export interface WireAdapter {
  listModels(ctx: import('./http').CallContext): Promise<AiModel[]>
  generateJson(
    ctx: import('./http').CallContext,
    req: JsonRequest
  ): Promise<string>
  generateText(
    ctx: import('./http').CallContext,
    req: TextRequest
  ): Promise<string>
}

/**
 * What one structured-JSON call is allowed to spend.
 *
 * `thinking` is the number that moves the bill. Left to the provider, a model
 * decides for itself how long to reason before answering, and those tokens are
 * charged as output — on prompts this size routinely several times the visible
 * answer. That is what puts a board's worth of calls through a tokens-per-minute
 * quota long before it goes near a requests-per-minute one, which is why raising
 * the calls-per-minute setting does not help a run that keeps being refused.
 *
 * Every caller states its own budget, because how much thought a job is worth is
 * a per-job answer: breaking a brief into shots deserves some, sorting the
 * user's own words into named boxes deserves none. Each adapter spends it in
 * whatever currency its vendor accepts.
 */
export interface JsonRequest {
  model: string
  prompt: string
  schema: unknown
  timeoutMs: number
  /** Caps thinking and answer together. Never below the answer plus thinking. */
  output: number
  /**
   * The smallest ceiling this job can still be answered under.
   *
   * `output` is a generous worst case, which is the right thing to reserve and
   * the wrong thing to insist on: a provider that meters credit holds the whole
   * ceiling before it runs anything, so an account with a little left refuses a
   * call whose answer would have used a fraction of it. This is the number that
   * says how far the ask may be cut to fit — below it the answer would arrive
   * truncated, which fails the job anyway and more confusingly.
   */
  minOutput: number
  thinking: number
}

export interface TextRequest {
  model: string
  system: string
  history: AgentMessage[]
  question: string
  timeoutMs: number
  output: number
  /** As `JsonRequest.minOutput`. Prose survives a trim better than JSON does. */
  minOutput: number
}

/**
 * What to re-ask for after a credit refusal, or null to give up.
 *
 * Three ways this is not a retry. It only fires when the provider named a
 * figure, so the new ask is known to fit rather than guessed at. It only fires
 * when that figure is strictly smaller, so a chain of these terminates. And it
 * refuses to drop below the caller's floor, because an answer cut off halfway
 * is not a cheaper success — it is the same failure with a worse explanation.
 */
export function affordableCeiling(
  err: AiError,
  ceiling: number,
  floor: number
): number | null {
  const affordable = err.affordable
  if (affordable === undefined || affordable >= ceiling) return null
  return affordable >= floor ? affordable : null
}

/**
 * The thinking budget, as the tiers the OpenAI-shaped APIs accept.
 *
 * A token count is the more expressive knob and it is what the callers state,
 * so the tiering happens here rather than making every caller learn two
 * vocabularies. The thresholds line up with the budgets actually in use: 0 for
 * sorting words into boxes, 512 for restating settled wording, 1024–4096 for
 * work that is genuinely deliberation.
 */
export function effortTier(thinking: number): 'minimal' | 'low' | 'medium' | 'high' {
  if (thinking <= 0) return 'minimal'
  if (thinking <= 512) return 'low'
  if (thinking <= 2_048) return 'medium'
  return 'high'
}

/**
 * The schema, stated in the prompt.
 *
 * Two of the three wires have no reliable structured-output field — Anthropic
 * has none at all, and the OpenAI-compatible servers behind `custom` implement
 * `response_format` to wildly varying degrees. Describing the shape in the
 * prompt is the one technique that works everywhere, so it is applied
 * everywhere rather than only where it is strictly needed: when the native
 * field is honoured too, this block is harmless redundancy, and when it is
 * quietly ignored it is the only thing standing between us and prose.
 */
export function schemaInstruction(schema: unknown): string {
  return [
    '',
    'OUTPUT FORMAT:',
    'Reply with a single JSON object and nothing else. No prose before or after it, no code fence, no explanation.',
    'It must match this JSON schema exactly:',
    JSON.stringify(schema, null, 2)
  ].join('\n')
}

/**
 * Strip whatever wrapping survived the instruction above.
 *
 * A model told not to use a code fence will occasionally use one anyway, and
 * throwing away an otherwise perfect answer over three backticks would be the
 * wrong trade. Leading prose before the first `{` is cut for the same reason.
 */
export function unwrapJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)
  const body = (fenced ? fenced[1] : text).trim()

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start > 0 && end > start) return body.slice(start, end + 1)
  return body
}

/**
 * What a cut-off response means, stated once for every adapter.
 *
 * Half a JSON document is unusable and has to fail loudly; half an answer is
 * still an answer, so the agent keeps what arrived rather than throwing away a
 * useful reply over its last sentence.
 */
export function guardTruncation(
  text: string,
  truncated: boolean,
  kind: 'json' | 'prose',
  label: string
): string {
  if (truncated) {
    if (kind === 'json' || !text) {
      throw new AiError(
        'The response was cut off before it finished. Ask for less in one go — a shorter curriculum, or fewer scenes on the board.',
        'truncated'
      )
    }
    return `${text}…`
  }

  if (!text) throw new AiError(`${label} returned an empty response.`, 'parse')
  return text
}

/** Models that exist but cannot do what Day Deck needs. */
export const NON_TEXT =
  /embedding|embed|aqa|imagen|veo|tts|whisper|dall-e|dalle|moderation|rerank|guard|computer-use|live|audio|image|video|vision-encoder|transcribe|realtime/i

/**
 * The models the video slot may be pointed at.
 *
 * An allowlist rather than the inverse of `NON_TEXT`, and the two do not meet:
 * `NON_TEXT` answers "can this model hold a conversation", which every text
 * picker asks, and this answers "can this model make a clip Day Deck knows how
 * to collect". A model that fails both questions — an embedder, say — must not
 * fall into the video picker just because it was excluded from the text one.
 *
 * Veo only, today. The generate/poll/download shape in `veo.ts` is Google's, so
 * offering anything else here would be offering a button that cannot work.
 */
export const VIDEO_MODELS = /veo/i

/**
 * Models that generate but cannot be *asked* for, on this wire.
 *
 * The `-generate-preview`-style aliases are real model ids that the list
 * endpoint returns and `predictLongRunning` refuses, which reads as a broken
 * button rather than as a model that was never usable.
 */
export const isVideoModel = (id: string): boolean =>
  VIDEO_MODELS.test(id) && !/embed|upscale/i.test(id)

/**
 * The models the image slot may be pointed at.
 *
 * A third allowlist for the third question, and it does not meet either of the
 * other two for the same reason they do not meet each other: "can this hold a
 * conversation", "can this make a clip", and "can this make a still" are three
 * different questions, and a model excluded from one has not thereby answered
 * the others.
 *
 * Broad on purpose — the vendors name these models nothing like each other, and
 * the endpoint is the real gate: a Gemini id only reaches the picker if the list
 * endpoint also says it does `generateContent`.
 */
export const IMAGE_MODELS = /image|imagen|dall-?e|flux|photon/i

export const isImageModel = (id: string): boolean =>
  IMAGE_MODELS.test(id) && !/embed|vision-encoder|moderation/i.test(id)
