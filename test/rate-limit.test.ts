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

const limiter = await import('../src/main/services/rate-limit')
const { setSetting, SETTING } = await import('../src/main/db/settings')
const { makeDb } = await import('./helpers')

/**
 * The proactive half of rate control: a bucket per feature slot, refilled
 * continuously, in front of every Gemini call. Time is passed in, so these
 * tests never sleep.
 */

let db: TestDb
const T0 = 1_755_000_000_000

beforeEach(() => {
  db = makeDb()
  limiter.resetBuckets()
})

describe('the token bucket', () => {
  it('allows a burst up to the rate, then refuses with a wait', () => {
    setSetting(db, SETTING.geminiRatePerMinute, '3')

    limiter.takeToken(db, 'scenes', T0)
    limiter.takeToken(db, 'scenes', T0)
    limiter.takeToken(db, 'scenes', T0)
    expect(() => limiter.takeToken(db, 'scenes', T0)).toThrow(/rate limit/i)
  })

  it('refills continuously rather than at the top of a minute', () => {
    setSetting(db, SETTING.geminiRatePerMinute, '6')
    for (let i = 0; i < 6; i++) limiter.takeToken(db, 'goals', T0)
    expect(() => limiter.takeToken(db, 'goals', T0)).toThrow(/rate limit/i)

    // 6 a minute is one every 10 seconds. 10s later there is exactly one.
    limiter.takeToken(db, 'goals', T0 + 10_000)
    expect(() => limiter.takeToken(db, 'goals', T0 + 10_000)).toThrow()
  })

  it('never stockpiles beyond the rate', () => {
    setSetting(db, SETTING.geminiRatePerMinute, '2')
    // An hour of silence still only buys the burst size.
    limiter.takeToken(db, 'agent', T0)
    limiter.takeToken(db, 'agent', T0 + 3_600_000)
    limiter.takeToken(db, 'agent', T0 + 3_600_000)
    expect(() =>
      limiter.takeToken(db, 'agent', T0 + 3_600_000)
    ).toThrow(/rate limit/i)
  })

  it('gives every slot its own bucket', () => {
    setSetting(db, SETTING.geminiRatePerMinute, '1')
    limiter.takeToken(db, 'scenes', T0)
    // scenes is spent; prompts is untouched.
    expect(() => limiter.takeToken(db, 'scenes', T0)).toThrow()
    limiter.takeToken(db, 'prompts', T0)
  })

  it('says how long to wait', () => {
    setSetting(db, SETTING.geminiRatePerMinute, '6')
    for (let i = 0; i < 6; i++) limiter.takeToken(db, 'default', T0)
    expect(() => limiter.takeToken(db, 'default', T0)).toThrow(/about 10s/)
  })
})

describe('the configured rate', () => {
  it('defaults sensibly and clamps what is saved', () => {
    expect(limiter.ratePerMinute(db)).toBe(8)

    expect(limiter.setRatePerMinute(db, 20)).toBe(20)
    expect(limiter.ratePerMinute(db)).toBe(20)

    expect(limiter.setRatePerMinute(db, 0)).toBe(1)
    expect(limiter.setRatePerMinute(db, 500)).toBe(60)
    expect(() => limiter.setRatePerMinute(db, Number.NaN)).toThrow()
  })

  it('degrades a hand-edited setting to the default', () => {
    setSetting(db, SETTING.geminiRatePerMinute, 'lots please')
    expect(limiter.ratePerMinute(db)).toBe(8)
  })
})
