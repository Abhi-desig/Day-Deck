import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test', getVersion: () => '0.1.0' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const { BackupError, exportBackup, importBackup } = await import(
  '../src/main/services/backup'
)
const { MIGRATIONS } = await import('../src/main/db/migrations')
const curricula = await import('../src/main/db/curriculum')
const notes = await import('../src/main/db/notes')
const stickers = await import('../src/main/db/stickers')
const slots = await import('../src/main/db/slots')
const { makeDb, seedSlot } = await import('./helpers')

const GOAL = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing.',
  deadline: '2026-08-31',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

/** A database with something from every table that matters. */
function populate(db: TestDb) {
  const curriculum = curricula.create(db, GOAL, '2026-08-10')
  const [topic] = curricula.replaceTopics(db, curriculum.id, [
    {
      seq: 1,
      module: 'Foundations',
      title: 'Shaders',
      detail: 'A working shader',
      estMinutes: 60
    }
  ])
  curricula.applyAssignments(db, [{ topicId: topic.id, date: '2026-08-12' }])
  curricula.setTopicPoints(db, curriculum.id, [
    { topicId: topic.id, points: ['Sample a texture', 'Blend two colours'] }
  ])
  curricula.materialise(db, curriculum.id)

  notes.createNote(db, {
    curriculumId: curriculum.id,
    body: 'Review the uniforms',
    surfaceDate: '2026-08-14',
    learnedDate: '2026-08-08'
  })

  stickers.createSticker(db, {
    body: 'A note on the wall',
    color: 'mint',
    kind: 'permanent',
    expiresAt: null,
    attachedDate: null,
    x: 120,
    y: 80,
    rotation: -2
  })

  db.prepare(
    `INSERT INTO projects (id, name, path, color, pinned, sort_index, created_at)
     VALUES ('p1', 'Day Deck', '/tmp/day-deck', 'sky', 1, 0, ?)`
  ).run(new Date().toISOString())

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('goals.daily_cap_minutes', '210')`
  ).run()

  return { curriculum, topic }
}

describe('export', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('stamps the schema version it was taken at', () => {
    const backup = exportBackup(db, '0.1.0')

    expect(backup.userVersion).toBe(MIGRATIONS.length)
    expect(backup.format).toBe(1)
    expect(backup.app).toBe('0.1.0')
    expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('includes every table, even the empty ones', () => {
    const backup = exportBackup(db, '0.1.0')

    for (const table of [
      'settings',
      'projects',
      'curricula',
      'topics',
      'weekly_templates',
      'weekly_seed_log',
      'notify_log',
      'sticker_folders',
      'stickers',
      'goal_notes',
      'tags',
      'storyboards',
      'storyboard_frames',
      'slots',
      'slot_tags'
    ]) {
      expect(backup.tables[table]).toBeDefined()
    }
  })
})

describe('round trip', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('restores everything into an empty database', () => {
    const source = makeDb()
    const { curriculum } = populate(source)
    const backup = exportBackup(source, '0.1.0')

    const summary = importBackup(db, JSON.stringify(backup))

    expect(summary.fromVersion).toBe(MIGRATIONS.length)
    expect(summary.total).toBeGreaterThan(0)

    const restored = curricula.getById(db, curriculum.id)
    expect(restored?.title).toBe('Become a Creative Technologist')

    const topics = curricula.listTopics(db, curriculum.id)
    expect(topics).toHaveLength(1)
    // Points survive as points, not as the raw JSON string.
    expect(topics[0].points).toEqual(['Sample a texture', 'Blend two colours'])

    const [card] = slots.listRange(db, '2026-08-12', '2026-08-12')
    expect(card.slots).toHaveLength(1)
    expect(card.slots[0].sourcePoints).toEqual([
      'Sample a texture',
      'Blend two colours'
    ])

    expect(notes.listForGoal(db, null)).toHaveLength(1)
    expect(stickers.listStickers(db).map((s) => s.color)).toEqual(['mint'])
  })

  it('replaces what was already there rather than merging into it', () => {
    populate(db)
    seedSlot(db, { date: '2026-08-20', title: 'Should not survive' })

    const empty = makeDb()
    const summary = importBackup(db, JSON.stringify(exportBackup(empty, '0.1.0')))

    // Everything a fresh database seeds: three weekly templates and the one
    // starter Amber tag from v6.
    expect(summary.total).toBe(4)
    expect(curricula.listActive(db)).toHaveLength(0)
    expect(stickers.listStickers(db)).toHaveLength(0)
    expect(slots.listRange(db, '2026-08-01', '2026-08-31')
      .flatMap((c) => c.slots)).toHaveLength(0)
  })

  /**
   * `slots.rolled_from` points at another slot, and nothing guarantees the
   * tombstone appears in the file before the row referencing it.
   */
  it('restores a carried slot whose tombstone comes later in the file', () => {
    const source = makeDb()
    const tombstone = seedSlot(source, {
      id: 'zz-tombstone', // sorts after the carried row
      date: '2026-08-10',
      title: 'Missed',
      status: 'rolled'
    })
    source
      .prepare(
        `INSERT INTO slots (id, date, duration_min, title, source, category,
                            status, rolled_from, roll_count, sort_index, created_at)
         VALUES ('aa-carried', '2026-08-11', 30, 'Carried', 'manual',
                 'personal_learning', 'open', ?, 1, 0, ?)`
      )
      .run(tombstone, new Date().toISOString())

    const backup = exportBackup(source, '0.1.0')
    // Force the awkward ordering rather than hoping the query produced it.
    backup.tables.slots.sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    )

    expect(() => importBackup(db, JSON.stringify(backup))).not.toThrow()

    const carried = db
      .prepare(`SELECT rolled_from FROM slots WHERE id = 'aa-carried'`)
      .get() as { rolled_from: string }
    expect(carried.rolled_from).toBe('zz-tombstone')
  })

  it('leaves the database untouched when the restore fails partway', () => {
    populate(db)
    const before = curricula.listActive(db).length

    const backup = exportBackup(makeDb(), '0.1.0')
    // A topic pointing at a curriculum that is not in the file: the insert
    // violates the foreign key, and the whole transaction must roll back.
    backup.tables.topics = [
      {
        id: 't-orphan',
        curriculum_id: 'no-such-curriculum',
        seq: 1,
        module: null,
        title: 'Orphan',
        detail: null,
        est_minutes: 60,
        assigned_date: null,
        status: 'pending',
        points: '[]'
      }
    ]

    expect(() => importBackup(db, JSON.stringify(backup))).toThrow()

    // Everything that was here before is still here.
    expect(curricula.listActive(db)).toHaveLength(before)
    expect(stickers.listStickers(db)).toHaveLength(1)
  })
})

describe('refusing a bad file', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('rejects a backup from a newer schema instead of dropping columns', () => {
    const backup = exportBackup(makeDb(), '0.1.0')
    backup.userVersion = MIGRATIONS.length + 1

    expect(() => importBackup(db, JSON.stringify(backup))).toThrow(BackupError)
    expect(() => importBackup(db, JSON.stringify(backup))).toThrow(
      /newer version of Day Deck/i
    )
  })

  it('accepts a backup from an older schema', () => {
    const backup = exportBackup(makeDb(), '0.1.0')
    backup.userVersion = 1

    const summary = importBackup(db, JSON.stringify(backup))

    expect(summary.fromVersion).toBe(1)
  })

  /** Forward-only migrations mean an old file simply lacks the newer columns. */
  it('gives a column an older backup never had its default', () => {
    const backup = exportBackup(makeDb(), '0.1.0')
    backup.userVersion = 4
    backup.tables.curricula = [
      {
        id: 'c-old',
        title: 'Pre-v5 goal',
        start_date: '2026-08-01',
        deadline: '2026-12-31',
        raw_text: 'text',
        model: 'gemini-3.5-flash',
        minutes_per_day: 90,
        rest_days: '[]',
        status: 'active',
        color: 'amber',
        sort_index: 0,
        created_at: '2026-08-01T00:00:00Z'
      }
    ]
    backup.tables.topics = [
      {
        id: 't-old',
        curriculum_id: 'c-old',
        seq: 1,
        module: null,
        title: 'No points column in v4',
        detail: null,
        est_minutes: 60,
        assigned_date: null,
        status: 'pending'
      }
    ]

    importBackup(db, JSON.stringify(backup))

    expect(curricula.listTopics(db, 'c-old')[0].points).toEqual([])
  })

  it('rejects something that is not JSON at all', () => {
    expect(() => importBackup(db, 'not json')).toThrow(/not valid JSON/i)
  })

  it('rejects JSON that is not a Day Deck backup', () => {
    expect(() => importBackup(db, JSON.stringify({ hello: 'world' }))).toThrow(
      /not a Day Deck backup/i
    )
  })

  it('rejects an envelope format it does not know', () => {
    const backup = exportBackup(makeDb(), '0.1.0')
    backup.format = 99

    expect(() => importBackup(db, JSON.stringify(backup))).toThrow(/format 99/)
  })
})

const { homedir } = await import('node:os')
const { dirname } = await import('node:path')

describe('refusing a project root broad enough to be the disk', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeDb()
  })

  const home = homedir()

  function backupWithProjectAt(path: string): string {
    const parsed = exportBackup(db, '0.1.0')
    parsed.tables.projects = [
      {
        id: 'p-evil',
        name: 'Everything',
        path,
        kind: 'code',
        entry_path: null,
        color: 'amber',
        branch: null,
        last_opened_at: null,
        pinned: 0,
        sort_index: 0,
        created_at: 'now'
      }
    ]
    return JSON.stringify(parsed)
  }

  it('refuses /, the home directory, and ancestors of home', () => {
    for (const path of ['/', home, dirname(home)]) {
      expect(() => importBackup(makeDb(), backupWithProjectAt(path))).toThrow(
        BackupError
      )
    }
  })

  it('refuses a relative or fake path', () => {
    expect(() =>
      importBackup(makeDb(), backupWithProjectAt('not/absolute'))
    ).toThrow(BackupError)
  })

  it('accepts an ordinary project folder inside home', () => {
    const fine = `${home}/code/some-project`
    expect(() => importBackup(makeDb(), backupWithProjectAt(fine))).not.toThrow()
  })
})
