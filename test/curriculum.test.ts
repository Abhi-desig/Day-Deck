import { beforeEach, describe, expect, it, vi } from 'vitest'
// Type-only, so it is erased before the electron mock matters.
import type { TestDb } from './helpers'

// services/curriculum pulls in secrets.ts, which imports electron at module
// scope. Reflow itself never touches the keychain, so a stub is enough to let
// the interesting code run under vitest.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const repo = await import('../src/main/db/curriculum')
const { previewReflow, commitReflow } = await import(
  '../src/main/services/curriculum'
)
const { makeDb, rows } = await import('./helpers')

const INPUT = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing. Generative type.',
  deadline: '2026-08-31',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

const drafts = (n: number, est = 60) =>
  Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    module: null,
    title: `Topic ${i + 1}`,
    detail: null,
    estMinutes: est
  }))

/** A real tombstoned predecessor for `rolled_from` to point at. */
let tombstoneSeq = 0
function makeTombstone(db: TestDb): string {
  const id = `tombstone-${++tombstoneSeq}`
  db.prepare(
    `INSERT INTO slots (id, date, duration_min, title, source, category, status, sort_index, created_at)
     VALUES (?, '2026-08-09', 60, 'Carried', 'manual', 'personal_learning', 'rolled', 0, ?)`
  ).run(id, new Date().toISOString())
  return id
}

function makePlan(db: TestDb, count = 5, startDate = '2026-08-10') {
  const curriculum = repo.create(db, INPUT, startDate)
  const topics = repo.replaceTopics(db, curriculum.id, drafts(count))
  repo.applyAssignments(
    db,
    topics.map((t, i) => ({
      topicId: t.id,
      date: `2026-08-${String(10 + i).padStart(2, '0')}`
    }))
  )
  return { curriculum, topics: repo.listTopics(db, curriculum.id) }
}

describe('curriculum slot materialisation', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('projects each assigned pending topic onto its day', () => {
    const { curriculum } = makePlan(db, 3)

    expect(repo.materialise(db, curriculum.id)).toBe(3)

    const slots = rows(db) as Array<Record<string, unknown>>
    expect(slots).toHaveLength(3)
    expect(slots.map((s) => s.date)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12'
    ])
    expect(slots.every((s) => s.source === 'curriculum')).toBe(true)
    expect(slots.every((s) => s.category === 'personal_learning')).toBe(true)
  })

  it('is idempotent — reconciling twice creates nothing new', () => {
    const { curriculum } = makePlan(db, 4)

    repo.materialise(db, curriculum.id)
    expect(repo.materialise(db, curriculum.id)).toBe(0)
    expect(repo.materialise(db, curriculum.id)).toBe(0)
    expect(rows(db)).toHaveLength(4)
  })

  it('moves the slot when a topic is reassigned', () => {
    const { curriculum, topics } = makePlan(db, 3)
    repo.materialise(db, curriculum.id)

    repo.applyAssignments(db, [{ topicId: topics[0].id, date: '2026-08-20' }])
    repo.materialise(db, curriculum.id)

    const slots = rows(db) as Array<Record<string, unknown>>
    expect(slots).toHaveLength(3)
    expect(slots.find((s) => s.source_ref === topics[0].id)?.date).toBe(
      '2026-08-20'
    )
    expect(rows(db, '2026-08-10')).toHaveLength(0)
  })

  /** The one thing reconciliation must never do. */
  it('never deletes a slot the user already completed', () => {
    const { curriculum, topics } = makePlan(db, 3)
    repo.materialise(db, curriculum.id)

    db.prepare(`UPDATE slots SET status = 'done' WHERE source_ref = ?`).run(
      topics[0].id
    )
    repo.syncTopicStatus(db, topics[0].id, 'done')

    // Reassign it somewhere else entirely and reconcile.
    repo.applyAssignments(db, [{ topicId: topics[0].id, date: '2026-08-25' }])
    repo.materialise(db, curriculum.id)

    const done = db
      .prepare(`SELECT * FROM slots WHERE status = 'done'`)
      .all() as Array<Record<string, unknown>>
    expect(done).toHaveLength(1)
    expect(done[0].date).toBe('2026-08-10')
  })

  it('leaves carried-forward slots alone', () => {
    const { curriculum, topics } = makePlan(db, 2)
    repo.materialise(db, curriculum.id)

    // Simulate rollover having carried topic 1 to a later day. rolled_from is
    // a real foreign key, so the tombstone it points at has to exist.
    const tombstone = makeTombstone(db)
    db.prepare(
      `UPDATE slots SET date = '2026-08-15', rolled_from = ?, roll_count = 1
        WHERE source_ref = ?`
    ).run(tombstone, topics[0].id)

    repo.materialise(db, curriculum.id)

    const carried = db
      .prepare(`SELECT * FROM slots WHERE source_ref = ?`)
      .all(topics[0].id) as Array<Record<string, unknown>>
    expect(carried).toHaveLength(1)
    expect(carried[0].date).toBe('2026-08-15')
  })

  it('points topics back at wherever rollover moved their slot', () => {
    const { curriculum, topics } = makePlan(db, 2)
    repo.materialise(db, curriculum.id)

    const tombstone = makeTombstone(db)
    db.prepare(
      `UPDATE slots SET date = '2026-08-18', rolled_from = ?, roll_count = 1
        WHERE source_ref = ?`
    ).run(tombstone, topics[0].id)

    repo.syncTopicsToSlots(db)

    const updated = repo.listTopics(db, curriculum.id)
    expect(updated.find((t) => t.id === topics[0].id)?.assignedDate).toBe(
      '2026-08-18'
    )
    // And a reconcile after the sync must not duplicate it.
    expect(repo.materialise(db, curriculum.id)).toBe(0)
  })

  it('maps slot status onto topic status, ignoring rollover', () => {
    const { curriculum, topics } = makePlan(db, 3)

    repo.syncTopicStatus(db, topics[0].id, 'done')
    repo.syncTopicStatus(db, topics[1].id, 'skipped')
    repo.syncTopicStatus(db, topics[2].id, 'rolled')

    const after = repo.listTopics(db, curriculum.id)
    expect(after[0].status).toBe('done')
    expect(after[1].status).toBe('skipped')
    expect(after[2].status).toBe('pending')
  })

  it('archiving clears unstarted work but keeps finished history', () => {
    const { curriculum, topics } = makePlan(db, 3)
    repo.materialise(db, curriculum.id)

    db.prepare(`UPDATE slots SET status = 'done' WHERE source_ref = ?`).run(
      topics[0].id
    )

    repo.archive(db, curriculum.id)

    const left = rows(db) as Array<Record<string, unknown>>
    expect(left).toHaveLength(1)
    expect(left[0].status).toBe('done')
    expect(repo.getActive(db)).toBeNull()
  })
})

