import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoStyle } from '../src/shared/types'
import {
  GeminiError,
  buildPromptWriterPrompt,
  buildScenePrompt,
  planPrompts,
  planScenes,
  renderStyle
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

function style(over: Partial<VideoStyle> = {}): VideoStyle {
  return {
    id: 's1',
    name: 'Urban indie',
    videoStyle: 'gritty urban indie',
    camera: 'handheld, slight roll',
    lens: '35mm anamorphic',
    grade: 'teal-orange, crushed blacks',
    lighting: '',
    filmStock: '',
    aspect: '2.39:1',
    extras: [{ key: 'gate weave', value: 'subtle' }],
    sourceText: '',
    color: 'amber',
    sortIndex: 0,
    createdAt: '2026-08-01T00:00:00Z',
    ...over
  }
}

const ARGS = {
  apiKey: 'test-key',
  model: 'gemini-3.5-flash',
  brief: 'A student arrives in a new city and finds a room.',
  visualStyle: 'warm, documentary',
  style: null,
  existing: [],
  references: []
}

const SCENES_JSON = JSON.stringify({
  scenes: [
    {
      title: 'Arrival',
      description: 'She steps off the train.',
      prompt: 'wide shot, handheld, 35mm, teal-orange grade',
      duration_sec: 10
    },
    {
      title: 'The key',
      description: 'A hand turns a key.',
      prompt: 'macro insert, hard practical light',
      duration_sec: 5
    }
  ]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the scene planning prompt', () => {
  it('carries the brief and the visual style', () => {
    const prompt = buildScenePrompt(ARGS)

    expect(prompt).toContain('A student arrives in a new city')
    expect(prompt).toContain('warm, documentary')
  })

  it('states the supported durations and what each is for', () => {
    const prompt = buildScenePrompt(ARGS)

    // The model has to know 5 and 10 are the only renderable lengths, and why it
    // would pick one over the other.
    expect(prompt).toMatch(/duration_sec must be exactly one of: 5, 10/)
    expect(prompt).toMatch(/5s for a single beat/)
    expect(prompt).toMatch(/10s for a developing action/)
  })

  it('declines to write prompts — that is stage two', () => {
    // The breakdown is approved before any prompt is paid for, so the one thing
    // this prompt must not do is ask for prompts.
    expect(buildScenePrompt(ARGS)).toMatch(/Do not write generation prompts/)
  })

  it('spells the style out in full when one is placed', () => {
    const prompt = buildScenePrompt({ ...ARGS, style: style() })

    expect(prompt).toContain('"Urban indie"')
    expect(prompt).toContain('- Lens: 35mm anamorphic')
    expect(prompt).toContain('- gate weave: subtle')
  })

  it('says nothing about a style when none is placed', () => {
    expect(buildScenePrompt(ARGS)).not.toContain('LOOK —')
  })

  it('lists what is already on the board, in order, flagging hand-written prompts', () => {
    const prompt = buildScenePrompt({
      ...ARGS,
      existing: [
        { title: 'Cold open', description: 'the platform', hasPrompt: true },
        { title: '', description: '', hasPrompt: false }
      ]
    })

    expect(prompt).toContain('1. Cold open — the platform [has a hand-written prompt]')
    expect(prompt).toContain('2. (untitled) — (no description)')
  })

  it('offers references but does not insist on them', () => {
    const prompt = buildScenePrompt({
      ...ARGS,
      references: ['hero-plate.mp4 (video)']
    })

    expect(prompt).toContain('hero-plate.mp4 (video)')
    expect(prompt).toMatch(/only if the shot genuinely uses it/)
  })
})

describe('rendering a style', () => {
  it('states the fields that are set, in prompt order, and skips the blanks', () => {
    const rendered = renderStyle(style())
    const lines = rendered.split('\n')

    expect(lines[0]).toBe('- Video style: gritty urban indie')
    expect(lines[1]).toBe('- Camera: handheld, slight roll')
    expect(lines[2]).toBe('- Lens: 35mm anamorphic')
    // Lighting and film stock are empty and must not appear as empty labels.
    expect(rendered).not.toContain('Lighting')
    expect(rendered).not.toContain('Film stock')
  })

  it('drops a half-filled extra rather than emitting a dangling label', () => {
    const rendered = renderStyle(
      style({ extras: [{ key: 'halation', value: '' }, { key: '', value: 'x' }] })
    )

    expect(rendered).not.toContain('halation')
  })

  it('is empty for a style with nothing set', () => {
    const blank = style({
      videoStyle: '',
      camera: '',
      lens: '',
      grade: '',
      aspect: '',
      extras: []
    })
    expect(renderStyle(blank)).toBe('')
  })
})

describe('planning scenes', () => {
  it('parses the scenes and keeps their order', async () => {
    mockFetch([{ body: reply(SCENES_JSON) }])
    const scenes = await planScenes(ARGS)

    expect(scenes.map((s) => s.title)).toEqual(['Arrival', 'The key'])
    expect(scenes[0].durationSec).toBe(10)
    expect(scenes[1].durationSec).toBe(5)
  })

  it('sends the key in a header, never the query string', async () => {
    const fetchMock = mockFetch([{ body: reply(SCENES_JSON) }])
    await planScenes(ARGS)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('test-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'test-key'
    )
  })

  it('constrains duration in the schema it sends', async () => {
    const fetchMock = mockFetch([{ body: reply(SCENES_JSON) }])
    await planScenes(ARGS)

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    )
    const scene =
      body.generationConfig.responseJsonSchema.properties.scenes.items
    expect(scene.properties.duration_sec.enum).toEqual([5, 10])
  })

  it('snaps a duration the model invented anyway', async () => {
    // An enum in the schema is a strong hint, not a guarantee. A 7-second scene
    // is not renderable, and throwing the whole plan away over one number would
    // be the wrong trade.
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            scenes: [
              { title: 'A', description: 'x', prompt: 'p', duration_sec: 7 },
              { title: 'B', description: 'y', prompt: 'q', duration_sec: 30 },
              { title: 'C', description: 'z', prompt: 'r', duration_sec: 1 }
            ]
          })
        )
      }
    ])

    const scenes = await planScenes(ARGS)
    expect(scenes.map((s) => s.durationSec)).toEqual([5, 10, 5])
  })

  it('defaults a missing duration rather than dropping the scene', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            scenes: [{ title: 'A', description: 'x', prompt: 'p' }]
          })
        )
      }
    ])

    const scenes = await planScenes(ARGS)
    expect(scenes[0].durationSec).toBe(5)
  })

  it('skips a scene with no description', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            scenes: [
              { title: 'Real', description: 'something', duration_sec: 5 },
              { title: 'Hollow', description: '  ', duration_sec: 5 }
            ]
          })
        )
      }
    ])

    const scenes = await planScenes(ARGS)
    expect(scenes.map((s) => s.title)).toEqual(['Real'])
  })

  it('returns every scene with an empty prompt — stage one never writes them', async () => {
    mockFetch([{ body: reply(SCENES_JSON) }])
    const scenes = await planScenes(ARGS)
    expect(scenes.every((s) => s.prompt === '')).toBe(true)
  })

  it('reports a parse failure rather than returning nothing', async () => {
    mockFetch([{ body: reply('not json at all') }])
    await expect(planScenes(ARGS)).rejects.toThrow(GeminiError)
  })

  it('reports JSON with no scenes array as a parse failure', async () => {
    mockFetch([{ body: reply(JSON.stringify({ shots: [] })) }])
    await expect(planScenes(ARGS)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('reports an all-empty plan rather than an empty board', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({ scenes: [{ title: 'x', description: '', prompt: '' }] })
        )
      }
    ])
    await expect(planScenes(ARGS)).rejects.toMatchObject({ kind: 'parse' })
  })
})

