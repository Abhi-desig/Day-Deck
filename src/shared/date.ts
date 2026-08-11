/**
 * All calendar arithmetic in Day Deck runs on `DateKey` strings, never on Date
 * objects carried across boundaries.
 *
 * The split that matters: deciding *what today is* uses local time, but every
 * key-to-key calculation is pure component math done through Date.UTC. That
 * makes addDays/diffDays exact across DST boundaries, where naive
 * local-midnight subtraction is off by an hour twice a year.
 */

/** A calendar day in the user's local timezone, formatted 'YYYY-MM-DD'. */
export type DateKey = string

const pad = (n: number): string => String(n).padStart(2, '0')

const parts = (key: DateKey): [number, number, number] => {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m, d]
}

/** Format a local Date as a DateKey. Uses local getters, never toISOString. */
export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A Date at local midnight on the given key. For display/formatting only. */
export function fromKey(key: DateKey): Date {
  const [y, m, d] = parts(key)
  return new Date(y, m - 1, d)
}

export function todayKey(): DateKey {
  return toKey(new Date())
}

export function isValidKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const [y, m, d] = parts(key)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}

export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = parts(key)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Whole days from `a` to `b`. Positive when b is later. */
export function diffDays(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  )
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: DateKey): number {
  const [y, m, d] = parts(key)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Monday-based start of week, which is also the key used to dedupe weekly seeding. */
export function startOfWeek(key: DateKey): DateKey {
  const dow = weekdayOf(key)
  return addDays(key, dow === 0 ? -6 : 1 - dow)
}

export const weekKey = startOfWeek

export function rangeKeys(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  const span = diffDays(from, to)
  for (let i = 0; i <= span; i++) out.push(addDays(from, i))
  return out
}

/** Minutes from local midnight → '09:30'. */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24
  return `${pad(h)}:${pad(min % 60)}`
}

export function parseMinutes(value: string): number | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h > 23 || mm > 59) return null
  return h * 60 + mm
}

const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

export interface CardLabel {
  weekday: string
  dayNum: number
  month: string
  year: number
  /** 'Today' | 'Tomorrow' | 'Yesterday' | 'in 4 days' | '3 days ago' */
  relative: string
  isToday: boolean
  isPast: boolean
  isWeekend: boolean
}

export function labelFor(key: DateKey, today: DateKey = todayKey()): CardLabel {
  const [y, m, d] = parts(key)
  const delta = diffDays(today, key)
  const dow = weekdayOf(key)

  let relative: string
  if (delta === 0) relative = 'Today'
  else if (delta === 1) relative = 'Tomorrow'
  else if (delta === -1) relative = 'Yesterday'
  else if (delta > 0) relative = `in ${delta} days`
  else relative = `${-delta} days ago`

  return {
    weekday: WEEKDAY_LONG[dow],
    dayNum: d,
    month: MONTH_SHORT[m - 1],
    year: y,
    relative,
    isToday: delta === 0,
    isPast: delta < 0,
    isWeekend: dow === 0 || dow === 6
  }
}
