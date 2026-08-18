import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
  type OnNodeDrag
} from '@xyflow/react'
// Vite bundles this into the app's own CSS, so it is covered by the existing
// `style-src 'self' 'unsafe-inline'` and needs no CSP change.
import '@xyflow/react/dist/style.css'
import {
  FRAME_H,
  FRAME_W,
  mediaKindFor,
  type StoryBriefRef,
  type StoryFrame,
  type StoryFrameRef,
  type StoryList,
  type StoryListItem,
  type Storyboard
} from '@shared/types'
import { api } from '../../lib/api'
import { buildBoardEdges, buildBoardNodes } from '../../lib/board-graph'
import { useCut } from '../../store/useCut'
import { usePrefs } from '../../store/usePrefs'
import { useStoryboards } from '../../store/useStoryboards'
import { useStyles } from '../../store/useStyles'
import { useCast } from '../../store/useCast'
import { useTakes } from '../../store/useTakes'
import { useShallow } from 'zustand/react/shallow'
import { BriefNode } from './nodes/BriefNode'
import { ListNode, LIST_MIN_H, LIST_MIN_W } from './nodes/ListNode'
import { SceneGroupNode } from './nodes/SceneGroupNode'
import { SceneNode } from './nodes/SceneNode'
import { StyleNode, STYLE_W } from './nodes/StyleNode'
import { CastNode, CAST_W } from './nodes/CastNode'
import { TimelineNode } from './nodes/TimelineNode'
import {
  HANDLE,
  STYLE_DRAG_TYPE,
  CAST_DRAG_TYPE,
  entityId,
  nodeId,
  nodeKind,
  type BoardNode
} from './nodes/types'

export const ZOOM_MIN = 0.3
export const ZOOM_MAX = 2.5

/**
 * Commands, not state.
 *
 * The toolbar needs to tell the canvas to do things — zoom, drop a frame, frame
 * the brief — but none of those are properties of the section above it. Passing a
 * handle up keeps the viewport's business inside the canvas.
 */
export interface CanvasHandle {
  addAtCentre(): void
  zoomBy(factor: number): void
  reset(): void
}

/** Custom node types. Defined once at module scope — React Flow remounts every
    node if this object's identity changes between renders. */
const NODE_TYPES = {
  brief: BriefNode,
  group: SceneGroupNode,
  list: ListNode,
  scene: SceneNode,
  style: StyleNode,
  cast: CastNode,
  timeline: TimelineNode
}

/**
 * The storyboard canvas.
 *
 * Pan, zoom, node dragging, resize handles, wire dragging and edge routing are
 * React Flow's. What is left here is the mapping between the store's rows and the
 * graph, in both directions — and the one rule that governs the write side: a
 * gesture writes when it ends, never while it is happening.
 */
export function Canvas(props: {
  board: Storyboard
  frames: StoryFrame[]
  lists: StoryList[]
  items: StoryListItem[]
  refs: StoryFrameRef[]
  briefRefs: StoryBriefRef[]
  onHandle(handle: CanvasHandle): void
  onZoom(zoom: number): void
  onFocusScene(frameId: string): void
  onStyleDropped(styleId: string): void
}) {
  return (
    // Provider per board: the viewport, selection and node store all belong to
    // one board and must not be inherited by the next.
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  )
}

