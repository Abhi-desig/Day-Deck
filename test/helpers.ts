import Database from 'better-sqlite3'
import { MIGRATIONS } from '../src/main/db/migrations'

export type TestDb = Database.Database

/**
 * A real SQLite database in memory, running the same migrations the app ships.
 * Testing against the actual schema means CHECK constraints and the partial
 * unique indexes are exercised too, not just the TypeScript.
 */
export function makeDb(): TestDb {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const sql of MIGRATIONS) db.exec(sql)
  db.pragma(`user_version = ${MIGRATIONS.length}`)
  return db
}

export function seedSlot(
  db: TestDb,
  overrides: Partial<{
    id: string
    date: string
    title: string
    source: string
    sourceRef: string | null
    status: string
    rollCount: number
    startMin: number | null
  }> = {}
): string {
  const id = overrides.id ?? `slot-${Math.random().toString(36).slice(2, 10)}`
  db.prepare(
    `INSERT INTO slots
       (id, date, start_min, duration_min, title, source, source_ref,
        category, status, roll_count, sort_index, created_at)
     VALUES (?, ?, ?, 30, ?, ?, ?, 'personal_learning', ?, ?, 0, ?)`
  ).run(
    id,
    overrides.date ?? '2026-08-01',
    overrides.startMin ?? null,
    overrides.title ?? 'Test task',
    overrides.source ?? 'manual',
    overrides.sourceRef ?? null,
    overrides.status ?? 'open',
    overrides.rollCount ?? 0,
    new Date().toISOString()
  )
  return id
}

export function rows(db: TestDb, date?: string) {
  return date
    ? db.prepare(`SELECT * FROM slots WHERE date = ? ORDER BY sort_index`).all(date)
    : db.prepare(`SELECT * FROM slots ORDER BY date, sort_index`).all()
}
