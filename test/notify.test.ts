import { beforeEach, describe, expect, it } from 'vitest'
import {
  alreadyClaimed,
  buildEvening,
  buildMorning,
  claim,
  decide,
  GRACE_MINUTES,
  getPrefs,
  setPrefs
} from '../src/main/services/notify'
import { makeDb, seedSlot, type TestDb } from './helpers'

const DAY = '2026-08-09'
const NINE = 9 * 60

const enableMorning = (db: TestDb, at = NINE) =>
  setPrefs(db, {
    morningEnabled: true,
    morningMin: at,
    eveningEnabled: false,
    eveningMin: 21 * 60
  })

describe('reminder preferences', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('is silent until switched on', () => {
    const prefs = getPrefs(db)
    expect(prefs.morningEnabled).toBe(false)
    expect(prefs.eveningEnabled).toBe(false)
  })

  it('round-trips through the settings table', () => {
    setPrefs(db, {
      morningEnabled: true,
      morningMin: 7 * 60 + 30,
      eveningEnabled: true,
      eveningMin: 22 * 60
    })

    expect(getPrefs(db)).toEqual({
      morningEnabled: true,
      morningMin: 450,
      eveningEnabled: true,
      eveningMin: 1320
    })
  })

  it('clamps a nonsense time rather than storing it', () => {
    setPrefs(db, {
      morningEnabled: true,
      morningMin: 99_999,
      eveningEnabled: false,
      eveningMin: -5
    })

    const prefs = getPrefs(db)
    expect(prefs.morningMin).toBe(1439)
    expect(prefs.eveningMin).toBe(0)
  })
})

describe('brief content', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
  })

  it('says nothing at all on an empty day', () => {
    expect(buildMorning(db, DAY)).toBeNull()
    expect(buildEvening(db, DAY)).toBeNull()
  })

  it('ignores work that is already done', () => {
    seedSlot(db, { date: DAY, status: 'done', title: 'Finished' })
    expect(buildMorning(db, DAY)).toBeNull()
  })

  it('counts the open work and names the first timed task', () => {
    seedSlot(db, { date: DAY, title: 'Anytime thing' })
    seedSlot(db, { date: DAY, title: 'Weekly amber sync', startMin: 600 })

    const brief = buildMorning(db, DAY)
    expect(brief?.title).toBe('Today · 2 tasks · 1h')
    expect(brief?.body).toContain('Weekly amber sync at 10:00')
  })

  it('falls back gracefully when nothing is pinned to a time', () => {
    seedSlot(db, { date: DAY, title: 'Whenever' })
    expect(buildMorning(db, DAY)?.body).toContain('Nothing is pinned to a time')
  })

  it('truncates a long unfinished list in the evening', () => {
    for (let i = 0; i < 5; i++) {
      seedSlot(db, { date: DAY, title: `Task ${i}` })
    }

    const brief = buildEvening(db, DAY)
    expect(brief?.title).toBe('5 tasks still open')
    expect(brief?.body).toContain('+2 more')
  })
})

describe('the once-a-day guard', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
    seedSlot(db, { date: DAY, title: 'Something to do', startMin: 600 })
  })

  it('only lets one caller claim a brief', () => {
    expect(claim(db, DAY, 'morning', true)).toBe(true)
    expect(claim(db, DAY, 'morning', true)).toBe(false)
    expect(alreadyClaimed(db, DAY, 'morning')).toBe(true)
    // The other brief is a separate claim.
    expect(alreadyClaimed(db, DAY, 'evening')).toBe(false)
  })

  it('waits while the brief is switched off', () => {
    expect(decide(db, DAY, NINE, 'morning').action).toBe('wait')
  })

  it('waits until the chosen time', () => {
    enableMorning(db)
    expect(decide(db, DAY, NINE - 1, 'morning').action).toBe('wait')
  })

  it('sends once the time has come', () => {
    enableMorning(db)
    const decision = decide(db, DAY, NINE, 'morning')

    expect(decision.action).toBe('send')
    if (decision.action !== 'send') throw new Error('unreachable')
    expect(decision.brief.title).toContain('1 task')
  })

  it('does not send twice in one day', () => {
    enableMorning(db)
    claim(db, DAY, 'morning', true)
    expect(decide(db, DAY, NINE + 5, 'morning').action).toBe('wait')
  })

  it('skips rather than delivering a stale brief hours late', () => {
    enableMorning(db)
    const decision = decide(db, DAY, NINE + GRACE_MINUTES + 1, 'morning')

    expect(decision.action).toBe('skip')
    if (decision.action !== 'skip') throw new Error('unreachable')
    expect(decision.reason).toBe('too-late')
  })

  it('claims a skipped brief so it cannot fire later', () => {
    enableMorning(db)
    const decision = decide(db, DAY, NINE + GRACE_MINUTES + 1, 'morning')
    expect(decision.action).toBe('skip')

    claim(db, DAY, 'morning', false)
    expect(decide(db, DAY, NINE + GRACE_MINUTES + 2, 'morning').action).toBe(
      'wait'
    )
  })

  it('skips quietly when the day turns out to be empty', () => {
    const empty = makeDb()
    enableMorning(empty)

    const decision = decide(empty, DAY, NINE, 'morning')
    expect(decision.action).toBe('skip')
    if (decision.action !== 'skip') throw new Error('unreachable')
    expect(decision.reason).toBe('empty')
  })
})
