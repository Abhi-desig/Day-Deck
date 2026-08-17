import { describe, expect, it } from 'vitest'
import type {
  StoryBriefRef,
  StoryCut,
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
import {
  GROUP_MAX_H,
  GROUP_MIN_H
} from '../src/renderer/src/sections/Storyboards/nodes/types'

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
  // The free canvas, which is what most of these cases are about. The container
  // has its own describe block below.
  sceneLayout: 'canvas',
  // No cut until the timeline has been opened once — most boards never reach
  // it, and drawing an empty one beside every brief says nothing.
  cut: null,
  takes: [],
  ...over
})

const storyCut: StoryCut = {
  id: 'c1',
  boardId: board.id,
  x: 980,
  y: -40,
  createdAt: '2026-08-13T00:00:00Z'
}

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

/** The builder takes a subset of the graph input, so one helper feeds both. */
const edgesOf = (over: Partial<BoardGraphInput> = {}) =>
  buildBoardEdges(graph(over))

describe('edges', () => {
  it('derives one spine per frame and one attachment per placement', () => {
    const edges = edgesOf({
      frames: [frame('f1'), frame('f2')],
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
    const edges = edgesOf({
      frames: [frame('f1')],
      items: [item('i1', 'l1')],
      refs: [ref('f1', 'i1')]
    })

    const wire = edges.find((e) => e.id === 'ref:f1:i1')
    expect(wire?.source).toBe('list:l1')
    // The source handle is the item id — that is what onConnect reads back.
    expect(wire?.sourceHandle).toBe('i1')
    expect(wire?.target).toBe('scene:f1')
  })

  it('skips a ref whose item is not loaded instead of emitting a broken wire', () => {
    const edges = edgesOf({ frames: [frame('f1')], refs: [ref('f1', 'ghost')] })
    expect(edges.some((e) => e.id.startsWith('ref:'))).toBe(false)
    // The spine is untouched by the skip.
    expect(edges.some((e) => e.id === 'spine:f1')).toBe(true)
  })

  it('wires a brief ref from its item row to the brief', () => {
    const edges = edgesOf({
      items: [item('i1', 'l1')],
      briefRefs: [briefRef('i1')]
    })

    const wire = edges.find((e) => e.id === 'bref:b1:i1')
    expect(wire?.source).toBe('list:l1')
    expect(wire?.sourceHandle).toBe('i1')
    expect(wire?.target).toBe('brief:b1')
  })

  it('skips a brief ref whose item is not loaded', () => {
    const edges = edgesOf({ briefRefs: [briefRef('ghost')] })
    expect(edges.some((e) => e.id.startsWith('bref:'))).toBe(false)
  })
})

describe('the scene container', () => {
  const stacked = (over: Partial<BoardGraphInput> = {}) =>
    graph({ sceneLayout: 'stack', ...over })

  it('replaces every scene node with one box holding them all', () => {
    const nodes = buildBoardNodes(
      stacked({ frames: [frame('f1'), frame('f2'), frame('f3')] })
    )

    expect(nodes.some((n) => n.type === 'scene')).toBe(false)
    const group = nodes.find((n) => n.type === 'group')
    expect(group?.id).toBe('group:b1')

    const { scenes } = group?.data as { scenes: { frame: StoryFrame }[] }
    // Board order, and the index each row numbers itself by, both preserved.
    expect(scenes.map((s) => s.frame.id)).toEqual(['f1', 'f2', 'f3'])
    expect((group?.data as { scenes: { index: number }[] }).scenes[2].index).toBe(
      2
    )
  })

  it('keeps its pointer events, the trap the brief node already paid for', () => {
    // Neither selectable nor draggable, so React Flow would otherwise stamp
    // pointer-events: none on the wrapper — and every field in every row would
    // be unclickable. Same override, same reason, pinned the same way.
    const group = buildBoardNodes(stacked({ frames: [frame('f1')] })).find(
      (n) => n.type === 'group'
    )
    expect(group?.style?.pointerEvents).toBe('all')
    expect(group?.draggable).toBe(false)
    expect(group?.deletable).toBe(false)
  })

  /**
   * The box grows with the list, up to a ceiling.
   *
   * It used to be one fixed height for every board, so three scenes got a
   * mostly-empty box and thirty got a two-row porthole onto a list that exists
   * to be read top to bottom.
   */
  it('sizes itself on how many scenes there are', () => {
    const heightOf = (count: number): number => {
      const group = buildBoardNodes(
        stacked({
          frames: Array.from({ length: count }, (_, i) => frame(`f${i}`))
        })
      ).find((n) => n.type === 'group')
      return group?.style?.height as number
    }

    expect(heightOf(0)).toBe(GROUP_MIN_H)
    expect(heightOf(3)).toBeGreaterThan(GROUP_MIN_H)
    expect(heightOf(8)).toBeGreaterThan(heightOf(3))
    // Past the ceiling the body scrolls rather than the board growing forever.
    expect(heightOf(40)).toBe(GROUP_MAX_H)
  })

  it('collapses the spine to a single edge', () => {
    const edges = buildBoardEdges(
      stacked({ frames: [frame('f1'), frame('f2'), frame('f3')] })
    )

    const spine = edges.filter((e) => e.id.startsWith('spine:'))
    expect(spine).toHaveLength(1)
    expect(spine[0].id).toBe('spine:b1')
    expect(spine[0].target).toBe('group:b1')
    expect(spine[0].deletable).toBe(false)
  })

  it('draws no spine at all when there are no scenes to wire', () => {
    expect(buildBoardEdges(stacked()).some((e) => e.id.startsWith('spine:')))
      .toBe(false)
  })

  it('lands a reference on its own scene row, not on the box', () => {
    const edges = buildBoardEdges(
      stacked({
        frames: [frame('f1'), frame('f2')],
        items: [item('i1', 'l1')],
        refs: [ref('f2', 'i1')]
      })
    )

    const wire = edges.find((e) => e.id === 'ref:f2:i1')
    expect(wire?.target).toBe('group:b1')
    // The row's handle id is the frame id — that is what makes the wire land on
    // scene 2 rather than on the container's edge, and what onConnect reads
    // back to know which scene a dropped wire belongs to.
    expect(wire?.targetHandle).toBe('f2')
    // Unchanged in both layouts, so onEdgesDelete still parses it.
    expect(wire?.source).toBe('list:l1')
    expect(wire?.sourceHandle).toBe('i1')
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

describe('the timeline node', () => {
  it('is absent until the board has a cut', () => {
    const nodes = buildBoardNodes(graph({ frames: [frame('f1')] }))
    expect(nodes.some((n) => n.type === 'timeline')).toBe(false)
    expect(
      buildBoardEdges(graph({ frames: [frame('f1')] })).some((e) =>
        e.id.startsWith('cut:')
      )
    ).toBe(false)
  })

  it('sits where the cut row says, unlike the pinned container', () => {
    const node = buildBoardNodes(graph({ cut: storyCut })).find(
      (n) => n.type === 'timeline'
    )
    expect(node?.id).toBe('timeline:b1')
    // Stored, because this is a node the user arranges. The container is not.
    expect(node?.position).toEqual({ x: 980, y: -40 })
    // Same pointer-events override as the brief and the container: without it
    // every trim handle inside stops responding.
    expect(node?.style?.pointerEvents).toBe('all')
    expect(node?.deletable).toBe(false)
  })

  it('is fed by the container when stacked and by the brief when spread', () => {
    const stacked = buildBoardEdges(
      graph({ sceneLayout: 'stack', frames: [frame('f1')], cut: storyCut })
    ).find((e) => e.id === 'cut:b1')
    expect(stacked?.source).toBe('group:b1')
    expect(stacked?.target).toBe('timeline:b1')

    // Spread out there is no single node the clips come from, so the wire
    // leaves the brief — which is what every scene descends from anyway.
    const spread = buildBoardEdges(
      graph({ sceneLayout: 'canvas', frames: [frame('f1')], cut: storyCut })
    ).find((e) => e.id === 'cut:b1')
    expect(spread?.source).toBe('brief:b1')
  })

  it('is derived, so it cannot be deleted as if it were a wire someone drew', () => {
    const wire = buildBoardEdges(graph({ cut: storyCut })).find(
      (e) => e.id === 'cut:b1'
    )
    expect(wire?.deletable).toBe(false)
    expect(wire?.selectable).toBe(false)
  })
})
