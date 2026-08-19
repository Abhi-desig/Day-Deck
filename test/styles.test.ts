import { beforeEach, describe, expect, it } from 'vitest'
import type { VideoStyle } from '../src/shared/types'
import * as boards from '../src/main/db/storyboards'
import * as styles from '../src/main/db/styles'
import { groupStyles } from '../src/renderer/src/lib/style-groups'
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
    // Both, side by side: duplicating adds a look rather than renaming one.
    // Counted by name, because the library also holds the seeded style pack.
    expect(
      styles.listStyles(db).filter((s) => s.name.startsWith('Urban indie'))
    ).toHaveLength(2)
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
    expect(styles.listStyles(db).map((s) => s.id)).toContain(styleId)
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

/**
 * Filing the library into families.
 *
 * The grouping is a pure function outside the component precisely so it can be
 * asserted here — logic of this kind inside JSX is invisible to a node-only
 * suite, and a style filed under a family nobody declared simply stops being
 * rendered with nothing to say so.
 */
describe('grouping styles into families', () => {
  const style = (
    over: Partial<VideoStyle> & Pick<VideoStyle, 'id' | 'name'>
  ): VideoStyle => ({
    videoStyle: '',
    camera: '',
    lens: '',
    grade: '',
    lighting: '',
    filmStock: '',
    aspect: '',
    extras: [],
    sourceText: '',
    category: '',
    color: 'amber',
    sortIndex: 0,
    createdAt: 'now',
    ...over
  })

  it('orders groups by the list in code, not by what is in the rows', () => {
    const groups = groupStyles([
      style({ id: '1', name: 'Late', category: 'landscape' }),
      style({ id: '2', name: 'Early', category: 'cinema' })
    ])
    // `cinema` comes first in STYLE_CATEGORIES, so it comes first here — which
    // family reads first is a decision made once, in code.
    expect(groups.map((g) => g.id)).toEqual(['cinema', 'landscape'])
  })

  it('gives uncategorised its own trailing group rather than hiding it', () => {
    const groups = groupStyles([
      style({ id: '1', name: 'Mine' }),
      style({ id: '2', name: 'Scope', category: 'cinema' })
    ])
    expect(groups.map((g) => g.id)).toEqual(['cinema', ''])
    expect(groups[1].label).toBe('Uncategorised')
    expect(groups[1].styles.map((s) => s.name)).toEqual(['Mine'])
  })

  it('files a category it has never heard of as uncategorised, not nowhere', () => {
    // From a newer build, or a hand-edited row. Dropping it would take the
    // style out of the panel entirely with nothing to say so.
    const groups = groupStyles([
      style({ id: '1', name: 'Future', category: 'holograph' as never })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('')
    expect(groups[0].styles[0].name).toBe('Future')
  })

  it('drops empty groups instead of printing headings over nothing', () => {
    expect(groupStyles([])).toEqual([])
    expect(
      groupStyles([style({ id: '1', name: 'Scope', category: 'cinema' })])
    ).toHaveLength(1)
  })

  it('keeps the caller’s order inside a group', () => {
    const groups = groupStyles([
      style({ id: '1', name: 'First', category: 'cinema', sortIndex: 0 }),
      style({ id: '2', name: 'Second', category: 'cinema', sortIndex: 1 })
    ])
    expect(groups[0].styles.map((s) => s.name)).toEqual(['First', 'Second'])
  })

  it('filters on what a look does, not only on what it is called', () => {
    const library = [
      style({ id: '1', name: 'SCOPE', category: 'cinema', lens: '40mm anamorphic' }),
      style({ id: '2', name: 'FRONT CAMERA', category: 'documentary', grade: 'flat' })
    ]
    // People look for a look by its lens or its stock far more often than by
    // the name somebody gave it.
    expect(groupStyles(library, 'anamorphic')[0].styles.map((s) => s.name)).toEqual(
      ['SCOPE']
    )
    expect(groupStyles(library, 'front')[0].styles.map((s) => s.name)).toEqual([
      'FRONT CAMERA'
    ])
    expect(groupStyles(library, 'nothing here')).toEqual([])
  })

  it('ignores case and surrounding space in the filter', () => {
    const library = [style({ id: '1', name: 'SCOPE', category: 'cinema' })]
    expect(groupStyles(library, '  scOpE ')).toHaveLength(1)
    expect(groupStyles(library, '')).toHaveLength(1)
  })
})


/**
 * The category column, read the way the colour beside it already is.
 */
describe('a style’s category', () => {
  it('defaults to uncategorised and round-trips a real one', () => {
    const plain = styles.createStyle(db, { name: 'Plain' })
    expect(plain.category).toBe('')

    const filed = styles.updateStyle(db, plain.id, { category: 'cinema' })
    expect(filed.category).toBe('cinema')
    expect(styles.getStyle(db, plain.id).category).toBe('cinema')
  })

  it('reads a value it does not recognise back as uncategorised', () => {
    // No CHECK on the column by design, so a row from a newer build — or a
    // hand-edited one — must degrade rather than crash a board load.
    const style = styles.createStyle(db, { name: 'Odd' })
    db.prepare(`UPDATE video_styles SET category = 'holograph' WHERE id = ?`).run(
      style.id
    )
    expect(styles.getStyle(db, style.id).category).toBe('')
  })

  it('refuses to store a category it does not know at create time', () => {
    const style = styles.createStyle(db, {
      name: 'Invented',
      category: 'holograph' as never
    })
    expect(style.category).toBe('')
  })

  it('keeps sort order within the library untouched by filing', () => {
    const a = styles.createStyle(db, { name: 'A' })
    const b = styles.createStyle(db, { name: 'B' })
    styles.updateStyle(db, b.id, { category: 'cinema' })
    // Among the two just added — the library already ships eighteen.
    const mine = styles
      .listStyles(db)
      .filter((s) => s.id === a.id || s.id === b.id)
    expect(mine.map((s) => s.id)).toEqual([a.id, b.id])
  })
})
