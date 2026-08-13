import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import type {
  NewSticker,
  NewStickerFolder,
  Sticker,
  StickerColor,
  StickerFolder,
  StickerFolderPatch,
  StickerPatch
} from '@shared/types'
import { STICKER_COLORS } from '@shared/types'
import type { Db } from './index'

/**
 * The stickers wall.
 *
 * The table has been in the schema since v1, so nothing here needs a migration.
 * The only real decision is what "temporary" means: a temp sticker either
 * expires on a date or is pinned to a specific day card, and the launch sweep
 * in services/stickers.ts is what acts on that.
 */

interface StickerRow {
  id: string
  body: string
  color: string
  kind: string
  expires_at: string | null
  attached_date: string | null
  x: number
  y: number
  rotation: number
  created_at: string
  folder_id: string | null
}

/**
 * The column is a plain TEXT with no CHECK, and rows predating the palette
 * default to 'amber'. An unknown value degrades to butter rather than rendering
 * a note with no styling at all — same defence as db/curriculum's goal colour.
 */
const isStickerColor = (value: string): value is StickerColor =>
  (STICKER_COLORS as readonly string[]).includes(value)

const toSticker = (r: StickerRow): Sticker => ({
  id: r.id,
  body: r.body,
  color: isStickerColor(r.color) ? r.color : 'butter',
  kind: r.kind as Sticker['kind'],
  expiresAt: r.expires_at,
  attachedDate: r.attached_date,
  x: r.x,
  y: r.y,
  rotation: r.rotation,
  createdAt: r.created_at,
  folderId: r.folder_id ?? null
})

export function listStickers(db: Db): Sticker[] {
  return db
    .prepare<[], StickerRow>(`SELECT * FROM stickers ORDER BY created_at ASC`)
    .all()
    .map(toSticker)
}

/** The ones pinned to a given day, for that day's card. */
export function listForDate(db: Db, date: DateKey): Sticker[] {
  return db
    .prepare<[string], StickerRow>(
      `SELECT * FROM stickers WHERE attached_date = ? ORDER BY created_at ASC`
    )
    .all(date)
    .map(toSticker)
}

/**
 * Like `getSticker`, but a missing row is an answer rather than an exception.
 *
 * The wall can legitimately hold a note whose row has gone — the launch sweep
 * hard-deletes expired temp notes, and a backup restore wipes every table — so
 * "is this still here?" is a question the write path has to be able to ask.
 */
export function findSticker(db: Db, id: string): Sticker | null {
  const row = db
    .prepare<[string], StickerRow>(`SELECT * FROM stickers WHERE id = ?`)
    .get(id)
  return row ? toSticker(row) : null
}

export function getSticker(db: Db, id: string): Sticker {
  const sticker = findSticker(db, id)
  if (!sticker) throw new Error(`Sticker not found: ${id}`)
  return sticker
}

export function createSticker(db: Db, input: NewSticker): Sticker {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO stickers
       (id, body, color, kind, expires_at, attached_date, x, y, rotation,
        created_at, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.body.trim(),
    input.color,
    input.kind,
    input.expiresAt ?? null,
    input.attachedDate ?? null,
    input.x,
    input.y,
    input.rotation,
    new Date().toISOString(),
    input.folderId ?? null
  )
  return getSticker(db, id)
}

const PATCH_COLUMNS: Record<keyof StickerPatch, string> = {
  body: 'body',
  color: 'color',
  kind: 'kind',
  expiresAt: 'expires_at',
  attachedDate: 'attached_date',
  x: 'x',
  y: 'y',
  rotation: 'rotation',
  folderId: 'folder_id'
}

