import { create } from 'zustand'
import type { ProjectFolder } from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Folders for one project at a time.
 *
 * Scoped to the open project because that is the only one whose folders are on
 * screen, and because `missing` and `fileCount` are answered by stat-ing the disk
 * on every list — holding every project's folders would mean stat-ing all of them
 * to show one.
 *
 * Not optimistic, unlike the rest of the app's stores: every mutation here also
 * creates, renames or writes into a real directory, and showing a folder that the
 * filesystem then refused would be a lie about the disk rather than a stale row.
 */
interface FolderState {
  projectId: string | null
  folders: ProjectFolder[]
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null

  open(projectId: string): Promise<void>
  reload(): Promise<void>
  create(parentId: string | null, name: string): Promise<ProjectFolder | null>
  rename(id: string, name: string): Promise<void>
  forget(id: string): Promise<void>
  /** Opens a picker, then copies whatever was chosen into the folder. */
  addFiles(id: string): Promise<void>
  /** Copies dropped files in. Never moves, never overwrites. */
  dropFiles(id: string, paths: string[]): Promise<void>
  reveal(id: string): Promise<void>

  dismiss(): void
}

export const useProjectFolders = create<FolderState>((set, get) => ({
  projectId: null,
  folders: [],
  loading: false,
  busy: false,
  error: null,
  notice: null,

  async open(projectId) {
    set({ projectId, loading: true, folders: [], error: null, notice: null })
    try {
      const folders = await api.projects.folders(projectId)
      // A slow read for a project the user has already navigated away from must
      // not overwrite the one they are now looking at.
      if (get().projectId !== projectId) return
      set({ folders, loading: false })
    } catch (err) {
      set({ loading: false, error: message(err) })
    }
  },

  async reload() {
    const { projectId } = get()
    if (!projectId) return
    try {
      const folders = await api.projects.folders(projectId)
      if (get().projectId !== projectId) return
      set({ folders, error: null })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async create(parentId, name) {
    const { projectId } = get()
    if (!projectId) return null
    set({ busy: true, notice: null })
    try {
      const folder = await api.projects.createFolder(projectId, parentId, name)
      await get().reload()
      return folder
    } catch (err) {
      set({ error: message(err) })
      return null
    } finally {
      set({ busy: false })
    }
  },

  async rename(id, name) {
    set({ busy: true, notice: null })
    try {
      await api.projects.renameFolder(id, name)
      await get().reload()
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busy: false })
    }
  },

  async forget(id) {
    set({ busy: true, notice: null })
    try {
      await api.projects.removeFolder(id)
      await get().reload()
      set({ notice: 'Removed from the panel. The files are still on disk.' })
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busy: false })
    }
  },

  async addFiles(id) {
    set({ busy: true, notice: null })
    try {
      const result = await api.projects.pickAssets(id)
      // null is a cancelled dialog, which is not worth reporting.
      if (result) {
        await get().reload()
        set({ notice: describe(result.copied.length, result.skipped) })
      }
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busy: false })
    }
  },

  async dropFiles(id, paths) {
    if (paths.length === 0) return
    set({ busy: true, notice: null })
    try {
      const result = await api.projects.fileAssets(id, paths)
      await get().reload()
      set({ notice: describe(result.copied.length, result.skipped) })
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busy: false })
    }
  },

  async reveal(id) {
    try {
      await api.projects.revealFolder(id)
    } catch (err) {
      set({ error: message(err) })
    }
  },

  dismiss() {
    set({ error: null, notice: null })
  }
}))

/**
 * What the copy actually did.
 *
 * Skips are named rather than counted: "2 skipped" leaves you wondering which,
 * and the answer matters — a skip means a file of that name was already there.
 */
function describe(copied: number, skipped: readonly string[]): string {
  const parts: string[] = []
  if (copied > 0) parts.push(`Copied ${copied} ${copied === 1 ? 'file' : 'files'}`)
  if (skipped.length > 0) {
    const named = skipped.slice(0, 3).join(', ')
    const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''
    parts.push(`already there: ${named}${more}`)
  }
  return parts.length > 0 ? `${parts.join(' · ')}.` : 'Nothing to copy.'
}
