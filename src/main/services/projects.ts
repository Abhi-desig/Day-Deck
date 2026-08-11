import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { Project, ProjectAdded } from '@shared/types'
import type { Db } from '../db'
import * as repo from '../db/projects'
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
    let branch = row.branch
    if (!missing) {
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
