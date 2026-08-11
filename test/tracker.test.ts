import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const { week, pace } = await import('../src/main/services/tracker')
const repo = await import('../src/main/db/curriculum')
const { makeDb } = await import('./helpers')

/**
 * Week of Mon 10 Aug 2026 – Sun 16 Aug 2026.
 *   Mon 10 · Tue 11 · Wed 12 · Thu 13 · Fri 14 · Sat 15 · Sun 16
 */
const MONDAY = '2026-08-10'

/**
 * A completion instant expressed in *local* time, then stored the way the app
 * stores it — as a UTC ISO string. Building it this way is what makes these
 * tests timezone-agnostic: whatever offset the machine is on, `local(12, 23, 30)`
 * is half past eleven at night on the 12th to the person using the app.
 */
function local(day: number, hour: number, minute = 0): string {
  return new Date(2026, 7, day, hour, minute).toISOString()
}

let seq = 0

function done(
  db: TestDb,
  opts: {
    completedAt: string
    /** The day it was *planned* for — deliberately different from completion. */
    plannedOn?: string
    category?: string
    durationMin?: number
    title?: string
  }
): void {
  db.prepare(
    `INSERT INTO slots
       (id, date, start_min, duration_min, title, source, source_ref,
        category, status, sort_index, completed_at, created_at)
     VALUES (?, ?, NULL, ?, ?, 'manual', NULL, ?, 'done', 0, ?, ?)`
  ).run(
    `slot-${++seq}`,
    opts.plannedOn ?? '2026-08-01',
    opts.durationMin ?? 30,
    opts.title ?? `Task ${seq}`,
    opts.category ?? 'personal_learning',
    opts.completedAt,
    new Date().toISOString()
  )
}

const GOAL = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing.',
  deadline: '2026-08-31',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

describe('tracker week', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('always returns seven days, Monday first', () => {
    const result = week(db, '2026-08-13')

    expect(result.weekStart).toBe(MONDAY)
    expect(result.days).toHaveLength(7)
    expect(result.days[0].date).toBe(MONDAY)
    expect(result.days[6].date).toBe('2026-08-16')
    expect(result.totalCount).toBe(0)
  })

  it('accepts any day of the week as the anchor', () => {
    for (const anchor of ['2026-08-10', '2026-08-13', '2026-08-16']) {
      expect(week(db, anchor).weekStart).toBe(MONDAY)
    }
  })

  /** The single most important thing this file asserts. */
  it('buckets on the day it was completed, not the day it was planned for', () => {
    done(db, { plannedOn: '2026-08-10', completedAt: local(13, 9) })

    const result = week(db, MONDAY)

    expect(result.days[0].total).toBe(0) // Monday, where it was planned
    expect(result.days[3].total).toBe(1) // Thursday, where it was finished
    expect(result.entries[0].doneOn).toBe('2026-08-13')
  })

  /**
   * completed_at is a UTC instant and the buckets are local days, so a
   * completion near either end of the day lands on a different UTC date in most
   * of the world. Both of these are the 12th to the user, whatever the offset.
   */
  it('buckets by local day even when UTC disagrees', () => {
    done(db, { completedAt: local(12, 0, 30), title: 'Early' })
    done(db, { completedAt: local(12, 23, 30), title: 'Late' })

    const result = week(db, MONDAY)

    expect(result.days[2].total).toBe(2)
    expect(result.entries.map((e) => e.doneOn)).toEqual([
      '2026-08-12',
      '2026-08-12'
    ])
  })

  it('keeps a late Sunday finish inside its own week', () => {
    done(db, { completedAt: local(16, 23, 30), title: 'Sunday night' })
    done(db, { completedAt: local(17, 0, 30), title: 'Monday small hours' })

    const thisWeek = week(db, MONDAY)
    const nextWeek = week(db, '2026-08-17')

    expect(thisWeek.days[6].total).toBe(1)
    expect(thisWeek.entries[0].title).toBe('Sunday night')
    expect(nextWeek.days[0].total).toBe(1)
    expect(nextWeek.entries[0].title).toBe('Monday small hours')
  })

  it('splits counts and minutes across the three categories', () => {
    done(db, { completedAt: local(10, 9), category: 'vibe_code', durationMin: 60 })
    done(db, { completedAt: local(10, 11), category: 'amber', durationMin: 45 })
    done(db, {
      completedAt: local(11, 9),
      category: 'personal_learning',
      durationMin: 90
    })
    done(db, { completedAt: local(11, 14), category: 'vibe_code', durationMin: 30 })

    const result = week(db, MONDAY)

    expect(result.totals).toEqual({
      vibe_code: 2,
      amber: 1,
      personal_learning: 1
    })
    expect(result.minutes).toEqual({
      vibe_code: 90,
      amber: 45,
      personal_learning: 90
    })
    expect(result.totalCount).toBe(4)
    expect(result.totalMinutes).toBe(225)

    expect(result.days[0].counts.vibe_code).toBe(1)
    expect(result.days[1].counts.vibe_code).toBe(1)
    expect(result.days[1].totalMinutes).toBe(120)
  })

  it('ignores slots that are not done', () => {
    db.prepare(
      `INSERT INTO slots (id, date, duration_min, title, source, category, status, sort_index, created_at)
       VALUES ('open-1', '2026-08-12', 30, 'Still open', 'manual', 'amber', 'open', 0, ?)`
    ).run(new Date().toISOString())

    expect(week(db, MONDAY).totalCount).toBe(0)
  })

  it('ignores a done slot with no completion time rather than guessing one', () => {
    db.prepare(
      `INSERT INTO slots (id, date, duration_min, title, source, category, status, sort_index, created_at)
       VALUES ('orphan', '2026-08-12', 30, 'No timestamp', 'manual', 'amber', 'done', 0, ?)`
    ).run(new Date().toISOString())

    expect(week(db, MONDAY).totalCount).toBe(0)
  })

  it('excludes work from the weeks either side', () => {
    done(db, { completedAt: local(9, 12), title: 'Last week' })
    done(db, { completedAt: local(17, 12), title: 'Next week' })
    done(db, { completedAt: local(13, 12), title: 'This week' })

    const result = week(db, MONDAY)

    expect(result.totalCount).toBe(1)
    expect(result.entries[0].title).toBe('This week')
  })

  it('carries the owning goal onto each entry', () => {
    const curriculum = repo.create(db, GOAL, MONDAY)
    const [topic] = repo.replaceTopics(db, curriculum.id, [
      { seq: 1, module: null, title: 'Shaders', detail: null, estMinutes: 60 }
    ])
    db.prepare(
      `INSERT INTO slots
         (id, date, duration_min, title, source, source_ref, category, status,
          sort_index, completed_at, created_at)
       VALUES ('cur-1', '2026-08-12', 60, 'Shaders', 'curriculum', ?,
               'personal_learning', 'done', 0, ?, ?)`
    ).run(topic.id, local(12, 10), new Date().toISOString())

    const [entry] = week(db, MONDAY).entries

    expect(entry.sourceLabel).toBe('Become a Creative Technologist')
    expect(entry.sourceColor).toBe(curriculum.color)
  })
})

