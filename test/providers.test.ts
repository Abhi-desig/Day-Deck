import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

/**
 * The provider layer: who a slot talks to, and what the request looks like once
 * it gets there.
 *
 * The case that started all of this is `pastes a Grok key` below — an xAI key
 * used to be sent to generativelanguage.googleapis.com with a Google header,
 * which could only ever come back "API key not valid", and the message blamed
 * the key rather than the destination.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

/** Only the default slot has a key, which is the shape of a fresh install. */
vi.mock('../src/main/services/secrets', () => ({
  getApiKey: (slot = 'default') => (slot === 'default' ? 'test-key' : null),
  keyStatus: () => ({ present: true, encryptionAvailable: true }),
  setApiKey: () => {},
  clearApiKey: () => {}
}))

const providers = await import('../src/main/services/providers')
const { decomposeCurriculum } = await import('../src/main/services/ai')
const { configureSlot, makeDb } = await import('./helpers')

interface FakeResponse {
  status?: number
  body?: unknown
  text?: string
  headers?: Record<string, string>
}

function mockFetch(responses: FakeResponse[]) {
  let call = 0
  const fn = vi.fn(async () => {
    const r = responses[Math.min(call++, responses.length - 1)]
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(r.headers ?? {}),
      json: async () => r.body,
      text: async () => r.text ?? JSON.stringify(r.body ?? {})
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** One chat-completions reply, the shape every OpenAI-compatible server sends. */
const chatReply = (content: string, finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }]
})

/** One Messages API reply. */
const messagesReply = (text: string, stop = 'end_turn') => ({
  content: [{ type: 'text', text }],
  stop_reason: stop
})

const TOPICS_JSON = JSON.stringify({
  topics: [{ seq: 1, title: 'Shaders', est_minutes: 60 }]
})

/**
 * A goals slot pointed at one provider, with the default slot on it too.
 *
 * Both, because the key lives in the default slot: a goals slot on a different
 * vendor with no key of its own is refused before any request is made, which is
 * its own test further down rather than the state these wire tests want.
 */
const goalsOn = (provider: Parameters<typeof configureSlot>[2]): TestDb =>
  configureSlot(configureSlot(makeDb(), 'default', provider), 'goals', provider)

const plan = (db: TestDb, model: string) =>
  decomposeCurriculum({
    db,
    model,
    title: 'Creative Technologist',
    rawText: 'Shaders. Physical computing.',
    minutesPerDay: 90,
    targetTopics: 10
  })

const sentTo = (fetchMock: ReturnType<typeof mockFetch>, call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the provider a slot resolves to', () => {
  it('is Gemini when nothing has ever been configured', () => {
    // Every install that predates providers is in exactly this state, and it
    // has a working Gemini key. Anything else here is a silent breakage on
    // upgrade.
    const config = providers.slotConfig(makeDb(), 'default')
    expect(config.provider).toBe('gemini')
    expect(config.inherited).toBe(false)
  })

  it('is inherited from the default slot, and says so', () => {
    const db = configureSlot(makeDb(), 'default', 'xai')

    const scenes = providers.slotConfig(db, 'scenes')
    expect(scenes.provider).toBe('xai')
    // The flag is the difference between "follows the default" and "was set to
    // xAI on purpose" — clearing the default only changes the first.
    expect(scenes.inherited).toBe(true)
  })

  it('lets one slot differ from the rest', () => {
    const db = configureSlot(makeDb(), 'default', 'gemini')
    configureSlot(db, 'scenes', 'anthropic')

    expect(providers.slotConfig(db, 'scenes').provider).toBe('anthropic')
    expect(providers.slotConfig(db, 'scenes').inherited).toBe(false)
    expect(providers.slotConfig(db, 'prompts').provider).toBe('gemini')
  })

  it('forgets the model when the provider changes', () => {
    const db = configureSlot(makeDb(), 'goals', 'gemini', {
      model: 'gemini-3.5-flash'
    })

    // A model id does not survive a vendor change: asking xAI for a Gemini
    // model is a 404 about a missing model, which says nothing about the switch
    // that caused it.
    expect(providers.setSlotProvider(db, 'goals', 'xai').model).toBe('')
  })

  it('refuses to leave the default slot with nothing to inherit', () => {
    expect(() => providers.setSlotProvider(makeDb(), 'default', '')).toThrow(
      /nothing to inherit/i
    )
  })
})

