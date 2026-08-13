import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { app } from 'electron'
import type { BinEntry, BinListing, BinSourceId } from '@shared/types'
import { BIN_SOURCES } from '@shared/types'

/**
 * The desktop bin: the two directories macOS itself dumps things into.
 *
 * This module only ever *reads* them. Moving a file out of a bin goes through
 * `projectAssets.fileInto`, and the one rule enforced here is the gate on what
 * that move may name as a source: a path under Desktop or Downloads and nothing
 * else. The renderer never gets to point the mover at `~/.ssh` because
 * `assertUnderBinSources` is in front of it.
 */

/** Resolved fresh on every call — `app.getPath` follows the account. */
export function binRoot(source: BinSourceId): string {
  return app.getPath(source)
}

/**
 * Entries the bin shows. Enough to fill the panel a few times over; a Desktop
 * with more than this on it is beyond what one approval pass can tidy anyway.
 */
const MAX_ENTRIES = 200

export function listBin(source: BinSourceId): BinListing {
  if (!BIN_SOURCES.includes(source)) {
    throw new Error(`Not a bin source: ${String(source)}`)
  }

  const root = binRoot(source)
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    // A missing Downloads folder is not an error state worth crashing over —
    // it lists as empty and the watcher will pick it up if it appears.
    return { source, rel: '', entries: [], truncated: false }
  }

  const entries: BinEntry[] = []
  for (const name of names) {
    // .DS_Store, .localized — the Desktop is full of files that are not the
    // user's clutter and must not be offered for filing.
    if (name.startsWith('.')) continue
    try {
      const stats = statSync(join(root, name))
      const directory = stats.isDirectory()
      if (!directory && !stats.isFile()) continue
      entries.push({
        path: name,
        name,
        directory,
        size: directory ? 0 : stats.size,
        modifiedMs: stats.mtimeMs
      })
    } catch {
      // Vanished between readdir and stat — a screenshot mid-rename. Skip it;
      // the watcher will list again in a moment anyway.
    }
  }

  // Newest first: the file you just downloaded is the one you came to file.
  entries.sort((a, b) => b.modifiedMs - a.modifiedMs)

  const truncated = entries.length > MAX_ENTRIES
  return {
    source,
    rel: '',
    entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
    truncated
  }
}

/**
 * Bin names into absolute paths, safely.
 *
 * The renderer names an entry, never a path — same rule the workspace bridge
 * enforces. A name is a plain basename by construction (the listing is one
 * level deep), so anything with a separator or a dot-walk in it did not come
 * from a listing and is refused. The resolved result is then prefix-checked
 * against the source root anyway, so the two checks have to both be wrong
 * before anything outside a bin can be named.
 */
export function resolveBinPaths(
  source: BinSourceId,
  names: readonly string[]
): string[] {
  if (!BIN_SOURCES.includes(source)) {
    throw new Error(`Not a bin source: ${String(source)}`)
  }
  const root = resolve(binRoot(source))

  return names.map((name) => {
    if (
      !name ||
      name.includes('\0') ||
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..' ||
      name.startsWith('.')
    ) {
      throw new Error('That is not something the bin listed.')
    }
    const path = resolve(join(root, name))
    if (!path.startsWith(root + sep)) {
      throw new Error('The bin can only file things from Desktop or Downloads.')
    }
    return path
  })
}

/**
 * Watch both bins, debounced per source.
 *
 * `fs.watch` rather than a watcher dependency on purpose: the only question is
 * "did anything change", answered by listing again — per-event fidelity would
 * buy nothing, and this app deliberately has two runtime dependencies.
 */
export function watchBins(
  onChange: (source: BinSourceId) => void
): () => void {
  const watchers: FSWatcher[] = []
  const timers = new Map<BinSourceId, ReturnType<typeof setTimeout>>()

  for (const source of BIN_SOURCES) {
    try {
      const watcher = watch(binRoot(source), () => {
        clearTimeout(timers.get(source))
        timers.set(
          source,
          setTimeout(() => onChange(source), 400)
        )
      })
      // A watcher error (folder deleted, permission pulled) must not take the
      // process down; the panel just stops updating until reopened.
      watcher.on('error', () => undefined)
      watchers.push(watcher)
    } catch {
      // No such directory. Nothing to watch; listBin already reports it empty.
    }
  }

  return () => {
    for (const timer of timers.values()) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
