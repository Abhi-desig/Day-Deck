import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync
} from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { shell } from 'electron'
import { PROJECT_TEMPLATE } from '@shared/types'
import type {
  AssetsFiled,
  AssetsMoved,
  FileMode,
  ProjectFolder,
  ProjectKind
} from '@shared/types'
import type { Db } from '../db'
import * as repo from '../db/projectFolders'
import { listProjects, requireProjectRoot } from './projects'
import { resolveInRoot } from './workspace-fs'

/**
 * Folders in the panel, and the real directories behind them.
 *
 * The mapping is the whole feature. A folder here creates a directory; filing an
 * asset copies the file into it. Without that, the panel would only be a second
 * place for things to be lost while the files stayed on the desktop — which is the
 * problem it exists to solve.
 *
 * Every path goes through `resolveInRoot` from workspace-fs, the same guard the
 * file tree uses, so a folder row can never name somewhere outside its project no
 * matter what it holds.
 */

/** A folder name, not a path. This is a name field, not a route. */
export function validateFolderPathName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the folder a name.')
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('That is not a folder name.')
  }
  if (/[/\\]/.test(trimmed)) {
    throw new Error('A folder name cannot contain a slash.')
  }
  if (trimmed.startsWith('.')) {
    throw new Error('A folder name cannot start with a dot.')
  }
  return trimmed
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Files only. A subfolder is its own row with its own count. */
function countFiles(path: string): number {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile())
      .length
  } catch {
    return 0
  }
}

const toFolder = (
  row: repo.FolderRow,
  missing: boolean,
  fileCount: number
): ProjectFolder => ({
  id: row.id,
  projectId: row.project_id,
  parentId: row.parent_id,
  name: row.name,
  relPath: row.rel_path,
  sortIndex: row.sort_index,
  createdAt: row.created_at,
  missing,
  fileCount
})

export function listFolders(db: Db, projectId: string): ProjectFolder[] {
  const { root } = requireProjectRoot(db, projectId)

  return repo.listRows(db, projectId).map((row) => {
    // Answered by looking, every time. A directory the user moved in Finder is a
    // thing that happens, and a stored flag would be a cached wrong answer.
    let absolute: string
    try {
      absolute = resolveInRoot(root, row.rel_path)
    } catch {
      return toFolder(row, true, 0)
    }
    const there = directoryExists(absolute)
    return toFolder(row, !there, there ? countFiles(absolute) : 0)
  })
}

export function getFolder(db: Db, id: string): ProjectFolder {
  const row = repo.getRow(db, id)
  if (!row) throw new Error('That folder is not in the panel any more.')
  const found = listFolders(db, row.project_id).find((f) => f.id === id)
  if (!found) throw new Error('That folder is not in the panel any more.')
  return found
}

/**
 * Every reachable project's folders, in one call.
 *
 * The desktop bin suggests a destination across all projects at once, and a
 * round trip per project would make opening the panel cost one IPC call per
 * card in the grid. A project whose root is unreachable simply contributes
 * nothing — its folders are not places anything can be filed right now.
 */
export function listAllFolders(db: Db): ProjectFolder[] {
  const out: ProjectFolder[] = []
  for (const project of listProjects(db)) {
    if (project.missing) continue
    try {
      out.push(...listFolders(db, project.id))
    } catch {
      /* unmounted between list and read — same as missing */
    }
  }
  return out
}

/**
 * Create the folder and the directory together.
 *
 * `mkdirSync` with `recursive: true` so an existing directory is adopted rather
 * than rejected — pointing the panel at a folder that is already on disk is a
 * completely reasonable thing to want, and the row is what was missing.
 */
export function createFolder(
  db: Db,
  projectId: string,
  parentId: string | null,
  name: string
): ProjectFolder {
  const { root } = requireProjectRoot(db, projectId)
  const clean = validateFolderPathName(name)

  let parentRel = ''
  if (parentId) {
    const parent = repo.getRow(db, parentId)
    if (!parent || parent.project_id !== projectId) {
      throw new Error('That parent folder is not in this project.')
    }
    parentRel = parent.rel_path
  }

  const relPath = parentRel ? `${parentRel}/${clean}` : clean
  if (repo.findByRelPath(db, projectId, relPath)) {
    throw new Error(`There is already a folder called ${clean} there.`)
  }

  mkdirSync(resolveInRoot(root, relPath), { recursive: true })
  const row = repo.insert(db, { projectId, parentId, name: clean, relPath })
  return getFolder(db, row.id)
}

/**
 * Rename the folder and the directory, and every descendant row with it.
 *
 * Descendants store their own full relative path, so renaming a parent has to
 * rewrite them — otherwise a child would keep pointing at the old name and read as
 * missing the moment its parent moved.
 */
export function renameFolder(db: Db, id: string, name: string): ProjectFolder {
  const row = repo.getRow(db, id)
  if (!row) throw new Error('That folder is not in the panel any more.')
  const { root } = requireProjectRoot(db, row.project_id)
  const clean = validateFolderPathName(name)
  if (clean === row.name) return getFolder(db, id)

  const parentRel = row.rel_path.slice(0, row.rel_path.lastIndexOf('/') + 1)
  const nextRel = `${parentRel}${clean}`
  if (repo.findByRelPath(db, row.project_id, nextRel)) {
    throw new Error(`There is already a folder called ${clean} there.`)
  }

  const from = resolveInRoot(root, row.rel_path)
  const to = resolveInRoot(root, nextRel)
  // Only if it is actually there — a row whose directory has already been moved
  // away in Finder should still be renameable in the panel.
  if (directoryExists(from) && !existsSync(to)) renameSync(from, to)

  const children = repo.descendants(db, id)
  db.transaction(() => {
    repo.rename(db, id, clean, nextRel)
    for (const child of children) {
      repo.rename(
        db,
        child.id,
        child.name,
        `${nextRel}${child.rel_path.slice(row.rel_path.length)}`
      )
    }
  })()

  return getFolder(db, id)
}

