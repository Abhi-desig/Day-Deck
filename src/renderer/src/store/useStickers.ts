import { create } from 'zustand'
import type { DateKey } from '@shared/date'
import type {
  NewSticker,
  NewStickerFolder,
  Sticker,
  StickerFolder,
  StickerFolderPatch,
  StickerPatch
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

interface StickerState {
  stickers: Sticker[]
  folders: StickerFolder[]
  ready: boolean
  error: string | null

  load(): Promise<void>
  add(input: NewSticker): Promise<Sticker | null>
  patch(id: string, patch: StickerPatch): Promise<void>
  /** Position only, and only on drop — see the note on `move`. */
  move(id: string, x: number, y: number, rotation: number): Promise<void>
  remove(id: string): Promise<void>

  addFolder(input: NewStickerFolder): Promise<StickerFolder | null>
  patchFolder(id: string, patch: StickerFolderPatch): Promise<void>
  removeFolder(id: string): Promise<void>
  /** null takes the note back out of every folder. */
  file(id: string, folderId: string | null): Promise<void>

  dismissError(): void
}

export const useStickers = create<StickerState>((set, get) => ({
  stickers: [],
  folders: [],
  ready: false,
  error: null,

  async load() {
    try {
      // Both in one pass: the board cannot render its filter strip before it
      // knows which folders exist, and two sequential awaits would show a wall
      // with no strip for a frame.
      const [stickers, folders] = await Promise.all([
        api.stickers.list(),
        api.stickers.folders()
      ])
      set({ stickers, folders, ready: true, error: null })
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

  /*
   * Every write below reverts *the note it touched*, never a snapshot of the
   * whole array.
   *
   * A snapshot taken before the await is stale by the time it is restored: it
   * puts back notes deleted while the write was in flight and discards edits
   * that succeeded. That is what turned one rejected write into a permanently
   * broken wall — a resurrected note has no row, so its next drag fails, which
   * restores it again, for ever.
   */
  async patch(id, patch) {
    // Optimistic: the note is under the user's cursor and should not wait for a
    // round trip to change.
    const before = get().stickers.find((s) => s.id === id)
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, ...patch } : x))
    }))
    try {
      const saved = await api.stickers.update(id, patch)
      if (!saved) {
        // The row is gone. Drop the note rather than restoring it: keeping it
        // on the wall is what makes the failure repeat on every later write.
        set((s) => ({
          stickers: s.stickers.filter((x) => x.id !== id),
          error: null
        }))
        return
      }
      set((s) => ({
        stickers: s.stickers.map((x) => (x.id === id ? saved : x)),
        error: null
      }))
    } catch (err) {
      set((s) => ({
        stickers: before
          ? s.stickers.map((x) => (x.id === id ? before : x))
          : s.stickers.filter((x) => x.id !== id),
        error: message(err)
      }))
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
    const stickers = get().stickers
    const index = stickers.findIndex((s) => s.id === id)
    const before = stickers[index]

    set((s) => ({ stickers: s.stickers.filter((x) => x.id !== id) }))
    try {
      await api.stickers.remove(id)
      set({ error: null })
    } catch (err) {
      // Back at its old index, not appended: the wall paints in array order, so
      // appending would quietly move the note above its neighbours.
      set((s) => {
        if (!before || s.stickers.some((x) => x.id === id)) {
          return { error: message(err) }
        }
        const next = [...s.stickers]
        next.splice(Math.min(index, next.length), 0, before)
        return { stickers: next, error: message(err) }
      })
    }
  },

  async addFolder(input) {
    try {
      const folder = await api.stickers.createFolder(input)
      set((s) => ({ folders: [...s.folders, folder], error: null }))
      return folder
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patchFolder(id, patch) {
    const before = get().folders.find((f) => f.id === id)
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f))
    }))
    try {
      const saved = await api.stickers.updateFolder(id, patch)
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? saved : f)),
        error: null
      }))
    } catch (err) {
      set((s) => ({
        folders: before
          ? s.folders.map((f) => (f.id === id ? before : f))
          : s.folders.filter((f) => f.id !== id),
        error: message(err)
      }))
    }
  },

  async removeFolder(id) {
    const folders = get().folders
    const index = folders.findIndex((f) => f.id === id)
    const before = folders[index]
    // Which notes this release actually touched, so a failure can re-file
    // exactly those and nothing else.
    const released = get()
      .stickers.filter((s) => s.folderId === id)
      .map((s) => s.id)

    // Main sets the notes loose via ON DELETE SET NULL. Mirroring that here
    // rather than refetching keeps a note that is on screen from vanishing for
    // a frame and coming back unfiled.
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      stickers: s.stickers.map((x) =>
        x.folderId === id ? { ...x, folderId: null } : x
      )
    }))

    try {
      await api.stickers.removeFolder(id)
      set({ error: null })
    } catch (err) {
      const affected = new Set(released)
      set((s) => {
        const next = [...s.folders]
        if (before && !next.some((f) => f.id === id)) {
          next.splice(Math.min(index, next.length), 0, before)
        }
        return {
          folders: next,
          stickers: s.stickers.map((x) =>
            affected.has(x.id) ? { ...x, folderId: id } : x
          ),
          error: message(err)
        }
      })
    }
  },

  async file(id, folderId) {
    await get().patch(id, { folderId })
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
