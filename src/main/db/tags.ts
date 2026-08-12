import { randomUUID } from 'node:crypto'
import { matchTags, slugify } from '@shared/tag-match'
import type {
  NewTag,
  SlotTag,
  Tag,
  TagColor,
  TagOrigin,
  TagPatch
} from '@shared/types'
import { TAG_COLORS } from '@shared/types'
import type { Db } from './index'

/**
 * Tags, and which slots are filed under them.
 *
 * The invariant this file exists to hold: **a rewritten title may only ever
 * disturb the tags the app put there itself.** Auto-matching runs again on
 * every title change, so if it were allowed to rebuild the whole set, editing
 * "Ship deck" to "Ship the deck" would silently drop a tag the user attached by
 * hand. Every write path here is therefore scoped to `origin = 'auto'`.
 */

interface TagRow {
  id: string
  label: string
  slug: string
  color: string
  keywords: string
  due_weekday: number | null
  sort_index: number
  created_at: string
}

/** Same defence as the goal and sticker palettes: an unknown colour degrades. */
const isTagColor = (value: string): value is TagColor =>
  (TAG_COLORS as readonly string[]).includes(value)

/**
 * Keywords are stored as JSON. A hand-edited or truncated value is a bad
 * keyword list, not a reason to fail the read that surfaces the tag at all.
 */
function parseKeywords(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is string => typeof k === 'string' && !!k.trim())
  } catch {
    return []
  }
}

const toTag = (r: TagRow): Tag => ({
  id: r.id,
  label: r.label,
  slug: r.slug,
  color: isTagColor(r.color) ? r.color : 'amber',
  keywords: parseKeywords(r.keywords),
  dueWeekday: r.due_weekday,
  sortIndex: r.sort_index,
  createdAt: r.created_at
})

const ORDER = `ORDER BY sort_index ASC, created_at ASC`

export function listTags(db: Db): Tag[] {
  return db
    .prepare<[], TagRow>(`SELECT * FROM tags ${ORDER}`)
    .all()
    .map(toTag)
}

export function getTag(db: Db, id: string): Tag {
  const row = db
    .prepare<[string], TagRow>(`SELECT * FROM tags WHERE id = ?`)
    .get(id)
  if (!row) throw new Error(`Tag not found: ${id}`)
  return toTag(row)
}

/**
 * Slugs are unique, so a collision has to be resolved rather than thrown at the
 * user — "Amber" and "amber" are a reasonable pair of labels to want.
 */
function freeSlug(db: Db, wanted: string, exceptId?: string): string {
  const taken = db.prepare<[string, string], { id: string }>(
    `SELECT id FROM tags WHERE slug = ? AND id <> ?`
  )
  const base = wanted || 'tag'
  let slug = base
  let n = 2
  while (taken.get(slug, exceptId ?? '')) {
    slug = `${base}-${n++}`
  }
  return slug
}

function nextSortIndex(db: Db): number {
  const r = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM tags`
    )
    .get()
  return r?.next ?? 0
}

/** Lowercased, trimmed, de-duplicated. Stored exactly as the matcher reads it. */
function cleanKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of keywords) {
    const term = raw.trim().toLowerCase()
    if (!term || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

export function createTag(db: Db, input: NewTag): Tag {
  const id = randomUUID()
  const label = input.label.trim()

  db.prepare(
    `INSERT INTO tags
       (id, label, slug, color, keywords, due_weekday, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    label,
    freeSlug(db, slugify(input.slug ?? label)),
    input.color,
    JSON.stringify(cleanKeywords(input.keywords ?? [])),
    input.dueWeekday ?? null,
    input.sortIndex ?? nextSortIndex(db),
    new Date().toISOString()
  )

  return getTag(db, id)
}

