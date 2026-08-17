import type { AiModel } from '@shared/types'
import { AiError, request, requestBinary, type CallContext } from './http'
import type {
  VideoAdapter,
  VideoOperation,
  VideoPoll,
  VideoRequest
} from './video-wire'

/**
 * OpenAI's `/videos` resource — the second video dialect, and the reason the
 * video slot is no longer a Google-only slot.
 *
 * The same three beats as Veo (submit, poll, download) arranged completely
 * differently. There is no long-running operation: creating a video returns a
 * video *object* with its own id and a `status` that walks
 * queued → in_progress → completed, and the bytes come from a sub-path of that
 * object rather than from a URI the response hands back. So `operation.name`
 * here is the video id, and `fetchBytes` is given a URL this file built rather
 * than one the provider named.
 *
 * Reached by `openai` and by `custom`. `custom` because a custom base URL means
 * the user knows what is behind it: a gateway proxying Sora, or a self-hosted
 * server implementing the same resource. One that does not answers 404, which
 * `http.ts` already turns into a sentence about a missing endpoint.
 */

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  authorization: `Bearer ${ctx.apiKey}`
})

/** Anything on this wire that makes video. Sora today, by name. */
const SORA_MODEL = /^sora/i

/**
 * What this provider will accept a generation on.
 *
 * The list endpoint is the chat one — there is no separate video model list —
 * so the filter is by name. That is weaker than Veo's method check and it is
 * the best available: `/models` says nothing about which resource a model
 * belongs to, and a model matched here that turns out not to be generable
 * fails at submit with the provider's own sentence.
 */
export async function listVideoModels(ctx: CallContext): Promise<AiModel[]> {
  const data = (await request(ctx, '/models', {
    headers: authHeaders(ctx),
    timeoutMs: 20_000
  })) as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> }

  const raw = data.data ?? data.models ?? []

  return raw
    .flatMap((m) =>
      typeof m.id === 'string' && SORA_MODEL.test(m.id)
        ? [{ id: m.id, displayName: m.name ?? m.id, inputTokenLimit: null }]
        : []
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * The lengths Sora will generate, in seconds.
 *
 * Not the same set as the board's own `OMNI_DURATIONS`, which is why this
 * mapping exists rather than passing the scene's number straight through: a
 * 6-second scene is a legal thing to plan and an illegal thing to ask for here.
 */
const SORA_SECONDS = [4, 8, 12] as const

/**
 * The nearest length this provider can actually make, rounding ties up.
 *
 * Up rather than down on purpose. Overshooting buys a couple of seconds of tail
 * that the trimmer drops in one gesture; undershooting cuts the end off the
 * action, and no amount of editing puts back footage that was never generated.
 */
export function soraSeconds(durationSec: number | null): number {
  if (durationSec === null) return 8
  // `<=` rather than `<`, and that is the tie-break: the list runs shortest
  // first, so a later candidate at an equal distance is the longer one and wins.
  return SORA_SECONDS.reduce((best, seconds) =>
    Math.abs(seconds - durationSec) <= Math.abs(best - durationSec)
      ? seconds
      : best
  )
}

/**
 * The frame size for an aspect ratio.
 *
 * Sora is asked for pixels, not a ratio, and it accepts a fixed handful of
 * them. An unrecognised ratio falls back to landscape rather than being passed
 * through: a made-up size is a 400 on a request the user has already waited
 * for, where landscape is at worst the wrong shape of a clip they can see.
 */
export function soraSize(aspectRatio: string): string {
  switch (aspectRatio.trim()) {
    case '9:16':
      return '720x1280'
    case '16:9':
      return '1280x720'
    default:
      return '1280x720'
  }
}

interface VideoObject {
  id?: string
  status?: string
  error?: { message?: string } | string | null
}

/**
 * Create the video. Returns as soon as it is queued, not when it is done.
 *
 * `sampleCount` is not sent, because this resource has no such field: it makes
 * exactly one video per request. Sending it anyway would be ignored, and the
 * run would come back one clip short of what was asked for with nothing to
 * point at. `maxSamples: 1` is what makes the caller ask for a number it can
 * actually get.
 */
export async function submit(
  ctx: CallContext,
  req: VideoRequest
): Promise<VideoOperation> {
  const payload = (await request(ctx, '/videos', {
    method: 'POST',
    headers: authHeaders(ctx),
    timeoutMs: 60_000,
    body: {
      model: req.model,
      prompt: req.prompt,
      // Strings, both of them — this endpoint documents them that way and
      // rejects the numeric form.
      seconds: String(soraSeconds(req.durationSec)),
      size: soraSize(req.aspectRatio)
    }
  })) as VideoObject

  if (!payload.id) {
    throw new AiError(
      `${ctx.label} accepted the request but returned no video id, so there is nothing to poll for the result.`,
      'parse'
    )
  }
  return { name: payload.id }
}

/** The statuses that mean the work is over, one way or the other. */
const FAILED = /^(failed|cancelled|canceled|error)$/i
const FINISHED = /^(completed|succeeded)$/i

/**
 * One look at a video object.
 *
 * Does not loop, for the same reason `veo.poll` does not: the caller owns the
 * schedule because the caller is what has to stay cancellable and report
 * progress. `attempts: 1` because a failed poll is answered by the next one.
 */
export async function poll(
  ctx: CallContext,
  operation: VideoOperation
): Promise<VideoPoll> {
  const payload = (await request(
    ctx,
    `/videos/${encodeURIComponent(operation.name)}`,
    { headers: authHeaders(ctx), timeoutMs: 30_000, attempts: 1 }
  )) as VideoObject

  const status = payload.status ?? ''

  if (FAILED.test(status)) {
    const detail =
      typeof payload.error === 'string'
        ? payload.error
        : (payload.error?.message ?? 'no reason given')
    throw new AiError(
      `${ctx.label} could not generate this shot: ${detail}`,
      'unknown'
    )
  }

  if (!FINISHED.test(status)) return { done: false }

  // The bytes live at a sub-path of the object, so the "sample uri" is one this
  // file builds. Absolute, because `fetchBytes` downloads from a URL rather
  // than a path — see the note on `RequestOptions.absolute`.
  return {
    done: true,
    samples: [
      {
        uri: `${ctx.baseUrl}/videos/${encodeURIComponent(operation.name)}/content`
      }
    ]
  }
}

export async function fetchBytes(
  ctx: CallContext,
  uri: string
): Promise<Buffer> {
  const bytes = await requestBinary(ctx, uri, {
    absolute: true,
    headers: authHeaders(ctx)
  })

  if (bytes.byteLength === 0) {
    throw new AiError(
      `${ctx.label} returned an empty file for a clip it reported as finished.`,
      'parse'
    )
  }
  return bytes
}

export const soraVideo: VideoAdapter = {
  // One video per request. Not a limit this app chose, and the reason
  // `maxSamples` is on the interface at all.
  maxSamples: 1,
  listModels: listVideoModels,
  submit,
  poll,
  fetchBytes
}
