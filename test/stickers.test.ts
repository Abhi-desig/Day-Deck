import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const repo = await import('../src/main/db/stickers')
const { sweepStickers } = await import('../src/main/services/stickers')
const { bootstrap } = await import('../src/main/services/bootstrap')
const { makeDb } = await import('./helpers')

const TODAY = '2026-08-12'

const base = {
  body: 'A note',
  color: 'butter' as const,
  kind: 'permanent' as const,
  expiresAt: null,
  attachedDate: null,
  x: 10,
  y: 20,
  rotation: 2
}

describe('stickers', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('round-trips a note with its position and tilt', () => {
    const sticker = repo.createSticker(db, {
      ...base,
      body: 'Remember the shader uniforms',
      x: 128,
      y: 64,
      rotation: -3.5
    })

    expect(sticker.body).toBe('Remember the shader uniforms')
    expect(sticker.x).toBe(128)
    expect(sticker.y).toBe(64)
    expect(sticker.rotation).toBe(-3.5)
    expect(sticker.kind).toBe('permanent')
  })

  it('moves without touching anything else', () => {
    const sticker = repo.createSticker(db, { ...base, body: 'Drag me' })

    const moved = repo.updateSticker(db, sticker.id, { x: 400, y: 250 })

    expect(moved.x).toBe(400)
    expect(moved.y).toBe(250)
    expect(moved.body).toBe('Drag me')
    expect(moved.rotation).toBe(sticker.rotation)
  })

  it('falls back to butter for a colour it does not recognise', () => {
    // The column is plain TEXT and defaults to 'amber' from the v1 schema, so
    // this is the state every pre-existing row would be in.
    db.prepare(
      `INSERT INTO stickers (id, body, color, kind, x, y, rotation, created_at)
       VALUES ('legacy', 'Old note', 'amber', 'permanent', 0, 0, 0, ?)`
    ).run(new Date().toISOString())

    expect(repo.getSticker(db, 'legacy').color).toBe('butter')
  })

  it('lists the notes pinned to one day', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'On the 12th',
      attachedDate: TODAY
    })
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'On the 13th',
      attachedDate: '2026-08-13'
    })
    repo.createSticker(db, { ...base, body: 'Wall only' })

    expect(repo.listForDate(db, TODAY).map((s) => s.body)).toEqual(['On the 12th'])
  })
})

describe('the launch sweep', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('clears a temp note whose expiry has passed', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Gone',
      expiresAt: '2026-08-11'
    })

    const swept = sweepStickers(db, TODAY)

    expect(swept.map((s) => s.body)).toEqual(['Gone'])
    expect(repo.listStickers(db)).toHaveLength(0)
  })

  /** Today is still today — a note expiring now has not expired yet. */
  it('keeps a note expiring today', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Still here',
      expiresAt: TODAY
    })

    expect(sweepStickers(db, TODAY)).toHaveLength(0)
    expect(repo.listStickers(db)).toHaveLength(1)
  })

  it('keeps a note pinned to today and clears one pinned to yesterday', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Today',
      attachedDate: TODAY
    })
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Yesterday',
      attachedDate: '2026-08-11'
    })

    const swept = sweepStickers(db, TODAY)

    expect(swept.map((s) => s.body)).toEqual(['Yesterday'])
    expect(repo.listStickers(db).map((s) => s.body)).toEqual(['Today'])
  })

  /** The entire meaning of the kind. */
  it('never touches a permanent note however old', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'permanent',
      body: 'Kept',
      expiresAt: '2020-01-01',
      attachedDate: '2020-01-01'
    })

    expect(sweepStickers(db, TODAY)).toHaveLength(0)
    expect(repo.listStickers(db)).toHaveLength(1)
  })

  /** An explicit expiry is the stronger signal when a note carries both. */
  it('prefers the expiry date over the attached day', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Pinned to a past day but not due to expire',
      attachedDate: '2026-08-01',
      expiresAt: '2026-08-20'
    })

    expect(sweepStickers(db, TODAY)).toHaveLength(0)
    expect(repo.listStickers(db)).toHaveLength(1)
  })

  it('is a no-op on an empty wall', () => {
    expect(sweepStickers(db, TODAY)).toEqual([])
  })

  it('runs during bootstrap and reports what it cleared', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Expired long ago',
      expiresAt: '2020-01-01'
    })
    repo.createSticker(db, { ...base, body: 'Kept' })

    const result = bootstrap(db)

    expect(result.expiredStickers.map((s) => s.body)).toEqual([
      'Expired long ago'
    ])
    expect(repo.listStickers(db).map((s) => s.body)).toEqual(['Kept'])
  })

  it('has nothing left to do on the second launch', () => {
    repo.createSticker(db, {
      ...base,
      kind: 'temp',
      body: 'Gone',
      expiresAt: '2020-01-01'
    })

    expect(bootstrap(db).expiredStickers).toHaveLength(1)
    expect(bootstrap(db).expiredStickers).toHaveLength(0)
  })
})
