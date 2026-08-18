import type { AiModel } from '@shared/types'
import {
  AiError,
  request,
  requestBinary,
  requestMultipart,
  type CallContext
} from './http'
import { isImageModel } from './wire'
import type { ImageAdapter, ImageRequest, ImageResult } from './image-wire'

/**
 * Image generation, the OpenAI dialect.
 *
 * Second of the two, and the harder one — which is the whole reason Gemini
 * ships first. `/images/generations` takes a prompt and nothing else: there is
 * no field on it for an input image, so on that endpoint a "reference pack"
 * could only ever be five separate people who each match the description.
 * References live on `/images/edits`, which is **multipart** where every other
 * call in this app is JSON, and that is why `requestMultipart` exists.
 *
 * Both paths still go through `http.ts`, so a refused image key reads the same
 * as a refused prompt key.
 */

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  authorization: `Bearer ${ctx.apiKey}`
})

const IMAGE_TIMEOUT_MS = 180_000

/**
 * The size to ask for, from the aspect the caller wanted.
 *
 * This endpoint takes pixel dimensions, not a ratio, and it accepts only the
 * handful below — an unrecognised string is a 400, not a nearest match. So
 * anything this table does not know becomes `auto` and lets the model choose,
 * which is a worse framing than the user asked for but is not a failed call.
 */
const SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '3:2': '1536x1024',
  '4:3': '1536x1024',
  '21:9': '1536x1024',
  '9:16': '1024x1536',
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '4:5': '1024x1536'
}

const sizeFor = (aspect: string): string => SIZES[aspect.trim()] ?? 'auto'

async function listModels(ctx: CallContext): Promise<AiModel[]> {
  const data = (await request(ctx, '/models', {
    headers: authHeaders(ctx),
    timeoutMs: 20_000
  })) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string }> }

  const raw = data.data ?? data.models ?? []

  return raw
    .flatMap((m) => (typeof m.id === 'string' && m.id ? [m.id] : []))
    .filter((id) => isImageModel(id))
    .map((id) => ({ id, displayName: id, inputTokenLimit: null }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string }>
}

/**
 * The bytes out of an images response, whichever way the model returned them.
 *
 * Two shapes, because the models disagree and the parameter that used to settle
 * it is refused by the newer one: `gpt-image-1` always answers with base64 and
 * rejects `response_format` outright, where the DALL·E models default to a
 * short-lived URL. Reading both is a few lines and means a picker that offers
 * either does not have a model in it that silently produces nothing.
 */
async function readImages(
  ctx: CallContext,
  payload: unknown
): Promise<ImageResult[]> {
  const rows = (payload as ImagesResponse).data ?? []
  const out: ImageResult[] = []

  for (const row of rows) {
    if (row.b64_json) {
      out.push({
        bytes: Buffer.from(row.b64_json, 'base64'),
        mimeType: 'image/png'
      })
      continue
    }
    if (row.url) {
      out.push({
        bytes: await requestBinary(ctx, row.url, { absolute: true }),
        mimeType: 'image/png'
      })
    }
  }

  if (out.length === 0) {
    throw new AiError(
      `${ctx.label} returned no image for this request.`,
      'parse'
    )
  }
  return out
}

async function generate(
  ctx: CallContext,
  req: ImageRequest
): Promise<ImageResult[]> {
  const size = sizeFor(req.aspectRatio)

  if (req.references.length === 0) {
    return readImages(
      ctx,
      await request(ctx, '/images/generations', {
        method: 'POST',
        headers: authHeaders(ctx),
        timeoutMs: IMAGE_TIMEOUT_MS,
        body: {
          model: req.model,
          prompt: req.prompt,
          n: req.count,
          ...(size === 'auto' ? {} : { size })
        }
      })
    )
  }

  // The reference path. `image` is repeated once per file rather than sent as
  // an array field, which is what this endpoint expects and what makes the
  // approved portrait an *input* rather than a second description of one.
  const form = new FormData()
  form.append('model', req.model)
  form.append('prompt', req.prompt)
  form.append('n', String(req.count))
  if (size !== 'auto') form.append('size', size)

  req.references.forEach((ref, i) => {
    form.append(
      'image[]',
      new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }),
      `reference-${i + 1}.png`
    )
  })

  return readImages(
    ctx,
    await requestMultipart(ctx, '/images/edits', form, {
      headers: authHeaders(ctx),
      timeoutMs: IMAGE_TIMEOUT_MS
    })
  )
}

export const openaiImage: ImageAdapter = {
  // One image per request. `n` goes higher on `gpt-image-1`, and DALL·E 3
  // refuses anything above one outright — so the number that is true of every
  // model this picker offers is one, and the app never asks for more.
  maxImages: 1,
  // One reference. `gpt-image-1` accepts several on `/images/edits`; the older
  // edit surface takes exactly one. One is the number every model behind this
  // wire honours, and one — the approved portrait — is all the pack ever sends.
  maxReferences: 1,
  listModels,
  generate
}
