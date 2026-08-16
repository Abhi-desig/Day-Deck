import type { AiModel } from '@shared/types'
import { AiError, request, requestBinary, type CallContext } from './http'
import { isVideoModel } from './wire'
import type {
  VideoAdapter,
  VideoOperation,
  VideoPoll,
  VideoRequest,
  VideoSample
} from './video-wire'

/**
 * Video generation, which does not fit `WireAdapter` and should not be made to.
 *
 * Every other call in this app is request in, JSON out. This one is submit,
 * then poll a long-running operation for a minute or three, then download bytes
 * from a URI the operation hands back. Widening `WireAdapter` to cover that
 * would put four methods no text provider can implement onto every adapter, so
 * this is a parallel surface instead — a small one, and Google-only, because
 * the shape is Google's.
 *
 * What it does *not* do is open its own socket: `submit`, `poll` and
 * `fetchBytes` all go through `http.ts`, which is what gives a refused video key
 * the same sentence as a refused prompt key rather than a second, worse copy of
 * the same logic.
 */

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  'x-goog-api-key': ctx.apiKey
})

/**
 * Veo is Google's, and only Google's.
 *
 * Checked here rather than at the call site so the message names the mismatch
 * instead of letting an OpenAI base URL answer 404 for a path it has never had
 * — which reads as a missing model rather than as a slot pointed at the wrong
 * vendor.
 */
function assertGoogle(ctx: CallContext): void {
  if (ctx.provider !== 'gemini') {
    throw new AiError(
      `Video generation is Google's Veo, but the video slot is set to ${ctx.label}. Set the video slot to Google Gemini in Settings and give it a key with billing enabled.`,
      'config'
    )
  }
}

/**
 * The models the video slot may be pointed at.
 *
 * Filtered on the generation method the submit call actually uses, not on the
 * name — a model that cannot do `predictLongRunning` is a model this file
 * cannot drive, whatever it is called. The name check stays as a second gate
 * because the list endpoint has been known to advertise the method on models
 * that then refuse it.
 */
export async function listVideoModels(ctx: CallContext): Promise<AiModel[]> {
  assertGoogle(ctx)

  const data = (await request(ctx, '/models?pageSize=200', {
    headers: authHeaders(ctx),
    timeoutMs: 20_000
  })) as {
    models?: Array<{
      name: string
      displayName?: string
      supportedGenerationMethods?: string[]
    }>
  }

  return (data.models ?? [])
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      displayName: m.displayName ?? m.name.replace(/^models\//, ''),
      inputTokenLimit: null,
      methods: m.supportedGenerationMethods ?? []
    }))
    .filter(
      (m) => isVideoModel(m.id) && m.methods.includes('predictLongRunning')
    )
    .map(({ id, displayName, inputTokenLimit }) => ({
      id,
      displayName,
      inputTokenLimit
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Ask for the clip. Returns as soon as the work is queued, not when it is done.
 *
 * Short timeout on purpose: this call only has to hand back an operation name.
 * If *this* is slow something is wrong with the request, and waiting three
 * minutes to find that out helps nobody — the waiting belongs in `poll`.
 */
export async function submit(
  ctx: CallContext,
  req: VideoRequest
): Promise<VideoOperation> {
  assertGoogle(ctx)

  const payload = (await request(
    ctx,
    `/models/${encodeURIComponent(req.model)}:predictLongRunning`,
    {
      method: 'POST',
      headers: authHeaders(ctx),
      timeoutMs: 60_000,
      body: {
        instances: [{ prompt: req.prompt }],
        parameters: {
          sampleCount: req.sampleCount,
          aspectRatio: req.aspectRatio,
          ...(req.durationSec ? { durationSeconds: req.durationSec } : {}),
          ...(req.negativePrompt?.trim()
            ? { negativePrompt: req.negativePrompt.trim() }
            : {})
        }
      }
    }
  )) as { name?: string }

  if (!payload.name) {
    throw new AiError(
      `${ctx.label} accepted the request but named no operation to follow, so there is nothing to poll for the result.`,
      'parse'
    )
  }
  return { name: payload.name }
}

/**
 * One look at a running operation.
 *
 * Deliberately does not loop: the caller owns the schedule, because the caller
 * is the one that has to stay cancellable and report progress. `attempts: 1`
 * for the same reason — a poll that fails is answered by the next poll a few
 * seconds later, so retrying inside one is just a slower poll.
 */
export async function poll(
  ctx: CallContext,
  operation: VideoOperation
): Promise<VideoPoll> {
  const payload = (await request(ctx, `/${operation.name}`, {
    headers: authHeaders(ctx),
    timeoutMs: 30_000,
    attempts: 1
  })) as {
    done?: boolean
    error?: { message?: string; code?: number }
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string } }>
        raiMediaFilteredReasons?: string[]
      }
      generatedVideos?: Array<{ video?: { uri?: string } }>
    }
  }

  if (!payload.done) return { done: false }

  if (payload.error) {
    throw new AiError(
      `${ctx.label} could not generate this shot: ${
        payload.error.message ?? 'no reason given'
      }`,
      'unknown'
    )
  }

  const samples = readSamples(payload.response)

  if (samples.length === 0) {
    // A finished operation with no clip is nearly always the safety filter,
    // which says so in its own field. Worth quoting: the prompt is fixable, and
    // "no video came back" is not the sentence that tells you that.
    const filtered =
      payload.response?.generateVideoResponse?.raiMediaFilteredReasons ?? []
    throw new AiError(
      filtered.length > 0
        ? `${ctx.label} filtered this shot rather than generating it: ${filtered.join('; ')}. Rewrite the prompt and try again.`
        : `${ctx.label} finished the job but returned no clip.`,
      'unknown'
    )
  }

  return { done: true, samples }
}

/**
 * Both shapes the operation has been seen to use.
 *
 * `generatedSamples` is what the v1beta long-running response documents;
 * `generatedVideos` is what the newer surface returns for the same thing.
 * Reading both is three lines and means a rollout on Google's side does not
 * land here as "the job finished but there was no clip in it".
 */
function readSamples(
  response:
    | {
        generateVideoResponse?: {
          generatedSamples?: Array<{ video?: { uri?: string } }>
        }
        generatedVideos?: Array<{ video?: { uri?: string } }>
      }
    | undefined
): VideoSample[] {
  const raw = [
    ...(response?.generateVideoResponse?.generatedSamples ?? []),
    ...(response?.generatedVideos ?? [])
  ]
  return raw.flatMap((s) => (s.video?.uri ? [{ uri: s.video.uri }] : []))
}

/**
 * The clip itself.
 *
 * The URI is absolute and on a host of the provider's choosing, so this is the
 * one caller of `requestBinary`'s `absolute` mode. It still needs the key: the
 * download is authenticated the same way the submission was.
 */
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

/**
 * Google's video dialect, as one entry in the registry.
 *
 * The `assertGoogle` guard inside each call stays even though the registry only
 * ever hands this adapter a Gemini context: it is the thing that makes a
 * mis-wired `PROVIDER_INFO` entry fail with a sentence instead of sending
 * `:predictLongRunning` to a host that has never had that path.
 */
export const veoVideo: VideoAdapter = {
  listModels: listVideoModels,
  submit,
  poll,
  fetchBytes
}
