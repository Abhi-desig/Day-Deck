import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

// The breakdown is the only part of the flow that needs a key, and the vault is
// a file on disk we have no business writing in a unit test.
vi.mock('../src/main/services/secrets', () => ({
  getApiKey: () => 'test-key',
  keyStatus: () => ({ present: true, encryptionAvailable: true }),
  setApiKey: () => {},
  clearApiKey: () => {}
}))

const { subdivideTopics } = await import('../src/main/services/ai')
const { subdivideGoal } = await import('../src/main/services/curriculum')
const repo = await import('../src/main/db/curriculum')
const slots = await import('../src/main/db/slots')
const { configureSlot, makeDb } = await import('./helpers')

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

const breakdowns = (entries: Array<[string, string[]]>): FakeResponse => ({
  body: reply(
    JSON.stringify({
      breakdowns: entries.map(([id, points]) => ({ id, points }))
    })
  )
})

const ARGS = {
  db: configureSlot(makeDb(), 'goals', 'gemini'),
  model: 'gemini-3.5-flash',
  goalTitle: 'Creative Technologist',
  curriculumExcerpt: 'Shaders. Physical computing.',
  topics: [
    {
      id: 'topic-1',
      title: 'Shaders',
      module: 'Foundations',
      detail: null,
      estMinutes: 60
    }
  ]
}

const GOAL = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing. Generative type.',
  deadline: '2026-08-31',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

const drafts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    module: null,
    title: `Topic ${i + 1}`,
    detail: null,
    estMinutes: 60
  }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('subdivideTopics', () => {
  it('asks for structured JSON and returns points per topic id', async () => {
    const fetchMock = mockFetch([
      breakdowns([['topic-1', ['Write a fragment shader', 'Sample a texture']]])
    ])

    const result = await subdivideTopics(ARGS)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/models/gemini-3.5-flash:generateContent')
    const body = JSON.parse(init.body as string)
    expect(body.generationConfig.responseMimeType).toBe('application/json')

    expect(result).toEqual([
      { topicId: 'topic-1', points: ['Write a fragment shader', 'Sample a texture'] }
    ])
  })

  /** The constraint the feature is worth nothing without. */
  it('tells the model to stay inside the curriculum and off the schedule', async () => {
    const fetchMock = mockFetch([breakdowns([['topic-1', ['A point']]])])
    await subdivideTopics(ARGS)

    const prompt = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    ).contents[0].parts[0].text as string

    expect(prompt).toMatch(/Do NOT introduce tools, libraries, courses or subjects/i)
    expect(prompt).toMatch(/do NOT mention dates, days or scheduling/i)
    // The ids have to come back untouched or nothing can be written.
    expect(prompt).toMatch(/Copy each topic's "id" back exactly/i)
    expect(prompt).toContain('id: topic-1')
  })

  it('strips list markers the model leaves on the front of a point', async () => {
    mockFetch([
      breakdowns([['topic-1', ['- Write a shader', '2. Sample a texture', '• Blend']]])
    ])

    const [result] = await subdivideTopics(ARGS)

    expect(result.points).toEqual([
      'Write a shader',
      'Sample a texture',
      'Blend'
    ])
  })

  it('caps a runaway list rather than letting it fill the card', async () => {
    mockFetch([
      breakdowns([
        ['topic-1', Array.from({ length: 30 }, (_, i) => `Point ${i + 1}`)]
      ])
    ])

    const [result] = await subdivideTopics(ARGS)

    expect(result.points).toHaveLength(8)
  })

  it('skips entries with no id or no usable points', async () => {
    mockFetch([
      {
        body: reply(
          JSON.stringify({
            breakdowns: [
              { id: '', points: ['orphan'] },
              { id: 'topic-1', points: [] },
              { id: 'topic-2', points: ['   ', ''] },
              { id: 'topic-3', points: ['Real point'] }
            ]
          })
        )
      }
    ])

    const result = await subdivideTopics(ARGS)

    expect(result).toEqual([{ topicId: 'topic-3', points: ['Real point'] }])
  })

  it('does not call out at all for an empty batch', async () => {
    const fetchMock = mockFetch([breakdowns([])])

    await expect(subdivideTopics({ ...ARGS, topics: [] })).resolves.toEqual([])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a cut-off response instead of writing half a breakdown', async () => {
    mockFetch([{ body: reply('{"breakdowns":[{"id":', 'MAX_TOKENS') }])

    await expect(subdivideTopics(ARGS)).rejects.toMatchObject({
      kind: 'truncated'
    })
  })
})

