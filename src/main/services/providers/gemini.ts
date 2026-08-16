import type { AiModel } from '@shared/types'
import { AiError, type CallContext, request } from './http'
import {
  NON_TEXT,
  type JsonRequest,
  type TextRequest,
  type WireAdapter,
  guardTruncation
} from './wire'

/**
 * Google's own dialect.
 *
 * The oldest adapter here and the only one written against a single vendor
 * rather than a de-facto standard, which is why it carries the most retreats:
 * `generativelanguage` has changed the name of both the schema field and the
 * thinking field inside its own v1beta, and the only way to learn which one an
 * endpoint accepts is to be rejected by it.
 */

interface RawModel {
  name: string
  displayName?: string
  inputTokenLimit?: number
  supportedGenerationMethods?: string[]
}

/**
 * Read the model list at runtime rather than hardcoding it — Google deprecates
 * and adds models continuously, and a stale constant would silently break plan
 * generation months from now.
 */
async function listModels(ctx: CallContext): Promise<AiModel[]> {
  const data = (await request(ctx, '/models?pageSize=200', {
    headers: authHeaders(ctx),
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

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  'x-goog-api-key': ctx.apiKey
})

/**
 * `kind` decides what a cut-off response means — see `guardTruncation`.
 */
function extractText(
  payload: unknown,
  ctx: CallContext,
  kind: 'json' | 'prose' = 'json'
): string {
  const data = payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }>
    promptFeedback?: { blockReason?: string }
  }

  const blocked = data.promptFeedback?.blockReason
  if (blocked) {
    throw new AiError(
      `${ctx.label} declined to answer this (${blocked}).`,
      'unknown'
    )
  }

  const candidate = data.candidates?.[0]
  if (!candidate) {
    throw new AiError(`${ctx.label} returned no candidates.`, 'parse')
  }

  const text = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  return guardTruncation(
    text,
    candidate.finishReason === 'MAX_TOKENS',
    kind,
    ctx.label
  )
}

/**
 * A surface that predates a field says so by name, and the name is the only
 * reliable way to tell which retreat is worth a round trip. Anything else a 400
 * can mean — a prompt over the input limit, a model id that does not exist — is
 * the same rejection whatever we send next, so retrying it only spends another
 * request from the quota to be told the same thing.
 */
const REJECTED_THINKING = /thinking/i
const REJECTED_SCHEMA = /unknown name|json[_-]?schema/i

/**
 * One structured-JSON call, degrading only on what the API actually rejected.
 *
 * Both schema fields express the same thing; which one an endpoint accepts
 * depends on how new it is. The same is true of the thinking budget. Each
 * retreat is taken at most once, so a call costs at most three round trips and
 * usually one.
 */
async function generateJson(
  ctx: CallContext,
  req: JsonRequest
): Promise<string> {
  const path = `/models/${encodeURIComponent(req.model)}:generateContent`

  let thinking = true
  let newSchemaField = true

  for (;;) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: req.output,
        ...(thinking
          ? { thinkingConfig: { thinkingBudget: req.thinking } }
          : {}),
        ...(newSchemaField
          ? { responseJsonSchema: req.schema }
          : { responseSchema: req.schema })
      }
    }

    try {
      return extractText(
        await request(ctx, path, {
          method: 'POST',
          headers: authHeaders(ctx),
          timeoutMs: req.timeoutMs,
          body
        }),
        ctx
      )
    } catch (err) {
      // `kind` as well as status: Google answers a bad key with a 400 too, and
      // no field this loop can drop will make a rejected key work.
      if (!(err instanceof AiError) || err.status !== 400 || err.kind === 'auth') {
        throw err
      }

      // Order matters: an unknown-field 400 for thinkingConfig also reads as a
      // schema rejection, and dropping the budget is the cheaper retreat.
      if (thinking && REJECTED_THINKING.test(err.message)) {
        thinking = false
        continue
      }
      if (newSchemaField && REJECTED_SCHEMA.test(err.message)) {
        newSchemaField = false
        continue
      }
      throw err
    }
  }
}

/** Plain text out, not JSON — this is prose for a human. */
async function generateText(
  ctx: CallContext,
  req: TextRequest
): Promise<string> {
  const contents = [
    ...req.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: req.question }] }
  ]

  const payload = await request(
    ctx,
    `/models/${encodeURIComponent(req.model)}:generateContent`,
    {
      method: 'POST',
      headers: authHeaders(ctx),
      timeoutMs: req.timeoutMs,
      body: {
        contents,
        systemInstruction: { parts: [{ text: req.system }] },
        generationConfig: { temperature: 0.3, maxOutputTokens: req.output }
      }
    }
  )

  return extractText(payload, ctx, 'prose')
}

/**
 * One structured-JSON call that has clips to watch as well as text to read.
 *
 * Separate from `generateJson` rather than an option on it, because it is the
 * one call in the app whose parts are not all text — and `WireAdapter` should
 * not grow a `files` parameter that two of its three implementations would have
 * to refuse. Video-in is Google's, so it lives in Google's adapter.
 *
 * No retreat loop: the surfaces that accept `file_data` are new enough to
 * accept `responseJsonSchema` and `thinkingConfig` too, so the two round trips
 * `generateJson` spends learning that would be spent for nothing here.
 */
export async function generateJsonWithFiles(
  ctx: CallContext,
  req: JsonRequest,
  files: readonly { uri: string; mimeType: string }[]
): Promise<string> {
  const parts = [
    ...files.map((file) => ({
      file_data: { file_uri: file.uri, mime_type: file.mimeType }
    })),
    { text: req.prompt }
  ]

  return extractText(
    await request(
      ctx,
      `/models/${encodeURIComponent(req.model)}:generateContent`,
      {
        method: 'POST',
        headers: authHeaders(ctx),
        timeoutMs: req.timeoutMs,
        body: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: req.output,
            thinkingConfig: { thinkingBudget: req.thinking },
            responseJsonSchema: req.schema
          }
        }
      }
    ),
    ctx
  )
}

export const geminiWire: WireAdapter = { listModels, generateJson, generateText }
