import { beforeEach, describe, expect, it } from 'vitest'
import { runWeeklySeeding } from '../src/main/services/weekly'
import { makeDb, rows, type TestDb } from './helpers'

/** 2026-08-09 is a Sunday; its week began Monday 2026-08-03. */
const SUNDAY = '2026-08-09'
const MONDAY = '2026-08-03'

function addTemplate(
  db: TestDb,
  id: string,
  weekday: number,
  active = true,
  title = `Template ${id}`
) {
  db.prepare(
    `INSERT INTO weekly_templates (id, title, weekday, start_min, duration_min, category, active, sort_index)
     VALUES (?, ?, ?, 540, 30, 'amber', ?, 0)`
  ).run(id, title, weekday, active ? 1 : 0)
}

describe('weekly seeding', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
    // The shipped migration seeds three starter templates; start from empty so
    // each test controls its own inputs.
    db.exec('DELETE FROM weekly_templates')
  })

  it('plants each active template on its weekday within the current week', () => {
    addTemplate(db, 'mon', 1)
    addTemplate(db, 'wed', 3)
    addTemplate(db, 'sun', 0)

    const result = runWeeklySeeding(db, SUNDAY)

    expect(result.week).toBe(MONDAY)
    expect(result.slotIds).toHaveLength(3)

    const all = rows(db) as Array<Record<string, unknown>>
    const byRef = new Map(all.map((r) => [r.source_ref, r.date]))

    expect(byRef.get('mon')).toBe('2026-08-03') // Monday
    expect(byRef.get('wed')).toBe('2026-08-05') // Wednesday
    expect(byRef.get('sun')).toBe('2026-08-09') // Sunday closes the week
  })

  it('runs once per week no matter how often the app launches', () => {
    addTemplate(db, 'mon', 1)

    const first = runWeeklySeeding(db, MONDAY)
    const second = runWeeklySeeding(db, '2026-08-05')
    const third = runWeeklySeeding(db, SUNDAY)

    expect(first.week).toBe(MONDAY)
    expect(second.week).toBeNull()
    expect(third.week).toBeNull()
    expect(rows(db)).toHaveLength(1)
  })

  it('seeds again once a new week starts', () => {
    addTemplate(db, 'mon', 1)

    runWeeklySeeding(db, MONDAY)
    const nextWeek = runWeeklySeeding(db, '2026-08-10')

    expect(nextWeek.week).toBe('2026-08-10')
    const dates = (rows(db) as Array<Record<string, unknown>>).map((r) => r.date)
    expect(dates).toEqual(['2026-08-03', '2026-08-10'])
  })

  it('ignores inactive templates', () => {
    addTemplate(db, 'on', 1, true)
    addTemplate(db, 'off', 2, false)

    const result = runWeeklySeeding(db, MONDAY)

    expect(result.slotIds).toHaveLength(1)
    const all = rows(db) as Array<Record<string, unknown>>
    expect(all.map((r) => r.source_ref)).toEqual(['on'])
  })

  it('marks slots as amber_weekly and links them back to the template', () => {
    addTemplate(db, 'sync', 1, true, 'Weekly amber sync')

    runWeeklySeeding(db, MONDAY)

    const [slot] = rows(db) as Array<Record<string, unknown>>
    expect(slot).toMatchObject({
      source: 'amber_weekly',
      source_ref: 'sync',
      category: 'amber',
      status: 'open',
      title: 'Weekly amber sync',
      start_min: 540
    })
  })

  it('records the week even when there are no templates to plant', () => {
    const result = runWeeklySeeding(db, MONDAY)

    expect(result.week).toBe(MONDAY)
    expect(result.slotIds).toHaveLength(0)
    expect(runWeeklySeeding(db, SUNDAY).week).toBeNull()
  })
})
