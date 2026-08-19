import type { Edge } from '@xyflow/react'
import type {
  SceneLayout,
  StoryBriefRef,
  StoryCut,
  StoryTake,
  StoryFrame,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  Storyboard,
  StoryCastNode,
  StorySheet,
  StoryStyleNode,
  VideoStyle
} from '@shared/types'
import {
  GROUP_W,
  groupHeight,
  TIMELINE_W,
  HANDLE,
  nodeId,
  type BoardNode,
  type SceneData
} from '../sections/Storyboards/nodes/types'

/**
 * Store rows in, graph out.
 *
 * Pure on purpose: React Flow regressions in this mapping are invisible to a
 * node-only test suite when the mapping lives inside a component, and one of
 * them — the brief card silently losing its pointer events — cost real time to
 * find. Everything here is assertable without a DOM.
 */

export interface BoardGraphInput {
  board: Storyboard
  frames: StoryFrame[]
  lists: StoryList[]
  items: StoryListItem[]
  refs: StoryFrameRef[]
  briefRefs: StoryBriefRef[]
  placedStyles: StoryStyleNode[]
  styleLibrary: VideoStyle[]
  /** Characters placed on this board — the ones whose portrait is attached. */
  placedCast: StoryCastNode[]
  /** The board's whole cast, to resolve a placement to a person. */
  sheets: StorySheet[]
  /**
   * Whether scenes are rows in one container or cards you position.
   *
   * The frames are identical in both — only where they are drawn changes, and
   * `x/y/w/h` are read in `canvas` and ignored in `stack` rather than rewritten
   * by the switch.
   */
  sceneLayout: SceneLayout
  /**
   * The cut, if the board has one.
   *
   * Null until the timeline is first opened, which is also why it is not always
   * drawn: most boards never reach the cut, and a permanently empty timeline
   * node beside every brief is clutter that says nothing.
   */
  cut: StoryCut | null
  /** Every take on the board, for the timeline to draw its clips from. */
  takes: StoryTake[]
}

/**
 * Where the container sits.
 *
 * Just right of the brief, which is pinned at the origin and 340 wide. Not
 * stored and not draggable: there is exactly one of these per board and nothing
 * to arrange it against, so a position would be a row that could only ever
 * agree with this constant or be stale.
 */
export const GROUP_POSITION = { x: 460, y: -40 }

export const groupItemsByList = (
  items: StoryListItem[]
): Map<string, StoryListItem[]> => {
  const map = new Map<string, StoryListItem[]>()
  for (const item of items) {
    const bucket = map.get(item.listId)
    if (bucket) bucket.push(item)
    else map.set(item.listId, [item])
  }
  return map
}

export const groupRefsByFrame = (
  refs: StoryFrameRef[],
  items: StoryListItem[]
): Map<string, StoryListItem[]> => {
  const byId = new Map(items.map((i) => [i.id, i]))
  const map = new Map<string, StoryListItem[]>()
  for (const ref of refs) {
    const item = byId.get(ref.itemId)
    if (!item) continue
    const bucket = map.get(ref.frameId)
    if (bucket) bucket.push(item)
    else map.set(ref.frameId, [item])
  }
  return map
}

