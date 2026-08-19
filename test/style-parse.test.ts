import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

vi.mock('../src/main/services/secrets', () => ({
  getApiKey: () => 'test-key',
  keyStatus: () => ({ present: true, encryptionAvailable: true }),
  setApiKey: () => {},
  clearApiKey: () => {}
}))

const {
  buildStyleSortPrompt,
  keepGroundedFields,
  sortStyleText
} = await import('../src/main/services/ai')
const plan = await import('../src/main/services/storyboard')
const styles = await import('../src/main/db/styles')
const { configureSlot, makeDb } = await import('./helpers')
const { PROCESS_DEFAULTS } = await import('../src/shared/processes')

/**
 * The sorter's one job is moving the user's words into boxes without adding
 * any of its own. The prompt states it; `keepGroundedFields` enforces it even
 * against a model that ignores the prompt.
 */

const TEXT =
  'gritty handheld look, 35mm anamorphic, teal and orange grade, hard practical light, 2.39:1'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the sort prompt', () => {
  it('carries the description verbatim and forbids invention', () => {
    const prompt = buildStyleSortPrompt(PROCESS_DEFAULTS['style.sort'], TEXT)

    expect(prompt).toContain(TEXT)
    expect(prompt).toMatch(/Use only words and phrases that appear/)
    expect(prompt).toMatch(/must be an empty string/)
    expect(prompt).toMatch(/a sorter, not a writer/i)
  })
})

describe('keeping only grounded fields', () => {
  it('keeps values whose words come from the text', () => {
    const kept = keepGroundedFields(
      {
        camera: 'handheld',
        lens: '35mm anamorphic',
        grade: 'teal and orange',
        aspect: '2.39:1'
      },
      TEXT
    )

    expect(kept).toEqual({
      camera: 'handheld',
      lens: '35mm anamorphic',
      grade: 'teal and orange',
      aspect: '2.39:1'
    })
  })

  it('drops a value that appears from nowhere, even if the model returned it', () => {
    const kept = keepGroundedFields(
      { filmStock: 'Vision3 500T', film_stock: 'Vision3 500T' },
      TEXT
    )
    // Nothing in the text says anything about a stock — invented, gone.
    expect(kept).toEqual({})
  })

  it('drops empty strings and non-strings rather than proposing them', () => {
    const kept = keepGroundedFields(
      { camera: '', lens: 42, grade: '   ', video_style: 'gritty' },
      TEXT
    )
    expect(kept).toEqual({ videoStyle: 'gritty' })
  })

  it('maps the snake_case wire fields onto the camelCase patch keys', () => {
    const kept = keepGroundedFields(
      { video_style: 'gritty', film_stock: '35mm' },
      TEXT
    )
    expect(kept).toEqual({ videoStyle: 'gritty', filmStock: '35mm' })
  })
})

describe('sorting over the wire', () => {
  const reply = (payload: unknown) => ({
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(payload) }] },
        finishReason: 'STOP'
      }
    ]
  })

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => ''
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('returns the grounded subset as a patch', async () => {
    mockFetch(
      reply({
        video_style: 'gritty',
        camera: 'handheld',
        lens: 'invented telephoto',
        grade: '',
        lighting: 'hard practical light',
        film_stock: '',
        aspect: '2.39:1'
      })
    )

    const result = await sortStyleText({
      db: configureSlot(makeDb(), 'scenes', 'gemini'),
      model: 'gemini-3.5-flash',
      text: TEXT
    })

    expect(result).toEqual({
      videoStyle: 'gritty',
      camera: 'handheld',
      lighting: 'hard practical light',
      aspect: '2.39:1'
    })
  })
})

describe('the service call', () => {
  it('refuses a style with no description rather than asking about nothing', async () => {
    const db = makeDb()
    const style = styles.createStyle(db, { name: 'Empty' })

    await expect(plan.parseStyle(db, style.id)).rejects.toThrow(
      /describe the look first/i
    )
  })

  it('reads the source text off the row, not from the caller', async () => {
    const db = makeDb()
    const style = styles.createStyle(db, {
      name: 'Urban',
      sourceText: TEXT
    })

    const fn = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const sent = body.contents[0].parts[0].text as string
      expect(sent).toContain(TEXT)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ camera: 'handheld' }) }]
              },
              finishReason: 'STOP'
            }
          ]
        }),
        text: async () => ''
      } as Response
    })
    vi.stubGlobal('fetch', fn)

    const result = await plan.parseStyle(db, style.id)
    expect(result).toEqual({ camera: 'handheld' })
    // Proposing writes nothing — the row is exactly as it was.
    expect(styles.getStyle(db, style.id).camera).toBe('')
  })
})
