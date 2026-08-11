import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Type-only, so it is erased before the electron mock matters.
import type { TestDb } from './helpers'

// services/projects imports `dialog` at module scope. Registration itself never
// opens one, so a stub is enough to exercise the interesting code headlessly.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
}))

const repo = await import('../src/main/db/projects')
const service = await import('../src/main/services/projects')
const { makeDb, seedSlot } = await import('./helpers')

let db: TestDb
const temps: string[] = []

function makeFolder(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'day-deck-proj-')), name)
  mkdirSync(dir, { recursive: true })
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

function add(name: string, branch: string | null = null) {
  return repo.insert(db, { name, path: `/repos/${name}`, branch })
}

describe('project ordering', () => {
  it('keeps insertion order until something changes it', () => {
    add('alpha')
    add('beta')
    add('gamma')

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('pulls a pinned project to the front and leaves the rest in order', () => {
    add('alpha')
    add('beta')
    const gamma = add('gamma')

    repo.setPinned(db, gamma.id, true)

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['gamma', 'alpha', 'beta'])
  })

  /** Within the pinned group, order is the order things were pinned. */
  it('keeps an earlier pin ahead of a later one', () => {
    add('alpha')
    const beta = add('beta')
    const gamma = add('gamma')

    repo.setPinned(db, gamma.id, true)
    repo.setPinned(db, beta.id, true)

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha'])
  })

  it('drops an unpinned project back below the pinned ones', () => {
    const alpha = add('alpha')
    const beta = add('beta')

    repo.setPinned(db, beta.id, true)
    repo.setPinned(db, alpha.id, true)
    repo.setPinned(db, beta.id, false)

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['alpha', 'beta'])
  })

  /**
   * The grid drags against display order and writes sort_index from it. If the
   * two orderings could disagree, the next drag would start from a different
   * list than the one on screen.
   */
  it('leaves sort_index equal to display position after every mutation', () => {
    const rows = ['a', 'b', 'c', 'd'].map((n) => add(n))

    repo.setPinned(db, rows[2].id, true)
    expectContiguous(repo.listRows(db))

    repo.reorder(db, [rows[2].id, rows[3].id, rows[0].id, rows[1].id])
    expectContiguous(repo.listRows(db))

    repo.setPinned(db, rows[2].id, false)
    expectContiguous(repo.listRows(db))

    repo.remove(db, rows[0].id)
    expectContiguous(repo.listRows(db))
  })

  it('reorders to exactly the order it was given', () => {
    const rows = ['a', 'b', 'c'].map((n) => add(n))
    repo.reorder(db, [rows[2].id, rows[0].id, rows[1].id])

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['c', 'a', 'b'])
  })

  /** A renderer holding a stale list must not delete what it forgot about. */
  it('parks anything the caller left out behind the listed ids', () => {
    const rows = ['a', 'b', 'c', 'd'].map((n) => add(n))
    repo.reorder(db, [rows[3].id, rows[1].id])

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('ignores ids for projects that no longer exist', () => {
    const rows = ['a', 'b'].map((n) => add(n))
    repo.reorder(db, ['ghost', rows[1].id, rows[0].id])

    expect(repo.listRows(db).map((r) => r.name)).toEqual(['b', 'a'])
  })
})

function expectContiguous(rows: Array<{ sort_index: number }>): void {
  expect(rows.map((r) => r.sort_index)).toEqual(rows.map((_, i) => i))
}

describe('colour assignment', () => {
  it('gives each project the first colour nobody is wearing', () => {
    expect(add('a').color).toBe('amber')
    expect(add('b').color).toBe('violet')
    expect(add('c').color).toBe('sky')
  })

  it('wraps round rather than running out', () => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) add(name)
    expect(repo.listRows(db)).toHaveLength(6)
    expect(repo.toProject(repo.listRows(db)[5]).color).toBe('amber')
  })
})

