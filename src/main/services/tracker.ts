import type { DateKey } from '@shared/date'
import {
  addDays,
  rangeKeys,
  startOfWeek,
  todayKey,
  toKey,
  weekdayOf
} from '@shared/date'
import type {
  SlotCategory,
  Tag,
  TagDue,
  TagWorkItem,
  TrackerDay,
  TrackerEntry,
  TrackerPace,
  TrackerWeek
} from '@shared/types'
import type { Db } from '../db'
import { toSlot, type SlotRow } from '../db/slots'
import { listTags, tagsForCompleted } from '../db/tags'

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
  const fromInstant = `${addDays(from, -1)}T00:00:00.000Z`
  const toInstant = `${addDays(to, 2)}T00:00:00.000Z`

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
    .all(fromInstant, toInstant)

  // Same padded window as the rows themselves, so the join is one statement
  // rather than one per completion.
  const tagsBySlot = tagsForCompleted(db, fromInstant, toInstant)

  const entries: TrackerEntry[] = []
  for (const row of rows) {
    if (!row.completed_at) continue
    const doneOn = toKey(new Date(row.completed_at))
    if (doneOn < from || doneOn > to) continue

    const slot = toSlot(row, tagsBySlot.get(row.id) ?? [])
    entries.push({
      slotId: slot.id,
      title: slot.title,
      category: slot.category,
      doneOn,
      durationMin: slot.durationMin,
      source: slot.source,
      sourceLabel: slot.sourceLabel,
      sourceColor: slot.sourceColor,
      tags: slot.tags
    })
  }
  return entries
}

/**
 * Where a tag's cutoff weekday falls inside the week being viewed.
 *
 * `weekStart` is a Monday, so the offset is measured from 1 rather than 0 and a
 * Sunday cutoff (weekday 0) correctly lands at the *end* of the week rather
 * than before its beginning.
 */
function cutoffDate(weekStart: DateKey, dueWeekday: number): DateKey {
  return addDays(weekStart, (dueWeekday - weekdayOf(weekStart) + 7) % 7)
}

/**
 * Work still open under a tag, on or before a cutoff.
 *
 * Bucketed on the *planned* date, not on completion — an unfinished task has no
 * completion date, and the only meaningful question about it is whether it is
 * scheduled to land before the deadline. `rolled` rows are excluded: they are
 * tombstones whose live copy is already counted somewhere else, so including
 * them would double every carried task.
 */
function openForTag(
  db: Db,
  tagId: string,
  from: DateKey,
  through: DateKey
): TagWorkItem[] {
  return db
    .prepare<[string, string, string], {
      id: string
      title: string
      date: string
      duration_min: number
      category: string
    }>(
      `SELECT s.id, s.title, s.date, s.duration_min, s.category
         FROM slots s
         JOIN slot_tags st ON st.slot_id = s.id
        WHERE st.tag_id = ?
          AND s.status = 'open'
          AND s.date BETWEEN ? AND ?
        ORDER BY s.date ASC, s.start_min IS NULL DESC, s.start_min ASC`
    )
    .all(tagId, from, through)
    .map((r) => ({
      slotId: r.id,
      title: r.title,
      date: r.date,
      durationMin: r.duration_min,
      category: r.category as SlotCategory
    }))
}

/**
 * Each tag's week against its own cutoff. Tags with no cutoff set are absent
 * entirely rather than present with a null date — the Tracker's rule is that a
 * deadline you did not ask for is not a deadline you get nagged about.
 */
function dueForTags(
  db: Db,
  tags: Tag[],
  entries: TrackerEntry[],
  weekStart: DateKey,
  today: DateKey
): TagDue[] {
  const out: TagDue[] = []

  for (const tag of tags) {
    if (tag.dueWeekday === null) continue

    const dueDate = cutoffDate(weekStart, tag.dueWeekday)

    let done = 0
    let doneMinutes = 0
    for (const entry of entries) {
      if (entry.doneOn > dueDate) continue
      if (!entry.tags.some((t) => t.id === tag.id)) continue
      done += 1
      doneMinutes += entry.durationMin
    }

    const openItems = openForTag(db, tag.id, weekStart, dueDate)
    const openMinutes = openItems.reduce((n, i) => n + i.durationMin, 0)

    out.push({
      tagId: tag.id,
      dueDate,
      done,
      doneMinutes,
      open: openItems.length,
      openMinutes,
      openItems,
      missed: today > dueDate && openItems.length > 0
    })
  }

  return out
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

  const tagTotals: Record<string, number> = {}
  const tagMinutes: Record<string, number> = {}
  let untaggedTotal = 0
  let untaggedMinutes = 0

  // Every weekday gets a bar, empty or not — a week with a blank Wednesday has
  // to read as a blank Wednesday, not as a six-day week.
  const days: TrackerDay[] = rangeKeys(weekStart, weekEnd).map((date) => {
    const day: TrackerDay = {
      date,
      counts: zeroed(),
      minutes: zeroed(),
      total: 0,
      totalMinutes: 0,
      tagCounts: {},
      tagMinutes: {},
      untagged: 0,
      untaggedMinutes: 0
    }

    for (const entry of byDate.get(date) ?? []) {
      day.counts[entry.category] += 1
      day.minutes[entry.category] += entry.durationMin
      day.total += 1
      day.totalMinutes += entry.durationMin
      totals[entry.category] += 1
      minutes[entry.category] += entry.durationMin

      // A slot with two tags counts under both, so these deliberately do not
      // sum to `total`. The chart divides each bar proportionally rather than
      // treating the tag counts as a partition of it — see the note on
      // TrackerDay.tagCounts.
      if (entry.tags.length === 0) {
        day.untagged += 1
        day.untaggedMinutes += entry.durationMin
        untaggedTotal += 1
        untaggedMinutes += entry.durationMin
      } else {
        for (const tag of entry.tags) {
          day.tagCounts[tag.id] = (day.tagCounts[tag.id] ?? 0) + 1
          day.tagMinutes[tag.id] =
            (day.tagMinutes[tag.id] ?? 0) + entry.durationMin
          tagTotals[tag.id] = (tagTotals[tag.id] ?? 0) + 1
          tagMinutes[tag.id] = (tagMinutes[tag.id] ?? 0) + entry.durationMin
        }
      }
    }

    return day
  })

  // Every tag, not just the ones with work in this week: a legend that changes
  // shape as you page back through quiet weeks is unreadable, and a tag showing
  // zero is itself the answer to "did I touch this at all".
  const tags = listTags(db)
  const today = todayKey()

  return {
    weekStart,
    days,
    totals,
    minutes,
    totalCount: CATEGORIES.reduce((n, c) => n + totals[c], 0),
    totalMinutes: CATEGORIES.reduce((n, c) => n + minutes[c], 0),
    entries,
    pace: pace(db, today),
    tags,
    tagTotals,
    tagMinutes,
    untaggedTotal,
    untaggedMinutes,
    tagDue: dueForTags(db, tags, entries, weekStart, today)
  }
}
