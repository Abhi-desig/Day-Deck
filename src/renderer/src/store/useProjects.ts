import { create } from 'zustand'
import type { Project, ProjectHomes, ProjectKind } from '@shared/types'
import { api } from '../lib/api'

/**
 * The project registry as the renderer sees it.
 *
 * Every mutation returns the whole list from main rather than being applied
 * locally, because order is a global property — pinning one card renumbers the
 * others, and a local guess would disagree with the database until the next
 * reload.
 *
 * `openId` doubles as the router: the Projects section shows the grid when it
 * is null and the workspace when it is not, and App watches it so a day-card
 * row can open a workspace from a different section entirely.
 */
interface ProjectsState {
  ready: boolean
  error: string | null
  /** Transient one-line message under the header — duplicates, launches. */
  notice: string | null
  projects: Project[]
  openId: string | null
  busy: boolean

  /** Where new projects go, per kind. Null until fetched or until chosen. */
  homes: ProjectHomes | null

  load(): Promise<void>
  add(): Promise<void>
  /** Create a named project from nothing under the kind's home. */
  createNew(kind: ProjectKind, name: string): Promise<boolean>
  loadHomes(): Promise<void>
  pickHome(kind: ProjectKind): Promise<void>
  remove(id: string): Promise<void>
  togglePin(id: string): Promise<void>
  reorder(orderedIds: string[]): Promise<void>
  rename(id: string, name: string): Promise<void>
  openInEditor(id: string): Promise<void>
  /** Opens the file picker for a creative project. */
  addCreative(): Promise<void>
  /** Hands a creative project's file to whichever application owns its type. */
  openExternal(id: string): Promise<void>
  open(id: string): void
  close(): void
  setNotice(notice: string | null): void
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

let loadPromise: Promise<void> | null = null

export const useProjects = create<ProjectsState>((set, get) => {
  /** Run a mutation that returns the authoritative list, with error capture. */
  async function apply(run: () => Promise<Project[]>): Promise<void> {
    set({ busy: true })
    try {
      set({ projects: await run(), error: null })
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ busy: false })
    }
  }

  return {
    ready: false,
    error: null,
    notice: null,
    projects: [],
    openId: null,
    busy: false,
    homes: null,

    async load() {
      // Already held, and every mutator below patches it. Deduping concurrent
      // calls was only ever half the answer — a section switch unmounts and
      // remounts this panel, so the list was re-read on every visit to a
      // gesture whose whole job is to be instant.
      if (get().ready) return
      // Mounting the section and jumping in from a day card can both land here
      // in the same tick; one fetch is enough.
      if (loadPromise) return loadPromise
      loadPromise = (async () => {
        try {
          set({ projects: await api.projects.list(), ready: true, error: null })
        } catch (err) {
          set({ ready: true, error: message(err) })
        } finally {
          loadPromise = null
        }
      })()
      return loadPromise
    },

    async add() {
      set({ busy: true, notice: null })
      try {
        const result = await api.projects.add()
        // null is a cancelled dialog, which is not worth reporting.
        if (!result) return
        set({
          projects: await api.projects.list(),
          error: null,
          notice: result.duplicate
            ? `${result.project.name} was already in your grid.`
            : null
        })
      } catch (err) {
        set({ error: message(err) })
      } finally {
        set({ busy: false })
      }
    },

    async createNew(kind, name) {
      set({ busy: true, notice: null })
      try {
        const result = await api.projects.create(kind, name)
        set({
          projects: await api.projects.list(),
          error: null,
          notice: result.duplicate
            ? `${result.project.name} was already in your grid.`
            : `${result.project.name} created.`
        })
        return true
      } catch (err) {
        set({ error: message(err) })
        return false
      } finally {
        set({ busy: false })
      }
    },

    async loadHomes() {
      try {
        set({ homes: await api.projects.homes() })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async pickHome(kind) {
      try {
        const homes = await api.projects.pickHome(kind)
        // null is a cancelled dialog; the previous answer stands.
        if (homes) set({ homes, error: null })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async remove(id) {
      if (get().openId === id) set({ openId: null })
      await apply(() => api.projects.remove(id))
    },

    async togglePin(id) {
      const project = get().projects.find((p) => p.id === id)
      if (!project) return
      await apply(() => api.projects.setPinned(id, !project.pinned))
    },

    async reorder(orderedIds) {
      // Show the new order immediately — a drag that snaps back while the write
      // lands feels broken even when nothing went wrong.
      //
      // Merged rather than replaced: the panel shows one kind at a time and sends
      // only the ids it can see, so rebuilding the list from them alone would make
      // every Code project vanish the moment you dragged a Creative one.
      const listed = new Set(orderedIds)
      const byId = new Map(get().projects.map((p) => [p.id, p]))
      const moved = orderedIds
        .map((id) => byId.get(id))
        .filter((p): p is Project => p !== undefined)
      const untouched = get().projects.filter((p) => !listed.has(p.id))
      set({ projects: [...moved, ...untouched] })

      await apply(() => api.projects.reorder(orderedIds))
    },

    async addCreative() {
      set({ busy: true, notice: null })
      try {
        const result = await api.projects.addCreative()
        if (!result) return
        set({
          projects: await api.projects.list(),
          error: null,
          notice: result.duplicate
            ? `${result.project.name} was already in your grid.`
            : null
        })
      } catch (err) {
        set({ error: message(err) })
      } finally {
        set({ busy: false })
      }
    },

    async openExternal(id) {
      const project = get().projects.find((p) => p.id === id)
      set({ notice: null })
      try {
        await api.projects.openExternal(id)
        await api.projects.touch(id)
        set({ notice: `Opening ${project?.name ?? 'that project'}…`, error: null })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async rename(id, name) {
      try {
        const updated = await api.projects.rename(id, name)
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? updated : p)),
          error: null
        }))
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async openInEditor(id) {
      set({ notice: null })
      try {
        const launch = await api.projects.openInEditor(id)
        set({
          notice:
            launch.via === 'cli'
              ? 'Opened in VS Code.'
              : `Opened with ${launch.path}.`,
          error: null
        })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    open(id) {
      set({ openId: id, notice: null })
      // Ordering by "recently worked on" is a Phase 4 view, but the timestamp
      // has to start being recorded now or that view opens with no history.
      void api.projects.touch(id).catch(() => undefined)
    },

    close() {
      set({ openId: null })
    },

    setNotice(notice) {
      set({ notice })
    }
  }
})

export function useOpenProject(): Project | null {
  return useProjects(
    (s) => s.projects.find((p) => p.id === s.openId) ?? null
  )
}
