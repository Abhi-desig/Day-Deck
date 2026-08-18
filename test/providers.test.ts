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
const { listVideoModels } = await import('../src/main/services/providers/veo')
const sora = await import('../src/main/services/providers/sora')
const { NON_TEXT, isVideoModel } = await import(
  '../src/main/services/providers/wire'
)
const { decomposeCurriculum } = await import('../src/main/services/ai')
const { configureSlot, makeDb } = await import('./helpers')
const { KEY_SLOTS, PROVIDER_INFO, imageProviders, videoProviders } =
  await import('../src/shared/types')

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

/**
 * The refusal that is about money, not about the request.
 *
 * A credit-metered gateway reserves a call's whole `max_tokens` before it runs
 * anything, so an account with a little credit left refuses a request whose
 * answer would have used a fraction of the reservation. Reported raw, that
 * reads as "your request was too big" about a request that was not.
 */
describe('a balance too thin to reserve the ceiling', () => {
  const outOfCredit = (affordable: number) => ({
    status: 402,
    text: JSON.stringify({
      error: {
        message:
          'This request requires more credits, or fewer max_tokens. You requested up to 32768 tokens, but can only afford ' +
          `${affordable}.`
      }
    })
  })

  it('re-asks for exactly what the balance covers, and gets the plan', async () => {
    const fetchMock = mockFetch([outOfCredit(12_000), { body: chatReply(TOPICS_JSON) }])

    await expect(
      plan(goalsOn('openrouter'), 'google/gemini-2.5-flash-lite')
    ).resolves.toHaveLength(1)

    // Not a blind retry: the second ask is the provider's own figure, so it is
    // known to fit rather than guessed at.
    expect(sentTo(fetchMock, 0).body.max_completion_tokens).toBe(32_768)
    expect(sentTo(fetchMock, 1).body.max_completion_tokens).toBe(12_000)
  })

  it('stops rather than ask for less than the job can be done in', async () => {
    const fetchMock = mockFetch([outOfCredit(400)])

    const error = await plan(goalsOn('openrouter'), 'x/y').catch(
      (e: unknown) => e
    )

    // 400 tokens cannot hold a curriculum, and an answer cut off halfway is
    // the same failure with a more confusing explanation.
    expect((error as { kind: string }).kind).toBe('credit')
    expect((error as Error).message).toMatch(/reserves its whole output ceiling/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not send a credit refusal round the field-dropping loop', async () => {
    // Some gateways say 400 for this. Every retreat spent looking for the
    // offending parameter is a request the balance still cannot pay for.
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: 'Your credit balance is too low to access this model.' }
        })
      }
    ])

    await expect(plan(goalsOn('openrouter'), 'x/y')).rejects.toMatchObject({
      kind: 'credit'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not wait out a quota that no amount of waiting refills', async () => {
    // OpenAI says 429 for an unpaid account, which is the status for "come
    // back later" — but this one never clears on its own.
    const fetchMock = mockFetch([
      {
        status: 429,
        text: JSON.stringify({
          error: {
            message:
              'You exceeded your current quota, please check your plan and billing details.',
            type: 'insufficient_quota'
          }
        })
      }
    ])

    await expect(plan(goalsOn('openai'), 'gpt-5')).rejects.toMatchObject({
      kind: 'credit'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

/**
 * The video slot.
 *
 * Its own key, its own provider, and its own model list — and the list is an
 * allowlist rather than the inverse of `NON_TEXT`. Those two are answering
 * different questions ("can this hold a conversation" versus "can this make a
 * clip we know how to collect"), so a model excluded from one must not fall
 * into the other by default. An embedding model is the case that proves it.
 */
describe('the video slot', () => {
  const modelList = {
    models: [
      {
        name: 'models/veo-3.0-generate-001',
        displayName: 'Veo 3',
        supportedGenerationMethods: ['predictLongRunning']
      },
      {
        name: 'models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        supportedGenerationMethods: ['generateContent']
      },
      {
        name: 'models/text-embedding-004',
        displayName: 'Embeddings',
        supportedGenerationMethods: ['embedContent']
      },
      {
        // Advertised but not drivable by this file — it cannot be submitted to
        // predictLongRunning, so offering it would be offering a broken button.
        name: 'models/veo-2.0-preview',
        displayName: 'Veo 2 preview',
        supportedGenerationMethods: ['generateContent']
      }
    ]
  }

  it('offers Veo and only Veo', async () => {
    mockFetch([{ body: modelList }])
    const db = configureSlot(makeDb(), 'video', 'gemini')

    const models = await providers.listModels(db, 'video')

    expect(models.map((m) => m.id)).toEqual(['veo-3.0-generate-001'])
  })

  it('still offers text models to a text slot from the same list', () => {
    // The two filters are independent, which is the whole point of them being
    // two filters. Asserted on the regexes directly so a change to either one
    // has to state which question it is answering.
    expect(NON_TEXT.test('veo-3.0-generate-001')).toBe(true)
    expect(NON_TEXT.test('gemini-2.5-flash')).toBe(false)
    expect(isVideoModel('veo-3.0-generate-001')).toBe(true)
    expect(isVideoModel('gemini-2.5-flash')).toBe(false)
    // Excluded from text, and still not video.
    expect(NON_TEXT.test('text-embedding-004')).toBe(true)
    expect(isVideoModel('text-embedding-004')).toBe(false)
  })

  it('names the vendor mismatch rather than letting the call 404', async () => {
    // Two gates, and this one fires first: a slot set to OpenAI has no OpenAI
    // key to borrow, because a key is only meaningful to the vendor it came
    // from. The message says so instead of reporting a rejected key.
    const db = configureSlot(makeDb(), 'video', 'openai')
    await expect(providers.listModels(db, 'video')).rejects.toThrow(
      /set to OpenAI.*Google Gemini/s
    )
  })

  it('refuses Veo on a non-Google context even when a key resolves', async () => {
    // The second gate, asserted directly because the first one shadows it
    // through `listModels`. Without this, an OpenAI base URL would be sent
    // `:predictLongRunning` and answer 404 — which reads as a missing model
    // rather than as a slot pointed at a vendor that has no Veo.
    await expect(
      listVideoModels({
        provider: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key'
      })
    ).rejects.toThrow(/Veo/)
  })
})

/**
 * Video is a registry, not a hardcoded vendor.
 *
 * The distinction that matters to a user: most providers here route *language*
 * models and have no video endpoint at all, so a key that works perfectly for
 * prompts cannot generate a clip however the slot is configured. Left to fail
 * on the wire that arrives as a 404 about a missing model, which sends people
 * looking for the wrong problem — so it is refused up front, by name.
 */
describe('which providers can generate video', () => {
  it('routes a provider with a video dialect to its adapter', () => {
    expect(providers.videoAdapterFor('gemini')).toBeDefined()
    expect(PROVIDER_INFO.gemini.videoWire).toBe('veo')
  })

  it('refuses a language-only provider and names the ones that work', () => {
    // OpenRouter is the case that prompted this: a perfectly good key, in the
    // default slot, that cannot make video because OpenRouter does not serve
    // video models at all.
    expect(() => providers.videoAdapterFor('openrouter')).toThrow(
      /does not generate video/i
    )
    expect(() => providers.videoAdapterFor('openrouter')).toThrow(
      /Google Gemini/
    )
    for (const p of ['groq', 'deepseek', 'mistral', 'anthropic'] as const) {
      expect(() => providers.videoAdapterFor(p)).toThrow(/video/i)
    }
  })

  it('lists the video-capable providers from the table, not a second list', () => {
    // Derived, so adding an adapter cannot leave the error message stale.
    expect(videoProviders()).toEqual(
      (Object.keys(PROVIDER_INFO) as Array<keyof typeof PROVIDER_INFO>).filter(
        (p) => PROVIDER_INFO[p].videoWire !== null
      )
    )
    expect(videoProviders()).toContain('gemini')
  })

  it('routes OpenAI to its own dialect rather than to Veo', () => {
    // The second video wire. Google was the only vendor that made video here,
    // which meant an OpenAI key could plan a whole board and then not generate
    // a single frame of it.
    expect(PROVIDER_INFO.openai.videoWire).toBe('sora')
    expect(providers.videoAdapterFor('openai')).not.toBe(
      providers.videoAdapterFor('gemini')
    )
    expect(videoProviders()).toContain('openai')
  })
})

/**
 * The model the video slot asks for when nobody has chosen one.
 *
 * This is the bug that made Generate look broken rather than misconfigured. The
 * fallback used to be the provider's *chat* default, so a fresh install sent
 * `gemini-3.5-flash` to a video endpoint and got a 404 about a missing model —
 * on a slot the user had never opened, for a button that looks like it should
 * simply work.
 */
describe('the video slot’s model', () => {
  it('falls back to a video model, not a chat model', () => {
    const db = configureSlot(makeDb(), 'video', 'gemini')
    const model = providers.modelFor(db, 'video')

    expect(model).toBe(PROVIDER_INFO.gemini.defaultVideoModel)
    expect(model).not.toBe(PROVIDER_INFO.gemini.defaultModel)
    expect(isVideoModel(model)).toBe(true)
  })

  it('leaves every other slot on the chat default', () => {
    const db = configureSlot(makeDb(), 'goals', 'gemini')
    expect(providers.modelFor(db, 'goals')).toBe(
      PROVIDER_INFO.gemini.defaultModel
    )
  })

  it('prefers whatever the user actually picked', () => {
    const db = configureSlot(makeDb(), 'video', 'gemini', {
      model: 'veo-3.1-generate-001'
    })
    expect(providers.modelFor(db, 'video')).toBe('veo-3.1-generate-001')
  })

  it('says which list to pick from when there is no sensible guess', () => {
    // A custom server could be serving anything, so inventing an id here would
    // 404 just as loudly as the chat default did.
    const db = configureSlot(makeDb(), 'video', 'custom', {
      baseUrl: 'http://localhost:8000/v1'
    })
    expect(() => providers.modelFor(db, 'video')).toThrow(/video model/i)
  })
})

/**
 * OpenAI's `/videos` resource.
 *
 * Three beats like Veo and none of them the same shape: no long-running
 * operation, an id of its own, a `status` that walks rather than a `done` flag,
 * and bytes served from a sub-path instead of a URI the response names.
 */
describe('the sora video dialect', () => {
  const ctx = {
    provider: 'openai' as const,
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key'
  }

  it('creates a video and follows its id', async () => {
    const fetchMock = mockFetch([{ body: { id: 'video_123', status: 'queued' } }])

    const operation = await sora.submit(ctx, {
      model: 'sora-2',
      prompt: 'A slow push in on a wet street',
      durationSec: 8,
      sampleCount: 1,
      aspectRatio: '16:9'
    })

    expect(operation.name).toBe('video_123')
    const sent = sentTo(fetchMock)
    expect(sent.url).toBe('https://api.openai.com/v1/videos')
    expect(sent.headers.authorization).toBe('Bearer test-key')
    // Strings, both of them — this endpoint rejects the numeric form.
    expect(sent.body.seconds).toBe('8')
    expect(sent.body.size).toBe('1280x720')
  })

  it('reports an unfinished video as unfinished rather than empty', async () => {
    mockFetch([{ body: { id: 'video_123', status: 'in_progress' } }])
    expect(await sora.poll(ctx, { name: 'video_123' })).toEqual({ done: false })
  })

  it('names the clip’s own content path once it is done', async () => {
    mockFetch([{ body: { id: 'video_123', status: 'completed' } }])

    const result = await sora.poll(ctx, { name: 'video_123' })

    expect(result.done).toBe(true)
    expect(result.done && result.samples[0].uri).toBe(
      'https://api.openai.com/v1/videos/video_123/content'
    )
  })

  it('surfaces a failed generation as an error, not as a clip', async () => {
    mockFetch([
      {
        body: {
          id: 'video_123',
          status: 'failed',
          error: { message: 'content policy' }
        }
      }
    ])
    await expect(sora.poll(ctx, { name: 'video_123' })).rejects.toThrow(
      /content policy/
    )
  })

  it('rounds a scene length to one this provider can make', () => {
    // The board plans in 4/6/8/10; Sora generates 4/8/12. A 6-second scene is a
    // legal thing to plan and an illegal thing to ask for, so it is snapped —
    // upward on a tie, because a couple of seconds of tail is one gesture in
    // the trimmer and a truncated action is unrecoverable.
    expect(sora.soraSeconds(4)).toBe(4)
    expect(sora.soraSeconds(6)).toBe(8)
    expect(sora.soraSeconds(8)).toBe(8)
    expect(sora.soraSeconds(10)).toBe(12)
    expect(sora.soraSeconds(null)).toBe(8)
  })

  it('turns an aspect ratio into a frame size it accepts', () => {
    expect(sora.soraSize('16:9')).toBe('1280x720')
    expect(sora.soraSize('9:16')).toBe('720x1280')
    // Anything unrecognised lands on landscape rather than being passed
    // through as a size the endpoint would refuse.
    expect(sora.soraSize('4:3')).toBe('1280x720')
  })

  it('offers only the models it can actually drive', async () => {
    mockFetch([
      { body: { data: [{ id: 'sora-2' }, { id: 'gpt-5' }, { id: 'dall-e-3' }] } }
    ])
    const models = await sora.listVideoModels(ctx)
    expect(models.map((m) => m.id)).toEqual(['sora-2'])
  })

  it('makes one clip per request, and says so', () => {
    // Not a limit this app chose. Without it the caller would ask for three
    // takes, quietly receive one, and have no way to report the shortfall on
    // something the user is billed for.
    expect(sora.soraVideo.maxSamples).toBe(1)
  })
})


/**
 * Images are the third registry, and the same rule again.
 *
 * The reason it is worth its own set of cases rather than trusting the video
 * ones by analogy: this is the registry a *new* slot points at, so an install
 * that has never opened Settings is the common case, not the edge one.
 */
describe('which providers can generate images', () => {
  it('has a slot of its own, separate from video', () => {
    // Two different bills. A portrait is cents and gets generated whenever
    // someone is describing a character; a clip is metered per second.
    expect(KEY_SLOTS).toContain('image')
    expect(KEY_SLOTS).toContain('video')
  })

  it('routes a provider with an image dialect to its adapter', () => {
    expect(providers.imageAdapterFor('gemini')).toBeDefined()
    expect(PROVIDER_INFO.gemini.imageWire).toBe('gemini-image')
  })

  it('routes OpenAI to its own dialect rather than to Gemini', () => {
    expect(PROVIDER_INFO.openai.imageWire).toBe('openai-image')
    expect(providers.imageAdapterFor('openai')).not.toBe(
      providers.imageAdapterFor('gemini')
    )
  })

  it('refuses a language-only provider and names the ones that work', () => {
    expect(() => providers.imageAdapterFor('groq')).toThrow(
      /does not generate images/i
    )
    expect(() => providers.imageAdapterFor('groq')).toThrow(/Google Gemini/)
    for (const p of ['openrouter', 'deepseek', 'mistral', 'anthropic'] as const) {
      expect(() => providers.imageAdapterFor(p)).toThrow(/image/i)
    }
  })

  it('lists the image-capable providers from the table, not a second list', () => {
    expect(imageProviders()).toEqual(
      (Object.keys(PROVIDER_INFO) as Array<keyof typeof PROVIDER_INFO>).filter(
        (p) => PROVIDER_INFO[p].imageWire !== null
      )
    )
    expect(imageProviders()).toContain('gemini')
    expect(imageProviders()).not.toContain('groq')
  })

  it('states how many references each dialect takes, rather than assuming', () => {
    // The number that decides whether a reference pack is one person from five
    // angles or five people who match the description. A provider that takes
    // none says so, and the caller refuses to build rather than building five
    // strangers that look exactly like a working pack.
    expect(providers.imageAdapterFor('gemini').maxReferences).toBeGreaterThan(0)
    expect(providers.imageAdapterFor('openai').maxReferences).toBeGreaterThan(0)
  })
})

/**
 * The model the image slot asks for when nobody has chosen one.
 *
 * `defaultVideoModel` exists because a slot nobody configured sent a chat model
 * id to a video endpoint and 404'd. An image slot falling back to either of the
 * other two defaults reproduces that bug exactly, on a button that looks like it
 * should just work — so the fallback is a lookup with an entry of its own.
 */
describe('the image slot’s default model', () => {
  it('falls back to the provider’s image default, not its chat one', () => {
    const db = configureSlot(makeDb(), 'default', 'gemini')
    const model = providers.modelFor(db, 'image')

    expect(model).toBe(PROVIDER_INFO.gemini.defaultImageModel)
    expect(model).not.toBe(PROVIDER_INFO.gemini.defaultModel)
    expect(model).not.toBe(PROVIDER_INFO.gemini.defaultVideoModel)
  })

  it('prefers a model the user actually chose', () => {
    const db = configureSlot(makeDb(), 'image', 'gemini', {
      model: 'gemini-4-image'
    })
    expect(providers.modelFor(db, 'image')).toBe('gemini-4-image')
  })

  it('says so plainly when the provider has no image default worth guessing', () => {
    const db = configureSlot(makeDb(), 'image', 'custom', {
      baseUrl: 'http://localhost:8080/v1'
    })
    expect(() => providers.modelFor(db, 'image')).toThrow(/image model/i)
  })

  it('leaves the chat slots on the chat default', () => {
    const db = configureSlot(makeDb(), 'default', 'gemini')
    expect(providers.modelFor(db, 'goals')).toBe(PROVIDER_INFO.gemini.defaultModel)
  })
})
