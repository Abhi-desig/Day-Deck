import { randomUUID } from 'node:crypto'
import type { Db } from './index'

/**
 * Folders in the Project Panel.
 *
 * The row is a pointer, not the folder. `rel_path` is relative to the project
 * root and the real directory on disk is the thing that actually holds files — so
 * this table can go stale, and the service layer answers `missing` and `fileCount`
 * by looking rather than by trusting.
 *
 * Kept as a repository of plain row functions, matching db/projects.ts, so it is
 * testable without a filesystem.
 */

export interface FolderRow {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  rel_path: string
  sort_index: number
  created_at: string
}

export function listRows(db: Db, projectId: string): FolderRow[] {
  return db
    .prepare<[string], FolderRow>(
      `SELECT * FROM project_folders
        WHERE project_id = ?
        ORDER BY sort_index ASC, created_at ASC`
    )
    .all(projectId)
}

export function getRow(db: Db, id: string): FolderRow | null {
  return (
    db
      .prepare<[string], FolderRow>(`SELECT * FROM project_folders WHERE id = ?`)
      .get(id) ?? null
  )
}

export function findByRelPath(
  db: Db,
  projectId: string,
  relPath: string
): FolderRow | null {
  return (
    db
      .prepare<[string, string], FolderRow>(
        `SELECT * FROM project_folders WHERE project_id = ? AND rel_path = ?`
      )
      .get(projectId, relPath) ?? null
  )
}

export interface NewFolderRow {
  projectId: string
  parentId: string | null
  name: string
  relPath: string
}

export function insert(db: Db, input: NewFolderRow): FolderRow {
  const id = randomUUID()
  const next = db
    .prepare<[string, string | null], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM project_folders
        WHERE project_id = ? AND parent_id IS ?`
    )
    .get(input.projectId, input.parentId)

  db.prepare(
    `INSERT INTO project_folders
       (id, project_id, parent_id, name, rel_path, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.parentId,
    input.name,
    input.relPath,
    next?.next ?? 0,
    new Date().toISOString()
  )

  return getRow(db, id) as FolderRow
}

export function rename(db: Db, id: string, name: string, relPath: string): void {
  db.prepare(`UPDATE project_folders SET name = ?, rel_path = ? WHERE id = ?`).run(
    name,
    relPath,
    id
  )
}

/**
 * Forgets the folder. Does not touch the directory.
 *
 * Deliberate: this app did not create most of what is in there and deleting a
 * directory full of somebody's footage because they tidied a panel is not a trade
 * worth offering. Children go, because a child's row is meaningless without its
 * parent's — CASCADE handles that.
 */
export function remove(db: Db, id: string): void {
  db.prepare(`DELETE FROM project_folders WHERE id = ?`).run(id)
}

/** Every descendant row of a folder, including deeper ones. */
export function descendants(db: Db, id: string): FolderRow[] {
  return db
    .prepare<[string, string], FolderRow>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM project_folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM project_folders f JOIN tree t ON f.parent_id = t.id
       )
       SELECT f.* FROM project_folders f
         JOIN tree t ON t.id = f.id
        WHERE f.id != ?`
    )
    .all(id, id)
}
