import { beforeEach, describe, expect, it } from 'vitest'
import * as boards from '../src/main/db/storyboards'
import { makeDb, type TestDb } from './helpers'

let db: TestDb

beforeEach(() => {
  db = makeDb()
})

function seedProject(id = 'p1', name = 'Day Deck'): string {
  db.prepare(
    `INSERT INTO projects (id, name, path, color, pinned, sort_index, created_at)
     VALUES (?, ?, ?, 'sky', 0, 0, ?)`
  ).run(id, name, `/tmp/${id}`, new Date().toISOString())
  return id
}

describe('boards', () => {
  it('creates one that stands on its own', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })

    expect(board.title).toBe('Launch film')
    expect(board.projectId).toBeNull()
    expect(boards.listBoards(db)).toHaveLength(1)
  })

  it('creates one belonging to a project', () => {
    const projectId = seedProject()
    const board = boards.createBoard(db, { title: 'Onboarding', projectId })

    expect(boards.getBoard(db, board.id).projectId).toBe(projectId)
  })

  it('renames and recolours', () => {
    const board = boards.createBoard(db, { title: 'Draft' })
    const saved = boards.updateBoard(db, board.id, {
      title: 'Final cut',
      color: 'sky'
    })

    expect(saved.title).toBe('Final cut')
    expect(saved.color).toBe('sky')
  })

  /**
   * SET NULL, not CASCADE: removing a folder from the Projects grid must not
   * shred the thinking that was done about it.
   */
  it('survives its project being deleted, unattached', () => {
    const projectId = seedProject()
    const board = boards.createBoard(db, { title: 'Kept', projectId })

    db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId)

    const after = boards.getBoard(db, board.id)
    expect(after.title).toBe('Kept')
    expect(after.projectId).toBeNull()
  })
})

