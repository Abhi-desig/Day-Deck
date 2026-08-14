import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiError,
  decomposeCurriculum,
  listModels
} from '../src/main/services/gemini'

interface FakeResponse {
  status?: number
  body?: unknown
  text?: string
}

function mockFetch(responses: FakeResponse[]) {
  let call = 0
  const fn = vi.fn(async () => {
    const r = responses[Math.min(call++, responses.length - 1)]
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
      text: async () => r.text ?? JSON.stringify(r.body ?? {})
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const reply = (text: string, finishReason = 'STOP') => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }]
})

const TOPICS_JSON = JSON.stringify({
  topics: [
    { seq: 1, module: 'Foundations', title: 'Shaders', est_minutes: 60 },
    { seq: 2, title: 'Physical computing', detail: 'Blink an LED', est_minutes: 45 }
  ]
})

const ARGS = {
  apiKey: 'test-key',
  model: 'gemini-3.5-flash',
  title: 'Creative Technologist',
  rawText: 'Shaders. Physical computing.',
  minutesPerDay: 90,
  targetTopics: 60
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listModels', () => {
  it('keeps only text models that can generateContent', async () => {
    mockFetch([
      {
        body: {
          models: [
            {
              name: 'models/gemini-3.5-flash',
              displayName: 'Gemini 3.5 Flash',
              inputTokenLimit: 1_000_000,
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/gemini-embedding-2',
              supportedGenerationMethods: ['embedContent']
            },
            {
              name: 'models/imagen-4',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent']
            }
          ]
        }
      }
    ])

    const models = await listModels('key')

    expect(models.map((m) => m.id)).toEqual([
      'gemini-2.5-pro',
      'gemini-3.5-flash'
    ])
    expect(models[1].inputTokenLimit).toBe(1_000_000)
  })

  it('sends the key as a header, never in the query string', async () => {
    const fetchMock = mockFetch([{ body: { models: [] } }])

    await listModels('secret-key')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-key'
    )
  })
})

