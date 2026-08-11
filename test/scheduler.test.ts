import { describe, expect, it } from 'vitest'
import { eligibleDays, schedule } from '../src/main/services/scheduler'
import { diffDays } from '../src/shared/date'

const topics = (count: number, est = 60) =>
  Array.from({ length: count }, (_, i) => ({ id: `t${i}`, estMinutes: est }))

describe('eligibleDays', () => {
  it('includes both endpoints', () => {
    expect(eligibleDays('2026-08-10', '2026-08-12', [])).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12'
    ])
  })

  it('drops rest weekdays', () => {
    // 2026-08-10 is a Monday, so the week runs Mon…Sun.
    const days = eligibleDays('2026-08-10', '2026-08-16', [0, 6])
    expect(days).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14'
    ])
  })

  it('returns nothing when the deadline is already past', () => {
    expect(eligibleDays('2026-08-10', '2026-08-09', [])).toEqual([])
  })

  it('returns nothing when every weekday is a rest day', () => {
    expect(eligibleDays('2026-08-10', '2026-09-10', [0, 1, 2, 3, 4, 5, 6])).toEqual(
      []
    )
  })

  it('refuses absurd windows instead of enumerating them', () => {
    expect(eligibleDays('2026-08-10', '2126-08-10', [])).toEqual([])
  })
})

describe('schedule', () => {
  /** The headline promise: the plan finishes on the deadline, never after. */
  it('lands the last topic exactly on the final eligible day', () => {
    const result = schedule({
      topics: topics(40),
      from: '2026-08-10',
      deadline: '2026-12-31',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.summary.lastDate).toBe('2026-12-31')
    expect(result.summary.bufferDays).toBe(0)
    expect(result.summary.firstDate).toBe('2026-08-10')
  })

  it('never assigns anything after the deadline, across many shapes', () => {
    for (const count of [1, 2, 3, 7, 40, 137, 500]) {
      for (const est of [15, 60, 240]) {
        for (const restDays of [[], [0, 6], [0]]) {
          const result = schedule({
            topics: topics(count, est),
            from: '2026-08-10',
            deadline: '2027-01-31',
            minutesPerDay: 90,
            restDays
          })

          expect(result.assignments).toHaveLength(count)
          for (const a of result.assignments) {
            expect(diffDays(a.date, '2027-01-31')).toBeGreaterThanOrEqual(0)
            expect(diffDays('2026-08-10', a.date)).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('keeps topics in order — a schedule never goes backwards', () => {
    const result = schedule({
      topics: topics(60, 45),
      from: '2026-08-10',
      deadline: '2026-11-30',
      minutesPerDay: 90,
      restDays: [0, 6]
    })

    for (let i = 1; i < result.assignments.length; i++) {
      const previous = result.assignments[i - 1].date
      const current = result.assignments[i].date
      expect(diffDays(previous, current)).toBeGreaterThanOrEqual(0)
    }
  })

  it('never schedules on a rest day', () => {
    const result = schedule({
      topics: topics(30),
      from: '2026-08-10',
      deadline: '2026-10-31',
      minutesPerDay: 90,
      restDays: [0, 6]
    })

    const weekend = result.assignments.filter((a) => {
      const dow = new Date(`${a.date}T00:00:00Z`).getUTCDay()
      return dow === 0 || dow === 6
    })
    expect(weekend).toHaveLength(0)
  })

  /**
   * The regression that motivated proportional placement: greedy packing at a
   * fixed daily budget front-loads whenever a topic exceeds the budget.
   */
  it('spreads uneven topic sizes across the window instead of front-loading', () => {
    const result = schedule({
      topics: [
        { id: 'big-a', estMinutes: 300 },
        { id: 'big-b', estMinutes: 300 },
        { id: 'small', estMinutes: 60 }
      ],
      from: '2026-08-10',
      deadline: '2026-08-19',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.assignments.map((a) => a.date)).toEqual([
      '2026-08-10',
      '2026-08-15',
      '2026-08-19'
    ])
  })

  it('doubles up when there are more topics than days', () => {
    const result = schedule({
      topics: topics(20, 30),
      from: '2026-08-10',
      deadline: '2026-08-19',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.summary.eligibleDays).toBe(10)
    expect(result.summary.daysUsed).toBe(10)
    expect(result.summary.lastDate).toBe('2026-08-19')
  })

  it('puts a single topic on the first day, not the deadline', () => {
    const result = schedule({
      topics: topics(1),
      from: '2026-08-10',
      deadline: '2026-12-31',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.assignments[0].date).toBe('2026-08-10')
  })

  it('flags work that cannot fit in the stated daily minutes', () => {
    const result = schedule({
      topics: topics(10, 120),
      from: '2026-08-10',
      deadline: '2026-08-14',
      minutesPerDay: 60,
      restDays: []
    })

    expect(result.summary.overCapacity).toBe(true)
    expect(result.summary.requiredPerDay).toBe(240)
    // Still assigns everything — the deadline is the hard constraint, and the
    // UI warns rather than silently dropping topics.
    expect(result.assignments).toHaveLength(10)
    expect(result.summary.lastDate).toBe('2026-08-14')
  })

  it('does not flag comfortable plans', () => {
    const result = schedule({
      topics: topics(10, 30),
      from: '2026-08-10',
      deadline: '2026-10-10',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.summary.overCapacity).toBe(false)
    expect(result.summary.totalMinutes).toBe(300)
  })

  it('returns an empty, flagged plan when the deadline has passed', () => {
    const result = schedule({
      topics: topics(5),
      from: '2026-08-10',
      deadline: '2026-08-01',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.assignments).toEqual([])
    expect(result.summary.eligibleDays).toBe(0)
    expect(result.summary.overCapacity).toBe(true)
    expect(result.summary.lastDate).toBeNull()
  })

  it('handles an empty curriculum without flagging it', () => {
    const result = schedule({
      topics: [],
      from: '2026-08-10',
      deadline: '2026-12-31',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.assignments).toEqual([])
    expect(result.summary.overCapacity).toBe(false)
    expect(result.summary.totalTopics).toBe(0)
  })

  it('treats zero-minute topics as one minute so placement stays sane', () => {
    const result = schedule({
      topics: [
        { id: 'a', estMinutes: 0 },
        { id: 'b', estMinutes: 0 },
        { id: 'c', estMinutes: 0 }
      ],
      from: '2026-08-10',
      deadline: '2026-08-12',
      minutesPerDay: 90,
      restDays: []
    })

    expect(result.summary.totalMinutes).toBe(3)
    expect(result.assignments.map((a) => a.date)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12'
    ])
  })

  /** Reflow is the same function with a later `from` and fewer topics. */
  it('still lands on the deadline when reflowing from mid-course', () => {
    const result = schedule({
      topics: topics(12),
      from: '2026-11-01',
      deadline: '2026-12-31',
      minutesPerDay: 90,
      restDays: [0, 6]
    })

    expect(result.summary.firstDate).toBe('2026-11-02') // 2026-11-01 is a Sunday
    expect(result.summary.lastDate).toBe('2026-12-31')
    expect(result.summary.bufferDays).toBe(0)
  })
})