describe('the key a slot calls with', () => {
  it('borrows the default slot key when both are the same provider', () => {
    const db = configureSlot(makeDb(), 'default', 'gemini')
    // `scenes` has no key of its own; same vendor, so the default's works.
    expect(providers.callContext(db, 'scenes').apiKey).toBe('test-key')
  })

  it('refuses to borrow one across vendors, and says why', () => {
    const db = configureSlot(makeDb(), 'default', 'gemini')
    configureSlot(db, 'scenes', 'xai')

    // The failure that would otherwise happen is a 401 from xAI blaming the
    // key. Refusing here names the actual mistake instead.
    expect(() => providers.callContext(db, 'scenes')).toThrow(
      /only the default slot has a key and that one is Google Gemini/i
    )
  })

  it('asks a custom provider where to send the request', () => {
    const db = configureSlot(makeDb(), 'default', 'custom')
    expect(() => providers.callContext(db, 'default')).toThrow(/no base URL/i)

    providers.setSlotBaseUrl(db, 'default', 'http://localhost:11434/v1/')
    // The trailing slash is trimmed, or every path would double up its own.
    expect(providers.callContext(db, 'default').baseUrl).toBe(
      'http://localhost:11434/v1'
    )
  })

  it('refuses a base URL that is not one', () => {
    const db = configureSlot(makeDb(), 'default', 'custom')
    expect(() => providers.setSlotBaseUrl(db, 'default', 'localhost:11434')).toThrow(
      /http:\/\/ or https:\/\//
    )
  })
})

describe('the OpenAI-compatible wire', () => {
  it('pastes a Grok key and reaches xAI, not Google', async () => {
    const fetchMock = mockFetch([{ body: chatReply(TOPICS_JSON) }])
    const db = goalsOn('xai')

    const topics = await plan(db, 'grok-4')

    const { url, headers, body } = sentTo(fetchMock)
    expect(url).toBe('https://api.x.ai/v1/chat/completions')
    expect(headers.authorization).toBe('Bearer test-key')
    // Nothing Google-shaped may survive the trip.
    expect(headers['x-goog-api-key']).toBeUndefined()
    expect(body.contents).toBeUndefined()
    expect(body.model).toBe('grok-4')
    expect(topics).toHaveLength(1)
  })

  it('states the schema in the prompt as well as the request', async () => {
    const fetchMock = mockFetch([{ body: chatReply(TOPICS_JSON) }])
    await plan(goalsOn('openai'), 'gpt-5')

    const { body } = sentTo(fetchMock)
    expect(body.response_format).toEqual({ type: 'json_object' })
    // The belt to that field's braces: a server that ignores `response_format`
    // is far commoner than one that rejects it, and a silent ignore is what
    // produces prose where JSON was expected.
    expect(body.messages[0].content).toContain('"topics"')
    expect(body.messages[0].content).toMatch(/single JSON object/i)
  })

  it('gives up one rejected field at a time, keeping the rest', async () => {
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: "Unsupported parameter: 'reasoning_effort'" }
        })
      },
      {
        status: 400,
        text: JSON.stringify({
          error: { message: "Unknown parameter: 'max_completion_tokens'" }
        })
      },
      { body: chatReply(TOPICS_JSON) }
    ])

    await expect(
      plan(goalsOn('groq'), 'llama-3.3-70b')
    ).resolves.toHaveLength(1)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const last = sentTo(fetchMock, 2).body
    expect(last.reasoning_effort).toBeUndefined()
    expect(last.max_completion_tokens).toBeUndefined()
    expect(last.max_tokens).toBe(32_768)
    // Only what was actually named is given up. JSON mode was never rejected.
    expect(last.response_format).toEqual({ type: 'json_object' })
  })

  it('does not retreat on a 400 that names no field it can drop', async () => {
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: 'This model does not exist for your account' }
        })
      }
    ])

    // Retrying a rejection that will not change is spending another request
    // from the quota to be told the same thing.
    await expect(
      plan(goalsOn('deepseek'), 'nope')
    ).rejects.toThrow(/does not exist/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('survives a server that answers in content parts', async () => {
    mockFetch([
      {
        body: {
          choices: [
            {
              message: { content: [{ text: TOPICS_JSON }] },
              finish_reason: 'stop'
            }
          ]
        }
      }
    ])

    await expect(
      plan(goalsOn('openrouter'), 'x/y')
    ).resolves.toHaveLength(1)
  })

  it('unwraps a fenced answer and ignores prose around it', async () => {
    mockFetch([
      { body: chatReply('Sure!\n```json\n' + TOPICS_JSON + '\n```\nHope that helps') }
    ])

    await expect(
      plan(goalsOn('mistral'), 'mistral-large-latest')
    ).resolves.toHaveLength(1)
  })

  it('reports a cut-off answer rather than half a plan', async () => {
    mockFetch([{ body: chatReply('{"topics":[{"seq":1,', 'length') }])

    await expect(
      plan(goalsOn('xai'), 'grok-4')
    ).rejects.toMatchObject({ kind: 'truncated' })
  })

  it('names the provider when the key is refused', async () => {
    mockFetch([
      {
        status: 401,
        text: JSON.stringify({ error: { message: 'Incorrect API key' } })
      }
    ])

    // The sentence that was missing: a key is only valid for one vendor, and
    // which vendor was called is the fact the user needs.
    await expect(plan(goalsOn('xai'), 'grok-4')).rejects.toThrow(
      /xAI \(Grok\) rejected the API key.*the provider beside it in Settings/is
    )
  })

  it('does not spend retreats on a 400 that is really a bad key', async () => {
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({ error: { message: 'Invalid API key provided' } })
      }
    ])

    // Dropping `reasoning_effort` will not make a rejected key work, and each
    // attempt is another request against a quota the key does not have.
    const error = await plan(goalsOn('groq'), 'llama-3.3-70b').catch(
      (e: unknown) => e
    )
    expect((error as { kind: string }).kind).toBe('auth')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * The exact failure from the report that prompted this work.
 *
 * Google answers a bad key with a 400, not a 401 — so before this, the single
 * commonest way to get this wrong was filed as "the request was malformed" and
 * printed without the one sentence that resolves it.
 */
