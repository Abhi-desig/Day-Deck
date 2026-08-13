import type { Node } from '@xyflow/react'
import type {
  Storyboard,
  StoryFrame,
  StoryList,
  StoryListItem
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
  style: (styleNodeId: string) => `style:${styleNodeId}`
}

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
  sceneRefIn: 'scene-ref-in'
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

export type BriefNodeType = Node<BriefData, 'brief'>
export type SceneNodeType = Node<SceneData, 'scene'>
export type ListNodeType = Node<ListData, 'list'>

export type BoardNode =
  | BriefNodeType
  | SceneNodeType
  | ListNodeType
  | StyleNodeType

/**
 * The drag payload type for dropping a saved style onto the canvas.
 *
 * A custom MIME type rather than `text/plain`, so a stray drag of selected text
 * from somewhere else in the app cannot be mistaken for a style.
 */
export const STYLE_DRAG_TYPE = 'application/x-day-deck-style'