describe('subdivideGoal', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  function makeGoal(count: number) {
    const curriculum = repo.create(db, GOAL, '2026-08-10')
    const topics = repo.replaceTopics(db, curriculum.id, drafts(count))
    repo.applyAssignments(
      db,
      topics.map((t, i) => ({
        topicId: t.id,
        date: `2026-08-${String(10 + i).padStart(2, '0')}`
      }))
    )
    return { curriculum, topics: repo.listTopics(db, curriculum.id) }
  }

  it('starts every topic with no points at all', () => {
    const { topics } = makeGoal(3)
    expect(topics.every((t) => t.points.length === 0)).toBe(true)
    expect(repo.listWithoutPoints(db, topics[0].curriculumId)).toHaveLength(3)
  })

  it('writes the points back onto the topics', async () => {
    const { curriculum, topics } = makeGoal(2)
    mockFetch([
      breakdowns([
        [topics[0].id, ['Read the spec', 'Build a toy']],
        [topics[1].id, ['Wire the LED']]
      ])
    ])

    const result = await subdivideGoal(db, curriculum.id)

    expect(result.topicsSubdivided).toBe(2)
    expect(result.error).toBeNull()
    const after = repo.listTopics(db, curriculum.id)
    expect(after[0].points).toEqual(['Read the spec', 'Build a toy'])
    expect(after[1].points).toEqual(['Wire the LED'])
  })

  /** Points ride onto the deck with the slot, or the day card cannot show them. */
  it('surfaces the points on the day card’s slot', async () => {
    const { curriculum, topics } = makeGoal(1)
    repo.materialise(db, curriculum.id)
    mockFetch([breakdowns([[topics[0].id, ['Sample a texture']]])])

    await subdivideGoal(db, curriculum.id)

    const [card] = slots.listRange(db, '2026-08-10', '2026-08-10')
    expect(card.slots[0].sourcePoints).toEqual(['Sample a texture'])
  })

  it('leaves non-curriculum slots with no points rather than null', () => {
    const { curriculum } = makeGoal(1)
    repo.materialise(db, curriculum.id)

    const [card] = slots.listRange(db, '2026-08-10', '2026-08-10')
    expect(card.slots[0].sourcePoints).toEqual([])
  })

  it('ignores an id that belongs to another goal', async () => {
    const first = makeGoal(1)
    const second = makeGoal(1)

    mockFetch([
      breakdowns([
        [second.topics[0].id, ['Belongs to the other goal']],
        [first.topics[0].id, ['Belongs here']]
      ])
    ])

    const result = await subdivideGoal(db, first.curriculum.id)

    expect(result.topicsSubdivided).toBe(1)
    expect(repo.listTopics(db, first.curriculum.id)[0].points).toEqual([
      'Belongs here'
    ])
    expect(repo.listTopics(db, second.curriculum.id)[0].points).toEqual([])
  })

  it('batches a long goal instead of asking for everything at once', async () => {
    const { curriculum, topics } = makeGoal(31)
    // The fixture answers for all 31 on every call, which is exactly the shape
    // that used to triple-count: each batch may only take its own ids from it.
    const fetchMock = mockFetch([
      breakdowns(topics.map((t) => [t.id, ['A point']]))
    ])

    const result = await subdivideGoal(db, curriculum.id)

    // 31 topics at 15 per call.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.topicsSubdivided).toBe(31)
    expect(
      repo.listTopics(db, curriculum.id).every((t) => t.points.length === 1)
    ).toBe(true)
  })

  it('discards a breakdown for a topic outside the batch it answered', async () => {
    const { curriculum, topics } = makeGoal(2)
    // Break the first one, so only the second is still in play.
    mockFetch([breakdowns([[topics[0].id, ['Original']]])])
    await subdivideGoal(db, curriculum.id)

    // Now the model answers for both — including the one it was not sent.
    mockFetch([
      breakdowns([
        [topics[0].id, ['Overwritten behind the user’s back']],
        [topics[1].id, ['Legitimate']]
      ])
    ])
    const result = await subdivideGoal(db, curriculum.id)

    expect(result.topicsSubdivided).toBe(1)
    const after = repo.listTopics(db, curriculum.id)
    expect(after[0].points).toEqual(['Original'])
    expect(after[1].points).toEqual(['Legitimate'])
  })

  it('keeps the batches that worked when a later one fails', async () => {
    const { curriculum, topics } = makeGoal(20)
    mockFetch([
      breakdowns(topics.map((t) => [t.id, ['A point']])),
      { status: 401, text: JSON.stringify({ error: { message: 'bad key' } }) }
    ])

    const result = await subdivideGoal(db, curriculum.id)

    // The first batch of 15 committed; the remaining 5 died with the 401.
    expect(result.topicsSubdivided).toBe(15)
    expect(result.error).toMatch(/rejected the API key/i)
    // And the plan itself is still returned, not lost with the failure.
    expect(result.plan?.topics).toHaveLength(20)

    const after = repo.listTopics(db, curriculum.id)
    expect(after.filter((t) => t.points.length > 0)).toHaveLength(15)
    // So a second attempt has exactly the unfinished five left to do.
    expect(repo.listWithoutPoints(db, curriculum.id)).toHaveLength(5)
  })

  it('only ever fills the gaps, so re-running is free', async () => {
    const { curriculum, topics } = makeGoal(2)
    mockFetch([breakdowns([[topics[0].id, ['Already done']]])])
    await subdivideGoal(db, curriculum.id)

    const fetchMock = mockFetch([breakdowns([[topics[1].id, ['The other one']]])])
    const result = await subdivideGoal(db, curriculum.id)

    expect(result.topicsSubdivided).toBe(1)
    // One call, and the prompt it sent carried only the topic still missing.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const prompt = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    ).contents[0].parts[0].text as string
    expect(prompt).toContain(topics[1].id)
    expect(prompt).not.toContain(topics[0].id)

    // A third run has nothing left to do and does not call out.
    const idle = mockFetch([breakdowns([])])
    await subdivideGoal(db, curriculum.id)
    expect(idle).not.toHaveBeenCalled()
  })

  it('does nothing for a goal that does not exist', async () => {
    const fetchMock = mockFetch([breakdowns([])])

    const result = await subdivideGoal(db, 'no-such-goal')

    expect(result).toEqual({ plan: null, topicsSubdivided: 0, error: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
