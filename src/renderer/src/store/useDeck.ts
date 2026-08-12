import { create } from 'zustand'
import type { DateKey } from '@shared/date'
import { addDays, diffDays, todayKey } from '@shared/date'
import type {
  BootstrapResult,
  DayCard,
  NewSlot,
  Slot,
  SlotPatch
} from '@shared/types'
import { api } from '../lib/api'

/** Days loaded either side of the focused date. */
const WINDOW = 21
/** Refetch once the focus gets this close to the edge of what's loaded. */
const MARGIN = 7

interface DeckState {
  ready: boolean
  error: string | null
  today: DateKey
  focused: DateKey
  cards: Record<DateKey, DayCard>
  loadedFrom: DateKey | null
  loadedTo: DateKey | null
  bootstrapResult: BootstrapResult | null
  /** Slot ids that arrived via rollover this launch — animated once, then cleared. */
  freshRollIds: Set<string>

  init(): Promise<void>
  focus(date: DateKey): void
  step(delta: number): void
  goToday(): void
  addSlot(input: NewSlot): Promise<void>
  patchSlot(id: string, date: DateKey, patch: SlotPatch): Promise<void>
  toggleDone(slot: Slot): Promise<void>
  removeSlot(id: string, date: DateKey): Promise<void>
  reorder(date: DateKey, orderedIds: string[]): Promise<void>
  /** Acknowledging a reminder. Not a completion — nothing counts it. */
  dismissNote(id: string, date: DateKey): Promise<void>
  acknowledgeRolls(): void
  /** Clears the "these stickers expired" report once the user has read it. */
  acknowledgeSweep(): void
  /** Re-read the loaded window — used after a curriculum plan rewrites slots. */
  reloadAll(): Promise<void>
  /**
   * Re-read one day. Exposed for mutations that live outside this store — a tag
   * attached from a slot row changes that row without going through any of the
   * slot actions above.
   */
  refreshDay(date: DateKey): Promise<void>
}

/**
 * Empty cards are cached by date so an unloaded day returns a stable object
 * identity. Returning a fresh `{ date, slots: [] }` each render would re-render
 * the whole card subtree on every parent update.
 */
const EMPTY_CARDS = new Map<DateKey, DayCard>()

function emptyCard(date: DateKey): DayCard {
  const cached = EMPTY_CARDS.get(date)
  if (cached) return cached

  const card: DayCard = { date, slots: [], notes: [] }
  EMPTY_CARDS.set(date, card)
  return card
}

let initPromise: Promise<void> | null = null

export const useDeck = create<DeckState>((set, get) => {
  /** Pull a date span from main and merge it over what's already cached. */
  async function load(from: DateKey, to: DateKey): Promise<void> {
    const cards = await api.days.range(from, to)
    set((s) => {
      const next = { ...s.cards }
      for (const card of cards) next[card.date] = card
      return {
        cards: next,
        loadedFrom:
          s.loadedFrom && diffDays(s.loadedFrom, from) > 0 ? s.loadedFrom : from,
        loadedTo: s.loadedTo && diffDays(to, s.loadedTo) > 0 ? s.loadedTo : to
      }
    })
  }

  /** Re-read a single day after a mutation — cheaper and always authoritative. */
  async function refresh(date: DateKey): Promise<void> {
    const [card] = await api.days.range(date, date)
    if (card) set((s) => ({ cards: { ...s.cards, [date]: card } }))
  }

  function ensureWindow(center: DateKey): void {
    const { loadedFrom, loadedTo } = get()
    const needs =
      !loadedFrom ||
      !loadedTo ||
      diffDays(loadedFrom, center) < MARGIN ||
      diffDays(center, loadedTo) < MARGIN
    if (needs) {
      void load(addDays(center, -WINDOW), addDays(center, WINDOW))
    }
  }

  return {
    ready: false,
    error: null,
    today: todayKey(),
    focused: todayKey(),
    cards: {},
    loadedFrom: null,
    loadedTo: null,
    bootstrapResult: null,
    freshRollIds: new Set(),

    async init() {
      // StrictMode double-invokes effects in dev, and bootstrap does real
      // writes. Sharing one promise keeps it to a single pass.
      if (initPromise) return initPromise
      initPromise = (async () => {
        try {
          // Rollover and weekly seeding run before the first read, so the very
          // first range query already reflects them.
          const result = await api.system.bootstrap()
          set({
            bootstrapResult: result,
            today: result.today,
            focused: result.today,
            freshRollIds: new Set(result.rolled.map((r) => r.newSlotId))
          })
          await load(
            addDays(result.today, -WINDOW),
            addDays(result.today, WINDOW)
          )
          set({ ready: true, error: null })
        } catch (err) {
          set({
            ready: true,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })()
      return initPromise
    },

    focus(date) {
      set({ focused: date })
      ensureWindow(date)
    },

    step(delta) {
      get().focus(addDays(get().focused, delta))
    },

    goToday() {
      get().focus(get().today)
    },

    async addSlot(input) {
      await api.slots.create(input)
      await refresh(input.date)
    },

    async patchSlot(id, date, patch) {
      await api.slots.update(id, patch)
      await refresh(date)
      // A moved slot changes two days, not one.
      if (patch.date && patch.date !== date) await refresh(patch.date)
    },

    async toggleDone(slot) {
      await api.slots.setStatus(slot.id, slot.status === 'done' ? 'open' : 'done')
      await refresh(slot.date)
    },

    async removeSlot(id, date) {
      await api.slots.remove(id)
      await refresh(date)
    },

    async reorder(date, orderedIds) {
      await api.slots.reorder(date, orderedIds)
      await refresh(date)
    },

    async dismissNote(id, date) {
      await api.notes.update(id, { status: 'dismissed' })
      await refresh(date)
    },

    acknowledgeRolls() {
      if (get().freshRollIds.size > 0) set({ freshRollIds: new Set() })
    },

    acknowledgeSweep() {
      const result = get().bootstrapResult
      if (!result || result.expiredStickers.length === 0) return
      set({ bootstrapResult: { ...result, expiredStickers: [] } })
    },

    async reloadAll() {
      const { focused } = get()
      await load(addDays(focused, -WINDOW), addDays(focused, WINDOW))
    },

    refreshDay: refresh
  }
})

export function useCard(date: DateKey): DayCard {
  return useDeck((s) => s.cards[date]) ?? emptyCard(date)
}
