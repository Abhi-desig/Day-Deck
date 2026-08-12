import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import { addDays, weekKey } from '@shared/date'
import type { Db } from '../db'
import { autoTagSlots } from '../db/tags'
import { listTemplates } from '../db/weekly'

export interface SeedResult {
  /** The Monday that was seeded, or null when this week was already done. */
  week: DateKey | null
  slotIds: string[]
}

/** Offset in days from the week's Monday. weekday is 0=Sun … 6=Sat. */
const offsetFromMonday = (weekday: number): number => (weekday + 6) % 7

/**
 * Materialises the active weekly templates into real slots for the current
 * week, exactly once. `weekly_seed_log` is the guard, and the partial unique
 * index on (source_ref, date) is the backstop if that guard ever loses a race.
 *
 * The whole week is seeded, including days already past. Opening the app on a
 * Wednesday after a gap therefore seeds Monday's amber tasks and lets rollover
 * carry them to today — which is the honest outcome, not a bug.
 */
export function runWeeklySeeding(db: Db, today: DateKey): SeedResult {
  const week = weekKey(today)

  const already = db
    .prepare<[string], { 1: number }>(
      `SELECT 1 FROM weekly_seed_log WHERE week_key = ?`
    )
    .get(week)
  if (already) return { week: null, slotIds: [] }

  const templates = listTemplates(db, { activeOnly: true })
  const slotIds: string[] = []

  const insert = db.prepare(
    `INSERT OR IGNORE INTO slots
       (id, date, start_min, duration_min, title, note, source, source_ref,
        category, status, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'amber_weekly', ?, ?, 'open', ?, ?)`
  )

  db.transaction(() => {
    const now = new Date().toISOString()

    for (const t of templates) {
      const date = addDays(week, offsetFromMonday(t.weekday))
      const id = randomUUID()
      const info = insert.run(
        id,
        date,
        t.startMin,
        t.durationMin,
        t.title,
        t.id,
        t.category,
        t.sortIndex,
        now
      )
      if (info.changes > 0) slotIds.push(id)
    }

    db.prepare(
      `INSERT INTO weekly_seed_log (week_key, seeded_at) VALUES (?, ?)`
    ).run(week, now)
  })()

  // Seeded work files itself like anything else. Outside the transaction above
  // because the ids are only known once it has committed.
  autoTagSlots(db, slotIds)

  return { week, slotIds }
}
