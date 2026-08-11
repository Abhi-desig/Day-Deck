import { create } from 'zustand'
import type { DateKey } from '@shared/date'
import type { AgentMessage } from '@shared/types'
import { api } from '../lib/api'

/**
 * The day-card assistant's conversations, one per date.
 *
 * Deliberately in memory and never written to the database. A day's questions
 * are scratch thinking about that day's work — keeping them would turn the deck
 * into a chat history you have to manage, and the answers go stale the moment
 * the plan reflows anyway.
 *
 * It lives in a store rather than in `DayCard` state because the card unmounts
 * its body every time the deck moves past it. Losing a half-finished
 * conversation to a stray swipe is exactly the kind of small betrayal that
 * stops people using a feature.
 */

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

interface AgentState {
  /** Which dates have the assistant switched on. */
  open: Record<DateKey, boolean>
  threads: Record<DateKey, AgentMessage[]>
  /** At most one question is in flight at a time; this is whose. */
  pending: DateKey | null
  errors: Record<DateKey, string | null>

  toggle(date: DateKey): void
  close(date: DateKey): void
  ask(date: DateKey, question: string): Promise<void>
  clear(date: DateKey): void
}

export const useAgent = create<AgentState>((set, get) => ({
  open: {},
  threads: {},
  pending: null,
  errors: {},

  toggle(date) {
    set((s) => ({ open: { ...s.open, [date]: !s.open[date] } }))
  },

  close(date) {
    set((s) => ({ open: { ...s.open, [date]: false } }))
  },

  async ask(date, question) {
    const text = question.trim()
    if (!text || get().pending) return

    const history = get().threads[date] ?? []

    // The question goes up immediately; waiting for the round trip to show what
    // you just typed makes a 2-second answer feel like a 4-second one.
    set((s) => ({
      threads: { ...s.threads, [date]: [...history, { role: 'user', text }] },
      pending: date,
      errors: { ...s.errors, [date]: null }
    }))

    try {
      const reply = await api.agent.ask(date, text, history)
      set((s) => ({
        threads: {
          ...s.threads,
          [date]: [
            ...(s.threads[date] ?? []),
            { role: 'model', text: reply.text }
          ]
        },
        pending: null
      }))
    } catch (err) {
      // The question stays in the thread so it can be retried by asking again
      // without retyping, and the error sits under it rather than replacing it.
      set((s) => ({
        pending: null,
        errors: { ...s.errors, [date]: message(err) }
      }))
    }
  },

  clear(date) {
    set((s) => ({
      threads: { ...s.threads, [date]: [] },
      errors: { ...s.errors, [date]: null }
    }))
  }
}))
