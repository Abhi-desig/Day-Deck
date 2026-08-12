import { randomUUID } from 'node:crypto'
import type {
  GoalColor,
  NewStoryboard,
  NewStoryFrame,
  Storyboard,
  StoryboardPatch,
  StoryFrame,
  StoryFramePatch
} from '@shared/types'
import { GOAL_COLORS } from '@shared/types'
import type { Db } from './index'

/**
 * Boards and the frames on them.
 *
 * Frames carry absolute canvas coordinates rather than an order, which is the
 * whole difference between this and a list: two frames may overlap, sit a
 * thousand pixels apart, or be arranged in a shape that means something to the
 * person who arranged them. `sort_index` exists only to break ties in stacking,
 * never to position anything.
 */

const isGoalColor = (value: string): value is GoalColor =>
  (GOAL_COLORS as readonly string[]).includes(value)

/* ----------------------------------------------------------------- boards */

interface BoardRow {
  id: string
  title: string
  project_id: string | null
  color: string
  sort_index: number
  created_at: string
}

const toBoard = (r: BoardRow): Storyboard => ({
  id: r.id,
  title: r.title,
  projectId: r.project_id,
  color: isGoalColor(r.color) ? r.color : 'amber',
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listBoards(db: Db): Storyboard[] {
  return db
    .prepare<[], BoardRow>(
      `SELECT * FROM storyboards ORDER BY sort_index ASC, created_at ASC`
    )
    .all()
    .map(toBoard)
}

export function getBoard(db: Db, id: string): Storyboard {
  const row = db
    .prepare<[string], BoardRow>(`SELECT * FROM storyboards WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Storyboard not found: ${id}`)
  return toBoard(row)
}

/**
 * Boards cycle through the goal palette as they are created, so a new segment
 * is visually distinct from its neighbours without the user picking a colour
 * first. They can still change it afterwards.
 */
function nextColor(db: Db): GoalColor {
  const r = db
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM storyboards`)
    .get()
  return GOAL_COLORS[(r?.n ?? 0) % GOAL_COLORS.length]
}

export function createBoard(db: Db, input: NewStoryboard): Storyboard {
  const id = randomUUID()
  const next = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM storyboards`
    )
    .get()

  db.prepare(
    `INSERT INTO storyboards (id, title, project_id, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    input.projectId ?? null,
    input.color ?? nextColor(db),
    next?.next ?? 0,
    new Date().toISOString()
  )

  return getBoard(db, id)
}

const BOARD_PATCH_COLUMNS: Record<keyof StoryboardPatch, string> = {
  title: 'title',
  projectId: 'project_id',
  color: 'color',
  sortIndex: 'sort_index'
}

export function updateBoard(
  db: Db,
  id: string,
  patch: StoryboardPatch
): Storyboard {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(BOARD_PATCH_COLUMNS)) {
    const value = patch[key as keyof StoryboardPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE storyboards SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getBoard(db, id)
}

/** Takes its frames with it — a board *is* its frames. ON DELETE CASCADE. */
export function deleteBoard(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboards WHERE id = ?`).run(id)
}

/* ----------------------------------------------------------------- frames */

interface FrameRow {
  id: string
  board_id: string
  title: string
  description: string
  prompt: string
  x: number
  y: number
  w: number
  h: number
  color: string
  sort_index: number
  created_at: string
}

const toFrame = (r: FrameRow): StoryFrame => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  description: r.description,
  prompt: r.prompt,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  color: isGoalColor(r.color) ? r.color : 'amber',
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listFrames(db: Db, boardId: string): StoryFrame[] {
  return db
    .prepare<[string], FrameRow>(
      `SELECT * FROM storyboard_frames
        WHERE board_id = ?
        ORDER BY sort_index ASC, created_at ASC`
    )
    .all(boardId)
    .map(toFrame)
}

export function getFrame(db: Db, id: string): StoryFrame {
  const row = db
    .prepare<[string], FrameRow>(`SELECT * FROM storyboard_frames WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Frame not found: ${id}`)
  return toFrame(row)
}

export function createFrame(db: Db, input: NewStoryFrame): StoryFrame {
  const id = randomUUID()
  const next = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM storyboard_frames WHERE board_id = ?`
    )
    .get(input.boardId)

  // A frame inherits its board's colour unless told otherwise, so a board reads
  // as one body of work rather than a bag of unrelated cards.
  const board = getBoard(db, input.boardId)

  db.prepare(
    `INSERT INTO storyboard_frames
       (id, board_id, title, description, prompt, x, y, w, h, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    (input.title ?? '').trim(),
    (input.description ?? '').trim(),
    (input.prompt ?? '').trim(),
    input.x ?? 0,
    input.y ?? 0,
    input.w ?? 280,
    input.h ?? 200,
    input.color ?? board.color,
    input.sortIndex ?? next?.next ?? 0,
    new Date().toISOString()
  )

  return getFrame(db, id)
}

const FRAME_PATCH_COLUMNS: Record<keyof StoryFramePatch, string> = {
  title: 'title',
  description: 'description',
  prompt: 'prompt',
  x: 'x',
  y: 'y',
  w: 'w',
  h: 'h',
  color: 'color',
  sortIndex: 'sort_index'
}

export function updateFrame(
  db: Db,
  id: string,
  patch: StoryFramePatch
): StoryFrame {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(FRAME_PATCH_COLUMNS)) {
    const value = patch[key as keyof StoryFramePatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    // Prompts and descriptions are multi-line, so only the ends are trimmed —
    // the internal shape of a prompt is part of the prompt.
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE storyboard_frames SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getFrame(db, id)
}

export function deleteFrame(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_frames WHERE id = ?`).run(id)
}
