import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  AiError,
  request,
  requestWithHeaders,
  type CallContext
} from './http'

/**
 * Uploading a clip so a model can watch it.
 *
 * Gemini accepts video natively, but only by reference: the bytes go to the
 * Files API first and the generate call cites the returned URI. This is that
 * upload, and it is a three-step handshake rather than a POST —
 * start (which answers with a URL in a *header*), upload, then wait for the
 * file to finish processing on their side.
 *
 * Google-only, like `veo.ts`, and for the same reason: the shape is Google's.
 * A file uploaded here expires after 48 hours, which is fine — the app uploads
 * per request and never treats a URI as durable.
 */

export interface UploadedFile {
  /** The `files/xyz` name, for polling and deletion. */
  name: string
  /** The URI a generate call cites in a `file_data` part. */
  uri: string
  mimeType: string
}

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  'x-goog-api-key': ctx.apiKey
})

/**
 * The upload host.
 *
 * Same origin, different path prefix — `/upload/v1beta/files` rather than
 * `/v1beta/files`. Derived from the context's base URL rather than hardcoded so
 * it still points at the right place if that base ever moves.
 */
function uploadUrl(ctx: CallContext): string {
  const match = /^(https?:\/\/[^/]+)(\/.*)?$/.exec(ctx.baseUrl)
  if (!match) {
    throw new AiError(
      `Cannot work out where to upload to from ${ctx.baseUrl}.`,
      'config'
    )
  }
  return `${match[1]}/upload${match[2] ?? ''}/files`
}

/**
 * Send one file and wait for it to be ready to reference.
 *
 * The wait is not optional. A file is `PROCESSING` for a few seconds after the
 * bytes land, and a generate call that cites it in that window is rejected with
 * a message about the file not being active — which reads as a broken upload
 * rather than as one that simply had not finished.
 */
export async function uploadFile(
  ctx: CallContext,
  path: string,
  mimeType = 'video/mp4'
): Promise<UploadedFile> {
  if (ctx.provider !== 'gemini') {
    throw new AiError(
      `Reading video is Google's Files API, but this slot is set to ${ctx.label}. Set the prompts slot to Google Gemini in Settings to have the AI watch the clips.`,
      'config'
    )
  }

  const bytes = readFileSync(path)

  const start = await requestWithHeaders(ctx, uploadUrl(ctx), {
    method: 'POST',
    absolute: true,
    timeoutMs: 60_000,
    headers: {
      ...authHeaders(ctx),
      'x-goog-upload-protocol': 'resumable',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(bytes.byteLength),
      'x-goog-upload-header-content-type': mimeType
    },
    body: { file: { display_name: basename(path) } }
  })

  const target = start.headers.get('x-goog-upload-url')
  if (!target) {
    throw new AiError(
      `${ctx.label} did not say where to upload the clip to.`,
      'parse'
    )
  }

  const finished = (await request(ctx, target, {
    method: 'POST',
    absolute: true,
    raw: bytes,
    // Minutes: this is a video file going up, and the default 30s ceiling would
    // abort an upload that was progressing perfectly well.
    timeoutMs: 300_000,
    // A failed upload is re-attempted by re-running the whole handshake, not by
    // replaying the body against a URL that may have consumed part of it.
    attempts: 1,
    headers: {
      ...authHeaders(ctx),
      'content-type': mimeType,
      'content-length': String(bytes.byteLength),
      'x-goog-upload-offset': '0',
      'x-goog-upload-command': 'upload, finalize'
    }
  })) as { file?: { name?: string; uri?: string; mimeType?: string } }

  const file = finished.file
  if (!file?.uri || !file.name) {
    throw new AiError(
      `${ctx.label} accepted the clip but named no file to reference.`,
      'parse'
    )
  }

  await waitUntilActive(ctx, file.name)

  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntilActive(ctx: CallContext, name: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const file = (await request(ctx, `/${name}`, {
      headers: authHeaders(ctx),
      timeoutMs: 20_000,
      attempts: 1
    })) as { state?: string; error?: { message?: string } }

    if (file.state === 'ACTIVE') return
    if (file.state === 'FAILED') {
      throw new AiError(
        `${ctx.label} could not process the clip: ${
          file.error?.message ?? 'no reason given'
        }`,
        'unknown'
      )
    }
    await sleep(2_000)
  }

  throw new AiError(
    `${ctx.label} is still processing the clip after a minute. Try again in a moment.`,
    'server'
  )
}

/**
 * Tidy up.
 *
 * Files expire on their own after 48 hours, so this is politeness rather than
 * correctness — but leaving a board's worth of video sitting in someone's
 * Google project because the app could not be bothered is not a good default.
 * Failures are swallowed for the same reason: a cleanup that fails must not
 * fail the cut it was cleaning up after.
 */
export async function deleteFile(
  ctx: CallContext,
  name: string
): Promise<void> {
  try {
    // requestWithHeaders, not request: a DELETE answers 200 with an empty body,
    // and `response.json()` on nothing throws.
    await requestWithHeaders(ctx, `/${name}`, {
      method: 'DELETE',
      headers: authHeaders(ctx),
      timeoutMs: 20_000,
      attempts: 1
    })
  } catch {
    /* expires on its own */
  }
}