function Graph({
  board,
  frames,
  lists,
  items,
  refs,
  briefRefs,
  onHandle,
  onZoom,
  onFocusScene,
  onStyleDropped
}: {
  board: Storyboard
  frames: StoryFrame[]
  lists: StoryList[]
  items: StoryListItem[]
  refs: StoryFrameRef[]
  briefRefs: StoryBriefRef[]
  onHandle(handle: CanvasHandle): void
  onZoom(zoom: number): void
  onFocusScene(frameId: string): void
  onStyleDropped(styleId: string): void
}) {
  const addFrame = useStoryboards((s) => s.addFrame)
  const addList = useStoryboards((s) => s.addList)
  const addItem = useStoryboards((s) => s.addItem)
  const placeFrame = useStoryboards((s) => s.placeFrame)
  const placeList = useStoryboards((s) => s.placeList)
  const removeFrame = useStoryboards((s) => s.removeFrame)
  const removeList = useStoryboards((s) => s.removeList)
  const connectRef = useStoryboards((s) => s.connectRef)
  const disconnectRef = useStoryboards((s) => s.disconnectRef)
  const connectBriefRef = useStoryboards((s) => s.connectBriefRef)
  const disconnectBriefRef = useStoryboards((s) => s.disconnectBriefRef)

  const styleLibrary = useStyles((s) => s.styles)
  const placedStyles = useStyles((s) => s.placed)
  const placeStyle = useStyles((s) => s.place)
  const moveStyle = useStyles((s) => s.move)
  const unplaceStyle = useStyles((s) => s.unplace)

  // The cast itself stays in the board store — a character is part of the
  // board. What lives in `useCast` is everything that ticks on its own.
  const sheets = useStoryboards((s) => s.sheets)

  const placedCast = useCast((s) => s.placed)
  const placeCast = useCast((s) => s.place)
  const moveCast = useCast((s) => s.move)
  const unplaceCast = useCast((s) => s.unplace)

  const sceneLayout = usePrefs((s) => s.sceneLayout)
  const cut = useCut((s) => s.cut)
  /**
   * Shallow, and it matters more here than it looks.
   *
   * A plain selector hands back `byFrame` by identity, and every generation
   * progress tick replaces that object — which rebuilt the whole board graph,
   * which rebuilt every node's `data`, which React Flow reads as *every node
   * changed*. Comparing one level down means a tick that did not actually
   * change a scene's takes stops the cascade at the selector.
   */
  const takesByFrame = useTakes(useShallow((s) => s.byFrame))

  // The timeline draws its clips from every take on the board. Flattened here
  // rather than in the node so the pure builder still receives plain data.
  const takes = useMemo(
    () => frames.flatMap((frame) => takesByFrame[frame.id] ?? []),
    [frames, takesByFrame]
  )

  const flow = useReactFlow<BoardNode, Edge>()

  /* ------------------------------------------------- store -> graph */

  // The mapping itself lives in lib/board-graph.ts, pure and unit-tested —
  // including the brief node's pointer-events override, which is the kind of
  // regression this component cannot catch on its own.
  const derivedNodes = useMemo<BoardNode[]>(
    () =>
      buildBoardNodes({
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
      }),
    [
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
    ]
  )

  const derivedEdges = useMemo<Edge[]>(
    () =>
      buildBoardEdges({
        board,
        frames,
        items,
        refs,
        briefRefs,
        placedStyles,
        placedCast,
        sceneLayout,
        cut
      }),
    [
      board,
      frames,
      items,
      refs,
      briefRefs,
      placedStyles,
      placedCast,
      sceneLayout,
      cut
    ]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>(derivedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges)

  /**
   * The store is authoritative, so the graph is rebuilt whenever it changes.
   *
   * Safe against clobbering a gesture in progress because every gesture writes on
   * end: by the time a drag's `placeFrame` lands here, the drag is over and the
   * position arriving back is the one already on screen.
   */
  const dragging = useRef(false)
  useEffect(() => {
    if (dragging.current) return
    setNodes(derivedNodes)
  }, [derivedNodes, setNodes])

  useEffect(() => {
    setEdges(derivedEdges)
  }, [derivedEdges, setEdges])

  /* ------------------------------------------------- graph -> store */

  const onNodeDragStart = useCallback(() => {
    dragging.current = true
  }, [])

  const onNodeDragStop = useCallback<OnNodeDrag<BoardNode>>(
    (_event, node) => {
      dragging.current = false
      const id = entityId(node.id)
      // Exactly what is on screen, not a recomputation of it.
      const rect = {
        x: node.position.x,
        y: node.position.y,
        w: node.measured?.width ?? FRAME_W,
        h: node.measured?.height ?? FRAME_H
      }
      if (node.type === 'scene') void placeFrame(id, rect)
      if (node.type === 'list') void placeList(id, rect)
      if (node.type === 'style') void moveStyle(id, rect.x, rect.y)
      if (node.type === 'cast') void moveCast(id, rect.x, rect.y)
      // The timeline is the one node whose position the cut table stores.
      if (node.type === 'timeline') void api.cut.move(id, rect.x, rect.y)
    },
    [placeFrame, placeList, moveStyle, moveCast]
  )

  /**
   * A reference may be wired to a scene, or to the brief.
   *
   * The spine is derived and the style attachment is automatic, so the
   * connections a person can draw by hand are item-to-scene (this shot uses it)
   * and item-to-brief (the whole film does). Anything else dropped on a handle
   * is refused rather than silently stored as a wire nothing reads.
   */
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) =>
      nodeKind(connection.source) === 'list' &&
      (nodeKind(connection.target) === 'scene' ||
        // Stacked, the scene is a row inside the container and its handle id is
        // the frame id. The spine's own inbound handle is refused here, or the
        // whole board's references would pile onto the container's top edge.
        (nodeKind(connection.target) === 'group' &&
          !!connection.targetHandle &&
          connection.targetHandle !== HANDLE.groupBriefIn) ||
        (nodeKind(connection.target) === 'brief' &&
          connection.targetHandle === HANDLE.briefRefIn)),
    []
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.sourceHandle) return
      // The source handle *is* the item id — see ListNode's Row.
      if (nodeKind(connection.target) === 'scene') {
        void connectRef(entityId(connection.target), connection.sourceHandle)
      }
      // …and on the container, the *target* handle is the frame id.
      if (
        nodeKind(connection.target) === 'group' &&
        connection.targetHandle &&
        connection.targetHandle !== HANDLE.groupBriefIn
      ) {
        void connectRef(connection.targetHandle, connection.sourceHandle)
      }
      if (
        nodeKind(connection.target) === 'brief' &&
        connection.targetHandle === HANDLE.briefRefIn
      ) {
        void connectBriefRef(connection.sourceHandle)
      }
    },
    [connectRef, connectBriefRef]
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        if (edge.id.startsWith('ref:')) {
          const [, frameId, itemId] = edge.id.split(':')
          void disconnectRef(frameId, itemId)
        }
        if (edge.id.startsWith('bref:')) {
          const [, , itemId] = edge.id.split(':')
          void disconnectBriefRef(itemId)
        }
      }
    },
    [disconnectRef, disconnectBriefRef]
  )

  const onNodesDelete = useCallback(
    (deleted: BoardNode[]) => {
      for (const node of deleted) {
        if (node.type === 'scene') void removeFrame(entityId(node.id))
        if (node.type === 'list') void removeList(entityId(node.id))
        // Deleting the node takes the style off this board. The library keeps it.
        if (node.type === 'style') void unplaceStyle(entityId(node.id))
        // Same rule for a character: the placement goes, the person stays in
        // the cast and their portrait stays approved.
        if (node.type === 'cast') void unplaceCast(entityId(node.id))
      }
    },
    [removeFrame, removeList, unplaceStyle, unplaceCast]
  )

  /**
   * Resizing reports through onNodesChange as a dimension change, and the store
   * only hears about it when the resize ends — NodeResizer's own onResizeEnd,
   * wired inside each node. This handler just lets React Flow keep its local
   * dimensions while the drag is live.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<BoardNode>[]) => {
      if (changes.some((c) => c.type === 'dimensions' && c.resizing)) {
        dragging.current = true
      }
      if (changes.some((c) => c.type === 'dimensions' && c.resizing === false)) {
        dragging.current = false
      }
      onNodesChange(changes)
    },
    [onNodesChange]
  )

  /**
   * Files dropped straight onto the canvas become references.
   *
   * Dropped onto a list, they join it; dropped onto empty canvas, a list is
   * created where they landed to hold them. Items are created serially so
   * sort_index follows the order the files arrived in, same as attachMedia.
   * Non-media files are skipped rather than stored as rows nothing can show.
   */
  const dropMedia = useCallback(
    async (
      paths: string[],
      at: { x: number; y: number },
      targetListId: string | null
    ) => {
      const media = paths.flatMap((path) => {
        const kind = mediaKindFor(path)
        return kind ? [{ path, kind }] : []
      })
      if (media.length === 0) return

      let listId = targetListId
      if (!listId) {
        const list = await addList({
          boardId: board.id,
          title: '',
          x: Math.round(at.x - LIST_MIN_W / 2),
          y: Math.round(at.y - LIST_MIN_H / 2)
        })
        if (!list) return
        listId = list.id
      }

      for (const item of media) {
        await addItem({
          listId,
          label: fileName(item.path),
          mediaPath: item.path,
          mediaKind: item.kind
        })
      }
    },
    [addList, addItem, board.id]
  )

  /* ------------------------------------------------------- commands */

  const placeAt = useCallback(
    (position: { x: number; y: number }) => {
      void addFrame({
        boardId: board.id,
        x: Math.round(position.x - FRAME_W / 2),
        y: Math.round(position.y - FRAME_H / 2),
        w: FRAME_W,
        h: FRAME_H
      })
    },
    [addFrame, board.id]
  )

  useEffect(() => {
    onHandle({
      addAtCentre: () => {
        // The middle of the window, converted into world coordinates — which is
        // the middle of whatever the user is currently looking at.
        placeAt(
          flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          })
        )
      },
      zoomBy: (factor: number) => {
        const { zoom } = flow.getViewport()
        flow.zoomTo(clampZoom(zoom * factor), { duration: 160 })
      },
      reset: () => {
        // Frame the brief, not the whole graph: the brief is the thing the board
        // is organised around, so "reset" means put it back in the middle.
        void flow.fitView({
          nodes: [{ id: nodeId.brief(board.id) }],
          duration: 240,
          maxZoom: 1,
          padding: 1.4
        })
      }
    })
  }, [flow, onHandle, placeAt, board.id])

  return (
    <ReactFlow<BoardNode, Edge>
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onMove={(_e, viewport) => onZoom(viewport.zoom)}
      onNodeDoubleClick={(event, node) => {
        if (node.type === 'scene') onFocusScene(entityId(node.id))
        // The container is one node, so which scene was double-clicked can only
        // be answered by the DOM — every row stamps its frame id, the same way
        // a list card stamps `data-list-id` for the drop handler.
        if (node.type === 'group') {
          const frameId = (event.target as HTMLElement)
            .closest('[data-scene-id]')
            ?.getAttribute('data-scene-id')
          if (frameId) onFocusScene(frameId)
        }
      }}
      // dragover must preventDefault or drop never fires at all. Two payloads
      // land here: a style chip from the panel, and files from the Finder.
      onDragOver={(event) => {
        const types = event.dataTransfer.types
        if (
          !types.includes(STYLE_DRAG_TYPE) &&
          !types.includes(CAST_DRAG_TYPE) &&
          !types.includes('Files')
        ) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        const at = flow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY
        })

        const styleId = event.dataTransfer.getData(STYLE_DRAG_TYPE)
        if (styleId) {
          event.preventDefault()
          void placeStyle({
            boardId: board.id,
            styleId,
            x: Math.round(at.x - STYLE_W / 2),
            y: Math.round(at.y - 40)
          }).then((placed) => {
            // The offer follows a successful drop, not the drag — a drop that
            // failed has nothing to plan from.
            if (placed) onStyleDropped(styleId)
          })
          return
        }

        const sheetId = event.dataTransfer.getData(CAST_DRAG_TYPE)
        if (sheetId) {
          event.preventDefault()
          void placeCast({
            boardId: board.id,
            sheetId,
            x: Math.round(at.x - CAST_W / 2),
            y: Math.round(at.y - 40)
          })
          return
        }

        // Electron removed File.path; the preload's webUtils bridge is the one
        // way back from a dropped File to something the main process can open.
        const paths = Array.from(event.dataTransfer.files).flatMap((file) => {
          const path = api.pathForFile(file)
          return path ? [path] : []
        })
        if (paths.length === 0) return
        event.preventDefault()
        const overList = (event.target as HTMLElement)
          .closest('[data-list-id]')
          ?.getAttribute('data-list-id')
        void dropMedia(paths, at, overList ?? null)
      }}
      onDoubleClick={(event) => {
        // A double-click on empty canvas drops a scene where you clicked. Guarded
        // on the target so double-clicking a card's text does not also spawn one.
        if ((event.target as HTMLElement).closest('[data-node]')) return
        placeAt(
          flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        )
      }}
      nodeTypes={NODE_TYPES}
      minZoom={ZOOM_MIN}
      maxZoom={ZOOM_MAX}
      // The brief is at the origin, so open looking at it.
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      fitView
      fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
      proOptions={{ hideAttribution: false }}
      deleteKeyCode={['Backspace', 'Delete']}
      selectionOnDrag
      panOnDrag={[1, 2]}
      panOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      className="min-h-0 flex-1 rounded-xl border border-line-soft"
    >
      {/* Dots that live in the world, so they scale and translate with it —
          graph paper rather than a static backdrop. */}
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1}
        className="!bg-transparent"
        color="var(--color-line-soft)"
      />
      <NewListButton boardId={board.id} onAdd={addList} />
    </ReactFlow>
  )
}

