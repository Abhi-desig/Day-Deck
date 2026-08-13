import { describe, expect, it } from 'vitest'
import type {
  StoryBriefRef,
  StoryFrame,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  Storyboard,
  StoryStyleNode,
  VideoStyle
} from '../src/shared/types'
import {
  buildBoardEdges,
  buildBoardNodes,
  groupItemsByList,
  groupRefsByFrame,
  type BoardGraphInput
} from '../src/renderer/src/lib/board-graph'

/**
 * The store-rows-to-graph mapping, asserted without a DOM.
 *
 * The brief test is the one that earns this file its place: React Flow gives a
 * node that is neither selectable nor draggable `pointer-events: none`, which
 * silently made the brief's textareas untypeable. That regression is invisible
 * to every other test in the suite, so it is pinned here as data.
 */

const board: Storyboard = {
  id: 'b1',
  title: 'Launch film',
  projectId: null,
  brief: 'A film about the thing',
  visualStyle: 'Handheld, warm',
  color: 'amber',
  sortIndex: 0,
  createdAt: '2026-08-13T00:00:00Z'
}

const frame = (id: string): StoryFrame => ({
  id,
  boardId: board.id,
  title: '',
  description: '',
  prompt: '',
  x: 420,
  y: 0,
  w: 280,
  h: 220,
  durationSec: null,
  color: 'amber',
  sortIndex: 0,
  createdAt: '2026-08-13T00:00:00Z'
})

const list = (id: string): StoryList => ({
  id,
  boardId: board.id,
  title: 'Plates',
  x: -520,
  y: 0,
  w: 260,
  h: 200,
  color: 'amber',
  sortIndex: 0,
  createdAt: '2026-08-13T00:00:00Z'
})

const item = (id: string, listId: string): StoryListItem => ({
  id,
  listId,
  label: 'ref.png',
  mediaPath: `/refs/${id}.png`,
  mediaKind: 'image',
  thumb: null,
  missing: false,
  sortIndex: 0,
  createdAt: '2026-08-13T00:00:00Z'
})

const ref = (frameId: string, itemId: string): StoryFrameRef => ({
  frameId,
  itemId,
  createdAt: '2026-08-13T00:00:00Z'
})

const briefRef = (itemId: string): StoryBriefRef => ({
  boardId: board.id,
  itemId,
  createdAt: '2026-08-13T00:00:00Z'
})

const style: VideoStyle = {
  id: 's1',
  name: 'Gritty',
  videoStyle: 'gritty urban indie',
  camera: 'handheld',
  lens: '35mm',
  grade: 'teal-orange',
  lighting: 'practicals',
  filmStock: '500T',
  aspect: '2.39:1',
  extras: [],
  sourceText: '',
  color: 'violet',
  sortIndex: 0,
  createdAt: '2026-08-13T00:00:00Z'
}

const placement: StoryStyleNode = {
  id: 'p1',
  boardId: board.id,
  styleId: style.id,
  x: -400,
  y: -200,
  createdAt: '2026-08-13T00:00:00Z'
}

const graph = (over: Partial<BoardGraphInput> = {}): BoardGraphInput => ({
  board,
  frames: [],
  lists: [],
  items: [],
  refs: [],
  briefRefs: [],
  placedStyles: [],
  styleLibrary: [],
  ...over
})

describe('the brief node', () => {
  const brief = buildBoardNodes(graph())[0]

  it('is exactly one, first, pinned at the origin', () => {
    expect(brief.type).toBe('brief')
    expect(brief.position).toEqual({ x: 0, y: 0 })
    expect(brief.draggable).toBe(false)
    expect(brief.deletable).toBe(false)
    expect(brief.selectable).toBe(false)
  })

  it('keeps its pointer events despite being unselectable and undraggable', () => {
    // Without this, React Flow computes hasPointerEvents = false and stamps
    // pointer-events: none on the wrapper — the card goes click-through and
    // the brief cannot be typed into. node.style is spread after that
    // decision, so this override is what keeps the textareas reachable.
    expect(brief.style?.pointerEvents).toBe('all')
  })
})

