import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

let instance: Db | null = null

export function getDb(): Db {
  if (instance) return instance

  const file = join(app.getPath('userData'), 'daydeck.db')
  const db = new Database(file)

  // WAL lets the UI read while a write is in flight; NORMAL sync is the right
  // durability trade for a single-user local app.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  instance = db
  return db
}

export function dbPath(): string {
  return join(app.getPath('userData'), 'daydeck.db')
}

export function closeDb(): void {
  instance?.close()
  instance = null
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.pragma(`user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${v + 1} failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
