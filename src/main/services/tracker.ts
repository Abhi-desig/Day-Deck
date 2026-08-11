import type { DateKey } from '@shared/date'
import { addDays, rangeKeys, startOfWeek, todayKey, toKey } from '@shared/date'
import type {
  SlotCategory,
  TrackerDay,
  TrackerEntry,
  TrackerPace,
  TrackerWeek
} from '@shared/types'
import type { Db } from '../db'
import { toSlot, type SlotRow } from '../db/slots'

/**
 * The Tracker is a read, not a record.
 *
 * Nothing writes tracker data: every number here is derived from slots that are
 * already `done`, which is what makes it a diary you never have to keep. The
 * one thing it must get right is *which day* a completion belongs to.
 */

const CATEGORIES: SlotCategory[] = ['vibe_code', 'amber', 'personal_learning']

const zeroed = (): Record<SlotCategory, number> => ({
  vibe_code: 0,
  amber: 0,
  personal_learning: 0
})

/**
 * `completed_at` is an ISO instant in UTC, and the Tracker buckets by *local*
 * day, so the conversion is done in JS through the same local-time path the
 * rest of the app uses rather than with SQLite's `date(..., 'localtime')`.
 *
 * The cost is that the SQL window has to be padded: a slot completed at 23:00
 * local on Sunday is Monday in UTC, and one completed at 01:00 local on Monday
 * is Sunday. A day either side covers every real offset, and the extra rows are
 * filtered out below.
 */
function readCompleted(db: Db, from: DateKey, to: DateKey): TrackerEntry[] {
  const rows = db
    .prepare<[string, string], SlotRow>(
      `SELECT s.*,
              COALESCE(c.title, p.name)  AS source_label,
              COALESCE(c.color, p.color) AS source_color,
              t.points                   AS source_points
         FROM slots s
         LEFT JOIN topics t
           ON s.source = 'curriculum' AND t.id = s.source_ref
         LEFT JOIN curricula c ON c.id = t.curriculum_id
         LEFT JOIN projects p
           ON s.source = 'project' AND p.id = s.source_ref
        WHERE s.status = 'done'
          AND s.completed_at IS NOT NULL
          AND s.completed_at >= ? AND s.completed_at < ?
        ORDER BY s.completed_at DESC`
    )
    // String comparison on ISO instants is chronological, which is the whole
    // reason completed_at is stored as one.
    .all(`${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`)

  const entries: TrackerEntry[] = []
  for (const row of rows) {
    if (!row.completed_at) continue
    const doneOn = toKey(new Date(row.completed_at))
    if (doneOn < from || doneOn > to) continue

    const slot = toSlot(row)
    entries.push({
      slotId: slot.id,
      title: slot.title,
      category: slot.category,
      doneOn,
      durationMin: slot.durationMin,
      source: slot.source,
      sourceLabel: slot.sourceLabel,
      sourceColor: slot.sourceColor
    })
  }
  return entries
}

/**
 * How the plans are actually going.
 *
 * Only active curricula count. An archived goal's unfinished topics are not a
 * debt the user still owes — archiving was the decision to stop owing them.
 */
export function pace(db: Db, today: DateKey = todayKey()): TrackerPace {
  const row = db
    .prepare<[string], { behind: number; done: number; total: number }>(
      `SELECT
         SUM(CASE WHEN t.status = 'pending' AND t.assigned_date IS NOT NULL
                   AND t.assigned_date < ? THEN 1 ELSE 0 END) AS behind,
         SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)   AS done,
         COUNT(*)                                             AS total
       FROM topics t
       JOIN curricula c ON c.id = t.curriculum_id
      WHERE c.status = 'active'`
    )
    .get(today)

  const total = row?.total ?? 0
  const behind = row?.behind ?? 0

  return {
    behind,
    done: row?.done ?? 0,
    total,
    onPace: behind === 0,
    hasGoals: total > 0
  }
}

/**
 * One week of finished work, Monday to Sunday.
 *
 * `anchor` can be any day in the week — the caller navigates by adding or
 * subtracting seven and does not have to know where the boundary is.
 */
export function week(db: Db, anchor: DateKey = todayKey()): TrackerWeek {
  const weekStart = startOfWeek(anchor)
  const weekEnd = addDays(weekStart, 6)

  const entries = readCompleted(db, weekStart, weekEnd)

  const byDate = new Map<DateKey, TrackerEntry[]>()
  for (const entry of entries) {
    const list = byDate.get(entry.doneOn)
    if (list) list.push(entry)
    else byDate.set(entry.doneOn, [entry])
  }

  const totals = zeroed()
  const minutes = zeroed()

  // Every weekday gets a bar, empty or not — a week with a blank Wednesday has
  // to read as a blank Wednesday, not as a six-day week.
  const days: TrackerDay[] = rangeKeys(weekStart, weekEnd).map((date) => {
    const day: TrackerDay = {
      date,
      counts: zeroed(),
      minutes: zeroed(),
      total: 0,
      totalMinutes: 0
    }

    for (const entry of byDate.get(date) ?? []) {
      day.counts[entry.category] += 1
      day.minutes[entry.category] += entry.durationMin
      day.total += 1
      day.totalMinutes += entry.durationMin
      totals[entry.category] += 1
      minutes[entry.category] += entry.durationMin
    }

    return day
  })

  return {
    weekStart,
    days,
    totals,
    minutes,
    totalCount: CATEGORIES.reduce((n, c) => n + totals[c], 0),
    totalMinutes: CATEGORIES.reduce((n, c) => n + minutes[c], 0),
    entries,
    pace: pace(db)
  }
}
