import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { trashItem: async () => undefined },
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const projects = await import('../src/main/services/projects')
const assets = await import('../src/main/services/projectAssets')
const { makeDb } = await import('./helpers')

/**
 * Creating a project from nothing — the direction of travel `addProject`
 * does not cover. A home is chosen once; from then on a project is a name.
 */

let db: TestDb
let home: string

beforeEach(() => {
  db = makeDb()
  home = mkdtempSync(join(tmpdir(), 'deck-home-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('project homes', () => {
  it('starts unset for both kinds', () => {
    expect(projects.projectHomes(db)).toEqual({ code: null, creative: null })
  })

  it('stores a home per kind, and rejects a non-folder', () => {
    projects.setProjectHome(db, 'creative', home)
    expect(projects.projectHomes(db)).toMatchObject({
      creative: home,
      code: null
    })

    expect(() =>
      projects.setProjectHome(db, 'code', join(home, 'not-there'))
    ).toThrow(/not a folder/i)
  })
})

describe('creating a project', () => {
  it('refuses to create anything before a home is chosen', () => {
    expect(() => projects.createProject(db, 'creative', 'Reel')).toThrow(
      /choose where creative projects/i
    )
  })

  it('makes the folder, registers the row, and reports it once', () => {
    projects.setProjectHome(db, 'creative', home)

    const added = projects.createProject(db, 'creative', ' Spring launch ')
    expect(added.duplicate).toBe(false)
    expect(added.project.kind).toBe('creative')
    expect(added.project.name).toBe('Spring launch')
    expect(existsSync(join(home, 'Spring launch'))).toBe(true)

    // Creating it again is the same statement made twice, not a second row.
    const again = projects.createProject(db, 'creative', 'Spring launch')
    expect(again.duplicate).toBe(true)
    expect(again.project.id).toBe(added.project.id)
  })

  it('rejects names that would leave the home', () => {
    projects.setProjectHome(db, 'code', home)
    for (const name of ['a/b', 'a\\b', '..', '.', '.hidden', '', '   ']) {
      expect(() => projects.createProject(db, 'code', name)).toThrow()
    }
  })

  it('composes with the template folders the way the handler does', () => {
    projects.setProjectHome(db, 'creative', home)
    const { project } = projects.createProject(db, 'creative', 'Reel')

    const made = assets.createTemplateFolders(db, project.id, 'creative')

    expect(made.map((f) => f.name)).toEqual([
      'Footage',
      'References',
      'Exports',
      'Project files'
    ])
    for (const folder of made) {
      expect(existsSync(join(home, 'Reel', folder.relPath))).toBe(true)
    }

    // And the bin's target list sees them straight away.
    const all = assets.listAllFolders(db)
    expect(all.filter((f) => f.projectId === project.id)).toHaveLength(4)
  })
})
