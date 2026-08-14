import type { KeySlot, UiPrefs } from '@shared/types'
import type { Db } from './index'

/**
 * The `settings` table is a plain key/value store, so everything that reads it
 * has to defend against a missing row and a garbage value. Doing that once here
 * keeps the callers readable and means a hand-edited database degrades to the
 * default instead of crashing the app on launch.
 */
export function getSetting(db: Db, key: string): string | null {
  const row = db
    .prepare<[string], { value: string }>(
      `SELECT value FROM settings WHERE key = ?`
    )
    .get(key)
  return row?.value ?? null
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

export function getNumber(db: Db, key: string, fallback: number): number {
  const raw = getSetting(db, key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getBool(db: Db, key: string, fallback: boolean): boolean {
  const raw = getSetting(db, key)
  if (raw === null) return fallback
  return raw === '1' || raw === 'true'
}

export const SETTING = {
  dailyCapMinutes: 'goals.daily_cap_minutes',
  morningEnabled: 'notify.morning_enabled',
  morningMin: 'notify.morning_min',
  eveningEnabled: 'notify.evening_enabled',
  eveningMin: 'notify.evening_min',
  /**
   * Where new projects are created, one directory per kind.
   *
   * Two keys rather than one because code and creative work rarely want to live
   * together: repositories belong somewhere small and backed up, a hundred
   * gigabytes of footage usually belongs on a scratch drive. Setting both to the
   * same path is a perfectly good answer, and is what sharing one home means.
   */
  codeHome: 'projects.code_home',
  creativeHome: 'projects.creative_home',
  /**
   * AI calls allowed per minute, per feature slot.
   *
   * The stored key still says `gemini` because it predates there being anything
   * else, and renaming it would silently reset the limit for everyone who has
   * already tuned it. The string is storage; the name beside it is the meaning.
   */
  aiRatePerMinute: 'gemini.rate_per_minute',

  /**
   * Appearance. Stored here rather than in the renderer so the main process can
   * read it before the window exists — the window's own background colour has
   * to be right, or launching in light mode flashes the dark canvas first.
   */
  theme: 'ui.theme',
  /** Whether storyboard scene cards show their position on the board. */
  sceneNumbers: 'ui.scene_numbers'
} as const

/**
 * Which provider each key slot talks to, and what to ask it for.
 *
 * Per slot rather than per app, matching the keys themselves — and stored in
 * `settings` rather than beside the key, because none of it is a secret and all
 * of it is worth carrying in a backup. The key is the only part that must not
 * travel; see services/secrets.ts.
 */
export const SLOT_SETTING = {
  provider: (slot: KeySlot): string => `ai.provider.${slot}`,
  /** Only read for the `custom` provider. */
  baseUrl: (slot: KeySlot): string => `ai.base_url.${slot}`,
  model: (slot: KeySlot): string => `ai.model.${slot}`
} as const

/** 2½ hours of focused study a day is already an ambitious default. */
export const DEFAULT_DAILY_CAP = 150

/**
 * Every preference the interface remembers, read in one go.
 *
 * Kept here rather than assembled in the IPC handler because `createWindow`
 * needs the theme too, before any IPC exists.
 */
export function getUiPrefs(db: Db): UiPrefs {
  return {
    theme: getSetting(db, SETTING.theme) === 'light' ? 'light' : 'dark',
    // On by default: the number is the only thing telling scene 1 from scene 10
    // once the planner has given every card a name.
    sceneNumbers: getBool(db, SETTING.sceneNumbers, true)
  }
}
