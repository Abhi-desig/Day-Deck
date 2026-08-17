import type { AiModel } from '@shared/types'
import type { CallContext } from './http'

/**
 * What a video provider has to be able to do, in Day Deck's terms.
 *
 * The video counterpart of `WireAdapter`, and deliberately a separate interface
 * rather than four more methods on it. The two protocols are not two flavours
 * of one thing: a text call is request in, JSON out, where every video API is
 * submit → poll a long-running operation → download bytes. Folding them
 * together would put four methods on every text adapter that none of them can
 * implement.
 *
 * Four calls, because four is all the app asks for: what can you make, start
 * this, is it done, and give me the file. Everything else — the prompt, the
 * takes, the guardrails, the job row — is provider-independent and lives in
 * services/video.ts, which is the point of drawing the line here.
 *
 * Adding a provider that speaks an existing dialect is a line in
 * `PROVIDER_INFO`. Adding one that speaks its own is a file beside `veo.ts`
 * that implements this, plus a name in `VIDEO_WIRES` — exactly the two-tier
 * arrangement text providers already have.
 */
export interface VideoAdapter {
  /**
   * How many clips one submission can produce here.
   *
   * Stated rather than assumed because the vendors genuinely differ: Veo takes
   * a `sampleCount` and returns that many samples from one operation, where
   * OpenAI's `/videos` creates exactly one video per request. Sent blindly, a
   * `sampleCount` of three reaches the second as an ignored field — the request
   * succeeds and quietly returns one clip, which is the wrong number to
   * discover from a bill. The caller clamps to this instead.
   */
  readonly maxSamples: number
  /** The models this provider will actually accept a generation on. */
  listModels(ctx: CallContext): Promise<AiModel[]>
  /** Start the work. Returns as soon as it is queued, not when it is done. */
  submit(ctx: CallContext, req: VideoRequest): Promise<VideoOperation>
  /** One look at a running operation. Does not loop — the caller owns that. */
  poll(ctx: CallContext, operation: VideoOperation): Promise<VideoPoll>
  /** The clip itself. */
  fetchBytes(ctx: CallContext, uri: string): Promise<Buffer>
}

export interface VideoRequest {
  model: string
  prompt: string
  /** Seconds. Null means "the provider's own default length". */
  durationSec: number | null
  /** How many takes to ask for in one submission. */
  sampleCount: number
  aspectRatio: string
  negativePrompt?: string
}

/**
 * How a submitted generation is referred to until it finishes.
 *
 * A string, because it is written to a job row and re-read after a restart —
 * anything richer would be state this app has to keep in sync with a provider
 * it cannot query about it.
 */
export interface VideoOperation {
  name: string
}

/** One finished clip, as the operation describes it. */
export interface VideoSample {
  uri: string
}

export type VideoPoll = { done: false } | { done: true; samples: VideoSample[] }
