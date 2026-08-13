import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '' }
}))

const repo = await import('../src/main/db/projects')
const service = await import('../src/main/services/projects')
const assets = await import('../src/main/services/projectAssets')
const { makeDb } = await import('./helpers')

let db: TestDb
const temps: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'day-deck-creative-'))
  temps.push(dir)
  return dir
}

beforeEach(() => {
  db = makeDb()
})

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop() as string, { recursive: true, force: true })
  }
})

describe('registering a creative project', () => {
  it('registers the folder but remembers the file', () => {
    const dir = makeDir()
    const entry = join(dir, 'Nike Spot.prproj')
    writeFileSync(entry, 'x')

    const { project, duplicate } = service.registerCreativePath(db, entry)

    expect(duplicate).toBe(false)
    expect(project.kind).toBe('creative')
    // `path` stays a directory, the same as every other row, so folders and asset
    // filing work identically for both kinds.
    expect(project.path).toBe(dir)
    expect(project.entryPath).toBe(entry)
  })

  it('names it after the file, without the extension', () => {
    const dir = makeDir()
    const entry = join(dir, 'Brand Film v4.aep')
    writeFileSync(entry, 'x')

    // "Brand Film v4" reads better than whatever the containing folder is called.
    expect(service.registerCreativePath(db, entry).project.name).toBe(
      'Brand Film v4'
    )
  })

  it('does not ask git about it', () => {
    const dir = makeDir()
    const entry = join(dir, 'Spot.prproj')
    writeFileSync(entry, 'x')
    service.registerCreativePath(db, entry)

    const listed = service.listProjects(db)[0]
    expect(listed.branch).toBeNull()
  })

  it('adopts the entry file when the folder is already registered', () => {
    const dir = makeDir()
    const entry = join(dir, 'Spot.prproj')
    writeFileSync(entry, 'x')
    repo.insert(db, { name: 'Existing', path: dir, branch: null })

    const { project, duplicate } = service.registerCreativePath(db, entry)

    // Picking the .prproj inside a folder you already added is how you say "this
    // is the file that opens" — not an error.
    expect(duplicate).toBe(true)
    expect(project.entryPath).toBe(entry)
  })

  it('refuses a file that is not there', () => {
    expect(() =>
      service.registerCreativePath(db, '/nope/missing.prproj')
    ).toThrow(/does not exist/i)
  })

  it('defaults an existing row with no kind to code', () => {
    const dir = makeDir()
    const row = repo.insert(db, { name: 'Old', path: dir, branch: null })
    expect(repo.toProject(row).kind).toBe('code')
    expect(repo.toProject(row).entryPath).toBeNull()
  })

  it('reads an unrecognised kind as code rather than crashing', () => {
    const dir = makeDir()
    const row = repo.insert(db, { name: 'Weird', path: dir, branch: null })
    db.prepare(`UPDATE projects SET kind = 'hologram' WHERE id = ?`).run(row.id)

    const reread = repo.getRow(db, row.id)!
    // Code is the behaviour that needs no extra data, so it is the safe default.
    expect(repo.toProject(reread).kind).toBe('code')
  })
})

describe('opening a creative project', () => {
  it('refuses one with no project file set', async () => {
    const dir = makeDir()
    const row = repo.insert(db, {
      name: 'Assets only',
      path: dir,
      kind: 'creative',
      branch: null
    })

    await expect(service.openCreativeProject(db, row.id)).rejects.toThrow(
      /no project file/i
    )
  })

  it('refuses one whose file has moved', async () => {
    const dir = makeDir()
    const row = repo.insert(db, {
      name: 'Gone',
      path: dir,
      kind: 'creative',
      entryPath: join(dir, 'not-here.prproj'),
      branch: null
    })

    await expect(service.openCreativeProject(db, row.id)).rejects.toThrow(
      /no longer at/i
    )
  })
})

