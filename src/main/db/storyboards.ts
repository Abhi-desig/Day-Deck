import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type {
  GoalColor,
  MediaKind,
  NewStoryboard,
  NewStoryFrame,
  NewStoryList,
  NewStoryListItem,
  Storyboard,
  StoryboardPatch,
  StoryBriefRef,
  StoryFrame,
  StoryFramePatch,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  StoryListPatch,
  StoryListItemPatch
} from '@shared/types'
import { FRAME_H, FRAME_W, GOAL_COLORS } from '@shared/types'
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
  brief: string
  visual_style: string
  color: string
  sort_index: number
  created_at: string
}

const toBoard = (r: BoardRow): Storyboard => ({
  id: r.id,
  title: r.title,
  projectId: r.project_id,
  brief: r.brief,
  visualStyle: r.visual_style,
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
  brief: 'brief',
  visualStyle: 'visual_style',
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
  duration_sec: number | null
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
  durationSec: r.duration_sec,
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
       (id, board_id, title, description, prompt, x, y, w, h, duration_sec,
        color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    (input.title ?? '').trim(),
    (input.description ?? '').trim(),
    (input.prompt ?? '').trim(),
    input.x ?? 0,
    input.y ?? 0,
    // Matches what the canvas actually creates. These used to disagree with the
    // column defaults, which was harmless only while every frame came from a
    // double-click; the moment the planner creates frames it would not be.
    input.w ?? FRAME_W,
    input.h ?? FRAME_H,
    input.durationSec ?? null,
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
  durationSec: 'duration_sec',
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

/* ------------------------------------------------------------------ lists */

interface ListRow {
  id: string
  board_id: string
  title: string
  x: number
  y: number
  w: number
  h: number
  color: string
  sort_index: number
  created_at: string
}

const toList = (r: ListRow): StoryList => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  color: isGoalColor(r.color) ? r.color : 'amber',
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listLists(db: Db, boardId: string): StoryList[] {
  return db
    .prepare<[string], ListRow>(
      `SELECT * FROM storyboard_lists
        WHERE board_id = ?
        ORDER BY sort_index ASC, created_at ASC`
    )
    .all(boardId)
    .map(toList)
}

export function getList(db: Db, id: string): StoryList {
  const row = db
    .prepare<[string], ListRow>(`SELECT * FROM storyboard_lists WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Reference list not found: ${id}`)
  return toList(row)
}

export function createList(db: Db, input: NewStoryList): StoryList {
  const id = randomUUID()
  const next = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM storyboard_lists WHERE board_id = ?`
    )
    .get(input.boardId)

  const board = getBoard(db, input.boardId)

  db.prepare(
    `INSERT INTO storyboard_lists
       (id, board_id, title, x, y, w, h, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    (input.title ?? '').trim(),
    input.x ?? 0,
    input.y ?? 0,
    input.w ?? 260,
    input.h ?? 220,
    input.color ?? board.color,
    input.sortIndex ?? next?.next ?? 0,
    new Date().toISOString()
  )

  return getList(db, id)
}

const LIST_PATCH_COLUMNS: Record<keyof StoryListPatch, string> = {
  title: 'title',
  x: 'x',
  y: 'y',
  w: 'w',
  h: 'h',
  color: 'color',
  sortIndex: 'sort_index'
}

export function updateList(
  db: Db,
  id: string,
  patch: StoryListPatch
): StoryList {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(LIST_PATCH_COLUMNS)) {
    const value = patch[key as keyof StoryListPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE storyboard_lists SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getList(db, id)
}

/** Takes its items with it, and their wires with them. CASCADE both hops. */
export function deleteList(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_lists WHERE id = ?`).run(id)
}

/* ------------------------------------------------------------- list items */

interface ItemRow {
  id: string
  list_id: string
  label: string
  media_path: string | null
  media_kind: string | null
  thumb: string | null
  sort_index: number
  created_at: string
}

const isMediaKind = (value: string | null): value is MediaKind =>
  value === 'image' || value === 'video'

/**
 * `missing` is answered here rather than stored.
 *
 * The file belongs to the user, not to this app, so it can appear and disappear
 * without anything telling us. A stored flag would be a cached answer to a
 * question whose answer changes behind our back; a stat is cheap and always true
 * at the moment it is asked.
 */
function isMissing(path: string | null): boolean {
  if (!path) return false
  try {
    return !statSync(path).isFile()
  } catch {
    return true
  }
}

const toItem = (r: ItemRow): StoryListItem => ({
  id: r.id,
  listId: r.list_id,
  label: r.label,
  mediaPath: r.media_path,
  mediaKind: isMediaKind(r.media_kind) ? r.media_kind : null,
  thumb: r.thumb,
  missing: isMissing(r.media_path),
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

/** Every item on a board, in one query — the canvas needs them all at once. */
export function listItems(db: Db, boardId: string): StoryListItem[] {
  return db
    .prepare<[string], ItemRow>(
      `SELECT i.* FROM storyboard_list_items i
         JOIN storyboard_lists l ON l.id = i.list_id
        WHERE l.board_id = ?
        ORDER BY i.sort_index ASC, i.created_at ASC`
    )
    .all(boardId)
    .map(toItem)
}

export function getItem(db: Db, id: string): StoryListItem {
  const row = db
    .prepare<[string], ItemRow>(
      `SELECT * FROM storyboard_list_items WHERE id = ?`
    )
    .get(id)
  if (!row) throw new Error(`Reference item not found: ${id}`)
  return toItem(row)
}

/**
 * The path only, with no stat and no mapping.
 *
 * This is what the deck-media protocol handler asks for on every media request,
 * so it stays as small as possible: one indexed lookup, no filesystem work in a
 * path that is about to do filesystem work anyway.
 */
export function itemMediaPath(
  db: Db,
  id: string
): { path: string; kind: string | null } | null {
  const row = db
    .prepare<[string], { media_path: string | null; media_kind: string | null }>(
      `SELECT media_path, media_kind FROM storyboard_list_items WHERE id = ?`
    )
    .get(id)
  if (!row?.media_path) return null
  return { path: row.media_path, kind: row.media_kind }
}

export function createItem(db: Db, input: NewStoryListItem): StoryListItem {
  const id = randomUUID()
  const next = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next
         FROM storyboard_list_items WHERE list_id = ?`
    )
    .get(input.listId)

  db.prepare(
    `INSERT INTO storyboard_list_items
       (id, list_id, label, media_path, media_kind, thumb, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.listId,
    (input.label ?? '').trim(),
    input.mediaPath ?? null,
    input.mediaKind ?? null,
    input.thumb ?? null,
    input.sortIndex ?? next?.next ?? 0,
    new Date().toISOString()
  )

  return getItem(db, id)
}

const ITEM_PATCH_COLUMNS: Record<keyof StoryListItemPatch, string> = {
  label: 'label',
  mediaPath: 'media_path',
  mediaKind: 'media_kind',
  thumb: 'thumb',
  sortIndex: 'sort_index'
}

export function updateItem(
  db: Db,
  id: string,
  patch: StoryListItemPatch
): StoryListItem {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(ITEM_PATCH_COLUMNS)) {
    const value = patch[key as keyof StoryListItemPatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    // `thumb` is a data URI and `mediaPath` a filesystem path — trimming the ends
    // is safe for both, and nothing here is meaningfully multi-line.
    values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(
      `UPDATE storyboard_list_items SET ${sets.join(', ')} WHERE id = ?`
    ).run(...values, id)
  }

  return getItem(db, id)
}

export function deleteItem(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_list_items WHERE id = ?`).run(id)
}

/* ------------------------------------------------------------------ wires */

interface RefRow {
  frame_id: string
  item_id: string
  created_at: string
}

const toRef = (r: RefRow): StoryFrameRef => ({
  frameId: r.frame_id,
  itemId: r.item_id,
  createdAt: r.created_at
})

export function listRefs(db: Db, boardId: string): StoryFrameRef[] {
  return db
    .prepare<[string], RefRow>(
      `SELECT r.* FROM storyboard_frame_refs r
         JOIN storyboard_frames f ON f.id = r.frame_id
        WHERE f.board_id = ?
        ORDER BY r.created_at ASC`
    )
    .all(boardId)
    .map(toRef)
}

/**
 * Idempotent by design: the primary key is the pair, so re-connecting an already
 * connected item is a no-op rather than an error the UI has to pre-empt.
 */
export function createRef(
  db: Db,
  frameId: string,
  itemId: string
): StoryFrameRef {
  db.prepare(
    `INSERT OR IGNORE INTO storyboard_frame_refs (frame_id, item_id, created_at)
     VALUES (?, ?, ?)`
  ).run(frameId, itemId, new Date().toISOString())

  const row = db
    .prepare<[string, string], RefRow>(
      `SELECT * FROM storyboard_frame_refs WHERE frame_id = ? AND item_id = ?`
    )
    .get(frameId, itemId)
  if (!row) throw new Error('Could not connect that reference.')
  return toRef(row)
}

export function deleteRef(db: Db, frameId: string, itemId: string): void {
  db.prepare(
    `DELETE FROM storyboard_frame_refs WHERE frame_id = ? AND item_id = ?`
  ).run(frameId, itemId)
}

/* ------------------------------------------------------------- brief refs */

interface BriefRefRow {
  board_id: string
  item_id: string
  created_at: string
}

const toBriefRef = (r: BriefRefRow): StoryBriefRef => ({
  boardId: r.board_id,
  itemId: r.item_id,
  createdAt: r.created_at
})

export function listBriefRefs(db: Db, boardId: string): StoryBriefRef[] {
  return db
    .prepare<[string], BriefRefRow>(
      `SELECT * FROM storyboard_brief_refs
        WHERE board_id = ?
        ORDER BY created_at ASC`
    )
    .all(boardId)
    .map(toBriefRef)
}

/** Idempotent, same as createRef: the pair is the primary key. */
export function createBriefRef(
  db: Db,
  boardId: string,
  itemId: string
): StoryBriefRef {
  // The item must live on this board — a brief ref to another board's item
  // would draw a wire with one end missing on every board that shows it.
  const owner = db
    .prepare<[string], { board_id: string }>(
      `SELECT l.board_id FROM storyboard_list_items i
         JOIN storyboard_lists l ON l.id = i.list_id
        WHERE i.id = ?`
    )
    .get(itemId)
  if (!owner) throw new Error(`Reference item not found: ${itemId}`)
  if (owner.board_id !== boardId) {
    throw new Error('That reference is not on this board.')
  }

  db.prepare(
    `INSERT OR IGNORE INTO storyboard_brief_refs (board_id, item_id, created_at)
     VALUES (?, ?, ?)`
  ).run(boardId, itemId, new Date().toISOString())

  const row = db
    .prepare<[string, string], BriefRefRow>(
      `SELECT * FROM storyboard_brief_refs WHERE board_id = ? AND item_id = ?`
    )
    .get(boardId, itemId)
  if (!row) throw new Error('Could not connect that reference to the brief.')
  return toBriefRef(row)
}

export function deleteBriefRef(db: Db, boardId: string, itemId: string): void {
  db.prepare(
    `DELETE FROM storyboard_brief_refs WHERE board_id = ? AND item_id = ?`
  ).run(boardId, itemId)
}
