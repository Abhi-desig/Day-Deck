import { create } from 'zustand'
import type { DateKey } from '@shared/date'
import type { NewSticker, Sticker, StickerPatch } from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

interface StickerState {
  stickers: Sticker[]
  ready: boolean
  error: string | null

  load(): Promise<void>
  add(input: NewSticker): Promise<Sticker | null>
  patch(id: string, patch: StickerPatch): Promise<void>
  /** Position only, and only on drop — see the note on `move`. */
  move(id: string, x: number, y: number, rotation: number): Promise<void>
  remove(id: string): Promise<void>
  dismissError(): void
}

export const useStickers = create<StickerState>((set, get) => ({
  stickers: [],
  ready: false,
  error: null,

  async load() {
    try {
      set({ stickers: await api.stickers.list(), ready: true, error: null })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async add(input) {
    try {
      const sticker = await api.stickers.create(input)
      set((s) => ({ stickers: [...s.stickers, sticker], error: null }))
      return sticker
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patch(id, patch) {
    // Optimistic: the note is under the user's cursor and should not wait for a
    // round trip to change.
    const previous = get().stickers
    set({
      stickers: previous.map((s) => (s.id === id ? { ...s, ...patch } : s))
    })
    try {
      const saved = await api.stickers.update(id, patch)
      set((s) => ({ stickers: s.stickers.map((x) => (x.id === id ? saved : x)) }))
    } catch (err) {
      set({ stickers: previous, error: message(err) })
    }
  },

  /**
   * Position is written on drop, never per frame.
   *
   * Motion drives the drag on the DOM directly, so the store does not need to
   * know where a note is mid-gesture — and a write per frame would mean sixty
   * IPC round trips and sixty SQLite UPDATEs a second for a note being nudged.
   */
  async move(id, x, y, rotation) {
    await get().patch(id, { x: Math.round(x), y: Math.round(y), rotation })
  },

  async remove(id) {
    const previous = get().stickers
    set({ stickers: previous.filter((s) => s.id !== id) })
    try {
      await api.stickers.remove(id)
    } catch (err) {
      set({ stickers: previous, error: message(err) })
    }
  },

  dismissError() {
    set({ error: null })
  }
}))

/** The notes pinned to one day, for that day's card. */
export function stickersForDate(
  stickers: Sticker[],
  date: DateKey
): Sticker[] {
  return stickers.filter((s) => s.attachedDate === date)
}
