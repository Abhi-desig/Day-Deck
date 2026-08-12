import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import type { RolloverRecord } from '@shared/types'
import type { Db } from '../db'
import type { SlotRow } from '../db/slots'
import { copyTags } from '../db/tags'

/**
 * Carries unfinished work forward to today.
 *
 * The original slot is *not* moved — it is tombstoned as `rolled` and a fresh
 * slot is created on today pointing back at it via `rolled_from`. Two reasons:
 * the Tracker can still show that the day was missed rather than quietly
 * rewriting history, and the renderer gets a stable pair of ids to run the
 * shared-`layoutId` flight animation between cards.
 *
 * Idempotent: a slot is only selected while it is still `open` on a past date,
 * so re-running within the same day is a no-op.
 */
export function runRollover(db: Db, today: DateKey): RolloverRecord[] {
  const stale = db
    .prepare<[string], SlotRow>(
      `SELECT * FROM slots
        WHERE status = 'open' AND date < ?
        ORDER BY date ASC, sort_index ASC`
    )
    .all(today)

  if (stale.length === 0) return []

  const insert = db.prepare(
    `INSERT OR IGNORE INTO slots
       (id, date, start_min, duration_min, title, note, source, source_ref,
        category, status, rolled_from, roll_count, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
  )
  const markRolled = db.prepare(
    `UPDATE slots SET status = 'rolled' WHERE id = ?`
  )

  const records: RolloverRecord[] = []

  db.transaction(() => {
    // Carried work sits above whatever today already holds.
    const floor =
      db
        .prepare<[string], { min: number }>(
          `SELECT COALESCE(MIN(sort_index), 0) AS min FROM slots WHERE date = ?`
        )
        .get(today)?.min ?? 0
    let sortIndex = floor - stale.length
    const now = new Date().toISOString()

    for (const row of stale) {
      const newId = randomUUID()
      const info = insert.run(
        newId,
        today,
        row.start_min,
        row.duration_min,
        row.title,
        row.note,
        row.source,
        row.source_ref,
        row.category,
        row.id,
        row.roll_count + 1,
        sortIndex++,
        now
      )

      // Tombstone either way. A skipped insert means the same curriculum topic
      // or weekly task already exists on today, so the work is not lost.
      markRolled.run(row.id)

      if (info.changes > 0) {
        // The carried slot is the same work on a later day, so its filing comes
        // with it — including tags attached by hand, which re-matching would
        // quietly demote back to whatever the title happens to contain.
        copyTags(db, row.id, newId)
        records.push({
          slotId: row.id,
          newSlotId: newId,
          fromDate: row.date,
          title: row.title,
          rollCount: row.roll_count + 1
        })
      }
    }
  })()

  return records
}
