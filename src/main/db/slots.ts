import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import { rangeKeys } from '@shared/date'
import type {
  DayCard,
  NewSlot,
  Slot,
  SlotPatch,
  SlotStatus
} from '@shared/types'
import type { Db } from './index'
import { parsePoints, syncTopicStatus } from './curriculum'
import { listInRange as listNotesInRange } from './notes'

export interface SlotRow {
  id: string
  date: string
  start_min: number | null
  duration_min: number
  title: string
  note: string | null
  source: string
  source_ref: string | null
  category: string
  status: string
  rolled_from: string | null
  roll_count: number
  sort_index: number
  completed_at: string | null
  created_at: string
  /** Present only on reads that join through to the owning goal. */
  source_label?: string | null
  source_color?: string | null
  /** The owning topic's learning points, still JSON at this point. */
  source_points?: string | null
}

export function toSlot(r: SlotRow): Slot {
  return {
    id: r.id,
    date: r.date,
    startMin: r.start_min,
    durationMin: r.duration_min,
    title: r.title,
    note: r.note,
    source: r.source as Slot['source'],
    sourceRef: r.source_ref,
    category: r.category as Slot['category'],
    status: r.status as Slot['status'],
    rolledFrom: r.rolled_from,
    rollCount: r.roll_count,
    sortIndex: r.sort_index,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    sourceLabel: r.source_label ?? null,
    sourceColor: (r.source_color as Slot['sourceColor']) ?? null,
    sourcePoints: parsePoints(r.source_points ?? null)
  }
}

/**
 * Unscheduled work floats to the top as an "anytime" inbox, then scheduled
 * work in clock order, then manual ordering inside the same minute.
 */
const ORDER = `ORDER BY (s.start_min IS NULL) DESC, s.start_min ASC, s.sort_index ASC, s.created_at ASC`

/**
 * Slots carry the name and colour of whatever produced them — the goal for
 * curriculum work, the project for a workspace row. With several goals live at
 * once, a card row that only says "curriculum" is useless; you cannot tell
 * which plan the work belongs to, and "project" is no better.
 *
 * `source_ref` is polymorphic, so each join is guarded by the source it belongs
 * to and is a no-op for every other row. The two can never both match, which is
 * what makes COALESCE safe here.
 */
const WITH_GOAL = `
  SELECT s.*,
         COALESCE(c.title, p.name)  AS source_label,
         COALESCE(c.color, p.color) AS source_color,
         t.points                   AS source_points
    FROM slots s
    LEFT JOIN topics t
      ON s.source = 'curriculum' AND t.id = s.source_ref
    LEFT JOIN curricula c ON c.id = t.curriculum_id
    LEFT JOIN projects p
      ON s.source = 'project' AND p.id = s.source_ref`

/**
 * The deck's read: every day in the window with its work and its reminders.
 *
 * Notes ride along here rather than through a channel of their own because a
 * card is incomplete without them and a second round trip per swipe is exactly
 * the latency the deck cannot afford. They stay a separate field on the card,
 * never merged into `slots`, so no caller can accidentally count one.
 */
export function listRange(db: Db, from: DateKey, to: DateKey): DayCard[] {
  const rows = db
    .prepare<[string, string], SlotRow>(
      `${WITH_GOAL} WHERE s.date BETWEEN ? AND ? ${ORDER}`
    )
    .all(from, to)

  const byDate = new Map<DateKey, Slot[]>()
  for (const row of rows) {
    const list = byDate.get(row.date)
    if (list) list.push(toSlot(row))
    else byDate.set(row.date, [toSlot(row)])
  }

  const notesByDate = listNotesInRange(db, from, to)

  // Every day in the window gets a card, empty or not — the deck must not have
  // holes where a date has no rows.
  return rangeKeys(from, to).map((date) => ({
    date,
    slots: byDate.get(date) ?? [],
    notes: notesByDate.get(date) ?? []
  }))
}

export function getSlot(db: Db, id: string): Slot {
  const row = db
    .prepare<[string], SlotRow>(`${WITH_GOAL} WHERE s.id = ?`)
    .get(id)
  if (!row) throw new Error(`Slot not found: ${id}`)
  return toSlot(row)
}

function nextSortIndex(db: Db, date: DateKey): number {
  const r = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM slots WHERE date = ?`
    )
    .get(date)
  return r?.next ?? 0
}

export function createSlot(db: Db, input: NewSlot): Slot {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO slots
       (id, date, start_min, duration_min, title, note, source, source_ref,
        category, status, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    id,
    input.date,
    input.startMin ?? null,
    input.durationMin ?? 30,
    input.title.trim(),
    input.note ?? null,
    input.source ?? 'manual',
    input.sourceRef ?? null,
    input.category ?? 'personal_learning',
    nextSortIndex(db, input.date),
    new Date().toISOString()
  )
  return getSlot(db, id)
}

const PATCH_COLUMNS: Record<keyof SlotPatch, string> = {
  title: 'title',
  note: 'note',
  startMin: 'start_min',
  durationMin: 'duration_min',
  category: 'category',
  status: 'status',
  date: 'date',
  sortIndex: 'sort_index'
}

export function updateSlot(db: Db, id: string, patch: SlotPatch): Slot {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof SlotPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (patch.status !== undefined) {
    sets.push('completed_at = ?')
    values.push(patch.status === 'done' ? new Date().toISOString() : null)
  }

  if (sets.length) {
    db.prepare(`UPDATE slots SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  const slot = getSlot(db, id)

  // Ticking a curriculum slot off on a day card is the same act as completing
  // the topic, so the plan must not be left thinking it is still pending.
  if (patch.status !== undefined && slot.source === 'curriculum' && slot.sourceRef) {
    syncTopicStatus(db, slot.sourceRef, slot.status)
  }

  return slot
}

export function setStatus(db: Db, id: string, status: SlotStatus): Slot {
  return updateSlot(db, id, { status })
}

export function deleteSlot(db: Db, id: string): void {
  db.prepare(`DELETE FROM slots WHERE id = ?`).run(id)
}

export function reorder(db: Db, date: DateKey, orderedIds: string[]): void {
  const stmt = db.prepare(
    `UPDATE slots SET sort_index = ? WHERE id = ? AND date = ?`
  )
  db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, id, date))
  })()
}
