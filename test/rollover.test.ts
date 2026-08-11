import { beforeEach, describe, expect, it } from 'vitest'
import { runRollover } from '../src/main/services/rollover'
import { makeDb, rows, seedSlot, type TestDb } from './helpers'

const TODAY = '2026-08-09'

describe('rollover', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('carries an unfinished past task to today and tombstones the original', () => {
    const original = seedSlot(db, { date: '2026-08-07', title: 'Ship the deck' })

    const records = runRollover(db, TODAY)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      slotId: original,
      fromDate: '2026-08-07',
      title: 'Ship the deck',
      rollCount: 1
    })

    const old = rows(db, '2026-08-07') as Array<Record<string, unknown>>
    expect(old[0].status).toBe('rolled')

    const carried = rows(db, TODAY) as Array<Record<string, unknown>>
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      title: 'Ship the deck',
      status: 'open',
      rolled_from: original,
      roll_count: 1
    })
  })

  /** The single most important property: relaunching must not duplicate work. */
  it('is idempotent across repeated runs on the same day', () => {
    seedSlot(db, { date: '2026-08-07', title: 'Ship the deck' })

    runRollover(db, TODAY)
    const second = runRollover(db, TODAY)
    const third = runRollover(db, TODAY)

    expect(second).toHaveLength(0)
    expect(third).toHaveLength(0)
    expect(rows(db, TODAY)).toHaveLength(1)
    expect(rows(db)).toHaveLength(2) // the tombstone plus one carried copy
  })

  it('increments roll_count once per day missed, not per launch', () => {
    seedSlot(db, { date: '2026-08-06', title: 'Persistent task' })

    runRollover(db, '2026-08-07')
    runRollover(db, '2026-08-07') // extra launch on the same day
    runRollover(db, '2026-08-08')
    runRollover(db, TODAY)

    const open = db
      .prepare(`SELECT * FROM slots WHERE status = 'open'`)
      .all() as Array<Record<string, unknown>>

    expect(open).toHaveLength(1)
    expect(open[0].date).toBe(TODAY)
    expect(open[0].roll_count).toBe(3)
  })

  it('leaves done and skipped work where it happened', () => {
    seedSlot(db, { date: '2026-08-07', status: 'done', title: 'Finished' })
    seedSlot(db, { date: '2026-08-07', status: 'skipped', title: 'Skipped' })

    expect(runRollover(db, TODAY)).toHaveLength(0)
    expect(rows(db, TODAY)).toHaveLength(0)
  })

  it('never rolls today or the future', () => {
    seedSlot(db, { date: TODAY, title: 'Today' })
    seedSlot(db, { date: '2026-08-11', title: 'Future' })

    expect(runRollover(db, TODAY)).toHaveLength(0)
    expect(rows(db, TODAY)).toHaveLength(1)
  })

  it('carries several days of backlog in one pass, oldest first', () => {
    seedSlot(db, { date: '2026-08-05', title: 'Oldest' })
    seedSlot(db, { date: '2026-08-06', title: 'Middle' })
    seedSlot(db, { date: '2026-08-08', title: 'Newest' })

    const records = runRollover(db, TODAY)

    expect(records.map((r) => r.title)).toEqual(['Oldest', 'Middle', 'Newest'])
    const carried = rows(db, TODAY) as Array<Record<string, unknown>>
    expect(carried.map((r) => r.title)).toEqual(['Oldest', 'Middle', 'Newest'])
  })

  it('sorts carried work above what today already holds', () => {
    seedSlot(db, { date: '2026-08-08', title: 'Carried' })
    db.prepare(
      `INSERT INTO slots (id, date, duration_min, title, source, category, status, sort_index, created_at)
       VALUES ('existing', ?, 30, 'Already here', 'manual', 'personal_learning', 'open', 0, ?)`
    ).run(TODAY, new Date().toISOString())

    runRollover(db, TODAY)

    const carried = rows(db, TODAY) as Array<Record<string, unknown>>
    expect(carried.map((r) => r.title)).toEqual(['Carried', 'Already here'])
  })

  /**
   * The partial unique index means a curriculum topic cannot land twice on one
   * day. The original must still be tombstoned — the work exists on today, so
   * leaving it `open` in the past would make it roll again forever.
   */
  it('tombstones without duplicating when the same topic already exists today', () => {
    seedSlot(db, {
      date: '2026-08-08',
      source: 'curriculum',
      sourceRef: 'topic-1',
      title: 'Shaders'
    })
    seedSlot(db, {
      date: TODAY,
      source: 'curriculum',
      sourceRef: 'topic-1',
      title: 'Shaders'
    })

    const records = runRollover(db, TODAY)

    expect(records).toHaveLength(0)
    expect(rows(db, TODAY)).toHaveLength(1)

    const past = rows(db, '2026-08-08') as Array<Record<string, unknown>>
    expect(past[0].status).toBe('rolled')

    // And it must not come back on the next launch.
    expect(runRollover(db, TODAY)).toHaveLength(0)
  })
})
