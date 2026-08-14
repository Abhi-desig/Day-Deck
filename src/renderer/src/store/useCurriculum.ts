import { create } from 'zustand'
import type {
  AiModel,
  AiProvider,
  CurriculumInput,
  CurriculumPlan,
  CurriculumProgress,
  GoalNote,
  GoalNotePatch,
  GoalsOverview,
  KeyStatus,
  NewGoalNote,
  ReflowPreview
} from '@shared/types'
import { api } from '../lib/api'
import { useDeck } from './useDeck'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const EMPTY: GoalsOverview = {
  plans: [],
  dailyCapMinutes: 150,
  committedMinutes: 0,
  overCap: false,
  requiredMinutes: 0
}

interface CurriculumState {
  overview: GoalsOverview
  /** Which goal the detail pane is showing. Null while composing a new one. */
  selectedId: string | null
  composing: boolean

  keyStatus: KeyStatus | null
  /**
   * Who the goals slot actually talks to.
   *
   * Held here so this whole section can name the provider instead of saying
   * "Gemini" at the user regardless of what they configured. Settings owns
   * changing it; Goals Admin only reports it.
   */
  goalsProvider: AiProvider
  /**
   * The model chosen for the goals slot in Settings, or '' for none.
   *
   * Only a starting point: a goal stores the model it was generated with on its
   * own row, so this preselects the composer's dropdown rather than deciding
   * anything. Without it the Settings choice would be a control that writes a
   * value nothing ever reads.
   */
  goalsModel: string
  models: AiModel[]
  modelsError: string | null
  loadingModels: boolean
  ready: boolean
  generating: boolean
  progress: CurriculumProgress | null
  error: string | null

  reflow: ReflowPreview | null
  /** The goal the open reflow dialog belongs to. */
  reflowFor: string | null
  reflowBusy: boolean

  /** Reminder notes for the selected goal. */
  notes: GoalNote[]
  notesBusy: boolean
  /** The goal whose topics are being broken down, if any. */
  subdividing: string | null

  load(): Promise<void>
  loadModels(): Promise<void>
  saveKey(key: string): Promise<void>
  clearKey(): Promise<void>
  testKey(key?: string): Promise<number>
  select(id: string | null): void
  startComposing(): void
  cancelComposing(): void
  generate(input: CurriculumInput): Promise<boolean>
  archive(id: string): Promise<void>
  setDailyCap(minutes: number): Promise<void>
  openReflow(id: string): Promise<void>
  closeReflow(): void
  commitReflow(): Promise<void>
  setProgress(update: CurriculumProgress): void
  dismissError(): void

  loadNotes(curriculumId: string | null): Promise<void>
  addNote(input: NewGoalNote): Promise<boolean>
  patchNote(id: string, patch: GoalNotePatch): Promise<void>
  removeNote(id: string): Promise<void>
  subdivide(id: string): Promise<void>
}

/** Keep the selection pointing at something real after a list change. */
function reconcile(
  overview: GoalsOverview,
  selectedId: string | null
): string | null {
  if (selectedId && overview.plans.some((p) => p.curriculum.id === selectedId)) {
    return selectedId
  }
  return overview.plans[0]?.curriculum.id ?? null
}

