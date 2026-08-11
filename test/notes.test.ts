import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

// db/slots reaches db/curriculum, which is clean, but the day-card read is the
// thing under test here and it must run against the real schema.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const notes = await import('../src/main/db/notes')
const slots = await import('../src/main/db/slots')
const repo = await import('../src/main/db/curriculum')
const { makeDb, seedSlot } = await import('./helpers')

const GOAL = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing. Generative type.',
  deadline: '2026-08-31',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

describe('goal notes', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('round-trips a note with both of its dates', () => {
    const goal = repo.create(db, GOAL, '2026-08-10')
    const note = notes.createNote(db, {
      curriculumId: goal.id,
      body: 'Review the shader uniforms',
      surfaceDate: '2026-08-12',
      learnedDate: '2026-08-08'
    })

    expect(note.body).toBe('Review the shader uniforms')
    expect(note.surfaceDate).toBe('2026-08-12')
    expect(note.learnedDate).toBe('2026-08-08')
    expect(note.status).toBe('active')
    // Denormalised for the card, same as a slot's source label.
    expect(note.goalTitle).toBe('Become a Creative Technologist')
    expect(note.goalColor).toBe(goal.color)
  })

  it('allows a note with no goal behind it', () => {
    const note = notes.createNote(db, {
      curriculumId: null,
      body: 'Dentist paperwork',
      surfaceDate: '2026-08-12'
    })

    expect(note.curriculumId).toBeNull()
    expect(note.goalTitle).toBeNull()
    expect(note.learnedDate).toBeNull()
  })

  /** The whole reason the table exists. */
  it('never appears among a day’s slots', () => {
    seedSlot(db, { date: '2026-08-12', title: 'Real task' })
    notes.createNote(db, {
      curriculumId: null,
      body: 'Just a reminder',
      surfaceDate: '2026-08-12'
    })

    const [card] = slots.listRange(db, '2026-08-12', '2026-08-12')

    expect(card.slots).toHaveLength(1)
    expect(card.slots[0].title).toBe('Real task')
    expect(card.notes).toHaveLength(1)
    expect(card.notes[0].body).toBe('Just a reminder')
  })

  it('lands on its surface date and no other day in the window', () => {
    notes.createNote(db, {
      curriculumId: null,
      body: 'Wednesday review',
      surfaceDate: '2026-08-12'
    })

    const cards = slots.listRange(db, '2026-08-10', '2026-08-14')

    expect(cards.map((c) => c.notes.length)).toEqual([0, 0, 1, 0, 0])
  })

  it('drops off the deck once dismissed, without being deleted', () => {
    const note = notes.createNote(db, {
      curriculumId: null,
      body: 'Seen it',
      surfaceDate: '2026-08-12'
    })

    notes.updateNote(db, note.id, { status: 'dismissed' })

    const [card] = slots.listRange(db, '2026-08-12', '2026-08-12')
    expect(card.notes).toHaveLength(0)
    // Still there for the admin list, and restorable.
    expect(notes.listForGoal(db, null)).toHaveLength(1)
    expect(notes.getNote(db, note.id).status).toBe('dismissed')
  })

  it('moves to a new day when its date is edited', () => {
    const note = notes.createNote(db, {
      curriculumId: null,
      body: 'Shift me',
      surfaceDate: '2026-08-12'
    })

    notes.updateNote(db, note.id, { surfaceDate: '2026-08-14' })

    const cards = slots.listRange(db, '2026-08-12', '2026-08-14')
    expect(cards[0].notes).toHaveLength(0)
    expect(cards[2].notes).toHaveLength(1)
  })

  it('lists only the goal asked for', () => {
    const a = repo.create(db, GOAL, '2026-08-10')
    const b = repo.create(db, { ...GOAL, title: 'Learn Rust' }, '2026-08-10')

    notes.createNote(db, {
      curriculumId: a.id,
      body: 'A note',
      surfaceDate: '2026-08-12'
    })
    notes.createNote(db, {
      curriculumId: b.id,
      body: 'B note',
      surfaceDate: '2026-08-13'
    })

    expect(notes.listForGoal(db, a.id).map((n) => n.body)).toEqual(['A note'])
    expect(notes.listForGoal(db, null)).toHaveLength(2)
  })

  it('goes with the goal when the goal is deleted', () => {
    const goal = repo.create(db, GOAL, '2026-08-10')
    notes.createNote(db, {
      curriculumId: goal.id,
      body: 'Attached',
      surfaceDate: '2026-08-12'
    })

    db.prepare(`DELETE FROM curricula WHERE id = ?`).run(goal.id)

    expect(notes.listForGoal(db, null)).toHaveLength(0)
  })

  it('deletes outright when asked', () => {
    const note = notes.createNote(db, {
      curriculumId: null,
      body: 'Gone',
      surfaceDate: '2026-08-12'
    })

    notes.deleteNote(db, note.id)

    expect(notes.listForGoal(db, null)).toHaveLength(0)
    expect(() => notes.getNote(db, note.id)).toThrow(/not found/i)
  })
})
