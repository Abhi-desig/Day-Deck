import { randomUUID } from 'node:crypto'
import type { NewWeeklyTemplate, WeeklyTemplate } from '@shared/types'
import type { Db } from './index'

interface WeeklyRow {
  id: string
  title: string
  weekday: number
  start_min: number | null
  duration_min: number
  category: string
  active: number
  sort_index: number
}

const toTemplate = (r: WeeklyRow): WeeklyTemplate => ({
  id: r.id,
  title: r.title,
  weekday: r.weekday,
  startMin: r.start_min,
  durationMin: r.duration_min,
  category: r.category as WeeklyTemplate['category'],
  active: r.active === 1,
  sortIndex: r.sort_index
})

export function listTemplates(
  db: Db,
  opts: { activeOnly?: boolean } = {}
): WeeklyTemplate[] {
  const where = opts.activeOnly ? 'WHERE active = 1' : ''
  return db
    .prepare<[], WeeklyRow>(
      `SELECT * FROM weekly_templates ${where} ORDER BY weekday ASC, sort_index ASC`
    )
    .all()
    .map(toTemplate)
}

export function upsertTemplate(
  db: Db,
  input: NewWeeklyTemplate & { id?: string }
): WeeklyTemplate {
  const id = input.id ?? randomUUID()
  db.prepare(
    `INSERT INTO weekly_templates
       (id, title, weekday, start_min, duration_min, category, active, sort_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       weekday = excluded.weekday,
       start_min = excluded.start_min,
       duration_min = excluded.duration_min,
       category = excluded.category,
       active = excluded.active,
       sort_index = excluded.sort_index`
  ).run(
    id,
    input.title.trim(),
    input.weekday,
    input.startMin ?? null,
    input.durationMin,
    input.category,
    input.active ? 1 : 0,
    input.sortIndex
  )

  const row = db
    .prepare<[string], WeeklyRow>(`SELECT * FROM weekly_templates WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Weekly template not found after upsert: ${id}`)
  return toTemplate(row)
}

export function deleteTemplate(db: Db, id: string): void {
  db.prepare(`DELETE FROM weekly_templates WHERE id = ?`).run(id)
}
