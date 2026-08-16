import type { AiModel } from '@shared/types'
import { AiError, type CallContext, request } from './http'
import {
  NON_TEXT,
  type JsonRequest,
  type TextRequest,
  type WireAdapter,
  affordableCeiling,
  effortTier,
  guardTruncation,
  schemaInstruction,
  unwrapJson
} from './wire'

/**
 * The chat-completions shape, which most of the industry now speaks.
 *
 * One adapter, six vendors: xAI, OpenAI, Groq, DeepSeek, Mistral and
 * OpenRouter all accept this body at their own base URL, and so does every
 * self-hosted server anyone is likely to point `custom` at — Ollama, LM Studio,
 * vLLM, LiteLLM. That is the whole reason a Grok key now works: nothing here is
 * xAI-specific, it is the same request with a different host and a different
 * bearer token.
 *
 * The cost of that reach is that "OpenAI-compatible" is a claim, not a
 * standard. Servers disagree about which optional fields exist, and a field one
 * accepts another rejects outright with a 400. So the request starts at the
 * richest form and gives up one field at a time, only ever on an explicit
 * rejection that names the field — see `generateJson`.
 */

const authHeaders = (ctx: CallContext): Record<string, string> => ({
  authorization: `Bearer ${ctx.apiKey}`
})

interface RawModel {
  id: string
  /** OpenRouter and some gateways send a friendly name; OpenAI does not. */
  name?: string
  context_length?: number
  /** Ollama and LiteLLM sometimes nest limits here instead. */
  context_window?: number
}

async function listModels(ctx: CallContext): Promise<AiModel[]> {
  const data = (await request(ctx, '/models', {
    headers: authHeaders(ctx),
    timeoutMs: 20_000
  })) as { data?: RawModel[]; models?: RawModel[] }

  // `data` is the documented envelope; `models` is what a couple of local
  // servers send instead. Accepting both costs one `??`.
  const raw = data.data ?? data.models ?? []

  return raw
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({
      id: m.id,
      displayName: m.name ?? m.id,
      inputTokenLimit: m.context_length ?? m.context_window ?? null
    }))
    .filter((m) => !NON_TEXT.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
}

interface ChatChoice {
  message?: { content?: string | Array<{ text?: string }> }
  finish_reason?: string
}

/**
 * Pull the answer out, tolerating the two content shapes in the wild.
 *
 * `content` is a plain string in the original spec and an array of parts on
 * servers that back-ported the newer multi-part format. Both appear behind
 * `custom`, and the difference is invisible until a local server returns the
 * one this app does not read.
 */
function extractText(
  payload: unknown,
  ctx: CallContext,
  kind: 'json' | 'prose'
): string {
  const data = payload as { choices?: ChatChoice[] }
  const choice = data.choices?.[0]

  if (!choice) {
    throw new AiError(`${ctx.label} returned no choices.`, 'parse')
  }

  const content = choice.message?.content
  const text = (
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((p) => p.text ?? '').join('')
        : ''
  ).trim()

  return guardTruncation(text, choice.finish_reason === 'length', kind, ctx.label)
}

/**
 * Which optional field a 400 was actually about.
 *
 * Matching on the field name rather than on the status alone is what keeps a
 * retreat from being a guess: a 400 that never names one of these is the same
 * rejection whatever we send next — a context overflow, a model this account
 * cannot reach — and retrying it just spends another request to be told the
 * same thing.
 */
const REJECTED = {
  reasoning: /reasoning_effort|reasoning/i,
  jsonSchema: /json_schema|response_format/i,
  maxCompletion: /max_completion_tokens/i,
  temperature: /temperature/i
}

/**
 * Whether this 400 is worth another round trip at all.
 *
 * `kind` as well as status: a rejected key can arrive as a 400 too, and no
 * field this loop is able to drop will make one work.
 */
const canRetreat = (err: unknown): err is AiError =>
  err instanceof AiError && err.status === 400 && err.kind !== 'auth'

/**
 * How many times a call may shrink itself to fit a balance.
 *
 * One is the case that exists: the gateway states what the account can afford
 * and the next request asks for exactly that. The second is for a balance that
 * moved between the two — someone else's job billing against the same account
 * — and past that a shrinking sequence has stopped being one request and
 * started being a spiral.
 */
