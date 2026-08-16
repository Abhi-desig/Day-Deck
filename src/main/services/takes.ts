import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Db } from '../db'
import { allTakeFileNames } from '../db/takes'

/**
 * Where generated clips live.
 *
 * The first files this app *owns* rather than links. Reference media stays
 * where the user put it and is never copied; a take has no home other than
 * here, because nobody chose a location for a file the app conjured.
 *
 * The naming rule is the security property: a file is `<takeId>.mp4`, the id is
 * a uuid, and no row stores a path. So there is nothing to sanitise, nothing to
 * traverse, and a take row that somehow named `../../etc/passwd` could not
 * resolve to it — the name is derived from the id, never read from the row.
 */

/** Created on demand rather than at boot; most launches never generate. */
export function takesDir(): string {
  const dir = join(app.getPath('userData'), 'takes')
  mkdirSync(dir, { recursive: true })
  return dir
}

export const takeFileName = (takeId: string): string => `${takeId}.mp4`

/**
 * The path for a take id, and the only function that builds one.
 *
 * Takes the id, not the stored file name, exactly so that the row cannot
 * influence where this points.
 */
export const takePath = (takeId: string): string =>
  join(takesDir(), takeFileName(takeId))

export function writeTakeFile(takeId: string, bytes: Buffer): string {
  const path = takePath(takeId)
  writeFileSync(path, bytes)
  return path
}

/** Missing is success: the caller wants the file gone, and it is. */
export function deleteTakeFile(takeId: string): void {
  try {
    unlinkSync(takePath(takeId))
  } catch {
    /* already gone */
  }
}

export function takeFileSize(takeId: string): number | null {
  try {
    const stat = statSync(takePath(takeId))
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

/**
 * Delete every file in the takes directory with no row behind it.
 *
 * `ON DELETE CASCADE` removes take rows when a frame or board goes, and SQLite
 * cannot delete files. Without this, deleting a board silently leaks every clip
 * it generated — which for video is not a stray kilobyte but potentially
 * gigabytes that nothing in the interface will ever mention again.
 *
 * Run at startup rather than on delete because cascade is exactly the case
 * where no code path runs at the moment the rows disappear.
 */
export function sweepOrphanedTakes(db: Db): number {
  let names: string[]
  try {
    names = readdirSync(takesDir())
  } catch {
    return 0
  }

  const known = allTakeFileNames(db)
  let removed = 0

  for (const name of names) {
    if (known.has(name)) continue
    // Only ever files this module could have written. A file the user dropped
    // in here by hand is not ours to delete.
    if (!/^[0-9a-f-]{36}\.mp4$/i.test(name)) continue
    try {
      unlinkSync(join(takesDir(), name))
      removed += 1
    } catch {
      /* a file we cannot remove is not worth failing a launch over */
    }
  }

  return removed
}
