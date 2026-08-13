import { randomUUID } from 'node:crypto'
import type {
  GoalColor,
  NewStoryStyleNode,
  NewVideoStyle,
  StoryStyleNode,
  StyleExtra,
  VideoStyle,
  VideoStylePatch
} from '@shared/types'
import { GOAL_COLORS } from '@shared/types'
import type { Db } from './index'

/**
 * The style library, and where a style has been placed.
 *
 * Two tables because they answer different questions. `video_styles` is a
 * library: it belongs to the user, not to a board, and survives every board that
 * ever used it. `storyboard_style_nodes` is a placement: this look, on this
 * canvas, at this spot.
 */

const isGoalColor = (value: string): value is GoalColor =>
  (GOAL_COLORS as readonly string[]).includes(value)

/* ----------------------------------------------------------------- styles */

interface StyleRow {
  id: string
  name: string
  video_style: string
  camera: string
  lens: string
  grade: string
  lighting: string
  film_stock: string
  aspect: string
  extras: string
  source_text: string
  color: string
  sort_index: number
  created_at: string
}

/**
 * Extras are stored as JSON in a text column, so a row written by a future
 * version — or hand-edited — must not be able to crash a board load. Anything
 * that is not an array of string pairs reads back as no extras at all.
 */
function parseExtras(raw: string): StyleExtra[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const { key, value } = entry as Record<string, unknown>
      if (typeof key !== 'string' || typeof value !== 'string') return []
      return [{ key, value }]
    })
  } catch {
    return []
  }
}