describe('reflow', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('returns null for a goal that does not exist', () => {
    expect(previewReflow(db, 'no-such-goal', '2026-08-10')).toBeNull()
    expect(commitReflow(db, 'no-such-goal', '2026-08-10')).toBeNull()
  })

  it('returns null for a goal that has been archived', () => {
    const { curriculum } = makePlan(db, 3)
    repo.archive(db, curriculum.id)

    expect(previewReflow(db, curriculum.id, '2026-08-20')).toBeNull()
    expect(commitReflow(db, curriculum.id, '2026-08-20')).toBeNull()
  })

  it('redistributes what is left across the days that remain', () => {
    const { curriculum, topics } = makePlan(db, 5)
    repo.materialise(db, curriculum.id)

    // Two done, three missed. Reflow from a week later.
    repo.syncTopicStatus(db, topics[0].id, 'done')
    repo.syncTopicStatus(db, topics[1].id, 'done')

    const preview = previewReflow(db, curriculum.id, '2026-08-20')
    expect(preview).not.toBeNull()
    expect(preview!.changes).toHaveLength(3)
    // Everything still lands on or before the deadline.
    expect(preview!.summary.lastDate).toBe('2026-08-31')
    for (const change of preview!.changes) {
      expect(change.to >= '2026-08-20').toBe(true)
    }
  })

  it('previewing writes nothing', () => {
    const { curriculum, topics } = makePlan(db, 4)
    repo.materialise(db, curriculum.id)
    const before = repo.listTopics(db, curriculum.id).map((t) => t.assignedDate)

    previewReflow(db, curriculum.id, '2026-08-20')

    expect(repo.listTopics(db, curriculum.id).map((t) => t.assignedDate)).toEqual(
      before
    )
    expect(rows(db)).toHaveLength(4)
    expect(topics).toHaveLength(4)
  })

  it('committing applies the dates and rebuilds the day cards', () => {
    const { curriculum } = makePlan(db, 4)
    repo.materialise(db, curriculum.id)

    const plan = commitReflow(db, curriculum.id, '2026-08-20')

    expect(plan).not.toBeNull()
    const dates = repo
      .listTopics(db, curriculum.id)
      .map((t) => t.assignedDate ?? '')
    expect(dates.every((d) => d >= '2026-08-20')).toBe(true)

    const slots = rows(db) as Array<Record<string, unknown>>
    expect(slots).toHaveLength(4)
    expect(
      slots.every((s) => String(s.date) >= '2026-08-20')
    ).toBe(true)
  })

  it('reports over-capacity rather than silently dropping topics', () => {
    const { curriculum } = makePlan(db, 20, '2026-08-10')
    repo.materialise(db, curriculum.id)

    // 20 hour-long topics with two days left.
    const preview = previewReflow(db, curriculum.id, '2026-08-30')

    expect(preview!.summary.overCapacity).toBe(true)
    expect(preview!.changes.length).toBeGreaterThan(0)
    expect(preview!.summary.totalTopics).toBe(20)
  })
})
