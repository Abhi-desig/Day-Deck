import { randomUUID } from 'node:crypto'
import type {
  NewStoryCastNode,
  PackView,
  SheetShot,
  SheetShotKind,
  StoryCastNode
} from '@shared/types'
import { isPackView } from '@shared/types'
import type { Db } from './index'

/**
 * The two tables a character's identity lives in.
 *
 * `storyboard_sheet_shots` is every image ever generated for a character —
 * candidates and pack angles both, kept the way takes are, because a generation
 * that cost money is not thrown away by the next click. `storyboard_cast_nodes`
 * is a placement: this person, on this board's canvas, at this spot.
 *
 * The split mirrors `db/styles.ts` exactly, and for the same reason: one of
 * these answers "what has been made", the other answers "what is this film
 * locked to", and folding them together would make deleting a placement look
 * like deleting a face.
 */

/* ------------------------------------------------------------------ shots */

interface ShotRow {
  id: string
  sheet_id: string
  kind: string
  view: string
  file_name: string
  model: string
  prompt: string
  poster: string | null
  sort_index: number
  created_at: string
}

const toShot = (r: ShotRow): SheetShot => ({
  id: r.id,
  sheetId: r.sheet_id,
  kind: r.kind === 'pack' ? 'pack' : 'candidate',
  // A view this build does not know reads back as none, which files the row as
  // a candidate's worth of image rather than crashing the panel.
  view: isPackView(r.view) ? r.view : '',
  fileName: r.file_name,
  model: r.model,
  prompt: r.prompt,
  poster: r.poster,
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listShots(db: Db, sheetId: string): SheetShot[] {
  return db
    .prepare<[string], ShotRow>(
      `SELECT * FROM storyboard_sheet_shots
        WHERE sheet_id = ?
        ORDER BY sort_index ASC, created_at ASC`
    )
    .all(sheetId)
    .map(toShot)
}

export function getShot(db: Db, id: string): SheetShot {
  const row = db
    .prepare<[string], ShotRow>(
      `SELECT * FROM storyboard_sheet_shots WHERE id = ?`
    )
    .get(id)
  if (!row) throw new Error(`Character image not found: ${id}`)
  return toShot(row)
}

export interface NewSheetShot {
  /** Minted by the caller before the file is written, so the name is the id. */
  id: string
  sheetId: string
  kind: SheetShotKind
  view: PackView | ''
  fileName: string
  model: string
  prompt: string
  poster?: string | null
}

export function createShot(db: Db, input: NewSheetShot): SheetShot {
  const next = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM storyboard_sheet_shots WHERE sheet_id = ?`
    )
    .get(input.sheetId)

  db.prepare(
    `INSERT INTO storyboard_sheet_shots
       (id, sheet_id, kind, view, file_name, model, prompt, poster,
        sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.sheetId,
    input.kind,
    input.view,
    input.fileName,
    input.model,
    input.prompt,
    input.poster ?? null,
    next?.next ?? 0,
    new Date().toISOString()
  )

  return getShot(db, input.id)
}

export function deleteShot(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_sheet_shots WHERE id = ?`).run(id)
}

/**
 * Which pack views this character already has.
 *
 * This is the pack's progress, and it is a query rather than a job row on
 * purpose. Video needed a row because the provider's operation name is the only
 * handle on work already paid for and not yet delivered; an image call is
 * request/response — it either returned bytes or it did not. So "what is left"
 * is `PACK_VIEWS` minus what is here, and there is no second record of progress
 * that could disagree with the files.
 */
export function packViewsPresent(db: Db, sheetId: string): Set<string> {
  const rows = db
    .prepare<[string], { view: string }>(
      `SELECT view FROM storyboard_sheet_shots
        WHERE sheet_id = ? AND kind = 'pack'`
    )
    .all(sheetId)
  return new Set(rows.map((r) => r.view))
}

/** Every locked sheet whose pack is short, for the startup resume. */
export function sheetsWithIncompletePack(
  db: Db,
  totalViews: number
): string[] {
  return db
    .prepare<[number], { id: string }>(
      `SELECT s.id FROM storyboard_sheets s
        WHERE s.status = 'locked'
          AND s.portrait_id IS NOT NULL
          AND (
            SELECT COUNT(*) FROM storyboard_sheet_shots x
             WHERE x.sheet_id = s.id AND x.kind = 'pack'
          ) < ?
        ORDER BY s.created_at ASC`
    )
    .all(totalViews)
    .map((r) => r.id)
}

/** Every shot file name with a row behind it, for the orphan sweep. */
export function allShotFileNames(db: Db): Set<string> {
  const rows = db
    .prepare<[], { file_name: string }>(
      `SELECT file_name FROM storyboard_sheet_shots`
    )
    .all()
  return new Set(rows.map((r) => r.file_name))
}

/**
 * Approving a portrait, as one transaction.
 *
 * The only call that makes a character real, and the whole of what approval
 * writes: a pointer and a status. The images were already on disk and already
 * had rows — what the user is approving is *which one is them*, which is the
 * same shape as `StoryFrame.isFinal` against `StoryTake.chosen`.
 */
export function approvePortrait(
  db: Db,
  sheetId: string,
  shotId: string
): void {
  const apply = db.transaction(() => {
    const shot = db
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM storyboard_sheet_shots WHERE id = ? AND sheet_id = ?`
      )
      .get(shotId, sheetId)
    if (!shot) {
      throw new Error('That image does not belong to this character.')
    }

    db.prepare(
      `UPDATE storyboard_sheets
          SET portrait_id = ?, status = 'locked', locked_at = ?
        WHERE id = ?`
    ).run(shotId, new Date().toISOString(), sheetId)
  })

  apply()
}

