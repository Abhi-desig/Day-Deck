import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { FileOpenError } from '@shared/types'
import { api } from '../lib/api'

/**
 * Everything inside an open workspace: which files are loaded, which of them
 * have unsaved edits, and which terminal tabs exist.
 *
 * Buffers are kept after you switch away from a file. Clicking another file and
 * coming back to find your edits gone is the kind of thing that makes an
 * embedded editor untrustworthy, and holding a few strings costs nothing.
 *
 * Terminal *sessions* are not in here. Each tab component owns its pty for its
 * whole lifetime — it creates it on mount and kills it on unmount — so a tab
 * that disappears from this list cannot leave a shell running behind it.
 */

export interface Buffer {
  path: string
  text: string
  /** Contents as last read from or written to disk. `dirty` is derived. */
  saved: string
  language: string
  mtimeMs: number
}

export interface TerminalTab {
  key: string
  label: string
  exited: boolean
}

interface WorkspaceState {
  projectId: string | null
  buffers: Record<string, Buffer>
  /** Open-file strip, in the order they were opened. */
  openOrder: string[]
  activePath: string | null
  loadingPath: string | null
  /** Set when the last open was refused — a binary or an oversized file. */
  rejection: FileOpenError | null
  saving: boolean
  error: string | null

  tabs: TerminalTab[]
  activeTab: string | null

  enter(projectId: string): void
  /**
   * Takes the project it is leaving. Workspaces unmount *after* their exit
   * animation, so closing one and opening another immediately can run this
   * cleanup after the next `enter` — without the id to check against, it would
   * wipe the workspace that just opened.
   */
  leave(projectId: string): void
  openFile(path: string): Promise<void>
  closeFile(path: string): void
  edit(path: string, text: string): void
  save(path?: string): Promise<void>
  saveAll(): Promise<void>
  addTerminal(): void
  closeTerminal(key: string): void
  selectTerminal(key: string): void
  markTerminal(key: string, patch: Partial<Omit<TerminalTab, 'key'>>): void
  setError(error: string | null): void
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projectId: null,
  buffers: {},
  openOrder: [],
  activePath: null,
  loadingPath: null,
  rejection: null,
  saving: false,
  error: null,
  tabs: [],
  activeTab: null,

  enter(projectId) {
    // Entering a different project must not inherit the previous one's buffers;
    // the paths are relative and would silently point at the wrong files.
    if (get().projectId === projectId) return
    const key = crypto.randomUUID()
    set({
      projectId,
      buffers: {},
      openOrder: [],
      activePath: null,
      loadingPath: null,
      rejection: null,
      error: null,
      // A workspace with no terminal in it is a folder viewer. Start with one.
      tabs: [{ key, label: 'shell', exited: false }],
      activeTab: key
    })
  },

  leave(projectId) {
    if (get().projectId !== projectId) return
    set({
      projectId: null,
      buffers: {},
      openOrder: [],
      activePath: null,
      loadingPath: null,
      rejection: null,
      error: null,
      tabs: [],
      activeTab: null
    })
  },

  async openFile(path) {
    const { projectId, buffers } = get()
    if (!projectId) return

    // Already loaded — just focus it, keeping any unsaved edits intact.
    if (buffers[path]) {
      set({ activePath: path, rejection: null })
      return
    }

    set({ loadingPath: path, rejection: null, error: null })
    try {
      const result = await api.files.read(projectId, path)
      // The user can click a third file while the first is still in flight.
      if (get().projectId !== projectId) return

      if (!result.ok) {
        set({ rejection: result.error, loadingPath: null })
        return
      }

      const file = result.file
      set((s) => ({
        buffers: {
          ...s.buffers,
          [path]: {
            path,
            text: file.text,
            saved: file.text,
            language: file.language,
            mtimeMs: file.mtimeMs
          }
        },
        openOrder: s.openOrder.includes(path) ? s.openOrder : [...s.openOrder, path],
        activePath: path,
        loadingPath: null
      }))
    } catch (err) {
      set({ error: message(err), loadingPath: null })
    }
  },

  closeFile(path) {
    set((s) => {
      const buffers = { ...s.buffers }
      delete buffers[path]
      const openOrder = s.openOrder.filter((p) => p !== path)
      const activePath =
        s.activePath === path ? (openOrder.at(-1) ?? null) : s.activePath
      return { buffers, openOrder, activePath }
    })
  },

  edit(path, text) {
    set((s) => {
      const buffer = s.buffers[path]
      if (!buffer || buffer.text === text) return s
      return { buffers: { ...s.buffers, [path]: { ...buffer, text } } }
    })
  },

  async save(path) {
    const state = get()
    const target = path ?? state.activePath
    if (!target || !state.projectId) return

    const buffer = state.buffers[target]
    if (!buffer || buffer.text === buffer.saved) return

    set({ saving: true, error: null })
    try {
      const saved = await api.files.write(
        state.projectId,
        target,
        buffer.text,
        buffer.mtimeMs
      )
      set((s) => {
        const current = s.buffers[target]
        if (!current) return s
        return {
          buffers: {
            ...s.buffers,
            // `saved` is the text we actually wrote, not whatever is in the
            // editor now — typing during the round trip must stay dirty.
            [target]: { ...current, saved: buffer.text, mtimeMs: saved.mtimeMs }
          }
        }
      })
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ saving: false })
    }
  },

  async saveAll() {
    for (const path of dirtyPaths(get())) {
      await get().save(path)
    }
  },

  addTerminal() {
    const key = crypto.randomUUID()
    set((s) => ({
      tabs: [...s.tabs, { key, label: 'shell', exited: false }],
      activeTab: key
    }))
  },

  closeTerminal(key) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key)
      const activeTab =
        s.activeTab === key ? (tabs.at(-1)?.key ?? null) : s.activeTab
      return { tabs, activeTab }
    })
  },

  selectTerminal(key) {
    set({ activeTab: key })
  },

  markTerminal(key, patch) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t))
    }))
  },

  setError(error) {
    set({ error })
  }
}))

function dirtyPaths(state: Pick<WorkspaceState, 'buffers'>): string[] {
  return Object.values(state.buffers)
    .filter((b) => b.text !== b.saved)
    .map((b) => b.path)
}

/**
 * `useShallow` is load-bearing: the selector builds a fresh array every call,
 * and zustand v5 compares snapshots by identity, so without it this subscribes
 * to a value that is never equal to itself and re-renders forever.
 */
export function useDirtyPaths(): string[] {
  return useWorkspace(useShallow(dirtyPaths))
}

export function useIsDirty(path: string | null): boolean {
  return useWorkspace((s) => {
    if (!path) return false
    const buffer = s.buffers[path]
    return !!buffer && buffer.text !== buffer.saved
  })
}