describe('ordering with two kinds', () => {
  function seed(kind: 'code' | 'creative', name: string): string {
    const dir = makeDir()
    return repo.insert(db, { name, path: dir, kind, branch: null }).id
  }

  it('numbers each kind from zero', () => {
    seed('code', 'a')
    seed('code', 'b')
    const first = seed('creative', 'c')

    // The panel shows one kind at a time, so each tab is its own list that merely
    // shares a table.
    expect(repo.getRow(db, first)?.sort_index).toBe(0)
  })

  it('reordering one kind leaves the other alone', () => {
    const codeA = seed('code', 'a')
    const codeB = seed('code', 'b')
    const creativeA = seed('creative', 'c')
    const creativeB = seed('creative', 'd')

    const before = [creativeA, creativeB].map(
      (id) => repo.getRow(db, id)?.sort_index
    )

    repo.reorder(db, [codeB, codeA])

    expect(repo.getRow(db, codeB)?.sort_index).toBe(0)
    expect(repo.getRow(db, codeA)?.sort_index).toBe(1)
    // A drag on the Code tab must not churn Creative's indices.
    expect([creativeA, creativeB].map((id) => repo.getRow(db, id)?.sort_index))
      .toEqual(before)
  })

  it('trails unmentioned projects behind their own kind', () => {
    const codeA = seed('code', 'a')
    const codeB = seed('code', 'b')
    const creativeA = seed('creative', 'c')

    repo.reorder(db, [codeB])

    expect(repo.getRow(db, codeB)?.sort_index).toBe(0)
    expect(repo.getRow(db, codeA)?.sort_index).toBe(1)
    expect(repo.getRow(db, creativeA)?.sort_index).toBe(0)
  })
})

describe('folders mapped to real directories', () => {
  function project(): { id: string; root: string } {
    const root = makeDir()
    const row = repo.insert(db, {
      name: 'Spot',
      path: root,
      kind: 'creative',
      branch: null
    })
    return { id: row.id, root }
  }

  it('creates the directory, not just the row', () => {
    const { id, root } = project()
    const folder = assets.createFolder(db, id, null, 'Footage')

    expect(folder.relPath).toBe('Footage')
    // The mapping is the feature. A row without a directory would leave the files
    // exactly where they were.
    expect(existsSync(join(root, 'Footage'))).toBe(true)
  })

  it('nests, and builds the relative path from the parent', () => {
    const { id, root } = project()
    const parent = assets.createFolder(db, id, null, 'Footage')
    const child = assets.createFolder(db, id, parent.id, 'Day 1')

    expect(child.relPath).toBe('Footage/Day 1')
    expect(existsSync(join(root, 'Footage', 'Day 1'))).toBe(true)
  })

  it('adopts a directory that is already on disk', () => {
    const { id, root } = project()
    mkdirSync(join(root, 'Exports'))

    // Pointing the panel at a folder that already exists is a reasonable thing to
    // want; the row is what was missing.
    expect(() => assets.createFolder(db, id, null, 'Exports')).not.toThrow()
  })

  it('refuses two folders of the same name in one place', () => {
    const { id } = project()
    assets.createFolder(db, id, null, 'Footage')

    expect(() => assets.createFolder(db, id, null, 'Footage')).toThrow(
      /already a folder/i
    )
  })

  it('refuses a name that is a path', () => {
    const { id } = project()
    // This is a name field, not a route. Without this, a folder row could name
    // somewhere outside its project.
    expect(() => assets.createFolder(db, id, null, '../escape')).toThrow(
      /cannot contain a slash/i
    )
    expect(() => assets.createFolder(db, id, null, 'a/b')).toThrow(
      /cannot contain a slash/i
    )
    expect(() => assets.createFolder(db, id, null, '..')).toThrow(
      /not a folder name/i
    )
    expect(() => assets.createFolder(db, id, null, '   ')).toThrow(
      /give the folder a name/i
    )
  })

  it('renames the directory and every descendant row with it', () => {
    const { id, root } = project()
    const parent = assets.createFolder(db, id, null, 'Footage')
    assets.createFolder(db, id, parent.id, 'Day 1')

    assets.renameFolder(db, parent.id, 'Rushes')

    expect(existsSync(join(root, 'Rushes', 'Day 1'))).toBe(true)
    expect(existsSync(join(root, 'Footage'))).toBe(false)

    const folders = assets.listFolders(db, id)
    // A child keeps its own full relative path, so renaming a parent has to
    // rewrite it or the child reads as missing.
    expect(folders.map((f) => f.relPath).sort()).toEqual([
      'Rushes',
      'Rushes/Day 1'
    ])
    expect(folders.every((f) => !f.missing)).toBe(true)
  })

  it('reports a directory somebody moved in Finder as missing', () => {
    const { id, root } = project()
    assets.createFolder(db, id, null, 'Footage')
    rmSync(join(root, 'Footage'), { recursive: true })

    const folder = assets.listFolders(db, id)[0]
    // Answered by looking, every time — a stored flag would be a cached wrong
    // answer the moment the folder came back.
    expect(folder.missing).toBe(true)
    expect(folder.fileCount).toBe(0)
  })

  it('forgetting a folder leaves the files alone', () => {
    const { id, root } = project()
    const folder = assets.createFolder(db, id, null, 'Footage')
    writeFileSync(join(root, 'Footage', 'a.mov'), 'x')

    assets.removeFolder(db, folder.id)

    expect(assets.listFolders(db, id)).toEqual([])
    // Deleting somebody's footage because they tidied a panel is not a trade
    // worth offering.
    expect(existsSync(join(root, 'Footage', 'a.mov'))).toBe(true)
  })
})

