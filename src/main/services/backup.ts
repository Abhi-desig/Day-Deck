import type { Db } from '../db'
import { MIGRATIONS } from '../db/migrations'

/**
 * JSON export and import of the whole database.
 *
 * Deliberately JSON and not a copy of the .db file. A file copy would be
 * simpler, but it is opaque — you cannot read it, diff it, or pull one goal out
 * of it — and restoring one silently replaces a database the running process
 * has open in WAL mode. A table-by-table dump is something the user can inspect
 * and, at a pinch, repair by hand.
 *
 * The version check is the part that matters. A backup written by a newer build
 * may contain columns this one has never heard of, and importing it would drop
 * them without a word. Forward-only migrations mean older is always safe to
 * read; newer never is, so it is refused outright.
 */

/**
 * Tables in dependency order: parents before children, so the inserts satisfy
 * every foreign key without having to defer constraint checking.
 */
const TABLES = [
  'settings',
  'projects',
  'curricula',
  'topics',
  'weekly_templates',
  'weekly_seed_log',
  'notify_log',
  'sticker_folders',
  'stickers',
  'goal_notes',
  'tags',
  'storyboards',
  'storyboard_frames',
  // Slots second-to-last: rolled_from is a self-reference, handled below.
  'slots',
  // And their attachments after them, since slot_tags references both ends.
  'slot_tags'
] as const

export const BACKUP_FORMAT = 1

export interface Backup {
  /** Shape of this envelope, not of the data inside it. */
  format: number
  /** The schema the rows came from. Compared against MIGRATIONS.length. */
  userVersion: number
  app: string
  exportedAt: string
  tables: Record<string, Array<Record<string, unknown>>>
}

export interface ImportSummary {
  /** Rows written per table. */
  counts: Record<string, number>
  total: number
  /** The version the file was written at, for the confirmation message. */
  fromVersion: number
}

const currentVersion = (db: Db): number =>
  db.pragma('user_version', { simple: true }) as number

export function exportBackup(db: Db, appVersion: string): Backup {
  const tables: Backup['tables'] = {}

  for (const table of TABLES) {
    tables[table] = db
      .prepare<[], Record<string, unknown>>(`SELECT * FROM ${table}`)
      .all()
  }

  return {
    format: BACKUP_FORMAT,
    userVersion: currentVersion(db),
    app: appVersion,
    exportedAt: new Date().toISOString(),
    tables
  }
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function parseBackup(text: string): Backup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('That file is not valid JSON.')
  }

  const backup = parsed as Partial<Backup>
  if (
    !backup ||
    typeof backup !== 'object' ||
    typeof backup.userVersion !== 'number' ||
    !backup.tables ||
    typeof backup.tables !== 'object'
  ) {
    throw new BackupError('That file is not a Day Deck backup.')
  }

  if (backup.format !== BACKUP_FORMAT) {
    throw new BackupError(
      `That backup is in format ${String(backup.format)}; this app reads format ${BACKUP_FORMAT}.`
    )
  }

  return backup as Backup
}

/**
 * Replace everything with the contents of a backup.
 *
 * One transaction: either the whole restore lands or the database is exactly as
 * it was. A half-applied import — goals without topics, slots pointing at
 * curricula that were never inserted — would be worse than a failed one.
 */
export function importBackup(db: Db, text: string): ImportSummary {
  const backup = parseBackup(text)
  const running = MIGRATIONS.length

  if (backup.userVersion > running) {
    throw new BackupError(
      `That backup was written by a newer version of Day Deck (schema v${backup.userVersion}; this app is v${running}). Update the app before restoring it, or data would be silently dropped.`
    )
  }

  const counts: Record<string, number> = {}

  const run = db.transaction(() => {
    // Children first on the way out, so nothing is orphaned mid-delete. Foreign
    // keys are ON, and this is the only ordering that satisfies them.
    for (const table of [...TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run()
    }

    for (const table of TABLES) {
      const rows = backup.tables[table] ?? []
      counts[table] = 0
      if (rows.length === 0) continue

      // Only columns this schema actually has. A backup from an older version
      // is missing newer columns (they take their defaults), and one that
      // somehow carries an unknown column has it ignored rather than crashing
      // the whole restore.
      const known = new Set(
        db
          .prepare<[string], { name: string }>(
            `SELECT name FROM pragma_table_info(?)`
          )
          .all(table)
          .map((c) => c.name)
      )

      for (const row of rows) {
        const columns = Object.keys(row).filter((c) => known.has(c))
        if (columns.length === 0) continue

        db.prepare(
          `INSERT OR REPLACE INTO ${table} (${columns.join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`
        ).run(...columns.map((c) => row[c]))

        counts[table] += 1
      }
    }
  })

  // `slots.rolled_from` points at another slot, so a tombstone can appear in
  // the file after the row that references it. Deferring the whole restore is
  // the simplest correct answer: constraints are checked at COMMIT, not per
  // statement, and better-sqlite3's transaction() gives us that scope.
  db.pragma('defer_foreign_keys = ON')
  try {
    run()
  } finally {
    db.pragma('defer_foreign_keys = OFF')
  }

  return {
    counts,
    total: Object.values(counts).reduce((n, c) => n + c, 0),
    fromVersion: backup.userVersion
  }
}