export function updateTag(db: Db, id: string, patch: TagPatch): Tag {
  const sets: string[] = []
  const values: unknown[] = []

  const push = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (patch.label !== undefined) push('label', patch.label.trim())
  if (patch.slug !== undefined) push('slug', freeSlug(db, slugify(patch.slug), id))
  if (patch.color !== undefined) push('color', patch.color)
  if (patch.keywords !== undefined) {
    push('keywords', JSON.stringify(cleanKeywords(patch.keywords)))
  }
  if (patch.dueWeekday !== undefined) push('due_weekday', patch.dueWeekday)
  if (patch.sortIndex !== undefined) push('sort_index', patch.sortIndex)

  if (sets.length) {
    db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  // Editing what a tag matches has to change what it holds, or the rules and
  // the contents drift apart the moment a keyword is added. Only auto rows are
  // touched — see the note at the top of the file.
  if (patch.label !== undefined || patch.slug !== undefined || patch.keywords !== undefined) {
    rematchAll(db)
  }

  return getTag(db, id)
}

export function deleteTag(db: Db, id: string): void {
  db.prepare(`DELETE FROM tags WHERE id = ?`).run(id)
}

export function reorderTags(db: Db, orderedIds: string[]): void {
  const stmt = db.prepare(`UPDATE tags SET sort_index = ? WHERE id = ?`)
  db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, id))
  })()
}

/* --------------------------------------------------------- attachments */

interface SlotTagRow extends TagRow {
  slot_id: string
  origin: string
  matched: string | null
}

const toSlotTag = (r: SlotTagRow): SlotTag => ({
  id: r.id,
  label: r.label,
  slug: r.slug,
  color: isTagColor(r.color) ? r.color : 'amber',
  origin: r.origin as TagOrigin,
  matched: r.matched
})

const ATTACHED = `
  SELECT st.slot_id, st.origin, st.matched, t.*
    FROM slot_tags st
    JOIN tags t ON t.id = st.tag_id`

function group(rows: SlotTagRow[]): Map<string, SlotTag[]> {
  const out = new Map<string, SlotTag[]>()
  for (const row of rows) {
    const list = out.get(row.slot_id)
    if (list) list.push(toSlotTag(row))
    else out.set(row.slot_id, [toSlotTag(row)])
  }
  return out
}

/**
 * Every attachment for the slots in a date window, in one query.
 *
 * The deck reads a range of days per swipe, so this is joined on `slots.date`
 * rather than taking a list of ids — one statement with two bound parameters
 * instead of a variadic `IN (?, ?, …)` rebuilt and re-prepared per read.
 */
export function tagsForRange(
  db: Db,
  from: string,
  to: string
): Map<string, SlotTag[]> {
  return group(
    db
      .prepare<[string, string], SlotTagRow>(
        `${ATTACHED}
           JOIN slots s ON s.id = st.slot_id
          WHERE s.date BETWEEN ? AND ?
          ORDER BY t.sort_index ASC`
      )
      .all(from, to)
  )
}

/** Attachments for slots completed in an instant window — the Tracker's read. */
export function tagsForCompleted(
  db: Db,
  fromInstant: string,
  toInstant: string
): Map<string, SlotTag[]> {
  return group(
    db
      .prepare<[string, string], SlotTagRow>(
        `${ATTACHED}
           JOIN slots s ON s.id = st.slot_id
          WHERE s.status = 'done'
            AND s.completed_at >= ? AND s.completed_at < ?
          ORDER BY t.sort_index ASC`
      )
      .all(fromInstant, toInstant)
  )
}

export function tagsForSlot(db: Db, slotId: string): SlotTag[] {
  return db
    .prepare<[string], SlotTagRow>(
      `${ATTACHED} WHERE st.slot_id = ? ORDER BY t.sort_index ASC`
    )
    .all(slotId)
    .map(toSlotTag)
}

/**
 * Attach, without ever weakening an attachment that is already there.
 *
 * `manual` and `typed` outrank `auto`: a tag the user put on by hand must not
 * be relabelled as auto-matched the next time the title happens to contain its
 * keyword, because the derivation is the only thing distinguishing a decision
 * from a guess.
 */
export function attachTag(
  db: Db,
  slotId: string,
  tagId: string,
  origin: TagOrigin,
  matched: string | null = null
): void {
  db.prepare(
    `INSERT INTO slot_tags (slot_id, tag_id, origin, matched)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(slot_id, tag_id) DO UPDATE SET
       origin  = CASE WHEN excluded.origin = 'auto' THEN slot_tags.origin
                      ELSE excluded.origin END,
       matched = CASE WHEN excluded.origin = 'auto' THEN slot_tags.matched
                      ELSE excluded.matched END`
  ).run(slotId, tagId, origin, matched)
}