const MAX_CREDIT_RETREATS = 2

/**
 * One structured-JSON call, degrading only on what the server actually
 * rejected.
 *
 * The schema goes into the prompt on every attempt regardless of
 * `response_format`, because a server that silently ignores the field is far
 * more common here than one that rejects it — and a silent ignore is the case
 * that produces prose where JSON was expected. The native field is treated as
 * an optimisation on top of the instruction, never as the thing being relied
 * on.
 */
async function generateJson(ctx: CallContext, req: JsonRequest): Promise<string> {
  const prompt = `${req.prompt}\n${schemaInstruction(req.schema)}`

  // Each of these is given up at most once, in the order that costs least.
  let reasoning = req.thinking > 0
  let jsonMode = true
  let modernTokenField = true
  let temperature = true

  // Not a field to give up but a number to lower, and only ever to one the
  // provider has already said it will accept.
  let ceiling = req.output
  let creditRetreats = 0

  for (;;) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'user', content: prompt }],
      ...(modernTokenField
        ? { max_completion_tokens: ceiling }
        : { max_tokens: ceiling }),
      ...(temperature ? { temperature: 0.2 } : {}),
      ...(reasoning ? { reasoning_effort: effortTier(req.thinking) } : {}),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    }

    try {
      return unwrapJson(
        extractText(
          await request(ctx, '/chat/completions', {
            method: 'POST',
            headers: authHeaders(ctx),
            timeoutMs: req.timeoutMs,
            body
          }),
          ctx,
          'json'
        )
      )
    } catch (err) {
      // Checked first: a credit refusal arrives as a 400 on some gateways, and
      // the field-dropping loop below would spend three more requests looking
      // for a parameter that was never the problem.
      if (err instanceof AiError && err.kind === 'credit') {
        const fits = affordableCeiling(err, ceiling, req.minOutput)
        if (fits === null || creditRetreats >= MAX_CREDIT_RETREATS) throw err
        ceiling = fits
        creditRetreats += 1
        continue
      }
      if (!canRetreat(err)) throw err

      if (reasoning && REJECTED.reasoning.test(err.message)) {
        reasoning = false
        continue
      }
      if (jsonMode && REJECTED.jsonSchema.test(err.message)) {
        jsonMode = false
        continue
      }
      if (modernTokenField && REJECTED.maxCompletion.test(err.message)) {
        modernTokenField = false
        continue
      }
      // Reasoning models frequently accept only the default temperature, and
      // say so by name. Cheapest retreat of the four, so it is tried last.
      if (temperature && REJECTED.temperature.test(err.message)) {
        temperature = false
        continue
      }
      throw err
    }
  }
}

async function generateText(ctx: CallContext, req: TextRequest): Promise<string> {
  const messages = [
    { role: 'system', content: req.system },
    // `model` is Gemini's name for the assistant turn; everything on this wire
    // calls it `assistant`, and a role a server does not know is a 400.
    ...req.history.map((m) => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.text
    })),
    { role: 'user', content: req.question }
  ]

  let modernTokenField = true
  let temperature = true
  let ceiling = req.output
  let creditRetreats = 0

  for (;;) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      ...(modernTokenField
        ? { max_completion_tokens: ceiling }
        : { max_tokens: ceiling }),
      ...(temperature ? { temperature: 0.3 } : {})
    }

    try {
      return extractText(
        await request(ctx, '/chat/completions', {
          method: 'POST',
          headers: authHeaders(ctx),
          timeoutMs: req.timeoutMs,
          body
        }),
        ctx,
        'prose'
      )
    } catch (err) {
      if (err instanceof AiError && err.kind === 'credit') {
        const fits = affordableCeiling(err, ceiling, req.minOutput)
        if (fits === null || creditRetreats >= MAX_CREDIT_RETREATS) throw err
        ceiling = fits
        creditRetreats += 1
        continue
      }
      if (!canRetreat(err)) throw err
      if (modernTokenField && REJECTED.maxCompletion.test(err.message)) {
        modernTokenField = false
        continue
      }
      if (temperature && REJECTED.temperature.test(err.message)) {
        temperature = false
        continue
      }
      throw err
    }
  }
}

export const openaiWire: WireAdapter = { listModels, generateJson, generateText }
