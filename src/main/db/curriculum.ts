import { randomUUID } from 'node:crypto'
import type { DateKey } from '@shared/date'
import { todayKey } from '@shared/date'
import type {
  Curriculum,
  CurriculumInput,
  GoalColor,
  Topic,
  TopicDraft
} from '@shared/types'
import { GOAL_COLORS } from '@shared/types'
import type { Db } from './index'
import { autoTagSlots } from './tags'

interface CurriculumRow {
  id: string
  title: string
  start_date: string
  deadline: string
  raw_text: string
  model: string
  minutes_per_day: number
  rest_days: string
  status: string
  color: string
  sort_index: number
  created_at: string
}

interface TopicRow {
  id: string
  curriculum_id: string
  seq: number
  module: string | null
  title: string
  detail: string | null
  est_minutes: number
  assigned_date: string | null
  status: string
  points: string
}

/**
 * Learning points are stored as a JSON array on the topic row. A hand-edited or
 * half-written value degrades to "not broken down yet" rather than taking the
 * day card down, which is the same defence `rest_days` gets above.
 *
 * Exported because db/slots.ts denormalises the same column onto its rows.
 */
export function parsePoints(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function toCurriculum(r: CurriculumRow): Curriculum {
  let restDays: number[] = []
  try {
    const parsed = JSON.parse(r.rest_days) as unknown
    if (Array.isArray(parsed)) restDays = parsed.filter((n) => typeof n === 'number')
  } catch {
    /* a corrupt value should not take the app down; no rest days is safe */
  }

  return {
    id: r.id,
    title: r.title,
    startDate: r.start_date,
    deadline: r.deadline,
    rawText: r.raw_text,
    model: r.model,
    minutesPerDay: r.minutes_per_day,
    restDays,
    status: r.status as Curriculum['status'],
    color: isGoalColor(r.color) ? r.color : 'amber',
    sortIndex: r.sort_index,
    createdAt: r.created_at
  }
}

const isGoalColor = (value: string): value is GoalColor =>
  (GOAL_COLORS as readonly string[]).includes(value)

const toTopic = (r: TopicRow): Topic => ({
  id: r.id,
  curriculumId: r.curriculum_id,
  seq: r.seq,
  module: r.module,
  title: r.title,
  detail: r.detail,
  estMinutes: r.est_minutes,
  assignedDate: r.assigned_date,
  status: r.status as Topic['status'],
  points: parsePoints(r.points)
})

/* ---------------------------------------------------------- curricula */

/** Every goal currently in play, in the order the user arranged them. */
export function listActive(db: Db): Curriculum[] {
  return db
    .prepare<[], CurriculumRow>(
      `SELECT * FROM curricula WHERE status = 'active'
        ORDER BY sort_index ASC, created_at ASC`
    )
    .all()
    .map(toCurriculum)
}

/**
 * The most recently created active goal. Kept for the few places that genuinely
 * mean "whatever the user is working on right now" — it is no longer "the"
 * curriculum, because there can be several.
 */
export function getActive(db: Db): Curriculum | null {
  const row = db
    .prepare<[], CurriculumRow>(
      `SELECT * FROM curricula WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    )
    .get()
  return row ? toCurriculum(row) : null
}

/**
 * First colour no live goal has claimed. Once all five are taken it wraps —
 * duplicated colours are a cosmetic problem, refusing to create the goal is a
 * real one.
 */
export function nextColor(db: Db): GoalColor {
  const taken = new Set(listActive(db).map((c) => c.color))
  return GOAL_COLORS.find((c) => !taken.has(c)) ?? GOAL_COLORS[0]
}

function nextSortIndex(db: Db): number {
  const row = db
    .prepare<[], { next: number }>(
      `SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM curricula WHERE status = 'active'`
    )
    .get()
  return row?.next ?? 0
}

export function getById(db: Db, id: string): Curriculum | null {
  const row = db
    .prepare<[string], CurriculumRow>(`SELECT * FROM curricula WHERE id = ?`)
    .get(id)
  return row ? toCurriculum(row) : null
}

/**
 * Archiving also clears the old plan's *unstarted* work from the deck. Slots
 * that were completed stay exactly where they are — the Tracker's history is
 * not the curriculum's to rewrite.
 */
export function archive(db: Db, id: string): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM slots
        WHERE source = 'curriculum'
          AND status = 'open'
          AND source_ref IN (SELECT id FROM topics WHERE curriculum_id = ?)`
    ).run(id)
    db.prepare(`UPDATE curricula SET status = 'archived' WHERE id = ?`).run(id)
  })()
}