export const useCurriculum = create<CurriculumState>((set, get) => ({
  overview: EMPTY,
  selectedId: null,
  composing: false,

  keyStatus: null,
  goalsProvider: 'gemini',
  goalsModel: '',
  models: [],
  modelsError: null,
  loadingModels: false,
  ready: false,
  generating: false,
  progress: null,
  error: null,

  reflow: null,
  reflowFor: null,
  reflowBusy: false,

  notes: [],
  notesBusy: false,
  subdividing: null,

  async load() {
    try {
      const [overview, keyStatus, configs] = await Promise.all([
        api.curriculum.overview(),
        api.settings.keyStatus(),
        api.settings.slotConfigs()
      ])
      const goals = configs.find((c) => c.slot === 'goals')
      set({
        overview,
        selectedId: reconcile(overview, get().selectedId),
        keyStatus,
        goalsProvider: goals?.provider ?? 'gemini',
        goalsModel: goals?.model ?? '',
        ready: true
      })
      if (keyStatus.present) void get().loadModels()
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async loadModels() {
    set({ loadingModels: true, modelsError: null })
    try {
      set({ models: await api.settings.models('goals'), loadingModels: false })
    } catch (err) {
      // A missing model list is recoverable — the saved model still works.
      set({ loadingModels: false, modelsError: message(err) })
    }
  },

  async saveKey(key) {
    set({ keyStatus: await api.settings.setKey(key), error: null })
    await get().loadModels()
  },

  async clearKey() {
    set({
      keyStatus: await api.settings.clearKey(),
      models: [],
      modelsError: null
    })
  },

  async testKey(key) {
    const { models } = await api.settings.testKey(key)
    return models
  },

  select(id) {
    set({ selectedId: id, composing: false })
  },

  startComposing() {
    set({ composing: true, error: null, progress: null })
  },

  cancelComposing() {
    set({ composing: false, error: null })
  },

  async generate(input) {
    set({ generating: true, error: null, progress: null })
    try {
      const plan: CurriculumPlan = await api.curriculum.generate(input)
      const overview = await api.curriculum.overview()
      set({
        overview,
        selectedId: plan.curriculum.id,
        composing: false,
        generating: false
      })
      // The new plan just wrote curriculum slots across many days.
      await useDeck.getState().reloadAll()
      return true
    } catch (err) {
      set({ generating: false, error: message(err) })
      return false
    }
  },

  async archive(id) {
    await api.curriculum.archive(id)
    const overview = await api.curriculum.overview()
    set({
      overview,
      selectedId: reconcile(overview, null),
      reflow: null,
      reflowFor: null
    })
    await useDeck.getState().reloadAll()
  },

  async setDailyCap(minutes) {
    try {
      set({ overview: await api.curriculum.setDailyCap(minutes) })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async openReflow(id) {
    set({ reflowBusy: true, error: null, reflowFor: id })
    try {
      set({
        reflow: await api.curriculum.reflowPreview(id),
        reflowBusy: false
      })
    } catch (err) {
      set({ reflowBusy: false, reflowFor: null, error: message(err) })
    }
  },

  closeReflow() {
    set({ reflow: null, reflowFor: null })
  },

  async commitReflow() {
    const id = get().reflowFor
    if (!id) return
    set({ reflowBusy: true })
    try {
      await api.curriculum.reflowCommit(id)
      const overview = await api.curriculum.overview()
      set({ overview, reflow: null, reflowFor: null, reflowBusy: false })
      await useDeck.getState().reloadAll()
    } catch (err) {
      set({ reflowBusy: false, error: message(err) })
    }
  },

  setProgress(update) {
    set({ progress: update })
  },

  dismissError() {
    set({ error: null })
  },

  async loadNotes(curriculumId) {
    set({ notesBusy: true })
    try {
      set({ notes: await api.notes.list(curriculumId), notesBusy: false })
    } catch (err) {
      set({ notesBusy: false, error: message(err) })
    }
  },

  async addNote(input) {
    try {
      const note = await api.notes.create(input)
      set((s) => ({
        notes: [...s.notes, note].sort((a, b) =>
          a.surfaceDate.localeCompare(b.surfaceDate)
        ),
        error: null
      }))
      // The note has a date, so some card in the loaded window now owns it.
      await useDeck.getState().reloadAll()
      return true
    } catch (err) {
      set({ error: message(err) })
      return false
    }
  },

  async patchNote(id, patch) {
    try {
      const note = await api.notes.update(id, patch)
      set((s) => ({
        notes: s.notes
          .map((n) => (n.id === id ? note : n))
          .sort((a, b) => a.surfaceDate.localeCompare(b.surfaceDate)),
        error: null
      }))
      await useDeck.getState().reloadAll()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async removeNote(id) {
    try {
      await api.notes.remove(id)
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
      await useDeck.getState().reloadAll()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async subdivide(id) {
    set({ subdividing: id, error: null, progress: null })
    try {
      const result = await api.curriculum.subdivide(id)
      const overview = await api.curriculum.overview()
      set({
        overview,
        subdividing: null,
        progress: null,
        // A partial pass is a success with a caveat, not a failure — the topics
        // that were broken down keep their points either way.
        error: result.error
      })
      // Points are denormalised onto the day cards, so the deck is now stale.
      await useDeck.getState().reloadAll()
    } catch (err) {
      set({ subdividing: null, progress: null, error: message(err) })
    }
  }
}))

/** The plan the detail pane should render, or null while composing. */
export function useSelectedPlan(): CurriculumPlan | null {
  const overview = useCurriculum((s) => s.overview)
  const selectedId = useCurriculum((s) => s.selectedId)
  return (
    overview.plans.find((p) => p.curriculum.id === selectedId) ?? null
  )
}