describe('removing a project', () => {
  /**
   * A slot pointing at a project that is gone would render as a row whose link
   * goes nowhere. The work itself is the user's, so it survives as plain work.
   */
  it('turns its day slots back into manual work instead of deleting them', () => {
    const project = add('alpha')
    const slotId = seedSlot(db, {
      date: '2026-08-10',
      title: 'Ship phase 3',
      source: 'project',
      sourceRef: project.id
    })

    repo.remove(db, project.id)

    const slot = db
      .prepare(`SELECT * FROM slots WHERE id = ?`)
      .get(slotId) as Record<string, unknown>
    expect(slot.source).toBe('manual')
    expect(slot.source_ref).toBeNull()
    expect(slot.title).toBe('Ship phase 3')
  })

  it('leaves other projects and their slots alone', () => {
    const keep = add('keep')
    const drop = add('drop')
    seedSlot(db, { source: 'project', sourceRef: keep.id })

    repo.remove(db, drop.id)

    const slot = db
      .prepare(`SELECT * FROM slots WHERE source = 'project'`)
      .get() as Record<string, unknown>
    expect(slot.source_ref).toBe(keep.id)
    expect(repo.listRows(db)).toHaveLength(1)
  })
})

describe('registerPath', () => {
  it('derives the name from the folder and picks up its branch', () => {
    const folder = makeFolder('day-deck')
    mkdirSync(join(folder, '.git'))
    writeFileSync(join(folder, '.git', 'HEAD'), 'ref: refs/heads/phase-3\n')

    const { project, duplicate } = service.registerPath(db, folder)

    expect(duplicate).toBe(false)
    expect(project.name).toBe('day-deck')
    expect(project.branch).toBe('phase-3')
    expect(project.missing).toBe(false)
  })

  /** Adding the same folder twice should find the card you already have. */
  it('reports a duplicate instead of failing the UNIQUE constraint', () => {
    const folder = makeFolder('twice')
    const first = service.registerPath(db, folder)
    const second = service.registerPath(db, folder)

    expect(second.duplicate).toBe(true)
    expect(second.project.id).toBe(first.project.id)
    expect(repo.listRows(db)).toHaveLength(1)
  })

  it('treats a trailing separator as the same folder', () => {
    const folder = makeFolder('slashes')
    service.registerPath(db, folder)

    expect(service.registerPath(db, `${folder}/`).duplicate).toBe(true)
  })

  it('refuses a folder that is not there', () => {
    expect(() => service.registerPath(db, '/no/such/folder/anywhere')).toThrow(
      /does not exist/
    )
  })
})

describe('listProjects', () => {
  it('marks a folder that has gone away and keeps its last known branch', () => {
    const folder = makeFolder('vanishing')
    mkdirSync(join(folder, '.git'))
    writeFileSync(join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    service.registerPath(db, folder)

    rmSync(folder, { recursive: true, force: true })

    const [project] = service.listProjects(db)
    expect(project.missing).toBe(true)
    // Stale, but better than blank — and honestly labelled by `missing`.
    expect(project.branch).toBe('main')
  })

  it('re-reads the branch on every list, so a checkout shows up', () => {
    const folder = makeFolder('switching')
    const head = join(folder, '.git', 'HEAD')
    mkdirSync(join(folder, '.git'))
    writeFileSync(head, 'ref: refs/heads/main\n')
    service.registerPath(db, folder)

    writeFileSync(head, 'ref: refs/heads/phase-4\n')

    expect(service.listProjects(db)[0].branch).toBe('phase-4')
    // …and the cache was updated, not just the returned value.
    expect(repo.listRows(db)[0].branch).toBe('phase-4')
  })
})

describe('requireProjectRoot', () => {
  it('resolves a live project to its folder', () => {
    const folder = makeFolder('live')
    const { project } = service.registerPath(db, folder)

    expect(service.requireProjectRoot(db, project.id).root).toBe(folder)
  })

  /** One clear error, rather than an ENOENT from deep inside a read. */
  it('explains a missing folder instead of letting fs fail later', () => {
    const folder = makeFolder('gone')
    const { project } = service.registerPath(db, folder)
    rmSync(folder, { recursive: true, force: true })

    expect(() => service.requireProjectRoot(db, project.id)).toThrow(
      /no longer at/
    )
  })

  it('rejects an unknown id', () => {
    expect(() => service.requireProjectRoot(db, 'nope')).toThrow(/No such project/)
  })
})