export function create(
  db: Db,
  input: CurriculumInput,
  startDate: DateKey = todayKey()
): Curriculum {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO curricula
       (id, title, start_date, deadline, raw_text, model, minutes_per_day,
        rest_days, status, color, sort_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    startDate,
    input.deadline,
    input.rawText,
    input.model,
    input.minutesPerDay,
    JSON.stringify([...new Set(input.restDays)].sort()),
    input.color ?? nextColor(db),
    nextSortIndex(db),
    new Date().toISOString()
  )
  const created = getById(db, id)
  if (!created) throw new Error('Curriculum vanished immediately after insert')
  return created
}

/* ------------------------------------------------------------- topics */

export function listTopics(db: Db, curriculumId: string): Topic[] {
  return db
    .prepare<[string], TopicRow>(
      `SELECT * FROM topics WHERE curriculum_id = ? ORDER BY seq ASC`
    )
    .all(curriculumId)
    .map(toTopic)
}

/** One topic by id. Used to walk from a slot's `source_ref` back to its goal. */
export function getTopic(db: Db, id: string): Topic | null {
  const row = db
    .prepare<[string], TopicRow>(`SELECT * FROM topics WHERE id = ?`)
    .get(id)
  return row ? toTopic(row) : null
}

export function listPending(db: Db, curriculumId: string): Topic[] {
  return db
    .prepare<[string], TopicRow>(
      `SELECT * FROM topics
        WHERE curriculum_id = ? AND status = 'pending'
        ORDER BY seq ASC`
    )
    .all(curriculumId)
    .map(toTopic)
}

export function replaceTopics(
  db: Db,
  curriculumId: string,
  drafts: TopicDraft[]
): Topic[] {
  const insert = db.prepare(
    `INSERT INTO topics
       (id, curriculum_id, seq, module, title, detail, est_minutes, assigned_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`
  )

  db.transaction(() => {
    db.prepare(`DELETE FROM topics WHERE curriculum_id = ?`).run(curriculumId)
    for (const d of drafts) {
      insert.run(
        randomUUID(),
        curriculumId,
        d.seq,
        d.module,
        d.title,
        d.detail,
        d.estMinutes
      )
    }
  })()

  return listTopics(db, curriculumId)
}

/**
 * Topics still waiting to be broken down.
 *
 * Only ever the ones with no points, so re-running a breakdown is cheap, is
 * safe to offer as a button, and never spends an API call re-deriving something
 * the user has already seen.
 */
export function listWithoutPoints(db: Db, curriculumId: string): Topic[] {
  return db
    .prepare<[string], TopicRow>(
      `SELECT * FROM topics
        WHERE curriculum_id = ? AND (points IS NULL OR points IN ('', '[]'))
        ORDER BY seq ASC`
    )
    .all(curriculumId)
    .map(toTopic)
}

/**
 * Write a breakdown back. Topic ids come from the model's own response, so this
 * is scoped to the curriculum being subdivided — a hallucinated or stale id
 * updates nothing rather than writing points onto some other goal's topic.
 */
export function setTopicPoints(
  db: Db,
  curriculumId: string,
  breakdowns: Array<{ topicId: string; points: string[] }>
): number {
  const stmt = db.prepare(
    `UPDATE topics SET points = ? WHERE id = ? AND curriculum_id = ?`
  )

  let updated = 0
  db.transaction(() => {
    for (const b of breakdowns) {
      const clean = b.points.map((p) => p.trim()).filter(Boolean)
      if (clean.length === 0) continue
      const info = stmt.run(JSON.stringify(clean), b.topicId, curriculumId)
      updated += info.changes
    }
  })()

  return updated
}

