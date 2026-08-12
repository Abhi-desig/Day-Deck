import { create } from 'zustand'
import type {
  NewStoryboard,
  NewStoryFrame,
  Storyboard,
  StoryboardPatch,
  StoryFrame,
  StoryFramePatch
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

interface StoryboardState {
  boards: Storyboard[]
  /** Frames for the open board only. Boards are segments; one is open at a time. */
  frames: StoryFrame[]
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
  placeFrame(id: string, rect: Pick<StoryFrame, 'x' | 'y' | 'w' | 'h'>): Promise<void>
  removeFrame(id: string): Promise<void>

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
      else if (boards.length === 0) set({ activeId: null, frames: [] })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async open(id) {
    set({ activeId: id, loadingFrames: true })
    try {
      const frames = await api.storyboards.frames(id)
      // A slow fetch for a board the user has already navigated away from must
      // not overwrite the one they are now looking at.
      if (get().activeId !== id) return
      set({ frames, loadingFrames: false, error: null })
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
        else set({ activeId: null, frames: [] })
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
    await get().patchFrame(id, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h)
    })
  },

  async removeFrame(id) {
    const previous = get().frames
    set({ frames: previous.filter((f) => f.id !== id) })
    try {
      await api.storyboards.removeFrame(id)
    } catch (err) {
      set({ frames: previous, error: message(err) })
    }
  },

  dismissError() {
    set({ error: null })
  }
}))
