import { create } from 'zustand'
import type { SectionId } from '@shared/types'

/**
 * Which section is showing, and one-shot requests aimed at it.
 *
 * Section state used to live in `App`, which was fine while the sidebar was the
 * only thing that changed it. The command palette needs to switch section *and*
 * then ask that section to do something — "New sticker" is a navigation plus an
 * instruction — and threading that through props from the shell to a section
 * that has not mounted yet does not work.
 *
 * Intents are nonces rather than booleans on purpose. A flag has to be cleared
 * by whoever consumed it, which means a section clearing state it does not own
 * and a race if it was not mounted when the flag was set. An incrementing
 * counter watched by an effect fires exactly once per request, needs no
 * cleanup, and works whether the section was already open or has just arrived.
 */
export type IntentId = 'weekly' | 'reminders' | 'newGoal' | 'newSticker'

type Intents = Record<IntentId, number>

const NO_INTENTS: Intents = {
  weekly: 0,
  reminders: 0,
  newGoal: 0,
  newSticker: 0
}

interface ShellState {
  section: SectionId
  intents: Intents
  paletteOpen: boolean
  /** Backup and the database path. App-level, so not part of any section. */
  dataOpen: boolean

  go(section: SectionId): void
  /** Switch to `section` if given, then fire the intent at it. */
  request(intent: IntentId, section?: SectionId): void
  setPalette(open: boolean): void
  setData(open: boolean): void
}

export const useShell = create<ShellState>((set) => ({
  section: 'today',
  intents: NO_INTENTS,
  paletteOpen: false,
  dataOpen: false,

  go(section) {
    set({ section, paletteOpen: false })
  },

  request(intent, section) {
    set((s) => ({
      section: section ?? s.section,
      paletteOpen: false,
      intents: { ...s.intents, [intent]: s.intents[intent] + 1 }
    }))
  },

  setPalette(open) {
    set({ paletteOpen: open })
  },

  setData(open) {
    set({ dataOpen: open, paletteOpen: false })
  }
}))

/** Subscribe to one intent's nonce. Changes exactly once per request. */
export function useIntent(intent: IntentId): number {
  return useShell((s) => s.intents[intent])
}