/**
 * Apply a patch, or answer `null` if the note is no longer on the wall.
 *
 * Deliberately not an error. `UPDATE ... WHERE id = ?` against a row that has
 * been swept or wiped by a restore is a silent no-op, and this used to report
 * that by re-reading through `getSticker` and throwing — which reached the
 * renderer as a raw `Error invoking remote method 'stickers:update'` banner and,
 * worse, told the store nothing it could act on. A `null` says "drop it", which
 * is the only useful answer: a note with no row throws again on every
 * subsequent drag, so the wall never recovers on its own.
 */
export function updateSticker(
  db: Db,
  id: string,
  patch: StickerPatch
): Sticker | null {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof StickerPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE stickers SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  // Re-read either way: an empty patch still has to answer whether the row is
  // there, and the row is the authority on what the trims above actually wrote.
  return findSticker(db, id)
}

export function deleteSticker(db: Db, id: string): void {
  db.prepare(`DELETE FROM stickers WHERE id = ?`).run(id)
}

/**
 * Temp stickers whose day has passed.
 *
 * Two ways to be stale, and both are strictly-before comparisons: a sticker
 * expiring *today* is still on the wall today, and one attached to today is
 * still that day's note. Permanent stickers are never eligible however old they
 * are — that is the entire meaning of the kind.
 */
export function listExpired(db: Db, today: DateKey): Sticker[] {
  return db
    .prepare<[string, string], StickerRow>(
      `SELECT * FROM stickers
        WHERE kind = 'temp'
          AND (
            (expires_at IS NOT NULL AND expires_at < ?)
            OR (expires_at IS NULL AND attached_date IS NOT NULL AND attached_date < ?)
          )
        ORDER BY created_at ASC`
    )
    .all(today, today)
    .map(toSticker)
}

export function deleteMany(db: Db, ids: string[]): number {
  if (ids.length === 0) return 0
  const stmt = db.prepare(`DELETE FROM stickers WHERE id = ?`)
  let removed = 0
  db.transaction(() => {
    for (const id of ids) removed += stmt.run(id).changes
  })()
  return removed
}

/* ---------------------------------------------------------------- folders */

interface FolderRow {
  id: string
  name: string
  color: string
  sort_index: number
  created_at: string
}

const toFolder = (r: FolderRow): StickerFolder => ({
  id: r.id,
  name: r.name,
  color: isStickerColor(r.color) ? r.color : 'butter',
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listFolders(db: Db): StickerFolder[] {
  return db
    .prepare<[], FolderRow>(
      `SELECT * FROM sticker_folders ORDER BY sort_index ASC, created_at ASC`
    )
    .all()
    .map(toFolder)
}

export function getFolder(db: Db, id: string): StickerFolder {
  const row = db
    .prepare<[string], FolderRow>(`SELECT * FROM sticker_folders WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Sticker folder not found: ${id}`)
  return toFolder(row)
}

export function createFolder(db: Db, input: NewStickerFolder): StickerFolder {
  const id = randomUUID()
  const next = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM sticker_folders`
    )
    .get()

  db.prepare(
    `INSERT INTO sticker_folders (id, name, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.name.trim(), input.color, next?.next ?? 0, new Date().toISOString())

  return getFolder(db, id)
}

const FOLDER_PATCH_COLUMNS: Record<keyof StickerFolderPatch, string> = {
  name: 'name',
  color: 'color',
  sortIndex: 'sort_index'
}

export function updateFolder(
  db: Db,
  id: string,
  patch: StickerFolderPatch
): StickerFolder {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(FOLDER_PATCH_COLUMNS)) {
    const value = patch[key as keyof StickerFolderPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE sticker_folders SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getFolder(db, id)
}

/**
 * Deleting a folder releases its notes; it does not shred them.
 *
 * The schema does this on its own via `ON DELETE SET NULL`, and it is stated
 * here as well because "delete the group" reading as "delete the notes" is the
 * kind of assumption that only gets tested once, by someone with real notes in
 * it.
 */
export function deleteFolder(db: Db, id: string): void {
  db.prepare(`DELETE FROM sticker_folders WHERE id = ?`).run(id)
}
