import { create } from 'zustand'
import type { ThemeName, UiPrefs } from '@shared/types'
import { api } from '../lib/api'

/**
 * Where the boot theme is cached.
 *
 * SQLite is the source of truth — this is only so the very first paint is the
 * right colour. Reading the real value is an IPC round trip, and the renderer
 * paints before it resolves.
 */
const THEME_CACHE_KEY = 'dayDeck.theme'

/**
 * Put the theme on the document.
 *
 * `<html>` rather than the React root: the body background and the scrollbar
 * rules in globals.css both live outside the React tree, and neither would
 * follow an attribute set further down.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme)
  } catch {
    // Storage can be unavailable; the cache is an optimisation, not the state.
  }
}

/**
 * The cached theme, for use before the database has answered.
 *
 * Called from main.tsx above the first import that paints, so there is no
 * window in which the wrong theme is on screen.
 */
export function applyCachedTheme(): void {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY)
    if (cached === 'light' || cached === 'dark') {
      document.documentElement.dataset.theme = cached
    }
  } catch {
    // Same as above — fall through to the dark default in the stylesheet.
  }
}

interface PrefsState extends UiPrefs {
  load(): Promise<void>
  setTheme(theme: ThemeName): Promise<void>
  setSceneNumbers(on: boolean): Promise<void>
}

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: 'dark',
  sceneNumbers: true,

  async load() {
    try {
      const prefs = await api.settings.prefs()
      applyTheme(prefs.theme)
      set(prefs)
    } catch {
      // A preference failing to load is not worth an error banner; the
      // defaults above are all usable.
    }
  },

  async setTheme(theme) {
    // Applied first, saved second: flipping a theme has to feel instant, and
    // the write is a round trip. A failed write leaves the screen ahead of the
    // database until the next launch, which is the right way round for this.
    const previous = get().theme
    applyTheme(theme)
    set({ theme })
    try {
      await api.settings.setTheme(theme)
    } catch {
      applyTheme(previous)
      set({ theme: previous })
    }
  },

  async setSceneNumbers(on) {
    const previous = get().sceneNumbers
    set({ sceneNumbers: on })
    try {
      await api.settings.setSceneNumbers(on)
    } catch {
      set({ sceneNumbers: previous })
    }
  }
}))