export function buildBoardNodes({
  board,
  frames,
  lists,
  items,
  refs,
  briefRefs,
  placedStyles,
  styleLibrary,
  placedCast,
  sheets,
  sceneLayout,
  cut,
  takes
}: BoardGraphInput): BoardNode[] {
  const itemsByList = groupItemsByList(items)
  const refsByFrame = groupRefsByFrame(refs, items)

  const itemById = new Map(items.map((i) => [i.id, i]))
  const briefItems = briefRefs.flatMap((r) => {
    const item = itemById.get(r.itemId)
    return item ? [item] : []
  })

  const brief: BoardNode = {
    id: nodeId.brief(board.id),
    type: 'brief',
    // Pinned at the origin. Everything else on the board is positioned
    // relative to a thing that does not move.
    position: { x: 0, y: 0 },
    data: { board, refs: briefItems },
    draggable: false,
    deletable: false,
    // Selecting it would offer a delete affordance it does not have.
    selectable: false,
    // Load-bearing. With neither selectable nor draggable, React Flow decides
    // the node needs no pointer events and stamps `pointer-events: none` on the
    // wrapper — which makes both textareas click-through and the brief
    // impossible to type into. node.style is spread after that decision, so
    // this wins. See test/board-graph.test.ts.
    style: { pointerEvents: 'all' }
  }

  const scenes: SceneData[] = frames.map((frame, index) => ({
    frame,
    index,
    refs: refsByFrame.get(frame.id) ?? []
  }))

  const sceneNodes: BoardNode[] =
    sceneLayout === 'stack'
      ? [
          {
            id: nodeId.group(board.id),
            type: 'group',
            position: GROUP_POSITION,
            data: { board, scenes },
            // Pinned for the same reason the brief is: nothing stores where it
            // went, so a drag would be undone by the next store change.
            draggable: false,
            deletable: false,
            selectable: false,
            // Load-bearing, and the exact trap the brief node already paid for:
            // with neither selectable nor draggable, React Flow decides the node
            // needs no pointer events and stamps `pointer-events: none` on the
            // wrapper — which would make every field in every row unclickable.
            //
            // The height follows the scene count up to a ceiling, so a board of
            // three is not a mostly-empty box and a board of thirty is not a
            // porthole. Past the ceiling the body scrolls.
            style: {
              pointerEvents: 'all',
              width: GROUP_W,
              height: groupHeight(scenes.length)
            }
          }
        ]
      : scenes.map((scene) => ({
          id: nodeId.scene(scene.frame.id),
          type: 'scene',
          position: { x: scene.frame.x, y: scene.frame.y },
          style: { width: scene.frame.w, height: scene.frame.h },
          data: scene
        }))

  const listNodes: BoardNode[] = lists.map((list) => ({
    id: nodeId.list(list.id),
    type: 'list',
    position: { x: list.x, y: list.y },
    style: { width: list.w, height: list.h },
    data: { list, items: itemsByList.get(list.id) ?? [] }
  }))

  const styleNodes: BoardNode[] = placedStyles.flatMap((placement) => {
    const style = styleLibrary.find((s) => s.id === placement.styleId)
    // A placement whose style the library has not loaded yet simply is not
    // drawn, rather than drawn as a card with nothing in it.
    if (!style) return []
    return [
      {
        id: nodeId.style(placement.id),
        type: 'style' as const,
        position: { x: placement.x, y: placement.y },
        data: { style, placementId: placement.id }
      }
    ]
  })

  const castNodes: BoardNode[] = placedCast.flatMap((placement) => {
    const sheet = sheets.find((x) => x.id === placement.sheetId)
    // A placement whose sheet has not loaded yet simply is not drawn, rather
    // than drawn as a card with nobody in it — the style node's rule, and the
    // same reason.
    if (!sheet) return []
    return [
      {
        id: nodeId.cast(placement.id),
        type: 'cast' as const,
        position: { x: placement.x, y: placement.y },
        data: { sheet, placementId: placement.id }
      }
    ]
  })

  // Unlike the container, the timeline's position is stored — it is a node the
  // user arranges relative to everything else, so it drags and stays put.
  const timelineNodes: BoardNode[] = cut
    ? [
        {
          id: nodeId.timeline(board.id),
          type: 'timeline',
          position: { x: cut.x, y: cut.y },
          data: { board, takes },
          deletable: false,
          // Same override as the brief and the container, for the same reason:
          // React Flow stamps `pointer-events: none` on a node it thinks needs
          // none, and every trim handle in here would stop responding.
          style: { pointerEvents: 'all', width: TIMELINE_W }
        }
      ]
    : []

  return [
    brief,
    ...listNodes,
    ...styleNodes,
    ...castNodes,
    ...sceneNodes,
    ...timelineNodes
  ]
}

