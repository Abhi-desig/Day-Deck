import { create } from 'zustand'
import type {
  NewStoryStyleNode,
  NewVideoStyle,
  StoryStyleNode,
  VideoStyle,
  VideoStylePatch
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * The style library.
 *
 * A separate store from useStoryboards, and not by accident: styles are
 * board-independent. The library is loaded once and outlives every board that
 * uses it, so scoping it to the open board — the way frames and lists are — would
 * be wrong.
 *
 * Placements are the exception. Those belong to one board, so they follow the
 * same "open board only" rule as the rest of the graph.
 */
interface StyleState {
  styles: VideoStyle[]
  /** Placements on the open board only. */
  placed: StoryStyleNode[]
  ready: boolean
  error: string | null

  load(): Promise<void>
  loadPlaced(boardId: string): Promise<void>

  add(input: NewVideoStyle): Promise<VideoStyle | null>
  patch(id: string, patch: VideoStylePatch): Promise<void>
  remove(id: string): Promise<void>
  duplicate(id: string): Promise<VideoStyle | null>
  /** Sorts the style's source text into fields. Writes nothing; returns the
      proposed patch, or null on failure (the error lands in `error`). */
  parse(id: string): Promise<VideoStylePatch | null>

  place(input: NewStoryStyleNode): Promise<StoryStyleNode | null>
  move(id: string, x: number, y: number): Promise<void>
  unplace(id: string): Promise<void>

  dismissError(): void
}

export const useStyles = create<StyleState>((set, get) => ({
  styles: [],
  placed: [],
  ready: false,
  error: null,

  async load() {
    try {
      set({ styles: await api.styles.list(), ready: true, error: null })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async loadPlaced(boardId) {
    try {
      set({ placed: await api.styles.placed(boardId), error: null })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async add(input) {
    try {
      const style = await api.styles.create(input)
      set((s) => ({ styles: [...s.styles, style], error: null }))
      return style
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patch(id, patch) {
    const previous = get().styles
    set({ styles: previous.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
    try {
      const saved = await api.styles.update(id, patch)
      set((s) => ({ styles: s.styles.map((x) => (x.id === id ? saved : x)) }))
    } catch (err) {
      set({ styles: previous, error: message(err) })
    }
  },

  async remove(id) {
    const previous = get().styles
    const previousPlaced = get().placed
    // Deleting a style takes it off every board. CASCADE does that in SQLite;
    // this keeps the open canvas honest about it straight away.
    set({
      styles: previous.filter((s) => s.id !== id),
      placed: previousPlaced.filter((p) => p.styleId !== id)
    })
    try {
      await api.styles.remove(id)
    } catch (err) {
      set({ styles: previous, placed: previousPlaced, error: message(err) })
    }
  },

  async duplicate(id) {
    try {
      const style = await api.styles.duplicate(id)
      set((s) => ({ styles: [...s.styles, style], error: null }))
      return style
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async parse(id) {
    try {
      return await api.styles.parse(id)
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async place(input) {
    try {
      const node = await api.styles.place(input)
      // Placing is idempotent per board — a second drop moves the existing node
      // rather than adding one — so this replaces by id rather than appending.
      set((s) => ({
        placed: [...s.placed.filter((p) => p.id !== node.id), node],
        error: null
      }))
      return node
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async move(id, x, y) {
    const previous = get().placed
    set({
      placed: previous.map((p) =>
        p.id === id ? { ...p, x: Math.round(x), y: Math.round(y) } : p
      )
    })
    try {
      const saved = await api.styles.move(id, Math.round(x), Math.round(y))
      set((s) => ({ placed: s.placed.map((p) => (p.id === id ? saved : p)) }))
    } catch (err) {
      set({ placed: previous, error: message(err) })
    }
  },

  async unplace(id) {
    const previous = get().placed
    set({ placed: previous.filter((p) => p.id !== id) })
    try {
      await api.styles.unplace(id)
    } catch (err) {
      set({ placed: previous, error: message(err) })
    }
  },

  dismissError() {
    set({ error: null })
  }
}))
