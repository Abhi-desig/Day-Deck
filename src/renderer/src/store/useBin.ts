import { create } from 'zustand'
import type {
  AssetsMoved,
  BinListing,
  BinSourceId,
  FileMode,
  ProjectFolder
} from '@shared/types'
import { BIN_SOURCES } from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * The desktop bin's state: both listings, every project's folders (the target
 * list), and the filing calls. Nothing here moves a file on its own — `file`
 * is called from the Accept buttons and nowhere else.
 */
interface BinState {
  listings: Partial<Record<BinSourceId, BinListing>>
  folders: ProjectFolder[]
  ready: boolean
  /** Bin paths currently being filed, absolute — rows disable while present. */
  filing: Set<string>
  error: string | null
  /** One line about the last filing — moved, skipped, left behind. */
  notice: string | null

  load(): Promise<void>
  refresh(source: BinSourceId): Promise<void>
  /** Wire the change events. Returns the unsubscribe for unmount. */
  subscribe(): () => void
  file(
    folderId: string,
    source: BinSourceId,
    names: string[],
    mode: FileMode
  ): Promise<AssetsMoved | null>
  dismiss(): void
}

export const useBin = create<BinState>((set, get) => ({
  listings: {},
  folders: [],
  ready: false,
  filing: new Set<string>(),
  error: null,
  notice: null,

  async load() {
    try {
      const [desktop, downloads, folders] = await Promise.all([
        api.bin.list('desktop'),
        api.bin.list('downloads'),
        api.projects.allFolders()
      ])
      set({
        listings: { desktop, downloads },
        folders,
        ready: true,
        error: null
      })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async refresh(source) {
    try {
      const listing = await api.bin.list(source)
      set((s) => ({ listings: { ...s.listings, [source]: listing } }))
    } catch (err) {
      set({ error: message(err) })
    }
  },

  subscribe() {
    return api.bin.onChanged((source) => {
      if (BIN_SOURCES.includes(source)) void get().refresh(source)
    })
  },

  async file(folderId, source, names, mode) {
    const keys = names.map((name) => `${source}:${name}`)
    set((s) => ({ filing: new Set([...s.filing, ...keys]), notice: null }))
    try {
      const result = await api.bin.file(folderId, source, names, mode)
      set({ notice: describe(result), error: null })
      // The watcher will refresh the listing too; doing it here as well makes
      // the row disappear now rather than half a second from now.
      await get().refresh(source)
      // Folder counts changed with the move.
      set({ folders: await api.projects.allFolders() })
      return result
    } catch (err) {
      set({ error: message(err) })
      return null
    } finally {
      set((s) => {
        const filing = new Set(s.filing)
        for (const key of keys) filing.delete(key)
        return { filing }
      })
    }
  },

  dismiss() {
    set({ error: null, notice: null })
  }
}))

/** One honest line about what the filing did. */
function describe(result: AssetsMoved): string {
  const parts: string[] = []
  if (result.moved.length > 0) {
    parts.push(
      `Moved ${result.moved.length} into ${result.folder.name}.`
    )
  }
  if (result.copied.length > 0) {
    parts.push(`Copied ${result.copied.length}.`)
  }
  if (result.skipped.length > 0) {
    parts.push(`Skipped ${result.skipped.join(', ')} — already there.`)
  }
  if (result.leftBehind.length > 0) {
    parts.push(
      `${result.leftBehind.join(', ')} copied but the original could not be removed.`
    )
  }
  return parts.join(' ') || 'Nothing to do.'
}
