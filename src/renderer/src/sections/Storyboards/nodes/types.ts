import type { Node } from '@xyflow/react'
import type {
  Storyboard,
  StoryFrame,
  StoryList,
  StoryListItem,
  StoryTake
} from '@shared/types'
import type { StyleNodeType } from './StyleNode'

/**
 * Node ids are namespaced.
 *
 * Frames, lists and the board itself are separate id spaces in SQLite and there
 * is nothing stopping two of them colliding. React Flow has one flat id space, so
 * the prefix is what keeps a scene and a list from ever being the same node.
 */
export const nodeId = {
  brief: (boardId: string) => `brief:${boardId}`,
  scene: (frameId: string) => `scene:${frameId}`,
  list: (listId: string) => `list:${listId}`,
  style: (styleNodeId: string) => `style:${styleNodeId}`,
  /** The container holding every scene. One per board, so keyed by the board. */
  group: (boardId: string) => `group:${boardId}`,
  /** The cut. Also one per board, for the same reason. */
  timeline: (boardId: string) => `timeline:${boardId}`
}

/**
 * The container's size.
 *
 * Here rather than beside the component because the pure graph builder needs it
 * to lay the box out, and that builder is unit-tested in a node process that
 * must not have to load React Flow's component tree to do it.
 */
export const GROUP_W = 460
export const GROUP_H = 560

/** The timeline's width. Its height follows the clip strip. */
export const TIMELINE_W = 520

/** The entity id back out of a namespaced node id. */
export const entityId = (id: string): string => id.slice(id.indexOf(':') + 1)

export const nodeKind = (id: string): string => id.slice(0, id.indexOf(':'))

/**
 * Handle ids.
 *
 * Scenes take two inbound handles rather than one so the spine (brief to scene)
 * and the references (item to scene) arrive on different sides of the card. One
 * shared handle works but draws every wire into the same point, which is exactly
 * where a graph stops being readable.
 */
export const HANDLE = {
  briefOut: 'brief-out',
  briefStyleIn: 'brief-style-in',
  /** Film-wide references arrive at the bottom, styles at the left — a brief
      takes two kinds of inbound wire and they must not land on one point. */
  briefRefIn: 'brief-ref-in',
  sceneBriefIn: 'scene-brief-in',
  sceneRefIn: 'scene-ref-in',
  /**
   * The collapsed spine's landing point on the container.
   *
   * The container has no equivalent of `sceneRefIn`, because a reference is
   * still wired to one *scene* rather than to the box the scenes live in — so
   * each row carries its own target handle whose id is the frame id, the same
   * shape `ListNode`'s rows already use on the source side.
   */
  groupBriefIn: 'group-brief-in',
  /** The cut is fed by the scenes, so its one inbound wire comes from them. */
  timelineIn: 'timeline-in'
} as const

/* Data payloads. Type aliases, not interfaces — React Flow requires node data to
   be assignable to Record<string, unknown>, which an interface will not be. */

export type BriefData = {
  board: Storyboard
  /** The film-wide references wired to the brief, in wiring order. */
  refs: StoryListItem[]
}

export type SceneData = {
  frame: StoryFrame
  /** Position in board order, which is what the scene number is derived from. */
  index: number
  /** The references wired into this card, in list order. */
  refs: StoryListItem[]
}

export type ListData = {
  list: StoryList
  items: StoryListItem[]
}

/**
 * Every scene on the board, in one box.
 *
 * Carries exactly the `SceneData` each card carried on its own — the container
 * changes where a scene is drawn, not what a scene is.
 */
export type GroupData = {
  board: Storyboard
  scenes: SceneData[]
}

/**
 * The cut.
 *
 * Carries the board's takes rather than its segments: the segments live in
 * `useCut` because they are edited by gestures inside the node, where the takes
 * are what the node needs to *draw* a segment and change only when a clip is
 * generated or deleted.
 */
export type TimelineData = {
  board: Storyboard
  takes: StoryTake[]
}

export type BriefNodeType = Node<BriefData, 'brief'>
export type SceneNodeType = Node<SceneData, 'scene'>
export type ListNodeType = Node<ListData, 'list'>
export type SceneGroupNodeType = Node<GroupData, 'group'>
export type TimelineNodeType = Node<TimelineData, 'timeline'>

export type BoardNode =
  | BriefNodeType
  | SceneNodeType
  | ListNodeType
  | SceneGroupNodeType
  | TimelineNodeType
  | StyleNodeType

/**
 * The drag payload type for dropping a saved style onto the canvas.
 *
 * A custom MIME type rather than `text/plain`, so a stray drag of selected text
 * from somewhere else in the app cannot be mistaken for a style.
 */
export const STYLE_DRAG_TYPE = 'application/x-day-deck-style'