describe('a Grok key pasted into the Gemini slot', () => {
  it('is called a rejected key, not a rejected request', async () => {
    mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: 'API key not valid. Please pass a valid API key.' }
        })
      }
    ])

    const error = await plan(goalsOn('gemini'), 'gemini-3.5-flash').catch(
      (e: unknown) => e
    )

    expect((error as { kind: string }).kind).toBe('auth')
    expect((error as Error).message).toMatch(
      /the provider beside it in Settings is the one the key came from/i
    )
  })

  it('reads the models list, filtering what cannot answer a prompt', async () => {
    mockFetch([
      {
        body: {
          data: [
            { id: 'grok-4' },
            { id: 'grok-2-image-1212' },
            { id: 'text-embedding-3-small' },
            { id: 'grok-3-mini', context_length: 131_072 }
          ]
        }
      }
    ])

    const models = await providers.listModels(
      configureSlot(makeDb(), 'default', 'xai'),
      'default'
    )

    expect(models.map((m) => m.id)).toEqual(['grok-3-mini', 'grok-4'])
    expect(models[0].inputTokenLimit).toBe(131_072)
  })
})

describe('the Anthropic wire', () => {
  it('sends its own headers and prefills the answer open', async () => {
    const fetchMock = mockFetch([
      // The prefilled `{` is not echoed back, so the reply starts after it.
      { body: messagesReply(TOPICS_JSON.slice(1)) }
    ])
    const db = goalsOn('anthropic')

    const topics = await plan(db, 'claude-sonnet-4-5')

    const { url, headers, body } = sentTo(fetchMock)
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.authorization).toBeUndefined()

    // The prefill is the whole technique: the reply is continuing an object
    // that is already open, so it has nowhere to put a preamble.
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '{' })
    expect(body.max_tokens).toBe(32_768)
    expect(topics).toHaveLength(1)
  })

  it('treats 529 as busy rather than broken', async () => {
    const fetchMock = mockFetch([
      { status: 529, text: 'overloaded' },
      { body: messagesReply(TOPICS_JSON.slice(1)) }
    ])

    await expect(
      plan(goalsOn('anthropic'), 'claude-sonnet-4-5')
    ).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps only text blocks, never the thinking', async () => {
    mockFetch([
      {
        body: {
          content: [
            { type: 'thinking', thinking: 'Let me consider the curriculum…' },
            { type: 'text', text: TOPICS_JSON.slice(1) }
          ],
          stop_reason: 'end_turn'
        }
      }
    ])

    // Concatenating a thinking block into the answer is how deliberation ends
    // up inside a prompt that gets pasted into a video generator.
    await expect(
      plan(goalsOn('anthropic'), 'claude-sonnet-4-5')
    ).resolves.toHaveLength(1)
  })
})

describe('a rate limit stated in a header', () => {
  it('is honoured rather than retried on our own schedule', async () => {
    const fetchMock = mockFetch([
      { status: 429, text: 'slow down', headers: { 'retry-after': '90' } }
    ])

    // 90s is a quota window, not a queue about to move. Sleeping through it
    // spends another request from the quota that just refused us.
    await expect(
      plan(goalsOn('xai'), 'grok-4')
    ).rejects.toThrow(/about 90s/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
