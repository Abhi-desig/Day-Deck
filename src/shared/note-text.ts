import type { DateKey } from './date'
import { addDays, isValidKey, weekdayOf } from './date'

/**
 * Reading dates out of a note the way it was actually typed.
 *
 * "I learned this on Saturday, but review it on Wednesday" carries two dates
 * pointing in opposite directions, and which is which is decided by the verb in
 * front of them, not by their order. Getting that from a sentence is the whole
 * job here.
 *
 * This is deliberately local code rather than another model call. Resolving a
 * weekday name against today is arithmetic, it has to work offline, it has to
 * be instant while the user is still typing, and — unlike a model — it is
 * exhaustively testable. The same reasoning that keeps scheduling out of the
 * decompose prompt keeps date parsing out of one too.
 *
 * Everything it finds is a *suggestion*: the composer shows the resolved dates
 * in editable fields, so a wrong guess costs a correction, never a wrong
 * reminder.
 */

export interface NoteSchedule {
  /** The day the note should appear on. */
  surfaceDate: DateKey | null
  /** The day the thing was first learned, when the note says so. */
  learnedDate: DateKey | null
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
}

/** Verbs that put the date behind us. */
const PAST_CUE =
  /\b(learn(?:ed|t)|studied|did|finished|completed|covered|read|watched|went through|saw|started|built|wrote)\b/

/** Verbs that put the date ahead of us. */
const FUTURE_CUE =
  /\b(review|revise|revisit|remind|recap|redo|repeat|practi[cs]e|automate|check|revisit|follow[- ]?up|come back|circle back|test|drill|refresh|apply)\b/

/** How far back to look for the verb that governs a date mention. */
const CUE_WINDOW = 48

type Direction = 'past' | 'future' | 'cue'

interface Mention {
  index: number
  /** 'cue' means the surrounding verb decides. */
  direction: Direction
  resolve(today: DateKey, direction: 'past' | 'future'): DateKey | null
}

/**
 * Nearest date with this weekday at or before today. "I learned this on
 * Saturday" typed on a Saturday means today, not a week ago.
 */
function backTo(today: DateKey, weekday: number): DateKey {
  return addDays(today, -((weekdayOf(today) - weekday + 7) % 7))
}

/**
 * Nearest date with this weekday strictly after today — a reminder for "this
 * Wednesday" set on a Wednesday is for next week, or it would fire in the past.
 */
function forwardTo(today: DateKey, weekday: number): DateKey {
  const delta = (weekday - weekdayOf(today) + 7) % 7
  return addDays(today, delta === 0 ? 7 : delta)
}

function scan(text: string): Mention[] {
  const found: Mention[] = []
  const lower = text.toLowerCase()

  const push = (
    pattern: RegExp,
    direction: Direction,
    resolve: (m: RegExpExecArray) => Mention['resolve']
  ): void => {
    const re = new RegExp(pattern.source, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(lower)) !== null) {
      found.push({ index: match.index, direction, resolve: resolve(match) })
    }
  }

  // An explicit key fixes the day outright, but not which of the two dates it
  // is — "learned on 2026-08-08, review on 2026-08-12" still needs the verbs.
  push(/\b(\d{4}-\d{2}-\d{2})\b/, 'cue', (m) => {
    const key = m[1]
    return () => (isValidKey(key) ? key : null)
  })

  // Same again: "I learned this today" and "remind me today" are the same day
  // in different columns.
  push(/\btoday\b|\btonight\b|\bthis evening\b/, 'cue', () => (today) => today)
  push(/\btomorrow\b/, 'future', () => (today) => addDays(today, 1))
  push(/\byesterday\b/, 'past', () => (today) => addDays(today, -1))

  push(/\bin (\d{1,3}) days?\b/, 'future', (m) => {
    const n = Number(m[1])
    return (today) => addDays(today, n)
  })
  push(/\b(\d{1,3}) days? ago\b/, 'past', (m) => {
    const n = Number(m[1])
    return (today) => addDays(today, -n)
  })

  push(/\b(?:in a|next) week\b/, 'future', () => (today) => addDays(today, 7))
  push(/\b(?:a|last) week ago\b|\blast week\b/, 'past', () => (today) =>
    addDays(today, -7)
  )

  // Bare weekday names are the ambiguous case the cue verbs exist to resolve.
  // "next"/"last" only nudge the search direction; they do not skip a week,
  // because "next Wednesday" said on a Monday usually means this Wednesday.
  push(
    /\b(?:on |this |next |last |by )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/,
    'cue',
    (m) => {
      const weekday = WEEKDAYS[m[1]]
      const forced = /\bnext /.test(m[0])
        ? 'future'
        : /\blast /.test(m[0])
          ? 'past'
          : null
      return (today, direction) => {
        const dir = forced ?? direction
        return dir === 'past' ? backTo(today, weekday) : forwardTo(today, weekday)
      }
    }
  )

  return found.sort((a, b) => a.index - b.index)
}

/**
 * Which way a mention points, from the nearest verb in front of it. A note with
 * no verb at all is a reminder, so an uncued date looks forward.
 */
function directionAt(lower: string, index: number): 'past' | 'future' {
  const before = lower.slice(Math.max(0, index - CUE_WINDOW), index)

  const past = lastIndexOfMatch(before, PAST_CUE)
  const future = lastIndexOfMatch(before, FUTURE_CUE)

  if (past === -1 && future === -1) return 'future'
  // Whichever verb is closest to the date governs it — that is what makes the
  // second clause of "learned Saturday, review Wednesday" read as the future.
  return past > future ? 'past' : 'future'
}

function lastIndexOfMatch(haystack: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, 'gi')
  let last = -1
  let match: RegExpExecArray | null
  while ((match = re.exec(haystack)) !== null) last = match.index
  return last
}

/**
 * Pull the surface and learned dates out of a free-text note.
 *
 * Both are null when the note names no date, which is the common case — the
 * composer then keeps whatever the user picked by hand.
 */
export function parseNoteSchedule(text: string, today: DateKey): NoteSchedule {
  const lower = text.toLowerCase()
  const result: NoteSchedule = { surfaceDate: null, learnedDate: null }

  for (const mention of scan(lower)) {
    const direction =
      mention.direction === 'cue'
        ? directionAt(lower, mention.index)
        : mention.direction

    const date = mention.resolve(today, direction)
    if (!date) continue

    // First mention in each direction wins. A note that names two future dates
    // means the earlier one; the second is usually "and again on…", which this
    // deliberately does not try to model.
    if (direction === 'past') {
      result.learnedDate ??= date
    } else {
      result.surfaceDate ??= date
    }
  }

  return result
}
