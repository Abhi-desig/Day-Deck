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
  eveningMin: 'notify.evening_min'
} as const

/** 2½ hours of focused study a day is already an ambitious default. */
export const DEFAULT_DAILY_CAP = 150
