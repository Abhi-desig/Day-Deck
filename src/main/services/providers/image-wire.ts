import type { AiModel } from '@shared/types'
import type { CallContext } from './http'

/**
 * What an image provider has to be able to do, in Day Deck's terms.
 *
 * The third registry in this directory, and a third one rather than more
 * methods on either of the first two because an image call is genuinely a third
 * shape. `WireAdapter` is request in, JSON out. `VideoAdapter` is submit → poll
 * a long-running operation → download bytes. This is request in, **bytes out**:
 * no operation to follow, but a body and a response neither of the other two
 * can express. Folding it into `WireAdapter` would put a `generate` that
 * returns images onto every text adapter, and two of the three would have to
 * refuse it.
 *
 * Two calls, because two is all the app asks for: what can you make, and make
 * it. Everything else — which prompt, which references, how many, the
 * guardrails, the rows — is provider-independent and lives in services/cast.ts,
 * which is the point of drawing the line here.
 */
export interface ImageAdapter {
  /**
   * How many images one request can return.
   *
   * Stated rather than assumed, which is the lesson `maxSamples` already paid
   * for: sent blindly, a count of four reaches a provider that makes one per
   * request as an ignored field. The request succeeds and quietly returns one
   * image, which is the wrong number to discover from a bill.
   */
  readonly maxImages: number
  /**
   * How many input references this provider accepts, 0 if none.
   *
   * Zero is a real answer and has to be sayable, because it is what
   * `/images/generations` supports: references there need `/images/edits`,
   * which is multipart, and every call in this app is JSON. A provider that
   * takes no reference can still generate a portrait — it just cannot build a
   * pack that is the *same* person, so the caller refuses the pack rather than
   * building five plausible strangers.
   */
  readonly maxReferences: number
  listModels(ctx: CallContext): Promise<AiModel[]>
  generate(ctx: CallContext, req: ImageRequest): Promise<ImageResult[]>
}

/**
 * An image going *into* a request.
 *
 * Bytes rather than a path or a URL: the provider needs the file, and the one
 * place in this app that reads a shot off disk is the service that owns the
 * directory. An adapter that took a path would be a second thing that knows
 * where portraits live.
 */
export interface ImageInput {
  bytes: Buffer
  mimeType: string
}

export interface ImageRequest {
  model: string
  prompt: string
  /**
   * Input images. The identity anchor for a pack shot, and the whole reason
   * this is a reference pack rather than five re-prompts.
   */
  references: ImageInput[]
  aspectRatio: string
  count: number
}

/** One generated image, as bytes. */
export interface ImageResult {
  bytes: Buffer
  mimeType: string
}