export function applyAssignments(
  db: Db,
  assignments: Array<{ topicId: string; date: DateKey }>
): void {
  const stmt = db.prepare(`UPDATE topics SET assigned_date = ? WHERE id = ?`)
  db.transaction(() => {
    for (const a of assignments) stmt.run(a.date, a.topicId)
  })()
}

/* -------------------------------------------------------- projection */

/**
 * Topics are the source of truth; curriculum slots are a projection of them
 * onto the deck. This reconciles the projection in two steps — drop open slots
 * whose topic has moved elsewhere, then create whatever is missing.
 *
 * Completed and carried-forward slots are never touched. Deleting a slot the
 * user already finished would silently erase it from the Tracker.
 */
export function materialise(db: Db, curriculumId: string): number {
  let created = 0
  const createdIds: string[] = []

  db.transaction(() => {
    db.prepare(
      `DELETE FROM slots
        WHERE source = 'curriculum'
          AND status = 'open'
          AND rolled_from IS NULL
          AND source_ref IN (SELECT id FROM topics WHERE curriculum_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM topics t
             WHERE t.id = slots.source_ref
               AND t.status = 'pending'
               AND t.assigned_date = slots.date
          )`
    ).run(curriculumId)

    /*
     * A pending topic gets exactly one live slot, wherever that slot currently
     * sits. Selecting purely on `assigned_date` would double-book any topic
     * rollover had already carried to another day: the carried slot is
     * protected from the delete above, and a second one would then be created
     * back on the topic's stale date.
     */
    const pending = db
      .prepare<[string], TopicRow>(
        `SELECT * FROM topics t
          WHERE t.curriculum_id = ?
            AND t.status = 'pending'
            AND t.assigned_date IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM slots s
               WHERE s.source = 'curriculum'
                 AND s.source_ref = t.id
                 AND s.status = 'open'
            )
          ORDER BY t.seq ASC`
      )
      .all(curriculumId)

    const insert = db.prepare(
      `INSERT OR IGNORE INTO slots
         (id, date, start_min, duration_min, title, note, source, source_ref,
          category, status, sort_index, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'curriculum', ?, 'personal_learning', 'open', ?, ?)`
    )
    const now = new Date().toISOString()

    for (const t of pending) {
      const id = randomUUID()
      const info = insert.run(
        id,
        t.assigned_date,
        t.est_minutes,
        t.title,
        t.detail,
        t.id,
        t.seq,
        now
      )
      if (info.changes > 0) {
        created++
        createdIds.push(id)
      }
    }
  })()

  // Topic titles go through the keyword rules like anything else, so a goal
  // about amber work lands in the amber box without being tagged by hand. Run
  // after the transaction commits, when the ids are real.
  autoTagSlots(db, createdIds)

  return created
}

/**
 * Rollover moves a curriculum slot to today without telling the topic. Left
 * alone, the next reconcile would treat the carried slot as orphaned. Pointing
 * the topic at wherever its live slot actually is keeps the two in step, and
 * means reflow plans from reality.
 */
export function syncTopicsToSlots(db: Db): void {
  db.prepare(
    `UPDATE topics
        SET assigned_date = (
          SELECT s.date FROM slots s
           WHERE s.source = 'curriculum'
             AND s.source_ref = topics.id
             AND s.status = 'open'
           ORDER BY s.date DESC
           LIMIT 1
        )
      WHERE status = 'pending'
        AND EXISTS (
          SELECT 1 FROM slots s
           WHERE s.source = 'curriculum'
             AND s.source_ref = topics.id
             AND s.status = 'open'
        )`
  ).run()
}

/** Keeps a topic's status in step when its slot is ticked off on a day card. */
export function syncTopicStatus(
  db: Db,
  topicId: string,
  slotStatus: string
): void {
  // 'rolled' is not a topic state — the work is still pending, just elsewhere.
  if (slotStatus === 'rolled') return
  const status =
    slotStatus === 'done' ? 'done' : slotStatus === 'skipped' ? 'skipped' : 'pending'
  db.prepare(`UPDATE topics SET status = ? WHERE id = ?`).run(status, topicId)
}
