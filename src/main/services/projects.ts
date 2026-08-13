import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { dialog, shell, type BrowserWindow } from 'electron'
import { CREATIVE_EXTENSIONS } from '@shared/types'
import type {
  Project,
  ProjectAdded,
  ProjectHomes,
  ProjectKind
} from '@shared/types'
import type { Db } from '../db'
import * as repo from '../db/projects'
import { SETTING, getSetting, setSetting } from '../db/settings'
import { projectNameFromPath, readBranch } from './git'

/**
 * The project registry.
 *
 * A project is just a folder the user pointed at, so everything derived from it
 * — the name, the branch, whether it is still there — is re-read here rather
 * than trusted from the row. The row is a cache that survives an unmounted
 * volume, not the source of truth.
 */

export function listProjects(db: Db): Project[] {
  return repo.listRows(db).map((row) => {
    const missing = !folderExists(row.path)

    // Branches move without the app being involved. Re-read on every list and
    // write back only on an actual change, so a project's card is never showing
    // the branch it was on last Tuesday.
    //
    // Creative projects are skipped: a folder of footage is not a repository, and
    // asking would be two file reads per card that always answer nothing.
    let branch = row.branch
    if (!missing && row.kind !== 'creative') {
      branch = readBranch(row.path)
      if (branch !== row.branch) repo.setBranch(db, row.id, branch)
    }

    return repo.toProject({ ...row, branch }, missing)
  })
}

function folderExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function getProject(db: Db, id: string): Project | null {
  const row = repo.getRow(db, id)
  if (!row) return null
  return repo.toProject(row, !folderExists(row.path))
}

/**
 * Resolve a project to a folder that is actually there. Every filesystem and
 * pty handler goes through this, so "the volume was ejected" is one clear error
 * instead of an ENOENT from somewhere deep in a read.
 */
export function requireProjectRoot(db: Db, id: string): { project: Project; root: string } {
  const project = getProject(db, id)
  if (!project) throw new Error(`No such project: ${id}`)
  if (project.missing) {
    throw new Error(
      `${project.name} is no longer at ${project.path}. Remove it from the grid, or reconnect the drive it lives on.`
    )
  }
  return { project, root: resolve(project.path) }
}

/**
 * Ask for a folder and register it. Returns null when the user cancels, which
 * is a normal outcome and not an error.
 */
export async function addProject(
  db: Db,
  window: BrowserWindow | null
): Promise<ProjectAdded | null> {
  const result = window
    ? await dialog.showOpenDialog(window, PICKER)
    : await dialog.showOpenDialog(PICKER)

  if (result.canceled || result.filePaths.length === 0) return null
  return registerPath(db, result.filePaths[0])
}

const PICKER = {
  title: 'Add a project',
  buttonLabel: 'Add project',
  properties: ['openDirectory' as const, 'createDirectory' as const]
}

/** Split out from the dialog so the registration rules can be tested directly. */
export function registerPath(db: Db, picked: string): ProjectAdded {
  const path = resolve(picked)

  if (!existsSync(path)) {
    throw new Error(`That folder does not exist: ${path}`)
  }

  // Adding the same folder twice should take you to the card you already have
  // rather than failing on the UNIQUE constraint with a SQL error.
  const existing = repo.findByPath(db, path)
  if (existing) {
    return { project: repo.toProject(existing, false), duplicate: true }
  }

  const row = repo.insert(db, {
    name: projectNameFromPath(path),
    path,
    branch: readBranch(path)
  })
  return { project: repo.toProject(row, false), duplicate: false }
}

/**
 * Ask for a creative project file and register the folder it lives in.
 *
 * You pick the .prproj, not the folder, because the file is the thing you think of
 * as the project — but `path` stays a directory, the same as every other row, so
 * folders and asset filing work identically for both kinds.
 */
export async function addCreativeProject(
  db: Db,
  window: BrowserWindow | null
): Promise<ProjectAdded | null> {
  const result = window
    ? await dialog.showOpenDialog(window, CREATIVE_PICKER)
    : await dialog.showOpenDialog(CREATIVE_PICKER)

  if (result.canceled || result.filePaths.length === 0) return null
  return registerCreativePath(db, result.filePaths[0])
}

const CREATIVE_PICKER = {
  title: 'Add a creative project',
  buttonLabel: 'Add project',
  properties: ['openFile' as const],
  filters: [
    {
      name: 'Creative projects',
      extensions: [...CREATIVE_EXTENSIONS]
    },
    { name: 'All files', extensions: ['*'] }
  ]
}

export function registerCreativePath(db: Db, picked: string): ProjectAdded {
  const entryPath = resolve(picked)
  if (!existsSync(entryPath)) {
    throw new Error(`That file does not exist: ${entryPath}`)
  }

  const path = dirname(entryPath)

  const existing = repo.findByPath(db, path)
  if (existing) {
    // The folder is already registered. Adopt the entry file rather than
    // refusing: picking the .prproj inside a folder you already added is the
    // natural way to say "this is the file that opens".
    if (!existing.entry_path) repo.setEntryPath(db, existing.id, entryPath)
    const row = repo.getRow(db, existing.id) as repo.ProjectRow
    return { project: repo.toProject(row, false), duplicate: true }
  }

  const row = repo.insert(db, {
    // The file's name, not the folder's — "Nike Spot" reads better than "04_edit".
    name: basename(entryPath).replace(/\.[^.]+$/, ''),
    path,
    kind: 'creative',
    entryPath,
    // Creative folders are not repositories, and asking git about them on every
    // list would be two file reads that always answer nothing.
    branch: null
  })
  return { project: repo.toProject(row, false), duplicate: false }
}