const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))

/**
 * Adding a list needs a position, and the obvious one is "somewhere you can see".
 *
 * The centre of the current viewport, not a fixed world coordinate — a list
 * placed at hardcoded world x is off-screen for anyone who has panned, which
 * reads as the button doing nothing at all. Steps down per existing list so two
 * clicks do not stack one card exactly on the other.
 */
function NewListButton({
  boardId,
  onAdd
}: {
  boardId: string
  onAdd: ReturnType<typeof useStoryboards.getState>['addList']
}) {
  const flow = useReactFlow()
  const lists = useStoryboards((s) => s.lists)

  return (
    <button
      type="button"
      onClick={() => {
        const at = flow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2
        })
        void onAdd({
          boardId,
          title: '',
          x: Math.round(at.x - LIST_MIN_W / 2),
          y: Math.round(at.y - LIST_MIN_H / 2 + (lists.length % 6) * 44)
        })
      }}
      className="absolute left-3 top-3 z-10 rounded-md border border-line-soft bg-surface/90 px-2.5 py-1 text-[11.5px] text-ink-dim backdrop-blur-sm transition-colors hover:border-line hover:text-ink"
    >
      + Reference list
    </button>
  )
}

/** Filename from an absolute path — the default label for a dropped reference. */
const fileName = (path: string): string => path.split('/').pop() || path