/** Back to described. Keeps every image, clears the pointer. */
export function unlockSheet(db: Db, sheetId: string): void {
  db.prepare(
    `UPDATE storyboard_sheets
        SET portrait_id = NULL, status = 'described', locked_at = NULL
      WHERE id = ?`
  ).run(sheetId)
}

/** Mark that a candidate exists, without claiming which one is them. */
export function markProposed(db: Db, sheetId: string): void {
  db.prepare(
    `UPDATE storyboard_sheets SET status = 'proposed'
      WHERE id = ? AND status = 'described'`
  ).run(sheetId)
}

/* ------------------------------------------------------------ placements */

interface CastNodeRow {
  id: string
  board_id: string
  sheet_id: string
  x: number
  y: number
  created_at: string
}

const toCastNode = (r: CastNodeRow): StoryCastNode => ({
  id: r.id,
  boardId: r.board_id,
  sheetId: r.sheet_id,
  x: r.x,
  y: r.y,
  createdAt: r.created_at
})

export function listCastNodes(db: Db, boardId: string): StoryCastNode[] {
  return db
    .prepare<[string], CastNodeRow>(
      `SELECT * FROM storyboard_cast_nodes
        WHERE board_id = ? ORDER BY created_at ASC`
    )
    .all(boardId)
    .map(toCastNode)
}

export function getCastNode(db: Db, id: string): StoryCastNode {
  const row = db
    .prepare<[string], CastNodeRow>(
      `SELECT * FROM storyboard_cast_nodes WHERE id = ?`
    )
    .get(id)
  if (!row) throw new Error(`Character placement not found: ${id}`)
  return toCastNode(row)
}

/**
 * Placing a character is idempotent per board.
 *
 * Dropping the same person twice is the same statement made twice. The second
 * drop moves the existing node rather than creating a duplicate that would
 * attach a second identical wire to the brief — the rule `placeStyle` already
 * follows, enforced by a UNIQUE index either way.
 */
export function placeCast(db: Db, input: NewStoryCastNode): StoryCastNode {
  const existing = db
    .prepare<[string, string], CastNodeRow>(
      `SELECT * FROM storyboard_cast_nodes WHERE board_id = ? AND sheet_id = ?`
    )
    .get(input.boardId, input.sheetId)

  if (existing) {
    db.prepare(`UPDATE storyboard_cast_nodes SET x = ?, y = ? WHERE id = ?`).run(
      input.x ?? existing.x,
      input.y ?? existing.y,
      existing.id
    )
    return getCastNode(db, existing.id)
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO storyboard_cast_nodes (id, board_id, sheet_id, x, y, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    input.sheetId,
    input.x ?? 0,
    input.y ?? 0,
    new Date().toISOString()
  )
  return getCastNode(db, id)
}

export function moveCastNode(
  db: Db,
  id: string,
  x: number,
  y: number
): StoryCastNode {
  db.prepare(`UPDATE storyboard_cast_nodes SET x = ?, y = ? WHERE id = ?`).run(
    Math.round(x),
    Math.round(y),
    id
  )
  return getCastNode(db, id)
}

/** Takes the character off this board. The sheet and its images survive. */
export function removeCastNode(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_cast_nodes WHERE id = ?`).run(id)
}