/** Forgets the folder. The directory and its contents stay. */
export function removeFolder(db: Db, id: string): void {
  repo.remove(db, id)
}

/**
 * The subfolders a brand-new project starts with.
 *
 * Lives here rather than beside `createProject` because it needs `createFolder`,
 * and this module already depends on the projects service — putting it there would
 * make the dependency circular.
 *
 * A template folder that fails is skipped rather than fatal. Losing "Exports"
 * because of a filesystem hiccup is not worth losing the project over, and the
 * panel can add it back in one click.
 */
export function createTemplateFolders(
  db: Db,
  projectId: string,
  kind: ProjectKind
): ProjectFolder[] {
  const made: ProjectFolder[] = []
  for (const name of PROJECT_TEMPLATE[kind]) {
    try {
      made.push(createFolder(db, projectId, null, name))
    } catch {
      /* addable by hand */
    }
  }
  return made
}

/**
 * Move or copy things into a folder.
 *
 * The move path is the first code in this app that removes one of the user's own
 * files, so it is built to be survivable rather than clever:
 *
 * - Same volume is a `rename`, which is atomic and instant. Nothing is copied and
 *   nothing can be half-done — a 40GB clip moves as fast as an empty file.
 * - Across volumes a rename is impossible (EXDEV), so it copies, confirms the copy
 *   arrived, and only then sends the original to the **Trash** rather than deleting
 *   it. If anything went wrong the original is recoverable in Finder.
 * - A name that already exists is skipped, never overwritten. On a move that means
 *   the original stays where it was, which is reported so it does not look like the
 *   file silently vanished.
 */
export async function fileInto(
  db: Db,
  folderId: string,
  paths: readonly string[],
  mode: FileMode
): Promise<AssetsMoved> {
  const row = repo.getRow(db, folderId)
  if (!row) throw new Error('That folder is not in the panel any more.')
  const { root } = requireProjectRoot(db, row.project_id)

  const target = resolveInRoot(root, row.rel_path)
  mkdirSync(target, { recursive: true })

  const moved: string[] = []
  const copied: string[] = []
  const skipped: string[] = []
  const leftBehind: string[] = []

  for (const source of paths) {
    const name = basename(source)
    if (!name) continue

    if (!existsSync(source)) {
      skipped.push(name)
      continue
    }

    const destination = join(target, name)
    if (existsSync(destination)) {
      skipped.push(name)
      continue
    }

    // Refuse to file a folder into itself or into its own subtree — that is an
    // infinite copy, and `cpSync` will happily start one.
    if (contains(source, target)) {
      skipped.push(name)
      continue
    }

    if (mode === 'copy') {
      try {
        cpSync(source, destination, { recursive: true })
        copied.push(name)
      } catch {
        skipped.push(name)
      }
      continue
    }

    try {
      renameSync(source, destination)
      moved.push(name)
      continue
    } catch (err) {
      // Anything other than a cross-device rename is a real failure.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
        skipped.push(name)
        continue
      }
    }

    // Cross-volume: copy, confirm, then trash the original.
    try {
      cpSync(source, destination, { recursive: true })
    } catch {
      skipped.push(name)
      continue
    }
    if (!existsSync(destination)) {
      skipped.push(name)
      continue
    }

    try {
      await shell.trashItem(source)
      moved.push(name)
    } catch {
      // The copy is good but the original could not be removed. Report it rather
      // than pretending the move finished — otherwise the user tidies a Desktop
      // that is still full.
      copied.push(name)
      leftBehind.push(name)
    }
  }

  return { folder: getFolder(db, folderId), mode, moved, copied, skipped, leftBehind }
}

/** True when `parent` is `child`, or an ancestor of it. */
function contains(parent: string, child: string): boolean {
  const a = resolve(parent)
  const b = resolve(child)
  return b === a || b.startsWith(a + sep)
}

/**
 * Copy files into a folder.
 *
 * Copy rather than move, so a bad drop is never destructive — the original stays
 * where it was and the worst case is a duplicate. A name that already exists is
 * skipped and reported rather than silently overwritten, because overwriting
 * somebody's footage with a different file of the same name is not recoverable.
 */
export function fileAssets(
  db: Db,
  folderId: string,
  paths: readonly string[]
): AssetsFiled {
  const row = repo.getRow(db, folderId)
  if (!row) throw new Error('That folder is not in the panel any more.')
  const { root } = requireProjectRoot(db, row.project_id)

  const target = resolveInRoot(root, row.rel_path)
  mkdirSync(target, { recursive: true })

  const copied: string[] = []
  const skipped: string[] = []

  for (const source of paths) {
    const name = basename(source)
    if (!name) continue

    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(source)
    } catch {
      skipped.push(name)
      continue
    }
    // Directories are out of scope: recursively copying a folder tree is a
    // different operation with different failure modes, and nothing asks for it.
    if (!stat.isFile()) {
      skipped.push(name)
      continue
    }

    const destination = join(target, name)
    if (existsSync(destination)) {
      skipped.push(name)
      continue
    }

    try {
      copyFileSync(source, destination)
      copied.push(name)
    } catch {
      skipped.push(name)
    }
  }

  return { folder: getFolder(db, folderId), copied, skipped }
}