/**
 * Hand a creative project to whichever application owns its file type.
 *
 * `shell.openPath` rather than a per-application launcher: LaunchServices already
 * knows that .prproj means Premiere and .aep means After Effects, and it knows the
 * user's own overrides too. It returns an error string instead of throwing, and an
 * empty string means it worked.
 */
export async function openCreativeProject(db: Db, id: string): Promise<void> {
  const project = getProject(db, id)
  if (!project) throw new Error(`No such project: ${id}`)
  if (!project.entryPath) {
    throw new Error(
      `${project.name} has no project file set. Add it again and pick the file that opens.`
    )
  }
  if (!existsSync(project.entryPath)) {
    throw new Error(`${project.name} is no longer at ${project.entryPath}.`)
  }

  const failure = await shell.openPath(project.entryPath)
  if (failure) throw new Error(failure)
  repo.touch(db, id)
}

/* --------------------------------------------------------- project homes */

/**
 * Where new projects are created.
 *
 * Stored per kind in the `settings` key/value table, so this needed no migration.
 * Null means "not chosen yet", which is a state the UI has to handle rather than
 * paper over with a guess — creating directories in a folder the user did not pick
 * is not a default worth having.
 */
export function projectHomes(db: Db): ProjectHomes {
  return {
    code: getSetting(db, SETTING.codeHome),
    creative: getSetting(db, SETTING.creativeHome)
  }
}

const HOME_KEY: Record<ProjectKind, string> = {
  code: SETTING.codeHome,
  creative: SETTING.creativeHome
}

export function setProjectHome(
  db: Db,
  kind: ProjectKind,
  path: string
): ProjectHomes {
  const resolved = resolve(path)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`That is not a folder: ${resolved}`)
  }
  setSetting(db, HOME_KEY[kind], resolved)
  return projectHomes(db)
}

/** Opens a folder picker for one kind's home. null means the user cancelled. */
export async function pickProjectHome(
  db: Db,
  kind: ProjectKind,
  window: BrowserWindow | null
): Promise<ProjectHomes | null> {
  const options = {
    title: kind === 'creative' ? 'Where creative projects live' : 'Where code projects live',
    buttonLabel: 'Use this folder',
    // Same as the add-a-project picker: let them make the folder here rather than
    // sending them to Finder to make it first.
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) return null
  return setProjectHome(db, kind, result.filePaths[0])
}

/**
 * Create a new project from nothing.
 *
 * The distinction from `addProject` is the direction of travel: that one adopts a
 * folder that already exists, this one makes the folder. Which is why it takes a
 * name rather than opening a picker — with a home set, creating a project is
 * typing what it is called.
 *
 * Deliberately does not create the template subfolders — that lives in
 * projectAssets, which already depends on this module for `requireProjectRoot`.
 * Calling it from here would close the cycle, so the caller composes the two.
 */
export function createProject(
  db: Db,
  kind: ProjectKind,
  name: string
): ProjectAdded {
  const home = projectHomes(db)[kind]
  if (!home) {
    throw new Error(
      `Choose where ${kind} projects should live first, then create one.`
    )
  }
  if (!existsSync(home)) {
    throw new Error(
      `${home} is not there any more. Choose where ${kind} projects should live.`
    )
  }

  const clean = validateProjectName(name)
  const path = join(home, clean)

  // Registered already: hand back the existing card rather than making a second
  // row for one folder, matching how registerPath behaves.
  const existing = repo.findByPath(db, path)
  if (existing) {
    return { project: repo.toProject(existing, false), duplicate: true }
  }

  // `recursive: true` adopts a directory that is already there. Making a project
  // out of a folder you had already created by hand is a reasonable thing to do,
  // and the row is what was missing.
  mkdirSync(path, { recursive: true })

  const row = repo.insert(db, {
    name: clean,
    path,
    kind,
    entryPath: null,
    branch: kind === 'creative' ? null : readBranch(path)
  })

  return { project: repo.toProject(row, false), duplicate: false }
}

/**
 * A project name, not a path.
 *
 * Stricter than a folder name because this one becomes a directory directly under
 * a home the user chose — a name containing a separator would put the project
 * somewhere they did not ask for.
 */
export function validateProjectName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the project a name.')
  if (trimmed.length > MAX_PROJECT_NAME) {
    throw new Error(`A project name has to be under ${MAX_PROJECT_NAME} characters.`)
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('That is not a project name.')
  }
  if (/[/\\]/.test(trimmed)) {
    throw new Error('A project name cannot contain a slash.')
  }
  if (trimmed.startsWith('.')) {
    throw new Error('A project name cannot start with a dot.')
  }
  return trimmed
}

const MAX_PROJECT_NAME = 80

export function removeProject(db: Db, id: string): void {
  repo.remove(db, id)
}

export function setPinned(db: Db, id: string, pinned: boolean): Project[] {
  repo.setPinned(db, id, pinned)
  return listProjects(db)
}

export function reorderProjects(db: Db, orderedIds: string[]): Project[] {
  repo.reorder(db, orderedIds)
  return listProjects(db)
}

export function renameProject(db: Db, id: string, name: string): Project {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A project needs a name.')
  db.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run(trimmed, id)
  const project = getProject(db, id)
  if (!project) throw new Error(`No such project: ${id}`)
  return project
}

/** Records that the workspace was opened, for "recently worked on" ordering. */
export function touchProject(db: Db, id: string): Project {
  repo.touch(db, id)
  const project = getProject(db, id)
  if (!project) throw new Error(`No such project: ${id}`)
  return project
}