describe('nodes', () => {
  it('maps frames, lists and placed styles around the brief', () => {
    const nodes = buildBoardNodes(
      graph({
        frames: [frame('f1'), frame('f2')],
        lists: [list('l1')],
        items: [item('i1', 'l1')],
        placedStyles: [placement],
        styleLibrary: [style]
      })
    )

    expect(nodes.map((n) => n.type)).toEqual([
      'brief',
      'list',
      'style',
      'scene',
      'scene'
    ])
    expect(nodes.map((n) => n.id)).toEqual([
      'brief:b1',
      'list:l1',
      'style:p1',
      'scene:f1',
      'scene:f2'
    ])
  })

  it('drops a placement whose style the library has not loaded', () => {
    const nodes = buildBoardNodes(
      graph({ placedStyles: [placement], styleLibrary: [] })
    )
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('brief')
  })

  it('hands each scene its wired references in list order', () => {
    const nodes = buildBoardNodes(
      graph({
        frames: [frame('f1')],
        lists: [list('l1')],
        items: [item('i1', 'l1'), item('i2', 'l1')],
        refs: [ref('f1', 'i1'), ref('f1', 'i2')]
      })
    )
    const scene = nodes.find((n) => n.type === 'scene')
    expect(
      (scene?.data as { refs: StoryListItem[] }).refs.map((r) => r.id)
    ).toEqual(['i1', 'i2'])
  })

  it('hands the brief its film-wide references, dropping unknown items', () => {
    const nodes = buildBoardNodes(
      graph({
        lists: [list('l1')],
        items: [item('i1', 'l1')],
        briefRefs: [briefRef('i1'), briefRef('ghost')]
      })
    )
    const brief = nodes.find((n) => n.type === 'brief')
    expect(
      (brief?.data as { refs: StoryListItem[] }).refs.map((r) => r.id)
    ).toEqual(['i1'])
  })
})

describe('edges', () => {
  it('derives one spine per frame and one attachment per placement', () => {
    const edges = buildBoardEdges({
      board,
      frames: [frame('f1'), frame('f2')],
      items: [],
      refs: [],
      briefRefs: [],
      placedStyles: [placement]
    })

    const spine = edges.filter((e) => e.id.startsWith('spine:'))
    expect(spine).toHaveLength(2)
    // Derived edges must not be deletable — there is no row behind them to
    // delete, so a deletion gesture would be a lie the store cannot honour.
    expect(spine.every((e) => e.deletable === false)).toBe(true)

    const attached = edges.find((e) => e.id === 'style:p1')
    expect(attached?.source).toBe('style:p1')
    expect(attached?.target).toBe('brief:b1')
    expect(attached?.deletable).toBe(false)
  })

  it('wires a ref from its item row to the scene', () => {
    const edges = buildBoardEdges({
      board,
      frames: [frame('f1')],
      items: [item('i1', 'l1')],
      refs: [ref('f1', 'i1')],
      briefRefs: [],
      placedStyles: []
    })

    const wire = edges.find((e) => e.id === 'ref:f1:i1')
    expect(wire?.source).toBe('list:l1')
    // The source handle is the item id — that is what onConnect reads back.
    expect(wire?.sourceHandle).toBe('i1')
    expect(wire?.target).toBe('scene:f1')
  })

  it('skips a ref whose item is not loaded instead of emitting a broken wire', () => {
    const edges = buildBoardEdges({
      board,
      frames: [frame('f1')],
      items: [],
      refs: [ref('f1', 'ghost')],
      briefRefs: [],
      placedStyles: []
    })
    expect(edges.some((e) => e.id.startsWith('ref:'))).toBe(false)
    // The spine is untouched by the skip.
    expect(edges.some((e) => e.id === 'spine:f1')).toBe(true)
  })

  it('wires a brief ref from its item row to the brief', () => {
    const edges = buildBoardEdges({
      board,
      frames: [],
      items: [item('i1', 'l1')],
      refs: [],
      briefRefs: [briefRef('i1')],
      placedStyles: []
    })

    const wire = edges.find((e) => e.id === 'bref:b1:i1')
    expect(wire?.source).toBe('list:l1')
    expect(wire?.sourceHandle).toBe('i1')
    expect(wire?.target).toBe('brief:b1')
  })

  it('skips a brief ref whose item is not loaded', () => {
    const edges = buildBoardEdges({
      board,
      frames: [],
      items: [],
      refs: [],
      briefRefs: [briefRef('ghost')],
      placedStyles: []
    })
    expect(edges.some((e) => e.id.startsWith('bref:'))).toBe(false)
  })
})

describe('grouping', () => {
  it('buckets items by list, preserving order', () => {
    const grouped = groupItemsByList([
      item('i1', 'l1'),
      item('i2', 'l2'),
      item('i3', 'l1')
    ])
    expect(grouped.get('l1')?.map((i) => i.id)).toEqual(['i1', 'i3'])
    expect(grouped.get('l2')?.map((i) => i.id)).toEqual(['i2'])
  })

  it('buckets refs by frame, dropping unknown items', () => {
    const grouped = groupRefsByFrame(
      [ref('f1', 'i1'), ref('f1', 'ghost'), ref('f2', 'i2')],
      [item('i1', 'l1'), item('i2', 'l1')]
    )
    expect(grouped.get('f1')?.map((i) => i.id)).toEqual(['i1'])
    expect(grouped.get('f2')?.map((i) => i.id)).toEqual(['i2'])
  })
})
