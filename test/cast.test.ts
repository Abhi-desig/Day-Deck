import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageRequest, ImageResult } from '../src/main/services/providers/image-wire'
import { makeDb, type TestDb } from './helpers'

/**
 * Locking a character to a face.
 *
 * Four rules are worth asserting here and the third is the one that is easy to
 * break invisibly: **every pack image must be generated with the approved
 * portrait attached as an input reference**. A pack built by re-prompting the
 * description is five different people who each match the words, and it looks
 * exactly like a working pack until two of its images are put side by side —
 * which no test that only counts rows would ever notice.
 */

let userData: string
/** Every image request the service made, in order. */
let requests: ImageRequest[]
/** What the fake provider will do next. */
let behaviour: { references: number; fail: number }

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

vi.mock('../src/main/services/providers', async () => {
  const actual = await vi.importActual<
    typeof import('../src/main/services/providers')
  >('../src/main/services/providers')
  return {
    ...actual,
    modelFor: () => 'test-image-model',
    imageReferenceLimit: () => behaviour.references,
    generateImage: async (
      _db: unknown,
      req: ImageRequest
    ): Promise<ImageResult[]> => {
      requests.push(req)
      if (behaviour.fail > 0) {
        behaviour.fail -= 1
        throw new actual.AiError('the provider said no', 'server')
      }
      // A one-pixel PNG is enough: nothing here reads the pixels, and a real
      // image would only make the fixture bigger.
      return [{ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' }]
    }
  }
})

const cast = await import('../src/main/services/cast')
const dbCast = await import('../src/main/db/cast')
const boards = await import('../src/main/db/storyboards')
const { PACK_VIEWS } = await import('../src/shared/types')

let db: TestDb

function seedSheet(): string {
  db.prepare(
    `INSERT INTO storyboards (id, title, brief, visual_style, color,
                              sort_index, created_at)
     VALUES ('b1', 'Launch film', 'A brief', '', 'amber', 0, 'now')`
  ).run()
  const sheet = boards.createSheet(db, {
    boardId: 'b1',
    name: 'Maya',
    description: '24, shoulder-length black hair, grey hoodie'
  })
  return sheet.id
}

const shotFiles = (): string[] =>
  readdirSync(join(userData, 'shots')).filter((n) => n.endsWith('.png'))

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'deck-cast-'))
  requests = []
  behaviour = { references: 3, fail: 0 }
  db = makeDb()
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
  db.close()
})

describe('proposing a portrait', () => {
  it('writes a candidate and a file, and does not lock the sheet', async () => {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')

    expect(shot.kind).toBe('candidate')
    expect(shot.view).toBe('')
    expect(shotFiles()).toHaveLength(1)

    const sheet = boards.getSheet(db, sheetId)
    // The candidate exists; *which image is them* is a separate question, and
    // approval is the only thing that answers it.
    expect(sheet.status).toBe('proposed')
    expect(sheet.portraitId).toBeNull()
    expect(sheet.lockedAt).toBeNull()
  })

  it('sends no reference — a first portrait has nothing to be anchored to', async () => {
    await cast.proposePortrait(db, seedSheet(), '')
    expect(requests[0].references).toHaveLength(0)
  })

  it('keeps every candidate rather than replacing the last one', async () => {
    const sheetId = seedSheet()
    await cast.proposePortrait(db, sheetId, '')
    await cast.proposePortrait(db, sheetId, '')

    expect(dbCast.listShots(db, sheetId)).toHaveLength(2)
    expect(shotFiles()).toHaveLength(2)
  })

  it('refuses a character with no description', async () => {
    db.prepare(
      `INSERT INTO storyboards (id, title, brief, visual_style, color,
                                sort_index, created_at)
       VALUES ('b1', 'F', '', '', 'amber', 0, 'now')`
    ).run()
    const sheet = boards.createSheet(db, { boardId: 'b1', name: 'Nobody' })
    await expect(cast.proposePortrait(db, sheet.id, '')).rejects.toThrow(
      /describe/i
    )
    expect(requests).toHaveLength(0)
  })
})

