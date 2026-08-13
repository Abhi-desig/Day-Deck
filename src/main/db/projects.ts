import { randomUUID } from 'node:crypto'
import { GOAL_COLORS, PROJECT_KINDS } from '@shared/types'
import type { GoalColor, Project, ProjectKind } from '@shared/types'
import type { Db } from './index'

export interface ProjectRow {
  id: string
  name: string
  path: string
  kind: string
  entry_path: string | null
  color: string | null
  branch: string | null
  last_opened_at: string | null
  pinned: number
  sort_index: number
  created_at: string
}

const isGoalColor = (value: unknown): value is GoalColor =>
  typeof value === 'string' && (GOAL_COLORS as readonly string[]).includes(value)

/** An unrecognised kind reads as code — the behaviour that needs no extra data. */
const asKind = (value: string): ProjectKind =>
  (PROJECT_KINDS as readonly string[]).includes(value)
    ? (value as ProjectKind)
    : 'code'

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
    kind: asKind(r.kind),
    entryPath: r.entry_path,
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
  kind?: ProjectKind
  entryPath?: string | null
}

export function insert(db: Db, input: NewProjectRow): ProjectRow {
  const id = randomUUID()
  const kind = input.kind ?? 'code'
  db.prepare(
    `INSERT INTO projects
       (id, name, path, kind, entry_path, color, branch, last_opened_at,
        pinned, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
  ).run(
    id,
    input.name,
    input.path,
    kind,
    input.entryPath ?? null,
    input.color ?? nextColor(db),
    input.branch,
    nextSortIndex(db, kind),
    new Date().toISOString()
  )
  return getRow(db, id) as ProjectRow
}

/** Per kind, because each tab in the panel orders itself independently. */
function nextSortIndex(db: Db, kind: ProjectKind): number {
  const r = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM projects WHERE kind = ?`
    )
    .get(kind)
  return r?.next ?? 0
}

export function setEntryPath(db: Db, id: string, entryPath: string | null): void {
  db.prepare(`UPDATE projects SET entry_path = ? WHERE id = ?`).run(entryPath, id)
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
  const rows = listRows(db)
  const kindOf = new Map(rows.map((r) => [r.id, asKind(r.kind)]))
  const stmt = db.prepare(`UPDATE projects SET sort_index = ? WHERE id = ?`)

  db.transaction(() => {
    // A counter per kind. The panel shows one kind at a time and reorders only
    // what it can see, so a drag in Code must not renumber Creative — and two
    // kinds sharing one counter would mean every drag on one tab churned the
    // other's indices.
    const next = new Map<ProjectKind, number>()
    const claimed = new Set<string>()

    for (const id of orderedIds) {
      const kind = kindOf.get(id)
      if (!kind) continue
      const i = next.get(kind) ?? 0
      stmt.run(i, id)
      next.set(kind, i + 1)
      claimed.add(id)
    }

    // Whatever was not mentioned trails behind its own kind, in existing order.
    for (const row of rows) {
      if (claimed.has(row.id)) continue
      const kind = asKind(row.kind)
      const i = next.get(kind) ?? 0
      stmt.run(i, row.id)
      next.set(kind, i + 1)
    }

    renumber(db)
  })()
}

/**
 * Rewrite sort_index to be 0..n-1 in display order, within each kind.
 *
 * Called after every mutation, which is what lets `ORDER BY pinned DESC,
 * sort_index ASC` and a plain `ORDER BY sort_index ASC` agree — the invariant the
 * grid's drag reordering depends on. Per kind rather than globally, because the
 * panel's two tabs are two independent lists that merely share a table.
 */
export function renumber(db: Db): void {
  const stmt = db.prepare(`UPDATE projects SET sort_index = ? WHERE id = ?`)
  const next = new Map<ProjectKind, number>()

  for (const row of listRows(db)) {
    const kind = asKind(row.kind)
    const i = next.get(kind) ?? 0
    next.set(kind, i + 1)
    if (row.sort_index !== i) stmt.run(i, row.id)
  }
}