describe('filing assets into a folder', () => {
  function folder(): { folderId: string; root: string; source: string } {
    const root = makeDir()
    const row = repo.insert(db, {
      name: 'Spot',
      path: root,
      kind: 'creative',
      branch: null
    })
    const made = assets.createFolder(db, row.id, null, 'Footage')
    return { folderId: made.id, root, source: makeDir() }
  }

  it('copies the file in and leaves the original alone', () => {
    const { folderId, root, source } = folder()
    const from = join(source, 'clip.mov')
    writeFileSync(from, 'footage')

    const result = assets.fileAssets(db, folderId, [from])

    expect(result.copied).toEqual(['clip.mov'])
    expect(readFileSync(join(root, 'Footage', 'clip.mov'), 'utf8')).toBe('footage')
    // Copy, not move: a bad drop should never be destructive.
    expect(existsSync(from)).toBe(true)
  })

  it('counts the files it now holds', () => {
    const { folderId, source } = folder()
    for (const name of ['a.mov', 'b.mov']) {
      writeFileSync(join(source, name), 'x')
    }

    const result = assets.fileAssets(db, folderId, [
      join(source, 'a.mov'),
      join(source, 'b.mov')
    ])
    expect(result.folder.fileCount).toBe(2)
  })

  it('skips a name that is already there rather than overwriting it', () => {
    const { folderId, root, source } = folder()
    writeFileSync(join(root, 'Footage', 'clip.mov'), 'the real one')
    const from = join(source, 'clip.mov')
    writeFileSync(from, 'a different file')

    const result = assets.fileAssets(db, folderId, [from])

    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual(['clip.mov'])
    // Overwriting somebody's footage with a different file of the same name is
    // not recoverable, so it never happens silently.
    expect(readFileSync(join(root, 'Footage', 'clip.mov'), 'utf8')).toBe(
      'the real one'
    )
  })

  it('skips a directory rather than half-copying a tree', () => {
    const { folderId, source } = folder()
    mkdirSync(join(source, 'a-folder'))

    const result = assets.fileAssets(db, folderId, [join(source, 'a-folder')])
    expect(result.skipped).toEqual(['a-folder'])
    expect(result.copied).toEqual([])
  })

  it('skips a source that is not there', () => {
    const { folderId, source } = folder()
    const result = assets.fileAssets(db, folderId, [join(source, 'ghost.mov')])

    expect(result.skipped).toEqual(['ghost.mov'])
  })

  it('recreates the directory if it went missing before the drop', () => {
    const { folderId, root, source } = folder()
    rmSync(join(root, 'Footage'), { recursive: true })
    const from = join(source, 'clip.mov')
    writeFileSync(from, 'x')

    const result = assets.fileAssets(db, folderId, [from])
    expect(result.copied).toEqual(['clip.mov'])
  })
})