describe('pace', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  function plan(dates: Array<{ date: string; status: string }>) {
    const curriculum = repo.create(db, GOAL, MONDAY)
    const topics = repo.replaceTopics(
      db,
      curriculum.id,
      dates.map((_, i) => ({
        seq: i + 1,
        module: null,
        title: `Topic ${i + 1}`,
        detail: null,
        estMinutes: 60
      }))
    )
    topics.forEach((t, i) => {
      db.prepare(`UPDATE topics SET assigned_date = ?, status = ? WHERE id = ?`).run(
        dates[i].date,
        dates[i].status,
        t.id
      )
    })
    return curriculum
  }

  it('stays quiet when there are no goals at all', () => {
    expect(pace(db, '2026-08-13')).toEqual({
      behind: 0,
      done: 0,
      total: 0,
      onPace: true,
      hasGoals: false
    })
  })

  it('counts only topics whose day has already passed', () => {
    plan([
      { date: '2026-08-10', status: 'pending' }, // overdue
      { date: '2026-08-11', status: 'pending' }, // overdue
      { date: '2026-08-13', status: 'pending' }, // today — not late yet
      { date: '2026-08-15', status: 'pending' } // future
    ])

    const result = pace(db, '2026-08-13')

    expect(result.behind).toBe(2)
    expect(result.onPace).toBe(false)
    expect(result.hasGoals).toBe(true)
  })

  it('is on pace when everything overdue is finished', () => {
    plan([
      { date: '2026-08-10', status: 'done' },
      { date: '2026-08-11', status: 'done' },
      { date: '2026-08-15', status: 'pending' }
    ])

    const result = pace(db, '2026-08-13')

    expect(result.behind).toBe(0)
    expect(result.done).toBe(2)
    expect(result.total).toBe(3)
    expect(result.onPace).toBe(true)
  })

  /** Skipping is a decision, not a debt. */
  it('does not count a skipped topic as being behind', () => {
    plan([
      { date: '2026-08-10', status: 'skipped' },
      { date: '2026-08-11', status: 'done' }
    ])

    expect(pace(db, '2026-08-13').behind).toBe(0)
  })

  /** Archiving is the decision to stop owing the work. */
  it('ignores archived goals entirely', () => {
    const curriculum = plan([
      { date: '2026-08-10', status: 'pending' },
      { date: '2026-08-11', status: 'pending' }
    ])

    expect(pace(db, '2026-08-13').behind).toBe(2)

    repo.archive(db, curriculum.id)

    expect(pace(db, '2026-08-13')).toMatchObject({
      behind: 0,
      total: 0,
      hasGoals: false
    })
  })
})
