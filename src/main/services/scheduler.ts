import type { DateKey } from '@shared/date'
import { addDays, diffDays, weekdayOf } from '@shared/date'
import type { ScheduleSummary } from '@shared/types'

/**
 * The deliberate division of labour in Day Deck: the model decides *what* the
 * topics are and roughly how long each takes; this file decides *when* they
 * happen. Language models are unreliable at "make this land exactly on the
 * deadline" — arithmetic is not. Keeping the calendar here also makes reflow
 * instant and free, because no API call is involved.
 *
 * Pure and side-effect free by design, so it can be tested directly.
 */

export interface SchedulableTopic {
  id: string
  estMinutes: number
}

export interface ScheduleInput {
  /** Must already be in the order they should be studied. */
  topics: SchedulableTopic[]
  from: DateKey
  deadline: DateKey
  minutesPerDay: number
  /** Weekday numbers (0 = Sunday) with no study load. */
  restDays: readonly number[]
}

export interface ScheduleResult {
  assignments: Array<{ topicId: string; date: DateKey }>
  summary: ScheduleSummary
}

/** Refuse to enumerate absurd windows rather than allocating a million keys. */
const MAX_WINDOW_DAYS = 3650

export function eligibleDays(
  from: DateKey,
  deadline: DateKey,
  restDays: readonly number[]
): DateKey[] {
  const span = diffDays(from, deadline)
  if (span < 0 || span > MAX_WINDOW_DAYS) return []

  const rest = new Set(restDays)
  const days: DateKey[] = []
  for (let i = 0; i <= span; i++) {
    const day = addDays(from, i)
    if (!rest.has(weekdayOf(day))) days.push(day)
  }
  return days
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const days = eligibleDays(input.from, input.deadline, input.restDays)
  // A zero-minute topic would collapse the proportional spread, so every topic
  // is worth at least a minute.
  const topics = input.topics.map((t) => ({
    id: t.id,
    estMinutes: Math.max(1, Math.round(t.estMinutes))
  }))

  const totalMinutes = topics.reduce((n, t) => n + t.estMinutes, 0)
  const D = days.length

  if (D === 0 || topics.length === 0) {
    return {
      assignments: [],
      summary: {
        totalTopics: topics.length,
        totalMinutes,
        eligibleDays: D,
        daysUsed: 0,
        perDayMinutes: 0,
        firstDate: null,
        lastDate: null,
        deadline: input.deadline,
        bufferDays: 0,
        // No days at all means the plan cannot be honoured, whatever the pace.
        overCapacity: topics.length > 0,
        requiredPerDay: topics.length > 0 ? totalMinutes : 0
      }
    }
  }

  const requiredPerDay = Math.ceil(totalMinutes / D)

  /*
   * Placement maps each topic's *preceding* workload onto the day range, so
   * the first topic lands on the first eligible day and the last topic lands
   * on the last one. Packing greedily at a fixed daily budget instead would
   * front-load the plan and finish weeks early whenever a topic happens to be
   * longer than the budget.
   */
  const lastEst = topics[topics.length - 1].estMinutes
  const span = totalMinutes - lastEst

  const assignments: Array<{ topicId: string; date: DateKey }> = []
  let acc = 0

  for (const topic of topics) {
    let index: number
    if (topics.length === 1) {
      // A lone topic belongs today, not on the deadline.
      index = 0
    } else if (span <= 0) {
      index = 0
    } else {
      index = Math.round((acc / span) * (D - 1))
    }
    assignments.push({
      topicId: topic.id,
      date: days[Math.min(D - 1, Math.max(0, index))]
    })
    acc += topic.estMinutes
  }

  const usedDates = new Set(assignments.map((a) => a.date))
  const firstDate = assignments[0].date
  const lastDate = assignments[assignments.length - 1].date
  const lastIndex = days.indexOf(lastDate)

  return {
    assignments,
    summary: {
      totalTopics: topics.length,
      totalMinutes,
      eligibleDays: D,
      daysUsed: usedDates.size,
      perDayMinutes: Math.ceil(totalMinutes / Math.max(1, usedDates.size)),
      firstDate,
      lastDate,
      deadline: input.deadline,
      bufferDays: D - 1 - lastIndex,
      overCapacity: requiredPerDay > input.minutesPerDay,
      requiredPerDay
    }
  }
}