export function detachTag(db: Db, slotId: string, tagId: string): void {
  db.prepare(`DELETE FROM slot_tags WHERE slot_id = ? AND tag_id = ?`).run(
    slotId,
    tagId
  )
}

/**
 * Re-run the keyword rules against one slot's title.
 *
 * Auto rows are cleared first so a tag stops applying when its keyword no
 * longer appears in the title — an "amber" task renamed to something else
 * should leave the amber box. Manual and typed rows are untouched by both
 * halves.
 */
export function syncAutoTags(db: Db, slotId: string, title: string): void {
  const tags = listTags(db)
  const matches = matchTags(title, tags)

  db.transaction(() => {
    db.prepare(`DELETE FROM slot_tags WHERE slot_id = ? AND origin = 'auto'`).run(
      slotId
    )
    for (const match of matches) {
      attachTag(db, slotId, match.tagId, 'auto', match.matched)
    }
  })()
}

/**
 * Auto-match a batch of freshly-inserted slots in one pass.
 *
 * The three bulk writers — weekly seeding, curriculum materialisation and
 * rollover — build their rows with raw SQL rather than going through
 * `createSlot`, for good reasons of their own (one prepared statement reused
 * across a whole week, `INSERT OR IGNORE` against the partial unique indexes).
 * That means filing has to be handed to them explicitly; otherwise a curriculum
 * topic called "Amber automation" would be the one kind of task that never
 * reaches the amber box.
 */
export function autoTagSlots(db: Db, slotIds: readonly string[]): void {
  if (slotIds.length === 0) return

  const tags = listTags(db)
  if (tags.length === 0) return

  const read = db.prepare<[string], { title: string }>(
    `SELECT title FROM slots WHERE id = ?`
  )
  const clear = db.prepare(
    `DELETE FROM slot_tags WHERE slot_id = ? AND origin = 'auto'`
  )

  db.transaction(() => {
    for (const slotId of slotIds) {
      const row = read.get(slotId)
      if (!row) continue
      clear.run(slotId)
      for (const match of matchTags(row.title, tags)) {
        attachTag(db, slotId, match.tagId, 'auto', match.matched)
      }
    }
  })()
}

/**
 * Copy every attachment from one slot to another, origins and all.
 *
 * Rollover's use. A carried task is the *same* task on a later day, so a tag
 * the user attached by hand has to travel with it — re-running the keyword
 * rules on the copy would silently demote that decision back to whatever the
 * title happens to match.
 */
export function copyTags(db: Db, fromSlotId: string, toSlotId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO slot_tags (slot_id, tag_id, origin, matched)
     SELECT ?, tag_id, origin, matched FROM slot_tags WHERE slot_id = ?`
  ).run(toSlotId, fromSlotId)
}

/** The same pass across every slot, after a tag's matching rules change. */
export function rematchAll(db: Db): void {
  const tags = listTags(db)
  const slots = db
    .prepare<[], { id: string; title: string }>(`SELECT id, title FROM slots`)
    .all()

  const clear = db.prepare(
    `DELETE FROM slot_tags WHERE slot_id = ? AND origin = 'auto'`
  )

  db.transaction(() => {
    for (const slot of slots) {
      clear.run(slot.id)
      for (const match of matchTags(slot.title, tags)) {
        attachTag(db, slot.id, match.tagId, 'auto', match.matched)
      }
    }
  })()
}

/**
 * The tags a set of typed `#slug` tokens resolves to.
 *
 * Unknown slugs are dropped rather than created. Auto-creating a tag from a
 * typo is how you end up with `#ambr` sitting in the Tracker legend forever,
 * and the quick-add bar can only offer slugs that already exist anyway.
 */
export function resolveSlugs(db: Db, slugs: readonly string[]): Tag[] {
  if (slugs.length === 0) return []
  const stmt = db.prepare<[string], TagRow>(`SELECT * FROM tags WHERE slug = ?`)
  const out: Tag[] = []
  for (const slug of slugs) {
    const row = stmt.get(slugify(slug))
    if (row) out.push(toTag(row))
  }
  return out
}
