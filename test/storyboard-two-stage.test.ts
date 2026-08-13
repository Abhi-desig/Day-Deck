import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

vi.mock('../src/main/services/secrets', () => ({
  requireApiKey: () => 'test-key',
  getApiKey: () => 'test-key',
  keyStatus: () => ({ present: true, encryptionAvailable: true }),
  setApiKey: () => {},
  clearApiKey: () => {}
}))

const plan = await import('../src/main/services/storyboard')
const boards = await import('../src/main/db/storyboards')
const { makeDb } = await import('./helpers')

/**
 * The two-stage flow at the service layer: stage one must never touch a
 * prompt, and stage two must land every prompt on the frame it was written
 * for. Gemini is a stubbed fetch; the database is real.
 */

interface FakeResponse {
  status?: number
  body?: unknown
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
      text: async () => JSON.stringify(r.body ?? {})
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const reply = (payload: unknown) => ({
  candidates: [
    { content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }
  ]
})

function seedBoard(db: TestDb) {
  const board = boards.createBoard(db, { title: 'Launch film' })
  boards.updateBoard(db, board.id, { brief: 'A student finds a room.' })
  return boards.getBoard(db, board.id)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('stage one: the breakdown', () => {
  it('carries an existing prompt through a paired scene untouched', async () => {
    const db = makeDb()
    const board = seedBoard(db)
    boards.createFrame(db, {
      boardId: board.id,
      title: 'Arrival',
      prompt: 'my hand-written prompt'
    })

    mockFetch([
      {
        body: reply({
          scenes: [
            { title: 'Arrival, retitled', description: 'new words', duration_sec: 5 },
            { title: 'New scene', description: 'added', duration_sec: 10 }
          ]
        })
      }
    ])

    const proposal = await plan.propose(db, board.id)

    // Paired scene keeps the card's own prompt; the surplus scene has none.
    expect(proposal.scenes[0].prompt).toBe('my hand-written prompt')
    expect(proposal.scenes[1].prompt).toBe('')
  })

  it('marks film-wide references as such in what the model is told', async () => {
    const db = makeDb()
    const board = seedBoard(db)
    const list = boards.createList(db, { boardId: board.id, title: 'Plates' })
    const wide = boards.createItem(db, { listId: list.id, label: 'moodboard' })
    boards.createItem(db, { listId: list.id, label: 'plate-4' })
    boards.createBriefRef(db, board.id, wide.id)

    const fetchMock = mockFetch([
      { body: reply({ scenes: [{ title: 'A', description: 'x', duration_sec: 5 }] }) }
    ])
    await plan.propose(db, board.id)

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string
    )
    const sent = body.contents[0].parts[0].text as string
    expect(sent).toContain('moodboard [film-wide]')
    expect(sent).toContain('- plate-4')
    expect(sent).not.toContain('plate-4 [film-wide]')
  })
})

describe('stage two: the prompts', () => {
  it('lands every prompt on the frame it was written for', async () => {
    const db = makeDb()
    const board = seedBoard(db)
    const f1 = boards.createFrame(db, { boardId: board.id, title: 'One' })
    const f2 = boards.createFrame(db, { boardId: board.id, title: 'Two' })

    mockFetch([
      {
        body: reply({
          prompts: [
            { scene: 2, prompt: 'second prompt' },
            { scene: 1, prompt: 'first prompt' }
          ]
        })
      }
    ])

    const proposal = await plan.proposePrompts(db, board.id)
    const byFrame = new Map(proposal.prompts.map((p) => [p.frameId, p.prompt]))

    expect(byFrame.get(f1.id)).toBe('first prompt')
    expect(byFrame.get(f2.id)).toBe('second prompt')
  })

  it('batches a large board and writes across the whole of it', async () => {
    const db = makeDb()
    const board = seedBoard(db)
    for (let i = 0; i < 17; i++) {
      boards.createFrame(db, { boardId: board.id, title: `S${i + 1}` })
    }

    // Each call answers exactly what it was asked for — read the request to
    // know which batch this is.
    let requests: number[][] = []
    const fn = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const text = body.contents[0].parts[0].text as string
      const match = /WRITE PROMPTS FOR SCENES: ([0-9, ]+)\./.exec(text)
      const write = match![1].split(',').map((n) => Number(n.trim()))
      requests.push(write)
      return {
        ok: true,
        status: 200,
        json: async () =>
          reply({
            prompts: write.map((scene) => ({ scene, prompt: `prompt ${scene}` }))
          }),
        text: async () => ''
      } as Response
    })
    vi.stubGlobal('fetch', fn)

    const proposal = await plan.proposePrompts(db, board.id)

    // Two sequential batches: 15, then the remaining 2.
    expect(requests.map((w) => w.length)).toEqual([15, 2])
    expect(proposal.prompts).toHaveLength(17)
  })

  it('refuses an empty board rather than asking for nothing', async () => {
    const db = makeDb()
    const board = seedBoard(db)
    await expect(plan.proposePrompts(db, board.id)).rejects.toThrow(
      /no scenes to write prompts for/i
    )
  })

  it('writes only the prompt column, and only on this board', () => {
    const db = makeDb()
    const board = seedBoard(db)
    const other = boards.createBoard(db, { title: 'Other' })
    const mine = boards.createFrame(db, {
      boardId: board.id,
      title: 'Kept title',
      description: 'kept description'
    })
    const theirs = boards.createFrame(db, { boardId: other.id })

    const after = plan.applyPrompts(db, board.id, [
      { frameId: mine.id, prompt: 'written' }
    ])
    expect(after.find((f) => f.id === mine.id)?.prompt).toBe('written')
    expect(after.find((f) => f.id === mine.id)?.title).toBe('Kept title')

    // A frame from another board is refused, and the refusal rolls back.
    expect(() =>
      plan.applyPrompts(db, board.id, [
        { frameId: mine.id, prompt: 'changed again' },
        { frameId: theirs.id, prompt: 'cross-board write' }
      ])
    ).toThrow(/not on this board/i)
    expect(boards.getFrame(db, mine.id).prompt).toBe('written')
    expect(boards.getFrame(db, theirs.id).prompt).toBe('')
  })
})
