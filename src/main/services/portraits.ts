import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Db } from '../db'
import { allShotFileNames } from '../db/cast'

/**
 * Where generated character images live.
 *
 * The second class of file this app *owns* rather than links, and a deliberate
 * sibling of `services/takes.ts` rather than a generalisation of it. The two
 * directories have different lifetimes, different sweeps and different
 * extensions, and a shared "asset store" abstraction would be one indirection
 * standing between a security property and the person reading it.
 *
 * The three rules that make `takes.ts` safe are the whole of this file too. A
 * file is `<shotId>.png`, the id is a uuid, and no row stores a path — so there
 * is nothing to sanitise, nothing to traverse, and a row that somehow named
 * `../../etc/passwd` could not resolve to it, because the name is derived from
 * the id and never read from the row.
 */

/** Created on demand rather than at boot; most launches generate nothing. */
export function portraitsDir(): string {
  const dir = join(app.getPath('userData'), 'shots')
  mkdirSync(dir, { recursive: true })
  return dir
}

export const shotFileName = (shotId: string): string => `${shotId}.png`

/**
 * The path for a shot id, and the only function that builds one.
 *
 * Takes the id, not the stored file name, exactly so that the row cannot
 * influence where this points.
 */
export const shotPath = (shotId: string): string =>
  join(portraitsDir(), shotFileName(shotId))

export function writeShotFile(shotId: string, bytes: Buffer): string {
  const path = shotPath(shotId)
  writeFileSync(path, bytes)
  return path
}

/** The bytes back, for sending a portrait in as a reference. */
export function readShotFile(shotId: string): Buffer {
  return readFileSync(shotPath(shotId))
}

/** Missing is success: the caller wants the file gone, and it is. */
export function deleteShotFile(shotId: string): void {
  try {
    unlinkSync(shotPath(shotId))
  } catch {
    /* already gone */
  }
}

/**
 * Delete every file in the shots directory with no row behind it.
 *
 * `ON DELETE CASCADE` removes shot rows when a sheet or a board goes, and
 * SQLite cannot delete files. Without this, deleting a board leaks every
 * portrait it ever generated — the identical trap `takes.ts` documents, and it
 * recurs here for the identical reason: cascade is exactly the case where no
 * code path runs at the moment the rows disappear.
 */
export function sweepOrphanedShots(db: Db): number {
  let names: string[]
  try {
    names = readdirSync(portraitsDir())
  } catch {
    return 0
  }

  const known = allShotFileNames(db)
  let removed = 0

  for (const name of names) {
    if (known.has(name)) continue
    // Only ever files this module could have written. Anything a user dropped
    // in here by hand is not ours to delete.
    if (!/^[0-9a-f-]{36}\.png$/i.test(name)) continue
    try {
      unlinkSync(join(portraitsDir(), name))
      removed += 1
    } catch {
      /* a file we cannot remove is not worth failing a launch over */
    }
  }

  return removed
}

export function shotFileSize(shotId: string): number | null {
  try {
    const stat = statSync(shotPath(shotId))
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}
