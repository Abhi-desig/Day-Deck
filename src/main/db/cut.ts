import { randomUUID } from 'node:crypto'
import type { CutSegmentInput, StoryCut, StoryCutSegment } from '@shared/types'
import type { Db } from './index'

/**
 * The timeline for a board, and the segments that make it up.
 *
 * The shape worth defending is that a segment names a *take* and a range, not a
 * scene. One scene can therefore appear twice, or contribute two of its takes
 * back to back, or be trimmed differently in two places — none of which a
 * "which take is in the cut" flag on the scene could express, and all of which
 * are ordinary things to want when cutting.
 */

interface CutRow {
  id: string
  board_id: string
  x: number
  y: number
  created_at: string
}

const toCut = (r: CutRow): StoryCut => ({
  id: r.id,
  boardId: r.board_id,
  x: r.x,
  y: r.y,
  createdAt: r.created_at
})

export function getCut(db: Db, boardId: string): StoryCut | null {
  const row = db
    .prepare<[string], CutRow>(
      `SELECT * FROM storyboard_cuts WHERE board_id = ?`
    )
    .get(boardId)
  return row ? toCut(row) : null
}

/**
 * The board's cut, creating it if this is the first time it has been asked for.
 *
 * Lazy rather than created with the board: most boards never reach the cut, and
 * a row per board that mostly holds two zeroes is a table that lies about how
 * many films have been assembled.
 */
export function ensureCut(
  db: Db,
  boardId: string,
  at: { x: number; y: number } = { x: 980, y: -40 },
  now = new Date().toISOString()
): StoryCut {
  const existing = getCut(db, boardId)
  if (existing) return existing

  db.prepare(
    `INSERT INTO storyboard_cuts (id, board_id, x, y, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), boardId, at.x, at.y, now)

  return getCut(db, boardId) as StoryCut
}

export function moveCut(db: Db, boardId: string, x: number, y: number): void {
  db.prepare(
    `UPDATE storyboard_cuts SET x = ?, y = ? WHERE board_id = ?`
  ).run(x, y, boardId)
}

/* -------------------------------------------------------------- segments */

interface SegmentRow {
  id: string
  cut_id: string
  take_id: string
  start_sec: number
  end_sec: number
  sort_index: number
  created_at: string
}

const toSegment = (r: SegmentRow): StoryCutSegment => ({
  id: r.id,
  cutId: r.cut_id,
  takeId: r.take_id,
  startSec: r.start_sec,
  endSec: r.end_sec,
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listSegments(db: Db, boardId: string): StoryCutSegment[] {
  return db
    .prepare<[string], SegmentRow>(
      `SELECT s.* FROM storyboard_cut_segments s
         JOIN storyboard_cuts c ON c.id = s.cut_id
        WHERE c.board_id = ?
        ORDER BY s.sort_index ASC, s.created_at ASC`
    )
    .all(boardId)
    .map(toSegment)
}

/**
 * Replace the whole segment list, in one transaction.
 *
 * Replace rather than patch, and that is the design. Reordering, trimming and
 * removing are all edits to *the list*, and expressing them as a diff would
 * mean three write paths that can each leave `sort_index` disagreeing with the
 * order on screen. One statement of what the cut now is cannot.
 */
export function replaceSegments(
  db: Db,
  boardId: string,
  segments: readonly CutSegmentInput[],
  now = new Date().toISOString()
): StoryCutSegment[] {
  const cut = ensureCut(db, boardId)

  db.transaction(() => {
    db.prepare(`DELETE FROM storyboard_cut_segments WHERE cut_id = ?`).run(
      cut.id
    )

    const insert = db.prepare(
      `INSERT INTO storyboard_cut_segments
         (id, cut_id, take_id, start_sec, end_sec, sort_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    segments.forEach((segment, index) => {
      // A zero-or-negative-length segment renders as nothing and would make
      // ffmpeg's `-t 0.000` produce an empty file that then breaks the concat.
      if (segment.endSec <= segment.startSec) return
      insert.run(
        randomUUID(),
        cut.id,
        segment.takeId,
        segment.startSec,
        segment.endSec,
        index,
        now
      )
    })
  })()

  return listSegments(db, boardId)
}

/** Total running time of the cut, in seconds. */
export const cutDuration = (segments: readonly StoryCutSegment[]): number =>
  segments.reduce((n, s) => n + Math.max(0, s.endSec - s.startSec), 0)
