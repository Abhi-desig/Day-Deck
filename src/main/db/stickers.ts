import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import type {
  NewSticker,
  Sticker,
  StickerColor,
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
  createdAt: r.created_at
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

export function getSticker(db: Db, id: string): Sticker {
  const row = db
    .prepare<[string], StickerRow>(`SELECT * FROM stickers WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Sticker not found: ${id}`)
  return toSticker(row)
}

export function createSticker(db: Db, input: NewSticker): Sticker {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO stickers
       (id, body, color, kind, expires_at, attached_date, x, y, rotation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    new Date().toISOString()
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
  rotation: 'rotation'
}

export function updateSticker(
  db: Db,
  id: string,
  patch: StickerPatch
): Sticker {
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

  return getSticker(db, id)
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