describe('approving a portrait', () => {
  it('writes the pointer, the status and the timestamp together', async () => {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')

    cast.approvePortrait(db, sheetId, shot.id)

    const sheet = boards.getSheet(db, sheetId)
    expect(sheet.status).toBe('locked')
    expect(sheet.portraitId).toBe(shot.id)
    expect(sheet.lockedAt).not.toBeNull()
  })

  it('refuses an image belonging to somebody else, and writes nothing', async () => {
    const one = seedSheet()
    const two = boards.createSheet(db, { boardId: 'b1', name: 'Dev', description: 'x' })
    const shot = await cast.proposePortrait(db, one, '')

    expect(() => cast.approvePortrait(db, two.id, shot.id)).toThrow(
      /does not belong/i
    )
    expect(boards.getSheet(db, two.id).status).toBe('described')
  })

  it('unlocking clears the pointer and keeps every image', async () => {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')
    cast.approvePortrait(db, sheetId, shot.id)

    cast.unlock(db, sheetId)

    const sheet = boards.getSheet(db, sheetId)
    expect(sheet.status).toBe('described')
    expect(sheet.portraitId).toBeNull()
    expect(dbCast.listShots(db, sheetId)).toHaveLength(1)
    expect(shotFiles()).toHaveLength(1)
  })
})

describe('the reference pack', () => {
  async function lock(): Promise<string> {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')
    cast.approvePortrait(db, sheetId, shot.id)
    requests = []
    return sheetId
  }

  it('generates every view with the approved portrait attached', async () => {
    const sheetId = await lock()
    await cast.buildPack(db, sheetId, () => {})

    expect(requests).toHaveLength(PACK_VIEWS.length)
    // The assertion this whole feature rests on. Without it a pack is five
    // people who match the description rather than one person from five angles.
    for (const req of requests) {
      expect(req.references).toHaveLength(1)
      expect(req.references[0].bytes.byteLength).toBeGreaterThan(0)
    }

    const pack = dbCast.listShots(db, sheetId).filter((s) => s.kind === 'pack')
    expect(pack.map((s) => s.view).sort()).toEqual([...PACK_VIEWS].sort())
  })

  it('reports ready, and counts up on the way', async () => {
    const sheetId = await lock()
    const seen: string[] = []
    await cast.buildPack(db, sheetId, (u) => seen.push(u.phase))

    expect(seen.filter((p) => p === 'building')).toHaveLength(PACK_VIEWS.length)
    expect(seen[seen.length - 1]).toBe('ready')
  })

  it('refuses to build at all when the provider takes no reference', async () => {
    const sheetId = await lock()
    behaviour.references = 0
    const messages: string[] = []
    await cast.buildPack(db, sheetId, (u) => {
      if (u.phase === 'error') messages.push(u.message)
    })

    // Building anyway would produce five plausible strangers that look exactly
    // like a working pack, so nothing is generated and it says why.
    expect(requests).toHaveLength(0)
    expect(messages[0]).toMatch(/reference/i)
  })

  it('degrades to locked with an incomplete pack, reported once', async () => {
    const sheetId = await lock()
    behaviour.fail = 99
    const errors: string[] = []
    await cast.buildPack(db, sheetId, (u) => {
      if (u.phase === 'error') errors.push(u.message)
    })

    expect(errors).toHaveLength(1)
    // The character keeps the portrait they approved. An incomplete pack is a
    // far smaller loss than an unapproved character.
    expect(boards.getSheet(db, sheetId).status).toBe('locked')
  })
})

describe('resuming packs at startup', () => {
  it('finishes a pack a quit left short', async () => {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')
    cast.approvePortrait(db, sheetId, shot.id)
    // Two views in, then the app died.
    behaviour.fail = 0
    await cast.buildPack(db, sheetId, () => {})
    dbCast.deleteShot(
      db,
      dbCast.listShots(db, sheetId).filter((s) => s.kind === 'pack')[0].id
    )
    requests = []

    await cast.resumePacks(db, () => {})

    // Exactly the missing one, not the whole pack again — the rows are the
    // progress, which is why this needs no job table to disagree with.
    expect(requests).toHaveLength(1)
    expect(
      dbCast.listShots(db, sheetId).filter((s) => s.kind === 'pack')
    ).toHaveLength(PACK_VIEWS.length)
  })

  it('is a no-op on a complete pack', async () => {
    const sheetId = seedSheet()
    const shot = await cast.proposePortrait(db, sheetId, '')
    cast.approvePortrait(db, sheetId, shot.id)
    await cast.buildPack(db, sheetId, () => {})
    requests = []

    await cast.resumePacks(db, () => {})
    expect(requests).toHaveLength(0)
  })

  it('ignores a character who was never locked', async () => {
    const sheetId = seedSheet()
    await cast.proposePortrait(db, sheetId, '')
    requests = []

    await cast.resumePacks(db, () => {})
    expect(requests).toHaveLength(0)
  })
})