const toStyle = (r: StyleRow): VideoStyle => ({
  id: r.id,
  name: r.name,
  videoStyle: r.video_style,
  camera: r.camera,
  lens: r.lens,
  grade: r.grade,
  lighting: r.lighting,
  filmStock: r.film_stock,
  aspect: r.aspect,
  extras: parseExtras(r.extras),
  sourceText: r.source_text,
  color: isGoalColor(r.color) ? r.color : 'amber',
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

export function listStyles(db: Db): VideoStyle[] {
  return db
    .prepare<[], StyleRow>(
      `SELECT * FROM video_styles ORDER BY sort_index ASC, created_at ASC`
    )
    .all()
    .map(toStyle)
}

export function getStyle(db: Db, id: string): VideoStyle {
  const row = db
    .prepare<[string], StyleRow>(`SELECT * FROM video_styles WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Style not found: ${id}`)
  return toStyle(row)
}

function nextColor(db: Db): GoalColor {
  const r = db
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM video_styles`)
    .get()
  return GOAL_COLORS[(r?.n ?? 0) % GOAL_COLORS.length]
}

export function createStyle(db: Db, input: NewVideoStyle): VideoStyle {
  const id = randomUUID()
  const next = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM video_styles`
    )
    .get()

  db.prepare(
    `INSERT INTO video_styles
       (id, name, video_style, camera, lens, grade, lighting, film_stock,
        aspect, extras, source_text, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name.trim(),
    (input.videoStyle ?? '').trim(),
    (input.camera ?? '').trim(),
    (input.lens ?? '').trim(),
    (input.grade ?? '').trim(),
    (input.lighting ?? '').trim(),
    (input.filmStock ?? '').trim(),
    (input.aspect ?? '').trim(),
    JSON.stringify(input.extras ?? []),
    (input.sourceText ?? '').trim(),
    input.color ?? nextColor(db),
    input.sortIndex ?? next?.next ?? 0,
    new Date().toISOString()
  )

  return getStyle(db, id)
}

const STYLE_PATCH_COLUMNS: Record<keyof VideoStylePatch, string> = {
  name: 'name',
  videoStyle: 'video_style',
  camera: 'camera',
  lens: 'lens',
  grade: 'grade',
  lighting: 'lighting',
  filmStock: 'film_stock',
  aspect: 'aspect',
  extras: 'extras',
  sourceText: 'source_text',
  color: 'color',
  sortIndex: 'sort_index'
}

export function updateStyle(
  db: Db,
  id: string,
  patch: VideoStylePatch
): VideoStyle {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(STYLE_PATCH_COLUMNS)) {
    const value = patch[key as keyof VideoStylePatch]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    if (key === 'extras') values.push(JSON.stringify(value))
    else values.push(typeof value === 'string' ? value.trim() : value)
  }

  if (sets.length) {
    db.prepare(`UPDATE video_styles SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  }

  return getStyle(db, id)
}

/**
 * Deleting a style takes it off every board that used it.
 *
 * The placements CASCADE, which is the honest behaviour: a placement means "this
 * board looks like that style", and once the style is gone there is nothing left
 * for it to mean. The prompts it already wrote stay where they are.
 */
export function deleteStyle(db: Db, id: string): void {
  db.prepare(`DELETE FROM video_styles WHERE id = ?`).run(id)
}

/** Same look, new name — the usual way a second style gets made. */
export function duplicateStyle(db: Db, id: string): VideoStyle {
  const source = getStyle(db, id)
  return createStyle(db, {
    ...source,
    name: `${source.name} copy`,
    sortIndex: undefined
  })
}

/* ------------------------------------------------------------ placements */

interface StyleNodeRow {
  id: string
  board_id: string
  style_id: string
  x: number
  y: number
  created_at: string
}

const toStyleNode = (r: StyleNodeRow): StoryStyleNode => ({
  id: r.id,
  boardId: r.board_id,
  styleId: r.style_id,
  x: r.x,
  y: r.y,
  createdAt: r.created_at
})

export function listStyleNodes(db: Db, boardId: string): StoryStyleNode[] {
  return db
    .prepare<[string], StyleNodeRow>(
      `SELECT * FROM storyboard_style_nodes
        WHERE board_id = ? ORDER BY created_at ASC`
    )
    .all(boardId)
    .map(toStyleNode)
}

export function getStyleNode(db: Db, id: string): StoryStyleNode {
  const row = db
    .prepare<[string], StyleNodeRow>(
      `SELECT * FROM storyboard_style_nodes WHERE id = ?`
    )
    .get(id)
  if (!row) throw new Error(`Style placement not found: ${id}`)
  return toStyleNode(row)
}

/**
 * Placing a style is idempotent per board.
 *
 * Dropping the same style twice is the same statement made twice. The second drop
 * moves the existing node rather than creating a duplicate that would attach a
 * second identical wire to the brief.
 */
export function placeStyle(db: Db, input: NewStoryStyleNode): StoryStyleNode {
  const existing = db
    .prepare<[string, string], StyleNodeRow>(
      `SELECT * FROM storyboard_style_nodes WHERE board_id = ? AND style_id = ?`
    )
    .get(input.boardId, input.styleId)

  if (existing) {
    db.prepare(`UPDATE storyboard_style_nodes SET x = ?, y = ? WHERE id = ?`).run(
      input.x ?? existing.x,
      input.y ?? existing.y,
      existing.id
    )
    return getStyleNode(db, existing.id)
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO storyboard_style_nodes (id, board_id, style_id, x, y, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    input.styleId,
    input.x ?? 0,
    input.y ?? 0,
    new Date().toISOString()
  )
  return getStyleNode(db, id)
}

export function moveStyleNode(
  db: Db,
  id: string,
  x: number,
  y: number
): StoryStyleNode {
  db.prepare(`UPDATE storyboard_style_nodes SET x = ?, y = ? WHERE id = ?`).run(
    Math.round(x),
    Math.round(y),
    id
  )
  return getStyleNode(db, id)
}

/** Takes the style off this board only. The library keeps it. */
export function removeStyleNode(db: Db, id: string): void {
  db.prepare(`DELETE FROM storyboard_style_nodes WHERE id = ?`).run(id)
}
