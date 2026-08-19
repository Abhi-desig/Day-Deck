import { create } from 'zustand'
import type {
  NewStoryCastNode,
  PackProgress,
  PackStatus,
  SheetShot,
  StoryCastNode,
  StorySheet
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Portraits, packs and placements — the character system's own store.
 *
 * Deliberately not more state inside `useStoryboards`. That store holds the
 * whole board graph, so a pack tick every few seconds would re-render the
 * canvas: React Flow would rebuild every node's `data` and redraw a graph
 * nothing about had changed, for background work the user was told they would
 * not have to watch. Keeping this separate is a correctness-adjacent
 * performance decision rather than tidiness.
 *
 * The sheets themselves stay in `useStoryboards` — they are part of the board.
 * What lives here is everything that changes on its own timetable.
 */
interface CastState {
  /** Images per sheet id, loaded on demand when a character is opened. */
  shots: Record<string, SheetShot[]>
  /** Pack progress per sheet id. */
  packs: Record<string, PackStatus>
  /** Placements on the open board only, like `useStyles.placed`. */
  placed: StoryCastNode[]
  /** Which board `placed` describes, so a re-visit does not re-ask. */
  placedFor: string | null
  /** Which sheet currently has an image call in flight, if any. */
  generating: string | null
  error: string | null

  loadShots(sheetId: string): Promise<void>
  loadPlaced(boardId: string): Promise<void>

  /** One metered image. Writes a candidate; does not touch the sheet. */
  propose(sheetId: string, extra: string): Promise<SheetShot | null>
  /** The write that makes a character real, then starts the pack behind it. */
  approve(sheetId: string, shotId: string): Promise<StorySheet | null>
  discard(shotId: string, sheetId: string): Promise<void>
  unlockSheet(sheetId: string): Promise<StorySheet | null>

  place(input: NewStoryCastNode): Promise<StoryCastNode | null>
  move(id: string, x: number, y: number): Promise<void>
  unplace(id: string): Promise<void>

  /** Applies one pushed update. Wired once, at the section level. */
  applyProgress(update: PackProgress): void
  dismissError(): void
}

export const useCast = create<CastState>((set, get) => ({
  shots: {},
  packs: {},
  placed: [],
  placedFor: null,
  generating: null,
  error: null,

  async loadShots(sheetId) {
    try {
      const [shots, pack] = await Promise.all([
        api.storyboards.shots(sheetId),
        api.storyboards.packProgress(sheetId)
      ])
      set((s) => ({
        shots: { ...s.shots, [sheetId]: shots },
        packs: { ...s.packs, [sheetId]: pack },
        error: null
      }))
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async loadPlaced(boardId) {
    if (get().placedFor === boardId) return
    try {
      set({
        placed: await api.storyboards.placedCast(boardId),
        placedFor: boardId,
        error: null
      })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async propose(sheetId, extra) {
    // One at a time in the UI as well as in main: the refusal there is a
    // backstop, and a button that can be clicked four times is a button that
    // will be.
    if (get().generating) return null
    set({ generating: sheetId, error: null })
    try {
      const shot = await api.storyboards.proposePortrait(sheetId, extra)
      set((s) => ({
        shots: { ...s.shots, [sheetId]: [...(s.shots[sheetId] ?? []), shot] },
        generating: null
      }))
      return shot
    } catch (err) {
      set({ generating: null, error: message(err) })
      return null
    }
  },

  async approve(sheetId, shotId) {
    try {
      const sheet = await api.storyboards.approvePortrait(sheetId, shotId)
      // Started separately from the approval on purpose: a pack that fails must
      // not be able to unapprove anybody, so the two are different calls.
      void api.storyboards.buildPack(sheetId)
      set((s) => ({
        packs: {
          ...s.packs,
          [sheetId]: s.packs[sheetId] ?? { done: 0, total: 5, missing: [] }
        },
        error: null
      }))
      return sheet
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async discard(shotId, sheetId) {
    const previous = get().shots[sheetId] ?? []
    set((s) => ({
      shots: { ...s.shots, [sheetId]: previous.filter((x) => x.id !== shotId) }
    }))
    try {
      await api.storyboards.discardShot(shotId)
    } catch (err) {
      set((s) => ({
        shots: { ...s.shots, [sheetId]: previous },
        error: message(err)
      }))
    }
  },

  async unlockSheet(sheetId) {
    try {
      const sheet = await api.storyboards.unlockSheet(sheetId)
      // Unlocking takes the character off every board it was placed on, because
      // a placement with no approved portrait is a lock with nothing behind it.
      set((s) => ({
        placed: s.placed.filter((p) => p.sheetId !== sheetId),
        error: null
      }))
      return sheet
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async place(input) {
    try {
      const node = await api.storyboards.placeCast(input)
      // Placing is idempotent per board — a second drop moves the existing node
      // — so this replaces by id rather than appending.
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
      const saved = await api.storyboards.moveCastNode(id, Math.round(x), Math.round(y))
      set((s) => ({ placed: s.placed.map((p) => (p.id === id ? saved : p)) }))
    } catch (err) {
      set({ placed: previous, error: message(err) })
    }
  },

  async unplace(id) {
    const previous = get().placed
    set({ placed: previous.filter((p) => p.id !== id) })
    try {
      await api.storyboards.unplaceCast(id)
    } catch (err) {
      set({ placed: previous, error: message(err) })
    }
  },

  applyProgress(update) {
    if (update.phase === 'building') {
      set((s) => ({
        packs: {
          ...s.packs,
          [update.sheetId]: {
            done: update.done,
            total: update.total,
            missing: s.packs[update.sheetId]?.missing ?? []
          }
        }
      }))
      return
    }
    if (update.phase === 'ready') {
      set((s) => ({
        shots: { ...s.shots, [update.sheetId]: update.shots },
        packs: {
          ...s.packs,
          [update.sheetId]: {
            done: update.shots.filter((x) => x.kind === 'pack').length,
            total: s.packs[update.sheetId]?.total ?? 5,
            missing: []
          }
        }
      }))
      return
    }
    // A failed pack leaves the character locked with the portrait they
    // approved. Reported once, and not as a modal — this is background work.
    set({ error: update.message })
  },

  dismissError() {
    set({ error: null })
  }
}))