export function buildBoardEdges({
  board,
  frames,
  items,
  refs,
  briefRefs,
  placedStyles,
  placedCast,
  sceneLayout,
  cut
}: Pick<
  BoardGraphInput,
  | 'board'
  | 'frames'
  | 'items'
  | 'refs'
  | 'briefRefs'
  | 'placedStyles'
  | 'placedCast'
  | 'sceneLayout'
  | 'cut'
>): Edge[] {
  const stacked = sceneLayout === 'stack'

  // The spine. Not stored anywhere: every frame already carries its board_id,
  // so "this scene belongs to this brief" is a fact the rows already hold and
  // an edge table would only be a second, disagreeable copy of it.
  //
  // Stacked, it collapses to one edge — the scenes are inside a single node, so
  // N wires would all be drawn between the same two boxes.
  const spineStyle = {
    deletable: false,
    selectable: false,
    style: { stroke: 'var(--color-line)', strokeWidth: 1, opacity: 0.5 },
    // Dashed so the derived spine reads differently from a wire you drew.
    animated: false,
    className: 'storyboard-spine'
  }

  const spine: Edge[] = stacked
    ? frames.length === 0
      ? []
      : [
          {
            id: `spine:${board.id}`,
            source: nodeId.brief(board.id),
            sourceHandle: HANDLE.briefOut,
            target: nodeId.group(board.id),
            targetHandle: HANDLE.groupBriefIn,
            ...spineStyle
          }
        ]
    : frames.map((frame) => ({
        id: `spine:${frame.id}`,
        source: nodeId.brief(board.id),
        sourceHandle: HANDLE.briefOut,
        target: nodeId.scene(frame.id),
        targetHandle: HANDLE.sceneBriefIn,
        ...spineStyle
      }))

  const listByItem = new Map(items.map((i) => [i.id, i.listId]))

  // A ref whose item is not loaded is skipped outright. Emitting it with an
  // empty source would hand React Flow an edge to a node that does not exist,
  // which it drops silently — better to make the skip a rule this module owns
  // than a side effect of a lookup miss.
  // Stacked, the wire still belongs to one scene — it just lands on that
  // scene's row inside the container, whose handle id is the frame id. The edge
  // id is unchanged in both layouts, which is what lets `onEdgesDelete` keep
  // reading the frame and item straight out of it.
  const wires: Edge[] = refs.flatMap((ref) => {
    const listId = listByItem.get(ref.itemId)
    if (!listId) return []
    return [
      {
        id: `ref:${ref.frameId}:${ref.itemId}`,
        source: nodeId.list(listId),
        sourceHandle: ref.itemId,
        target: stacked ? nodeId.group(board.id) : nodeId.scene(ref.frameId),
        targetHandle: stacked ? ref.frameId : HANDLE.sceneRefIn,
        style: { stroke: 'var(--color-amber)', strokeWidth: 1.5 }
      }
    ]
  })

  // Film-wide references, wired to the brief. Same skip rule as scene wires.
  const briefWires: Edge[] = briefRefs.flatMap((ref) => {
    const listId = listByItem.get(ref.itemId)
    if (!listId) return []
    return [
      {
        id: `bref:${board.id}:${ref.itemId}`,
        source: nodeId.list(listId),
        sourceHandle: ref.itemId,
        target: nodeId.brief(board.id),
        targetHandle: HANDLE.briefRefIn,
        style: { stroke: 'var(--color-amber)', strokeWidth: 1.5, opacity: 0.8 }
      }
    ]
  })

  // A placed style is attached to the brief without anyone drawing it. There is
  // exactly one brief per board, so the attachment is implied by the placement
  // and an edge row could only ever agree with it or be wrong.
  const attachments: Edge[] = placedStyles.map((placement) => ({
    id: `style:${placement.id}`,
    source: nodeId.style(placement.id),
    target: nodeId.brief(board.id),
    targetHandle: HANDLE.briefStyleIn,
    deletable: false,
    selectable: false,
    style: { stroke: 'var(--color-line)', strokeWidth: 1.5 }
  }))

  // And the same for a placed character, on its own handle. Derived for the
  // identical reason: one brief per board, so the attachment is implied by the
  // placement and a row could only ever agree with it or be wrong.
  const castAttachments: Edge[] = placedCast.map((placement) => ({
    id: `cast:${placement.id}`,
    source: nodeId.cast(placement.id),
    target: nodeId.brief(board.id),
    targetHandle: HANDLE.briefCastIn,
    deletable: false,
    selectable: false,
    style: { stroke: 'var(--color-amber)', strokeWidth: 1.5, opacity: 0.7 }
  }))

  // The cut is fed by the scenes. Derived like the spine, and for the same
  // reason: there is one timeline per board and one place the clips come from,
  // so an edge row could only ever agree with that or be wrong.
  //
  // Spread out, the wire leaves the brief instead — with N scene cards there is
  // no single node to draw it from, and the brief is what they all descend from.
  const cutWire: Edge[] = cut
    ? [
        {
          id: `cut:${board.id}`,
          source: stacked ? nodeId.group(board.id) : nodeId.brief(board.id),
          sourceHandle: stacked ? undefined : HANDLE.briefOut,
          target: nodeId.timeline(board.id),
          targetHandle: HANDLE.timelineIn,
          ...spineStyle
        }
      ]
    : []

  return [
    ...spine,
    ...attachments,
    ...castAttachments,
    ...wires,
    ...briefWires,
    ...cutWire
  ]
}
