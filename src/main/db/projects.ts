import { randomUUID } from 'node:crypto'
import { GOAL_COLORS } from '@shared/types'
import type { GoalColor, Project } from '@shared/types'
import type { Db } from './index'

export interface ProjectRow {
  id: string
  name: string
  path: string
  color: string | null
  branch: string | null
  last_opened_at: string | null
  pinned: number
  sort_index: number
  created_at: string
}

const isGoalColor = (value: unknown): value is GoalColor =>
  typeof value === 'string' && (GOAL_COLORS as readonly string[]).includes(value)

/**
 * `missing` is supplied by the caller because only the service layer touches
 * the filesystem — the repository stays a pure translation of rows to objects
 * so it can be tested without one.
 */
export function toProject(r: ProjectRow, missing = false): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    color: isGoalColor(r.color) ? r.color : 'amber',
    branch: r.branch,
    lastOpenedAt: r.last_opened_at,
    pinned: r.pinned === 1,
    sortIndex: r.sort_index,
    createdAt: r.created_at,
    missing
  }
}

/**
 * Pinned first, then explicit order. `renumber` keeps sort_index in step with
 * this exact ordering after every mutation, so the stored index and the
 * displayed position never drift apart.
 */
const ORDER = `ORDER BY pinned DESC, sort_index ASC, created_at ASC`

export function listRows(db: Db): ProjectRow[] {
  return db.prepare<[], ProjectRow>(`SELECT * FROM projects ${ORDER}`).all()
}

export function getRow(db: Db, id: string): ProjectRow | null {
  return (
    db.prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE id = ?`).get(id) ??
    null
  )
}

export function findByPath(db: Db, path: string): ProjectRow | null {
  return (
    db
      .prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE path = ?`)
      .get(path) ?? null
  )
}

/** The first palette colour no project is wearing yet. */
export function nextColor(db: Db): GoalColor {
  const taken = new Set(listRows(db).map((r) => r.color))
  return GOAL_COLORS.find((c) => !taken.has(c)) ?? GOAL_COLORS[0]
}

export interface NewProjectRow {
  name: string
  path: string
  branch: string | null
  color?: GoalColor
}

export function insert(db: Db, input: NewProjectRow): ProjectRow {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO projects
       (id, name, path, color, branch, last_opened_at, pinned, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)`
  ).run(
    id,
    input.name,
    input.path,
    input.color ?? nextColor(db),
    input.branch,
    nextSortIndex(db),
    new Date().toISOString()
  )
  return getRow(db, id) as ProjectRow
}

function nextSortIndex(db: Db): number {
  const r = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM projects`
    )
    .get()
  return r?.next ?? 0
}

export function remove(db: Db, id: string): void {
  db.transaction(() => {
    // A slot pointing at a project that no longer exists would render as an
    // untitled row that goes nowhere. Removing the registry entry removes the
    // link too; the slot itself is the user's, so it survives as plain work.
    db.prepare(
      `UPDATE slots SET source = 'manual', source_ref = NULL
        WHERE source = 'project' AND source_ref = ?`
    ).run(id)
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id)
    renumber(db)
  })()
}

export function setPinned(db: Db, id: string, pinned: boolean): void {
  db.transaction(() => {
    db.prepare(`UPDATE projects SET pinned = ? WHERE id = ?`).run(
      pinned ? 1 : 0,
      id
    )
    // Pinning moves a card to the front of the grid, so the stored order has to
    // move with it or the next drag would fight the pin.
    renumber(db)
  })()
}

export function setBranch(db: Db, id: string, branch: string | null): void {
  db.prepare(`UPDATE projects SET branch = ? WHERE id = ?`).run(branch, id)
}

export function touch(db: Db, id: string): void {
  db.prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  )
}

/**
 * Accepts the ids in the order they are shown. Anything the caller left out
 * keeps its relative position after the listed ones, so a stale renderer list
 * can reorder what it knows about without silently discarding the rest.
 */
export function reorder(db: Db, orderedIds: string[]): void {
  const known = new Set(listRows(db).map((r) => r.id))
  const stmt = db.prepare(`UPDATE projects SET sort_index = ? WHERE id = ?`)

  db.transaction(() => {
    let i = 0
    for (const id of orderedIds) {
      if (!known.has(id)) continue
      stmt.run(i++, id)
      known.delete(id)
    }
    // Whatever was not mentioned trails behind, in its existing order.
    for (const row of listRows(db)) {
      if (known.has(row.id)) stmt.run(i++, row.id)
    }
    renumber(db)
  })()
}

/**
 * Rewrite sort_index to be 0..n-1 in display order. Called after every
 * mutation, which is what lets `ORDER BY pinned DESC, sort_index ASC` and a
 * plain `ORDER BY sort_index ASC` agree — the invariant the grid's drag
 * reordering depends on.
 */
export function renumber(db: Db): void {
  const stmt = db.prepare(`UPDATE projects SET sort_index = ? WHERE id = ?`)
  listRows(db).forEach((row, i) => {
    if (row.sort_index !== i) stmt.run(i, row.id)
  })
}
