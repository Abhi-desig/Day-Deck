import { describe, expect, it } from 'vitest'
import {
  addDays,
  diffDays,
  isValidKey,
  labelFor,
  parseMinutes,
  formatMinutes,
  rangeKeys,
  startOfWeek,
  weekdayOf
} from '../src/shared/date'

describe('date key arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-09', 1)).toBe('2026-08-10')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2)
  })

  /**
   * The whole reason the helpers use Date.UTC on components: naive local
   * midnight subtraction is 23 or 25 hours across these boundaries, which
   * rounds to the wrong number of days.
   */
  it('stays exact across daylight-saving transitions', () => {
    // US spring forward (2026-03-08) and fall back (2026-11-01).
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2)
    // EU transitions.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2)
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2)

    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('round-trips addDays and diffDays over a long span', () => {
    const start = '2026-08-09'
    expect(diffDays(start, addDays(start, 0))).toBe(0)
    for (const n of [1, 7, 30, 180, 365, 511]) {
      expect(diffDays(start, addDays(start, n))).toBe(n)
      expect(diffDays(start, addDays(start, -n))).toBe(-n)
    }
  })

  it('validates keys', () => {
    expect(isValidKey('2026-08-09')).toBe(true)
    expect(isValidKey('2026-02-30')).toBe(false)
    expect(isValidKey('2026-13-01')).toBe(false)
    expect(isValidKey('2026-8-9')).toBe(false)
    expect(isValidKey('nonsense')).toBe(false)
  })
})

describe('weeks', () => {
  it('treats Monday as the start of the week', () => {
    // 2026-08-09 is a Sunday, so its week began Monday 2026-08-03.
    expect(weekdayOf('2026-08-09')).toBe(0)
    expect(startOfWeek('2026-08-09')).toBe('2026-08-03')
    expect(startOfWeek('2026-08-03')).toBe('2026-08-03')
    expect(startOfWeek('2026-08-04')).toBe('2026-08-03')
    expect(startOfWeek('2026-08-08')).toBe('2026-08-03')
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10')
  })

  it('gives every day in a range, inclusive', () => {
    expect(rangeKeys('2026-08-09', '2026-08-12')).toEqual([
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12'
    ])
    expect(rangeKeys('2026-08-09', '2026-08-09')).toEqual(['2026-08-09'])
  })
})

describe('labels and times', () => {
  it('describes days relative to today', () => {
    const today = '2026-08-09'
    expect(labelFor(today, today).relative).toBe('Today')
    expect(labelFor('2026-08-10', today).relative).toBe('Tomorrow')
    expect(labelFor('2026-08-08', today).relative).toBe('Yesterday')
    expect(labelFor('2026-08-13', today).relative).toBe('in 4 days')
    expect(labelFor('2026-08-06', today).relative).toBe('3 days ago')

    expect(labelFor(today, today).isToday).toBe(true)
    expect(labelFor('2026-08-08', today).isPast).toBe(true)
    expect(labelFor('2026-08-09', today).isWeekend).toBe(true)
    expect(labelFor('2026-08-10', today).isWeekend).toBe(false)
  })

  it('formats and parses clock minutes', () => {
    expect(formatMinutes(0)).toBe('00:00')
    expect(formatMinutes(540)).toBe('09:00')
    expect(formatMinutes(1439)).toBe('23:59')

    expect(parseMinutes('09:30')).toBe(570)
    expect(parseMinutes('9:30')).toBe(570)
    expect(parseMinutes('0930')).toBe(570)
    expect(parseMinutes('24:00')).toBeNull()
    expect(parseMinutes('09:60')).toBeNull()
    expect(parseMinutes('later')).toBeNull()
  })
})
