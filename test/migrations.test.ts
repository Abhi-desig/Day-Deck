import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/main/db/migrations'

/**
 * `makeDb()` builds every schema from scratch, which is the one path a real
 * installation never takes. These exercise the upgrade instead — an ALTER
 * against a database that already holds the user's data is where a bad
 * migration costs someone their goals.
 */
function dbAtVersion(version: number): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v])
  db.pragma(`user_version = ${version}`)
  return db
}

/** The forward-only runner from db/index.ts, minus its electron import. */
function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

describe('migrating an existing database', () => {
  it('upgrades a v2 database that already has a curriculum in it', () => {
    const db = dbAtVersion(2)

    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, created_at)
       VALUES ('c1', 'Existing goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { color: string; sort_index: number; title: string }>(
        `SELECT title, color, sort_index FROM curricula WHERE id = 'c1'`
      )
      .get()

    expect(row?.title).toBe('Existing goal')
    // The pre-existing goal has to come out of the upgrade usable, not null.
    expect(row?.color).toBe('amber')
    expect(row?.sort_index).toBe(0)
  })

  it('lands on the current version and creates notify_log', () => {
    const db = dbAtVersion(2)
    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)

    const table = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notify_log'`
      )
      .get()
    expect(table?.name).toBe('notify_log')
  })

  it('gives a pre-existing topic empty points rather than null', () => {
    const db = dbAtVersion(4)

    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, color, sort_index, created_at)
       VALUES ('c1', 'Old goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', 'amber', 0,
               '2026-08-01T00:00:00Z')`
    ).run()
    db.prepare(
      `INSERT INTO topics
         (id, curriculum_id, seq, title, est_minutes, assigned_date, status)
       VALUES ('t1', 'c1', 1, 'Shaders', 60, '2026-08-12', 'pending')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { title: string; points: string }>(
        `SELECT title, points FROM topics WHERE id = 't1'`
      )
      .get()

    expect(row?.title).toBe('Shaders')
    // '[]', not NULL — "not broken down yet" is a state the reader understands,
    // and it is what makes the goal show up as backfillable in Goals Admin.
    expect(row?.points).toBe('[]')
  })

  it('creates goal_notes and cascades it from curricula', () => {
    const db = dbAtVersion(4)
    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, color, sort_index, created_at)
       VALUES ('c1', 'Old goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', 'amber', 0,
               '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    db.prepare(
      `INSERT INTO goal_notes
         (id, curriculum_id, body, surface_date, status, created_at)
       VALUES ('n1', 'c1', 'Review Wednesday', '2026-08-12', 'active',
               '2026-08-11T00:00:00Z')`
    ).run()

    db.prepare(`DELETE FROM curricula WHERE id = 'c1'`).run()

    const left = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM goal_notes`)
      .get()?.n
    expect(left).toBe(0)
  })

  it('is a no-op when already current', () => {
    const db = dbAtVersion(MIGRATIONS.length)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  })

  it('keeps the weekly seed rows through the upgrade', () => {
    const db = dbAtVersion(2)
    const before = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM weekly_templates`
      )
      .get()?.n

    migrate(db)

    const after = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM weekly_templates`
      )
      .get()?.n

    expect(before).toBe(3)
    expect(after).toBe(3)
  })
})
