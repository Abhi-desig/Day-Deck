import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import type {
  GoalColor,
  GoalNote,
  GoalNotePatch,
  NewGoalNote
} from '@shared/types'
import { GOAL_COLORS } from '@shared/types'
import type { Db } from './index'

/**
 * Reminder notes: things to be aware of on a day, as opposed to work to do on
 * it.
 *
 * The distinction is the whole point of the table. Everything that counts
 * progress — the day card's ring, the Tracker, rollover, the notification
 * briefs — reads `slots`, so a note living here can never be mistaken for an
 * unfinished task no matter how many of those readers are written later.
 */

interface NoteRow {
  id: string
  curriculum_id: string | null
  body: string
  surface_date: string
  learned_date: string | null
  status: string
  created_at: string
  goal_title: string | null
  goal_color: string | null
}

const isGoalColor = (value: string | null): value is GoalColor =>
  value !== null && (GOAL_COLORS as readonly string[]).includes(value)

const toNote = (r: NoteRow): GoalNote => ({
  id: r.id,
  curriculumId: r.curriculum_id,
  body: r.body,
  surfaceDate: r.surface_date,
  learnedDate: r.learned_date,
  status: r.status as GoalNote['status'],
  createdAt: r.created_at,
  goalTitle: r.goal_title,
  goalColor: isGoalColor(r.goal_color) ? r.goal_color : null
})

/** Notes carry their goal's name and colour for the same reason slots do. */
const WITH_GOAL = `
  SELECT n.*, c.title AS goal_title, c.color AS goal_color
    FROM goal_notes n
    LEFT JOIN curricula c ON c.id = n.curriculum_id`

export function getNote(db: Db, id: string): GoalNote {
  const row = db
    .prepare<[string], NoteRow>(`${WITH_GOAL} WHERE n.id = ?`)
    .get(id)
  if (!row) throw new Error(`Note not found: ${id}`)
  return toNote(row)
}

/**
 * Active notes across a date window, for the deck.
 *
 * Dismissed notes are excluded here but kept in the table — a note the user
 * has acknowledged should stop appearing without the record of it having
 * existed being destroyed.
 */
export function listInRange(
  db: Db,
  from: DateKey,
  to: DateKey
): Map<DateKey, GoalNote[]> {
  const rows = db
    .prepare<[string, string], NoteRow>(
      `${WITH_GOAL}
        WHERE n.status = 'active' AND n.surface_date BETWEEN ? AND ?
        ORDER BY n.created_at ASC`
    )
    .all(from, to)

  const byDate = new Map<DateKey, GoalNote[]>()
  for (const row of rows) {
    const list = byDate.get(row.surface_date)
    if (list) list.push(toNote(row))
    else byDate.set(row.surface_date, [toNote(row)])
  }
  return byDate
}

/**
 * The admin list, which shows dismissed notes too — the panel is where you go
 * to see what you have set up, including what has already been and gone.
 */
export function listForGoal(db: Db, curriculumId?: string | null): GoalNote[] {
  const order = `ORDER BY n.surface_date ASC, n.created_at ASC`
  const rows =
    curriculumId == null
      ? db.prepare<[], NoteRow>(`${WITH_GOAL} ${order}`).all()
      : db
          .prepare<[string], NoteRow>(
            `${WITH_GOAL} WHERE n.curriculum_id = ? ${order}`
          )
          .all(curriculumId)

  return rows.map(toNote)
}

export function createNote(db: Db, input: NewGoalNote): GoalNote {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO goal_notes
       (id, curriculum_id, body, surface_date, learned_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    id,
    input.curriculumId,
    input.body.trim(),
    input.surfaceDate,
    input.learnedDate ?? null,
    new Date().toISOString()
  )
  return getNote(db, id)
}

const PATCH_COLUMNS: Record<keyof GoalNotePatch, string> = {
  body: 'body',
  surfaceDate: 'surface_date',
  learnedDate: 'learned_date',
  status: 'status',
  curriculumId: 'curriculum_id'
}

export function updateNote(db: Db, id: string, patch: GoalNotePatch): GoalNote {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof GoalNotePatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE goal_notes SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getNote(db, id)
}

export function deleteNote(db: Db, id: string): void {
  db.prepare(`DELETE FROM goal_notes WHERE id = ?`).run(id)
}