describe('decomposeCurriculum', () => {
  it('asks for structured JSON and parses the topics', async () => {
    const fetchMock = mockFetch([{ body: reply(TOPICS_JSON) }])

    const topics = await decomposeCurriculum(ARGS)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/models/gemini-3.5-flash:generateContent')

    const body = JSON.parse(init.body as string)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseJsonSchema).toBeDefined()

    expect(topics).toEqual([
      {
        seq: 1,
        module: 'Foundations',
        title: 'Shaders',
        detail: null,
        estMinutes: 60
      },
      {
        seq: 2,
        module: null,
        title: 'Physical computing',
        detail: 'Blink an LED',
        estMinutes: 45
      }
    ])
  })

  /** The prompt must never invite the model to schedule anything. */
  it('tells the model explicitly not to assign dates', async () => {
    const fetchMock = mockFetch([{ body: reply(TOPICS_JSON) }])
    await decomposeCurriculum(ARGS)

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    )
    const prompt = body.contents[0].parts[0].text as string
    expect(prompt).toMatch(/Do NOT assign dates/i)
  })

  it('falls back to the older responseSchema field on a 400', async () => {
    const fetchMock = mockFetch([
      { status: 400, text: JSON.stringify({ error: { message: 'Unknown name' } }) },
      { body: reply(TOPICS_JSON) }
    ])

    const topics = await decomposeCurriculum(ARGS)

    expect(topics).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string
    )
    expect(second.generationConfig.responseSchema).toBeDefined()
    expect(second.generationConfig.responseJsonSchema).toBeUndefined()
  })

  it('survives a stray code fence', async () => {
    mockFetch([{ body: reply('```json\n' + TOPICS_JSON + '\n```') }])
    await expect(decomposeCurriculum(ARGS)).resolves.toHaveLength(2)
  })

  it('clamps wild estimates and renumbers seq', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            topics: [
              { seq: 7, title: 'Marathon', est_minutes: 9000 },
              { seq: 9, title: 'Blink', est_minutes: 0 },
              { seq: 11, title: 'Missing estimate' },
              { title: '   ' }
            ]
          })
        )
      }
    ])

    const topics = await decomposeCurriculum(ARGS)

    expect(topics.map((t) => t.seq)).toEqual([1, 2, 3])
    expect(topics[0].estMinutes).toBe(600)
    expect(topics[1].estMinutes).toBe(5)
    expect(topics[2].estMinutes).toBe(45)
  })

  it('reports a cut-off response instead of returning half a plan', async () => {
    mockFetch([{ body: reply('{"topics":[{"seq":1,', 'MAX_TOKENS') }])

    await expect(decomposeCurriculum(ARGS)).rejects.toMatchObject({
      kind: 'truncated'
    })
  })

  it('reports a bad key clearly and does not retry it', async () => {
    const fetchMock = mockFetch([
      { status: 401, text: JSON.stringify({ error: { message: 'API key not valid' } }) }
    ])

    await expect(decomposeCurriculum(ARGS)).rejects.toMatchObject({
      kind: 'auth'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a rate limit and then succeeds', async () => {
    const fetchMock = mockFetch([
      { status: 429, text: 'rate limited' },
      { body: reply(TOPICS_JSON) }
    ])

    await expect(decomposeCurriculum(ARGS)).resolves.toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('classifies a dead network as offline rather than a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    const error = await decomposeCurriculum(ARGS).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GeminiError)
    expect((error as GeminiError).kind).toBe('offline')
    expect((error as GeminiError).message).toMatch(/works offline/i)
  })

  it('rejects a response with no usable topics', async () => {
    mockFetch([{ body: reply(JSON.stringify({ topics: [] })) }])
    await expect(decomposeCurriculum(ARGS)).rejects.toMatchObject({
      kind: 'parse'
    })
  })
})

/**
 * Thinking tokens are billed as output and are invisible in the answer, which
 * makes them the easiest cost in the app to spend without noticing. These tests
 * are about the bill, not the reply.
 */
describe('the token budget', () => {
  const configOf = (fetchMock: ReturnType<typeof mockFetch>, call = 0) =>
    JSON.parse(
      (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1]
        .body as string
    ).generationConfig

  it('caps how long the model may reason before answering', async () => {
    const fetchMock = mockFetch([{ body: reply(TOPICS_JSON) }])
    await decomposeCurriculum(ARGS)

    const config = configOf(fetchMock)
    expect(config.thinkingConfig.thinkingBudget).toBeGreaterThan(0)
    expect(config.thinkingConfig.thinkingBudget).toBeLessThan(
      config.maxOutputTokens
    )
  })

  /** An older surface that has never heard of the field must not lose the call. */
  it('drops the budget and keeps going when the surface rejects it', async () => {
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: 'Unknown name "thinkingConfig" at generation_config' }
        })
      },
      { body: reply(TOPICS_JSON) }
    ])

    await expect(decomposeCurriculum(ARGS)).resolves.toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const retry = configOf(fetchMock, 1)
    expect(retry.thinkingConfig).toBeUndefined()
    // The retreat is one field wide: the schema was never what was refused.
    expect(retry.responseJsonSchema).toBeDefined()
  })

  /** A 400 nothing can be retreated from is the same 400 the second time. */
  it('does not spend a second request on an unrelated rejection', async () => {
    const fetchMock = mockFetch([
      {
        status: 400,
        text: JSON.stringify({
          error: { message: 'The input token count exceeds the maximum' }
        })
      }
    ])

    await expect(decomposeCurriculum(ARGS)).rejects.toThrow(/input token count/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a rate limit Gemini has already priced', () => {
  const refusal = (retryDelay: string) => ({
    status: 429,
    text: JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }
        ]
      }
    })
  })

  it('stops rather than retrying into a window it cannot clear', async () => {
    const fetchMock = mockFetch([refusal('47s')])

    const error = await decomposeCurriculum(ARGS).catch((e: unknown) => e)
    expect((error as GeminiError).kind).toBe('rate')
    // Says whose limit it is — the app's own calls-per-minute setting cannot
    // move this one, and a user who does not know that will keep raising it.
    expect((error as GeminiError).message).toMatch(/47s/)
    expect((error as GeminiError).message).toMatch(/Google's limit/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits out a short window and succeeds', async () => {
    const fetchMock = mockFetch([refusal('1s'), { body: reply(TOPICS_JSON) }])

    await expect(decomposeCurriculum(ARGS)).resolves.toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
