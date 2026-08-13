import type { Edge } from '@xyflow/react'
import type {
  StoryBriefRef,
  StoryFrame,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  Storyboard,
  StoryStyleNode,
  VideoStyle
} from '@shared/types'
import {
  HANDLE,
  nodeId,
  type BoardNode
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
}

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
  styleLibrary
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

  const sceneNodes: BoardNode[] = frames.map((frame, index) => ({
    id: nodeId.scene(frame.id),
    type: 'scene',
    position: { x: frame.x, y: frame.y },
    style: { width: frame.w, height: frame.h },
    data: { frame, index, refs: refsByFrame.get(frame.id) ?? [] }
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

  return [brief, ...listNodes, ...styleNodes, ...sceneNodes]
}

export function buildBoardEdges({
  board,
  frames,
  items,
  refs,
  briefRefs,
  placedStyles
}: Pick<
  BoardGraphInput,
  'board' | 'frames' | 'items' | 'refs' | 'briefRefs' | 'placedStyles'
>): Edge[] {
  // The spine. Not stored anywhere: every frame already carries its board_id,
  // so "this scene belongs to this brief" is a fact the rows already hold and
  // an edge table would only be a second, disagreeable copy of it.
  const spine: Edge[] = frames.map((frame) => ({
    id: `spine:${frame.id}`,
    source: nodeId.brief(board.id),
    sourceHandle: HANDLE.briefOut,
    target: nodeId.scene(frame.id),
    targetHandle: HANDLE.sceneBriefIn,
    deletable: false,
    selectable: false,
    style: { stroke: 'var(--color-line)', strokeWidth: 1, opacity: 0.5 },
    // Dashed so the derived spine reads differently from a wire you drew.
    animated: false,
    className: 'storyboard-spine'
  }))

  const listByItem = new Map(items.map((i) => [i.id, i.listId]))

  // A ref whose item is not loaded is skipped outright. Emitting it with an
  // empty source would hand React Flow an edge to a node that does not exist,
  // which it drops silently — better to make the skip a rule this module owns
  // than a side effect of a lookup miss.
  const wires: Edge[] = refs.flatMap((ref) => {
    const listId = listByItem.get(ref.itemId)
    if (!listId) return []
    return [
      {
        id: `ref:${ref.frameId}:${ref.itemId}`,
        source: nodeId.list(listId),
        sourceHandle: ref.itemId,
        target: nodeId.scene(ref.frameId),
        targetHandle: HANDLE.sceneRefIn,
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

  return [...spine, ...attachments, ...wires, ...briefWires]
}
