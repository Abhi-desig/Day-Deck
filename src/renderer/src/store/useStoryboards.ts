import { create } from 'zustand'
import type {
  NewStoryboard,
  NewStoryFrame,
  NewStoryList,
  NewStoryListItem,
  Storyboard,
  StoryboardPatch,
  StoryBriefRef,
  StoryFrame,
  StoryFramePatch,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  StoryListItemPatch,
  StoryListPatch,
  NewStorySheet,
  StorySheet,
  StorySheetPatch
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/** Position and size, the shape every node's drag-stop writes. */
type Rect = { x: number; y: number; w: number; h: number }

interface StoryboardState {
  boards: Storyboard[]
  /** Frames for the open board only. Boards are segments; one is open at a time. */
  frames: StoryFrame[]
  /** The rest of the open board's graph, scoped the same way. */
  lists: StoryList[]
  items: StoryListItem[]
  refs: StoryFrameRef[]
  /** References wired to the brief itself — film-wide, per board. */
  briefRefs: StoryBriefRef[]
  /** The cast. Board-scoped, like everything else here except styles. */
  sheets: StorySheet[]
  activeId: string | null
  ready: boolean
  loadingFrames: boolean
  error: string | null

  load(): Promise<void>
  open(id: string): Promise<void>
  addBoard(input: NewStoryboard): Promise<Storyboard | null>
  patchBoard(id: string, patch: StoryboardPatch): Promise<void>
  removeBoard(id: string): Promise<void>

  addFrame(input: NewStoryFrame): Promise<StoryFrame | null>
  patchFrame(id: string, patch: StoryFramePatch): Promise<void>
  /** Position and size, written on drop rather than per frame. */
  placeFrame(id: string, rect: Rect): Promise<void>
  removeFrame(id: string): Promise<void>

  addList(input: NewStoryList): Promise<StoryList | null>
  patchList(id: string, patch: StoryListPatch): Promise<void>
  placeList(id: string, rect: Rect): Promise<void>
  removeList(id: string): Promise<void>

  addItem(input: NewStoryListItem): Promise<StoryListItem | null>
  patchItem(id: string, patch: StoryListItemPatch): Promise<void>
  removeItem(id: string): Promise<void>
  /** Opens the native picker and files everything chosen into one list. */
  attachMedia(listId: string): Promise<void>

  connectRef(frameId: string, itemId: string): Promise<void>
  disconnectRef(frameId: string, itemId: string): Promise<void>

  connectBriefRef(itemId: string): Promise<void>
  disconnectBriefRef(itemId: string): Promise<void>

  addSheet(input: NewStorySheet): Promise<StorySheet | null>
  patchSheet(id: string, patch: StorySheetPatch): Promise<void>
  removeSheet(id: string): Promise<void>

  dismissError(): void
}

/**
 * Only the open board's frames are held.
 *
 * Boards are segments, not filters — switching boards swaps the canvas
 * wholesale — so keeping every board's frames in memory would mean loading
 * work the user is not looking at and reconciling writes against boards that
 * are not on screen.
 */
export const useStoryboards = create<StoryboardState>((set, get) => ({
  boards: [],
  frames: [],
  lists: [],
  items: [],
  refs: [],
  briefRefs: [],
  sheets: [],
  activeId: null,
  ready: false,
  loadingFrames: false,
  error: null,

  async load() {
    try {
      const boards = await api.storyboards.list()
      set({ boards, ready: true, error: null })

      // Land on something. An empty canvas with no board selected looks
      // identical to a board with nothing on it, and only one of those is a
      // state the user can act on.
      const { activeId } = get()
      const stillThere = activeId && boards.some((b) => b.id === activeId)
      if (!stillThere && boards.length > 0) await get().open(boards[0].id)
      else if (boards.length === 0) set({ activeId: null, ...emptyGraph() })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async open(id) {
    set({ activeId: id, loadingFrames: true })
    try {
      // One round of six, not six rounds of one: the canvas cannot draw a wire
      // before it has both ends, so a staggered arrival would only show the user
      // a graph assembling itself.
      const [frames, lists, items, refs, briefRefs, sheets] = await Promise.all([
        api.storyboards.frames(id),
        api.storyboards.lists(id),
        api.storyboards.items(id),
        api.storyboards.refs(id),
        api.storyboards.briefRefs(id),
        api.storyboards.sheets(id)
      ])
      // A slow fetch for a board the user has already navigated away from must
      // not overwrite the one they are now looking at.
      if (get().activeId !== id) return
      set({
        frames,
        lists,
        items,
        refs,
        briefRefs,
        sheets,
        loadingFrames: false,
        error: null
      })
    } catch (err) {
      set({ loadingFrames: false, error: message(err) })
    }
  },

  async addBoard(input) {
    try {
      const board = await api.storyboards.create(input)
      set((s) => ({ boards: [...s.boards, board], error: null }))
      await get().open(board.id)
      return board
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchBoard(id, patch) {
    const previous = get().boards
    set({ boards: previous.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
    try {
      const saved = await api.storyboards.update(id, patch)
      set((s) => ({ boards: s.boards.map((b) => (b.id === id ? saved : b)) }))
    } catch (err) {
      set({ boards: previous, error: message(err) })
    }
  },

  async removeBoard(id) {
    const previous = get().boards
    const next = previous.filter((b) => b.id !== id)
    set({ boards: next })
    try {
      await api.storyboards.remove(id)
      if (get().activeId === id) {
        if (next.length > 0) await get().open(next[0].id)
        else set({ activeId: null, ...emptyGraph() })
      }
    } catch (err) {
      set({ boards: previous, error: message(err) })
    }
  },

  async addFrame(input) {
    try {
      const frame = await api.storyboards.createFrame(input)
      set((s) => ({ frames: [...s.frames, frame], error: null }))
      return frame
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchFrame(id, patch) {
    // Optimistic: the frame is under the cursor and must not wait on a round
    // trip to reflect a keystroke.
    const previous = get().frames
    set({ frames: previous.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
    try {
      const saved = await api.storyboards.updateFrame(id, patch)
      set((s) => ({ frames: s.frames.map((f) => (f.id === id ? saved : f)) }))
    } catch (err) {
      set({ frames: previous, error: message(err) })
    }
  },

  async placeFrame(id, rect) {
    await get().patchFrame(id, round(rect))
  },

  async removeFrame(id) {
    const previous = get().frames
    const previousRefs = get().refs
    set({
      frames: previous.filter((f) => f.id !== id),
      // The wires go with it in SQLite via CASCADE; drop them here too so the
      // canvas does not draw an edge to a card that is already gone.
      refs: previousRefs.filter((r) => r.frameId !== id)
    })
    try {
      await api.storyboards.removeFrame(id)
    } catch (err) {
      set({ frames: previous, refs: previousRefs, error: message(err) })
    }
  },

  /* ------------------------------------------------------------ lists */

  async addList(input) {
    try {
      const list = await api.storyboards.createList(input)
      set((s) => ({ lists: [...s.lists, list], error: null }))
      return list
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchList(id, patch) {
    const previous = get().lists
    set({ lists: previous.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
    try {
      const saved = await api.storyboards.updateList(id, patch)
      set((s) => ({ lists: s.lists.map((l) => (l.id === id ? saved : l)) }))
    } catch (err) {
      set({ lists: previous, error: message(err) })
    }
  },

  async placeList(id, rect) {
    await get().patchList(id, round(rect))
  },

  async removeList(id) {
    const previous = get().lists
    const previousItems = get().items
    const previousRefs = get().refs
    const previousBriefRefs = get().briefRefs
    const orphaned = new Set(
      previousItems.filter((i) => i.listId === id).map((i) => i.id)
    )
    set({
      lists: previous.filter((l) => l.id !== id),
      items: previousItems.filter((i) => i.listId !== id),
      refs: previousRefs.filter((r) => !orphaned.has(r.itemId)),
      briefRefs: previousBriefRefs.filter((r) => !orphaned.has(r.itemId))
    })
    try {
      await api.storyboards.removeList(id)
    } catch (err) {
      set({
        lists: previous,
        items: previousItems,
        refs: previousRefs,
        briefRefs: previousBriefRefs,
        error: message(err)
      })
    }
  },

  /* ------------------------------------------------------------ items */

  async addItem(input) {
    try {
      const item = await api.storyboards.createItem(input)
      set((s) => ({ items: [...s.items, item], error: null }))
      return item
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchItem(id, patch) {
    const previous = get().items
    set({ items: previous.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
    try {
      const saved = await api.storyboards.updateItem(id, patch)
      set((s) => ({ items: s.items.map((i) => (i.id === id ? saved : i)) }))
    } catch (err) {
      set({ items: previous, error: message(err) })
    }
  },

  async removeItem(id) {
    const previous = get().items
    const previousRefs = get().refs
    const previousBriefRefs = get().briefRefs
    set({
      items: previous.filter((i) => i.id !== id),
      refs: previousRefs.filter((r) => r.itemId !== id),
      briefRefs: previousBriefRefs.filter((r) => r.itemId !== id)
    })
    try {
      await api.storyboards.removeItem(id)
    } catch (err) {
      set({
        items: previous,
        refs: previousRefs,
        briefRefs: previousBriefRefs,
        error: message(err)
      })
    }
  },

  async attachMedia(listId) {
    try {
      const picked = await api.storyboards.pickMedia()
      if (picked.length === 0) return
      // Serially, so sort_index comes out in the order they were chosen rather
      // than in whichever order four concurrent inserts happen to land.
      for (const media of picked) {
        await get().addItem({
          listId,
          label: basename(media.path),
          mediaPath: media.path,
          mediaKind: media.kind
        })
      }
    } catch (err) {
      set({ error: message(err) })
    }
  },

  /* ------------------------------------------------------------ wires */

  async connectRef(frameId, itemId) {
    const previous = get().refs
    if (previous.some((r) => r.frameId === frameId && r.itemId === itemId)) return
    set({
      refs: [...previous, { frameId, itemId, createdAt: new Date().toISOString() }]
    })
    try {
      const saved = await api.storyboards.connect(frameId, itemId)
      set((s) => ({
        refs: s.refs.map((r) =>
          r.frameId === frameId && r.itemId === itemId ? saved : r
        )
      }))
    } catch (err) {
      set({ refs: previous, error: message(err) })
    }
  },

  async disconnectRef(frameId, itemId) {
    const previous = get().refs
    set({
      refs: previous.filter(
        (r) => !(r.frameId === frameId && r.itemId === itemId)
      )
    })
    try {
      await api.storyboards.disconnect(frameId, itemId)
    } catch (err) {
      set({ refs: previous, error: message(err) })
    }
  },

  async connectBriefRef(itemId) {
    const boardId = get().activeId
    if (!boardId) return
    const previous = get().briefRefs
    if (previous.some((r) => r.itemId === itemId)) return
    set({
      briefRefs: [
        ...previous,
        { boardId, itemId, createdAt: new Date().toISOString() }
      ]
    })
    try {
      const saved = await api.storyboards.connectBrief(boardId, itemId)
      set((s) => ({
        briefRefs: s.briefRefs.map((r) => (r.itemId === itemId ? saved : r))
      }))
    } catch (err) {
      set({ briefRefs: previous, error: message(err) })
    }
  },

  async disconnectBriefRef(itemId) {
    const boardId = get().activeId
    if (!boardId) return
    const previous = get().briefRefs
    set({ briefRefs: previous.filter((r) => r.itemId !== itemId) })
    try {
      await api.storyboards.disconnectBrief(boardId, itemId)
    } catch (err) {
      set({ briefRefs: previous, error: message(err) })
    }
  },

  async addSheet(input) {
    try {
      const sheet = await api.storyboards.createSheet(input)
      set((s) => ({ sheets: [...s.sheets, sheet], error: null }))
      return sheet
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchSheet(id, patch) {
    const previous = get().sheets
    set({
      sheets: previous.map((s) => (s.id === id ? { ...s, ...patch } : s))
    })
    try {
      const saved = await api.storyboards.updateSheet(id, patch)
      set((s) => ({ sheets: s.sheets.map((x) => (x.id === id ? saved : x)) }))
    } catch (err) {
      set({ sheets: previous, error: message(err) })
    }
  },

  async removeSheet(id) {
    const previous = get().sheets
    set({ sheets: previous.filter((s) => s.id !== id) })
    try {
      await api.storyboards.deleteSheet(id)
    } catch (err) {
      set({ sheets: previous, error: message(err) })
    }
  },

  dismissError() {
    set({ error: null })
  }
}))

/** Switching to no board at all clears the whole graph, not just the frames. */
const emptyGraph = (): Pick<
  StoryboardState,
  'frames' | 'lists' | 'items' | 'refs' | 'briefRefs' | 'sheets'
> => ({
  frames: [],
  lists: [],
  items: [],
  refs: [],
  briefRefs: [],
  sheets: []
})

const round = (rect: Rect): Rect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  w: Math.round(rect.w),
  h: Math.round(rect.h)
})

/** Filename from an absolute path — the default label for a picked reference. */
const basename = (path: string): string =>
  path.split('/').pop() || path
