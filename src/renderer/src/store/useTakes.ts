import { create } from 'zustand'
import type { StoryTake, TakeGenerateOptions, VideoJobProgress } from '@shared/types'
import { api } from '../lib/api'
import { useCut } from './useCut'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Generated clips, kept apart from the board's own state.
 *
 * Takes are not part of the graph — nothing on the canvas is positioned by
 * them, no wire connects to them, and a board opens perfectly well before a
 * single one has loaded. Folding them into `useStoryboards` would have made
 * every generation re-render the whole canvas.
 *
 * There is one progress slot rather than a map because there is one job: video
 * runs strictly one at a time, and modelling it as "many, of which one" would
 * be inventing a state the main process refuses to produce.
 */
interface TakesState {
  /** Per frame, newest first. Absent means "not loaded", not "none". */
  byFrame: Record<string, StoryTake[]>
  /** The job in flight, or null. */
  progress: VideoJobProgress | null
  /** The scene currently generating — the one thing the UI disables on. */
  busyFrameId: string | null
  error: string | null

  load(frameId: string): Promise<void>
  generate(
    frameId: string,
    options?: Partial<TakeGenerateOptions>
  ): Promise<void>
  choose(takeId: string, frameId: string): Promise<void>
  remove(takeId: string, frameId: string): Promise<void>
  dismissError(): void
  /** Subscribe to main's push channel. Returns the unsubscribe. */
  listen(): () => void
}

export const useTakes = create<TakesState>((set, get) => ({
  byFrame: {},
  progress: null,
  busyFrameId: null,
  error: null,

  async load(frameId) {
    try {
      const takes = await api.takes.list(frameId)
      set((s) => ({ byFrame: { ...s.byFrame, [frameId]: takes } }))
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async generate(frameId, options = {}) {
    if (get().busyFrameId) return
    set({ busyFrameId: frameId, error: null })
    try {
      const takes = await api.takes.generate(frameId, options)
      // The push channel has already reported `done`, but the invoke result is
      // the authoritative list — a progress event that arrived out of order
      // must not be what the strip renders.
      set((s) => ({
        byFrame: {
          ...s.byFrame,
          [frameId]: [...takes, ...(s.byFrame[frameId] ?? [])]
        }
      }))
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busyFrameId: null, progress: null })
    }
  },

  async choose(takeId, frameId) {
    // Optimistic: exactly one chosen, decided here as well as in SQLite, so the
    // radio behaviour is visible before the round trip lands.
    const previous = get().byFrame[frameId] ?? []
    set((s) => ({
      byFrame: {
        ...s.byFrame,
        [frameId]: previous.map((t) => ({ ...t, chosen: t.id === takeId }))
      }
    }))
    try {
      await api.takes.choose(takeId)
    } catch (err) {
      set((s) => ({
        byFrame: { ...s.byFrame, [frameId]: previous },
        error: message(err)
      }))
    }
  },

  async remove(takeId, frameId) {
    const previous = get().byFrame[frameId] ?? []
    set((s) => ({
      byFrame: {
        ...s.byFrame,
        [frameId]: previous.filter((t) => t.id !== takeId)
      }
    }))
    try {
      await api.takes.remove(takeId)
    } catch (err) {
      set((s) => ({
        byFrame: { ...s.byFrame, [frameId]: previous },
        error: message(err)
      }))
    }
  },

  dismissError() {
    set({ error: null })
  },

  listen() {
    return api.takes.onProgress((update) => {
      // Export shares this channel. Routed to the cut's own store rather than
      // shown on a clip strip, because "joining — 40%" on scene 3 is reporting
      // work that has nothing to do with scene 3.
      if (
        update.phase === 'trimming' ||
        update.phase === 'joining' ||
        update.phase === 'exported' ||
        update.phase === 'renderError'
      ) {
        useCut.getState().setRender(update)
        return
      }

      set({ progress: update })

      // A job resumed from a previous launch has no invoke call waiting on it,
      // so `done` arriving on the channel is the only thing that will ever tell
      // this store the clips exist.
      if (update.phase === 'done') {
        set((s) => ({
          byFrame: {
            ...s.byFrame,
            [update.frameId]: [
              ...update.takes,
              ...(s.byFrame[update.frameId] ?? []).filter(
                (t) => !update.takes.some((n) => n.id === t.id)
              )
            ]
          },
          progress: null
        }))
      }

      if (update.phase === 'error') {
        set({ error: update.message, progress: null, busyFrameId: null })
      }
    })
  }
}))
