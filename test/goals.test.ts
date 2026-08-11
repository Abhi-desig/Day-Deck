import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

// services/curriculum reaches secrets.ts, which imports electron at module
// scope. None of the multi-goal arithmetic touches the keychain.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const repo = await import('../src/main/db/curriculum')
const slots = await import('../src/main/db/slots')
const { getOverview, setDailyCap, archiveGoal } = await import(
  '../src/main/services/curriculum'
)
const { makeDb } = await import('./helpers')

const input = (over: Partial<Parameters<typeof repo.create>[1]> = {}) => ({
  title: 'Creative Technologist',
  rawText: 'Shaders. Physical computing.',
  deadline: '2026-12-31',
  minutesPerDay: 60,
  restDays: [],
  model: 'gemini-3.5-flash',
  ...over
})

function makeGoal(
  db: TestDb,
  over: Partial<Parameters<typeof repo.create>[1]> = {},
  topics = 3
) {
  const curriculum = repo.create(db, input(over), '2026-08-10')
  const created = repo.replaceTopics(
    db,
    curriculum.id,
    Array.from({ length: topics }, (_, i) => ({
      seq: i + 1,
      module: null,
      title: `${curriculum.title} topic ${i + 1}`,
      detail: null,
      estMinutes: 60
    }))
  )
  repo.applyAssignments(
    db,
    created.map((t, i) => ({
      topicId: t.id,
      date: `2026-08-${String(10 + i).padStart(2, '0')}`
    }))
  )
  repo.materialise(db, curriculum.id)
  return curriculum
}

describe('several goals at once', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('keeps every goal active — a new one never replaces the last', () => {
    makeGoal(db, { title: 'Creative Technologist' })
    makeGoal(db, { title: 'Ship an iOS app' })

    const active = repo.listActive(db)
    expect(active).toHaveLength(2)
    expect(active.map((c) => c.title)).toEqual([
      'Creative Technologist',
      'Ship an iOS app'
    ])
  })

  it('gives each goal its own colour until the palette runs out', () => {
    const colors = Array.from({ length: 6 }, (_, i) =>
      makeGoal(db, { title: `Goal ${i}` }, 1).color
    )

    // First five are distinct; the sixth wraps rather than failing.
    expect(new Set(colors.slice(0, 5)).size).toBe(5)
    expect(colors[5]).toBe(colors[0])
  })

  it('adds up every goal’s slice against the daily cap', () => {
    makeGoal(db, { title: 'A', minutesPerDay: 60 })
    makeGoal(db, { title: 'B', minutesPerDay: 45 })

    const overview = getOverview(db)
    expect(overview.plans).toHaveLength(2)
    expect(overview.committedMinutes).toBe(105)
    expect(overview.dailyCapMinutes).toBe(150)
    expect(overview.overCap).toBe(false)
  })

  it('flags an over-commitment instead of refusing the goal', () => {
    makeGoal(db, { title: 'A', minutesPerDay: 90 })
    makeGoal(db, { title: 'B', minutesPerDay: 90 })

    const overview = getOverview(db)
    expect(overview.committedMinutes).toBe(180)
    expect(overview.overCap).toBe(true)
    // The goals still exist — the app reports, it does not veto.
    expect(overview.plans).toHaveLength(2)
  })

  it('persists a changed cap', () => {
    makeGoal(db, { title: 'A', minutesPerDay: 90 })

    expect(setDailyCap(db, 60).overCap).toBe(true)
    expect(getOverview(db).dailyCapMinutes).toBe(60)

    expect(setDailyCap(db, 240).overCap).toBe(false)
  })

  it('archiving one goal leaves the others’ work on the deck', () => {
    const a = makeGoal(db, { title: 'Keep me' })
    const b = makeGoal(db, { title: 'Bin me' })

    archiveGoal(db, b.id)

    expect(repo.listActive(db).map((c) => c.id)).toEqual([a.id])

    const remaining = slots
      .listRange(db, '2026-08-01', '2026-08-31')
      .flatMap((card) => card.slots)
    expect(remaining).toHaveLength(3)
    expect(remaining.every((s) => s.sourceLabel === 'Keep me')).toBe(true)
  })

  it('labels each slot with the goal that produced it', () => {
    makeGoal(db, { title: 'Creative Technologist', minutesPerDay: 60 })
    makeGoal(db, { title: 'Ship an iOS app', minutesPerDay: 45 })

    const day = slots
      .listRange(db, '2026-08-10', '2026-08-10')[0]
      .slots.map((s) => ({ label: s.sourceLabel, color: s.sourceColor }))

    expect(day).toHaveLength(2)
    expect(day.map((d) => d.label).sort()).toEqual([
      'Creative Technologist',
      'Ship an iOS app'
    ])
    // Distinct colours are what make the two readable on one card.
    expect(new Set(day.map((d) => d.color)).size).toBe(2)
  })

  it('leaves non-curriculum slots unlabelled', () => {
    const slot = slots.createSlot(db, {
      date: '2026-08-10',
      title: 'Write the brief'
    })
    expect(slot.sourceLabel).toBeNull()
    expect(slot.sourceColor).toBeNull()
  })
})
