import { beforeEach, describe, expect, it } from 'vitest'
import * as boards from '../src/main/db/storyboards'
import * as styles from '../src/main/db/styles'
import { makeDb, type TestDb } from './helpers'

let db: TestDb

beforeEach(() => {
  db = makeDb()
})

describe('the style library', () => {
  it('creates one with the named fields and freeform extras', () => {
    const style = styles.createStyle(db, {
      name: 'Urban indie',
      lens: '35mm anamorphic',
      extras: [{ key: 'gate weave', value: 'subtle' }]
    })

    expect(style.name).toBe('Urban indie')
    expect(style.lens).toBe('35mm anamorphic')
    expect(style.extras).toEqual([{ key: 'gate weave', value: 'subtle' }])
    // Unset named fields come back as '' rather than null, so the prompt builder
    // and the editor never have to check.
    expect(style.camera).toBe('')
  })

  it('round-trips extras through JSON', () => {
    const style = styles.createStyle(db, { name: 'S' })
    const extras = [
      { key: 'halation', value: 'heavy' },
      { key: 'frame rate', value: '24' }
    ]

    expect(styles.updateStyle(db, style.id, { extras }).extras).toEqual(extras)
  })

  it('survives extras that are not the shape we expect', () => {
    const style = styles.createStyle(db, { name: 'S' })
    // A row written by a future version, or hand-edited, must not be able to
    // crash a board load.
    db.prepare(`UPDATE video_styles SET extras = ? WHERE id = ?`).run(
      '[{"key":"ok","value":"yes"},{"key":1},"junk",null]',
      style.id
    )

    expect(styles.getStyle(db, style.id).extras).toEqual([
      { key: 'ok', value: 'yes' }
    ])
  })

  it('survives extras that are not JSON at all', () => {
    const style = styles.createStyle(db, { name: 'S' })
    db.prepare(`UPDATE video_styles SET extras = ? WHERE id = ?`).run(
      'not json',
      style.id
    )

    expect(styles.getStyle(db, style.id).extras).toEqual([])
  })

  it('patches one field without clobbering its siblings', () => {
    const style = styles.createStyle(db, {
      name: 'S',
      lens: '50mm',
      grade: 'bleach bypass'
    })

    const saved = styles.updateStyle(db, style.id, { lens: '85mm' })
    expect(saved.lens).toBe('85mm')
    expect(saved.grade).toBe('bleach bypass')
  })

  it('duplicates a look under a new name', () => {
    const style = styles.createStyle(db, {
      name: 'Urban indie',
      lens: '35mm',
      extras: [{ key: 'gate weave', value: 'subtle' }]
    })

    const copy = styles.duplicateStyle(db, style.id)
    expect(copy.id).not.toBe(style.id)
    expect(copy.name).toBe('Urban indie copy')
    expect(copy.lens).toBe('35mm')
    expect(copy.extras).toEqual(style.extras)
    expect(styles.listStyles(db)).toHaveLength(2)
  })
})

describe('placing a style on a board', () => {
  function seed(): { boardId: string; styleId: string } {
    const board = boards.createBoard(db, { title: 'Board' })
    const style = styles.createStyle(db, { name: 'Look' })
    return { boardId: board.id, styleId: style.id }
  }

  it('records where it was dropped', () => {
    const { boardId, styleId } = seed()
    const node = styles.placeStyle(db, { boardId, styleId, x: -520, y: -60 })

    expect(node).toMatchObject({ boardId, styleId, x: -520, y: -60 })
    expect(styles.listStyleNodes(db, boardId)).toHaveLength(1)
  })

  it('moves the existing node when the same style is dropped again', () => {
    const { boardId, styleId } = seed()
    const first = styles.placeStyle(db, { boardId, styleId, x: 0, y: 0 })
    const second = styles.placeStyle(db, { boardId, styleId, x: 100, y: 200 })

    // Dropping the same style twice is the same statement made twice — not two
    // placements, and not a unique-index error the UI has to pre-empt.
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ x: 100, y: 200 })
    expect(styles.listStyleNodes(db, boardId)).toHaveLength(1)
  })

  it('lets the same style sit on two different boards', () => {
    const { boardId, styleId } = seed()
    const other = boards.createBoard(db, { title: 'Other' })

    styles.placeStyle(db, { boardId, styleId })
    styles.placeStyle(db, { boardId: other.id, styleId })

    expect(styles.listStyleNodes(db, boardId)).toHaveLength(1)
    expect(styles.listStyleNodes(db, other.id)).toHaveLength(1)
  })

  it('does not leak placements between boards', () => {
    const { boardId, styleId } = seed()
    styles.placeStyle(db, { boardId, styleId })
    const other = boards.createBoard(db, { title: 'Other' })

    expect(styles.listStyleNodes(db, other.id)).toEqual([])
  })

  it('unplacing takes it off the board but keeps the library entry', () => {
    const { boardId, styleId } = seed()
    const node = styles.placeStyle(db, { boardId, styleId })

    styles.removeStyleNode(db, node.id)

    expect(styles.listStyleNodes(db, boardId)).toEqual([])
    expect(styles.listStyles(db)).toHaveLength(1)
  })

  it('deleting the style takes it off every board', () => {
    const { boardId, styleId } = seed()
    const other = boards.createBoard(db, { title: 'Other' })
    styles.placeStyle(db, { boardId, styleId })
    styles.placeStyle(db, { boardId: other.id, styleId })

    styles.deleteStyle(db, styleId)

    expect(styles.listStyleNodes(db, boardId)).toEqual([])
    expect(styles.listStyleNodes(db, other.id)).toEqual([])
  })

  it('deleting the board takes its placements, not the style', () => {
    const { boardId, styleId } = seed()
    styles.placeStyle(db, { boardId, styleId })

    boards.deleteBoard(db, boardId)

    expect(styles.listStyleNodes(db, boardId)).toEqual([])
    expect(styles.getStyle(db, styleId).name).toBe('Look')
  })

  it('refuses a placement of a style that does not exist', () => {
    const board = boards.createBoard(db, { title: 'Board' })
    expect(() =>
      styles.placeStyle(db, { boardId: board.id, styleId: 'no-such-style' })
    ).toThrow()
  })
})