describe('frames', () => {
  it('defaults to an empty prompt rather than null', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const frame = boards.createFrame(db, { boardId: board.id })

    expect(frame.prompt).toBe('')
    expect(frame.title).toBe('')
  })

  /** The prompt is the thing that gets copied out whole. */
  it('round-trips a multi-line prompt verbatim', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const prompt =
      'Wide shot, dusk.\nHandheld, 35mm, teal-and-orange grade.\n"Keep the quotes."'
    const frame = boards.createFrame(db, { boardId: board.id, prompt })

    expect(boards.getFrame(db, frame.id).prompt).toBe(prompt)
  })

  it('keeps its own coordinates and size', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const frame = boards.createFrame(db, {
      boardId: board.id,
      x: 420,
      y: -160,
      w: 320,
      h: 240
    })

    const saved = boards.getFrame(db, frame.id)
    // Negative coordinates are legal: the canvas is unbounded and pans.
    expect([saved.x, saved.y, saved.w, saved.h]).toEqual([420, -160, 320, 240])
  })

  it('patches one field without disturbing the others', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const frame = boards.createFrame(db, {
      boardId: board.id,
      title: 'Shot 1',
      prompt: 'keep me'
    })

    const saved = boards.updateFrame(db, frame.id, { x: 80, y: 90 })
    expect(saved.prompt).toBe('keep me')
    expect(saved.title).toBe('Shot 1')
    expect([saved.x, saved.y]).toEqual([80, 90])
  })

  it('lists only its own board — segments do not leak', () => {
    const a = boards.createBoard(db, { title: 'A' })
    const b = boards.createBoard(db, { title: 'B' })
    boards.createFrame(db, { boardId: a.id, title: 'a1' })
    boards.createFrame(db, { boardId: a.id, title: 'a2' })
    boards.createFrame(db, { boardId: b.id, title: 'b1' })

    expect(boards.listFrames(db, a.id).map((f) => f.title)).toEqual([
      'a1',
      'a2'
    ])
    expect(boards.listFrames(db, b.id).map((f) => f.title)).toEqual(['b1'])
  })

  it('goes with its board — CASCADE, not orphaned rows', () => {
    const board = boards.createBoard(db, { title: 'Doomed' })
    boards.createFrame(db, { boardId: board.id })
    boards.createFrame(db, { boardId: board.id })

    boards.deleteBoard(db, board.id)

    expect(boards.listBoards(db)).toHaveLength(0)
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM storyboard_frames`).get()
    ).toEqual({ n: 0 })
  })

  it('refuses a frame on a board that does not exist', () => {
    expect(() =>
      boards.createFrame(db, { boardId: 'no-such-board' })
    ).toThrow()
  })

  it('deletes one frame without touching its siblings', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const doomed = boards.createFrame(db, { boardId: board.id, title: 'go' })
    boards.createFrame(db, { boardId: board.id, title: 'stay' })

    boards.deleteFrame(db, doomed.id)

    expect(boards.listFrames(db, board.id).map((f) => f.title)).toEqual([
      'stay'
    ])
  })
})

describe('the brief', () => {
  it('starts empty on a new board and round-trips multi-line text', () => {
    const board = boards.createBoard(db, { title: 'Spot' })
    expect(board.brief).toBe('')
    expect(board.visualStyle).toBe('')

    const brief = 'A student lands in a new city.\n\nBeat two: the room.'
    const saved = boards.updateBoard(db, board.id, {
      brief,
      visualStyle: 'handheld, teal-orange'
    })

    // The internal shape of a brief is part of the brief — only the ends trim.
    expect(saved.brief).toBe(brief)
    expect(saved.visualStyle).toBe('handheld, teal-orange')
  })

  it('survives a title change, and a title survives a brief change', () => {
    const board = boards.createBoard(db, { title: 'Draft' })
    boards.updateBoard(db, board.id, { brief: 'the idea' })
    const saved = boards.updateBoard(db, board.id, { title: 'Final' })

    expect(saved.title).toBe('Final')
    expect(saved.brief).toBe('the idea')
  })
})

describe('scene duration', () => {
  it('is null until decided, and holds a supported length', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const frame = boards.createFrame(db, { boardId: board.id })

    expect(frame.durationSec).toBeNull()
    expect(boards.updateFrame(db, frame.id, { durationSec: 10 }).durationSec)
      .toBe(10)
    // Back to undecided is a real move, not a reset to some default.
    expect(boards.updateFrame(db, frame.id, { durationSec: null }).durationSec)
      .toBeNull()
  })
})

describe('reference lists', () => {
  it('belongs to a board and inherits its colour', () => {
    const board = boards.createBoard(db, { title: 'Board', color: 'sky' })
    const list = boards.createList(db, { boardId: board.id, title: 'Plates' })

    expect(list.title).toBe('Plates')
    expect(list.color).toBe('sky')
    expect(boards.listLists(db, board.id)).toHaveLength(1)
  })

  it('does not leak between boards', () => {
    const a = boards.createBoard(db, { title: 'A' })
    const b = boards.createBoard(db, { title: 'B' })
    boards.createList(db, { boardId: a.id, title: 'only A' })

    expect(boards.listLists(db, b.id)).toEqual([])
  })

  it('reports a linked file that is not there as missing', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const list = boards.createList(db, { boardId: board.id })
    const item = boards.createItem(db, {
      listId: list.id,
      label: 'hero plate',
      mediaPath: '/tmp/definitely-not-a-real-file-9f3a.mp4',
      mediaKind: 'video'
    })

    // Linked in place, so the file is the user's and can vanish. Computed on
    // read rather than stored, which is why it is right the first time.
    expect(item.missing).toBe(true)
    expect(item.mediaKind).toBe('video')
  })

  it('is not missing when there is no media to miss', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const list = boards.createList(db, { boardId: board.id })
    const item = boards.createItem(db, { listId: list.id, label: 'note to self' })

    expect(item.mediaPath).toBeNull()
    expect(item.missing).toBe(false)
  })

  it('gathers every item across all the lists on a board, in order', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const one = boards.createList(db, { boardId: board.id, title: 'one' })
    const two = boards.createList(db, { boardId: board.id, title: 'two' })
    boards.createItem(db, { listId: one.id, label: 'a' })
    boards.createItem(db, { listId: two.id, label: 'b' })

    expect(boards.listItems(db, board.id).map((i) => i.label)).toEqual(['a', 'b'])
  })

  it('takes its items with it when deleted', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    const list = boards.createList(db, { boardId: board.id })
    boards.createItem(db, { listId: list.id, label: 'doomed' })

    boards.deleteList(db, list.id)

    expect(boards.listItems(db, board.id)).toEqual([])
  })
})

describe('wires', () => {
  function graph(): { frameId: string; itemId: string; boardId: string } {
    const board = boards.createBoard(db, { title: 'Board' })
    const frame = boards.createFrame(db, { boardId: board.id })
    const list = boards.createList(db, { boardId: board.id })
    const item = boards.createItem(db, { listId: list.id, label: 'ref' })
    return { frameId: frame.id, itemId: item.id, boardId: board.id }
  }

  it('connects a reference to a scene', () => {
    const { frameId, itemId, boardId } = graph()
    boards.createRef(db, frameId, itemId)

    expect(boards.listRefs(db, boardId)).toEqual([
      expect.objectContaining({ frameId, itemId })
    ])
  })

  it('connecting twice is a no-op, not an error', () => {
    const { frameId, itemId, boardId } = graph()
    boards.createRef(db, frameId, itemId)

    // The pair is the primary key, so the UI never has to check first.
    expect(() => boards.createRef(db, frameId, itemId)).not.toThrow()
    expect(boards.listRefs(db, boardId)).toHaveLength(1)
  })

  it('disconnects one wire without disturbing the nodes', () => {
    const { frameId, itemId, boardId } = graph()
    boards.createRef(db, frameId, itemId)

    boards.deleteRef(db, frameId, itemId)

    expect(boards.listRefs(db, boardId)).toEqual([])
    expect(boards.listFrames(db, boardId)).toHaveLength(1)
    expect(boards.listItems(db, boardId)).toHaveLength(1)
  })

  it('refuses a wire to a scene that does not exist', () => {
    const { itemId } = graph()
    expect(() => boards.createRef(db, 'no-such-frame', itemId)).toThrow()
  })

  it('does not leak between boards', () => {
    const mine = graph()
    boards.createRef(db, mine.frameId, mine.itemId)
    const other = boards.createBoard(db, { title: 'Other' })

    expect(boards.listRefs(db, other.id)).toEqual([])
  })
})

describe('brief refs', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeDb()
  })

  function graph(): { itemId: string; boardId: string } {
    const board = boards.createBoard(db, { title: 'Board' })
    const list = boards.createList(db, { boardId: board.id })
    const item = boards.createItem(db, { listId: list.id, label: 'moodboard' })
    return { itemId: item.id, boardId: board.id }
  }

  it('connects a reference to the brief, idempotently', () => {
    const { itemId, boardId } = graph()
    boards.createBriefRef(db, boardId, itemId)

    expect(() => boards.createBriefRef(db, boardId, itemId)).not.toThrow()
    expect(boards.listBriefRefs(db, boardId)).toEqual([
      expect.objectContaining({ boardId, itemId })
    ])
  })

  it("refuses another board's item", () => {
    const { itemId } = graph()
    const other = boards.createBoard(db, { title: 'Other' })

    // A brief ref to a foreign item would draw a wire with one end missing on
    // every board that shows it.
    expect(() => boards.createBriefRef(db, other.id, itemId)).toThrow(
      /not on this board/i
    )
  })

  it('refuses an item that does not exist', () => {
    const { boardId } = graph()
    expect(() => boards.createBriefRef(db, boardId, 'ghost')).toThrow(
      /not found/i
    )
  })

  it('disconnects without disturbing the item', () => {
    const { itemId, boardId } = graph()
    boards.createBriefRef(db, boardId, itemId)
    boards.deleteBriefRef(db, boardId, itemId)

    expect(boards.listBriefRefs(db, boardId)).toEqual([])
    expect(boards.getItem(db, itemId).label).toBe('moodboard')
  })

  it('cascades away with its item', () => {
    const { itemId, boardId } = graph()
    boards.createBriefRef(db, boardId, itemId)
    boards.deleteItem(db, itemId)

    expect(boards.listBriefRefs(db, boardId)).toEqual([])
  })

  it('scopes the listing to one board', () => {
    const mine = graph()
    boards.createBriefRef(db, mine.boardId, mine.itemId)
    const other = boards.createBoard(db, { title: 'Other' })

    expect(boards.listBriefRefs(db, other.id)).toEqual([])
  })
})

describe('character sheets', () => {
  it('creates one with a name and a description', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })
    const sheet = boards.createSheet(db, {
      boardId: board.id,
      name: 'Maya',
      description: '24, oversized grey hoodie, silver nose stud'
    })

    expect(sheet.kind).toBe('character')
    expect(sheet.name).toBe('Maya')
    expect(boards.listSheets(db, board.id)).toHaveLength(1)
  })

  it('defaults to a character rather than making the caller say so', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })

    expect(boards.createSheet(db, { boardId: board.id }).kind).toBe('character')
  })

  it('edits the description without touching the name', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })
    const sheet = boards.createSheet(db, { boardId: board.id, name: 'Maya' })
    const saved = boards.updateSheet(db, sheet.id, {
      description: 'thick glasses, brown cardigan'
    })

    expect(saved.name).toBe('Maya')
    expect(saved.description).toBe('thick glasses, brown cardigan')
  })

  it('orders by sort index, then by age', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })
    boards.createSheet(db, { boardId: board.id, name: 'First' })
    boards.createSheet(db, { boardId: board.id, name: 'Second' })

    expect(boards.listSheets(db, board.id).map((s) => s.name)).toEqual([
      'First',
      'Second'
    ])
  })

  it('is scoped to its board — a cast belongs to one film', () => {
    const mine = boards.createBoard(db, { title: 'Mine' })
    const other = boards.createBoard(db, { title: 'Other' })
    boards.createSheet(db, { boardId: mine.id, name: 'Maya' })

    expect(boards.listSheets(db, other.id)).toEqual([])
  })

  it('cascades away with its board', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })
    boards.createSheet(db, { boardId: board.id, name: 'Maya' })
    boards.deleteBoard(db, board.id)

    expect(boards.listSheets(db, board.id)).toEqual([])
  })

  it('deletes one without disturbing the rest of the cast', () => {
    const board = boards.createBoard(db, { title: 'Launch film' })
    const maya = boards.createSheet(db, { boardId: board.id, name: 'Maya' })
    boards.createSheet(db, { boardId: board.id, name: 'The landlord' })
    boards.deleteSheet(db, maya.id)

    expect(boards.listSheets(db, board.id).map((s) => s.name)).toEqual([
      'The landlord'
    ])
  })
})