const PROMPT_ARGS = {
  apiKey: 'test-key',
  model: 'gemini-3.5-flash',
  brief: 'A student arrives in a new city and finds a room.',
  visualStyle: 'warm, documentary',
  style: null,
  briefReferences: ['moodboard.png (image) '.trim()],
  scenes: [
    {
      number: 1,
      title: 'Arrival',
      description: 'She steps off the train.',
      durationSec: 10,
      references: ['platform-plate.mp4 (video)']
    },
    {
      number: 2,
      title: 'The key',
      description: 'A hand turns a key.',
      durationSec: null,
      references: []
    }
  ],
  write: [1, 2]
}

describe('the prompt writing prompt', () => {
  it('carries the whole board and says which scenes to write', () => {
    const prompt = buildPromptWriterPrompt(PROMPT_ARGS)

    expect(prompt).toContain(
      '1. Arrival — She steps off the train. [10s] [references: platform-plate.mp4 (video)]'
    )
    expect(prompt).toContain('2. The key — A hand turns a key.')
    expect(prompt).toMatch(/WRITE PROMPTS FOR SCENES: 1, 2\./)
  })

  it('forbids prompts that reference other shots', () => {
    // A prompt saying "as established" is worthless the moment it leaves the
    // app, and leaving is the entire purpose of a prompt.
    expect(buildPromptWriterPrompt(PROMPT_ARGS)).toMatch(
      /never write "as established"/i
    )
  })

  it('separates film-wide references from a scene\'s own', () => {
    const prompt = buildPromptWriterPrompt(PROMPT_ARGS)

    expect(prompt).toContain('FILM-WIDE REFERENCES')
    expect(prompt).toContain('- moodboard.png (image)')
  })

  it('demands the look wording stay identical across prompts', () => {
    const prompt = buildPromptWriterPrompt({ ...PROMPT_ARGS, style: style() })

    expect(prompt).toContain('"Urban indie"')
    expect(prompt).toContain('- Lens: 35mm anamorphic')
    expect(prompt).toMatch(/in full and in the same wording/)
    expect(prompt).toMatch(/Keep the look wording identical/)
  })
})

describe('planning prompts', () => {
  const PROMPTS_JSON = JSON.stringify({
    prompts: [
      { scene: 1, prompt: 'wide shot, handheld, teal-orange grade' },
      { scene: 2, prompt: 'macro insert, hard practical light' }
    ]
  })

  it('maps each prompt to its scene number', async () => {
    mockFetch([{ body: reply(PROMPTS_JSON) }])
    const prompts = await planPrompts(PROMPT_ARGS)

    expect(prompts.get(1)).toBe('wide shot, handheld, teal-orange grade')
    expect(prompts.get(2)).toBe('macro insert, hard practical light')
  })

  it('drops prompts for scenes it did not ask for, and empty ones', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            prompts: [
              { scene: 1, prompt: 'kept' },
              { scene: 9, prompt: 'not asked for' },
              { scene: 2, prompt: '   ' }
            ]
          })
        )
      }
    ])

    const prompts = await planPrompts(PROMPT_ARGS)
    expect([...prompts.keys()]).toEqual([1])
  })

  it('reports a plan with no usable prompts as a parse failure', async () => {
    mockFetch([
      { body: reply(JSON.stringify({ prompts: [{ scene: 9, prompt: 'x' }] })) }
    ])
    await expect(planPrompts(PROMPT_ARGS)).rejects.toMatchObject({
      kind: 'parse'
    })
  })
})
