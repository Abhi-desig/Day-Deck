import type { AiModel } from '@shared/types'
import { AiError, type CallContext, request } from './http'
import {
  NON_TEXT,
  type JsonRequest,
  type TextRequest,
  type WireAdapter,
  guardTruncation,
  schemaInstruction,
  unwrapJson
} from './wire'

/**
 * The Messages API.
 *
 * Its own adapter rather than a variant of the OpenAI one because three things
 * differ in ways no amount of shared code would hide: the system prompt is a
 * top-level field rather than a message, `max_tokens` is required rather than
 * optional, and there is no structured-output field at all.
 */

const VERSION = '2023-06-01'

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  'x-api-key': ctx.apiKey,
  'anthropic-version': VERSION
})

interface RawModel {
  id: string
  display_name?: string
}

async function listModels(ctx: CallContext): Promise<AiModel[]> {
  const data = (await request(ctx, '/models?limit=1000', {
    headers: authHeaders(ctx),
    timeoutMs: 20_000
  })) as { data?: RawModel[] }

  return (data.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      // The list endpoint does not report context windows. Saying null is
      // better than quoting a number this app would be inventing.
      inputTokenLimit: null
    }))
    .filter((m) => !NON_TEXT.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
}

interface ContentBlock {
  type?: string
  text?: string
}

function extractText(
  payload: unknown,
  ctx: CallContext,
  kind: 'json' | 'prose'
): string {
  const data = payload as {
    content?: ContentBlock[]
    stop_reason?: string
  }

  const blocks = data.content ?? []
  if (blocks.length === 0) {
    throw new AiError(`${ctx.label} returned no content.`, 'parse')
  }

  // Only `text` blocks are the answer. A thinking block is deliberation, and
  // concatenating it into the reply is how reasoning ends up inside a prompt
  // that gets pasted into a video generator.
  const text = blocks
    .filter((b) => b.type === undefined || b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()

  return guardTruncation(text, data.stop_reason === 'max_tokens', kind, ctx.label)
}

/**
 * One structured-JSON call.
 *
 * There is no JSON mode here, so the shape is carried by the prompt and the
 * answer is forced open with a prefilled assistant turn: the reply is
 * *continuing* an object that has already been opened, which leaves it nowhere
 * to put a preamble. That is the reliable technique on this API, and it is
 * worth more than extended thinking would be — the two are mutually exclusive,
 * since a thinking response cannot be prefilled.
 *
 * So the budget is deliberately not spent here. A cut-off or chatty answer
 * fails the whole plan; a slightly less deliberated breakdown does not.
 */
async function generateJson(
  ctx: CallContext,
  req: JsonRequest
): Promise<string> {
  const payload = await request(ctx, '/messages', {
    method: 'POST',
    headers: authHeaders(ctx),
    timeoutMs: req.timeoutMs,
    body: {
      model: req.model,
      max_tokens: req.output,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: `${req.prompt}\n${schemaInstruction(req.schema)}`
        },
        { role: 'assistant', content: '{' }
      ]
    }
  })

  // The prefill is not echoed back, so the opening brace has to be put back on
  // before anything tries to parse it.
  return unwrapJson(`{${extractText(payload, ctx, 'json')}`)
}

async function generateText(
  ctx: CallContext,
  req: TextRequest
): Promise<string> {
  const payload = await request(ctx, '/messages', {
    method: 'POST',
    headers: authHeaders(ctx),
    timeoutMs: req.timeoutMs,
    body: {
      model: req.model,
      max_tokens: req.output,
      temperature: 0.3,
      system: req.system,
      messages: [
        ...req.history.map((m) => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.text
        })),
        { role: 'user', content: req.question }
      ]
    }
  })

  return extractText(payload, ctx, 'prose')
}

export const anthropicWire: WireAdapter = {
  listModels,
  generateJson,
  generateText
}
