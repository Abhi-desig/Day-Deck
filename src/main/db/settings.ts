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
  /** Gemini calls allowed per minute, per feature slot. */
  geminiRatePerMinute: 'gemini.rate_per_minute'
} as const

/** 2½ hours of focused study a day is already an ambitious default. */
export const DEFAULT_DAILY_CAP = 150
