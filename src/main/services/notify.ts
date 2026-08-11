import type { DateKey } from '@shared/date'
import { formatMinutes } from '@shared/date'
import type { BriefPreview, NotifyPrefs } from '@shared/types'
import type { Db } from '../db'
import { getBool, getNumber, SETTING, setSetting } from '../db/settings'

/**
 * The content and the decision-making for the two daily briefs. Deliberately
 * free of any `electron` import so it can be unit-tested directly — actually
 * showing a notification is `reminders.ts`'s job.
 */

export type BriefKind = 'morning' | 'evening'

/** Both off until asked for. An app that pings you unprompted gets muted. */
export const DEFAULT_PREFS: NotifyPrefs = {
  morningEnabled: false,
  morningMin: 9 * 60,
  eveningEnabled: false,
  eveningMin: 21 * 60
}

/**
 * How late a brief may still be delivered. Open the app at 6pm and you want
 * today's plan, not a "good morning" — past this the slot is claimed and
 * skipped so it cannot fire later either.
 */
export const GRACE_MINUTES = 90

export function getPrefs(db: Db): NotifyPrefs {
  return {
    morningEnabled: getBool(
      db,
      SETTING.morningEnabled,
      DEFAULT_PREFS.morningEnabled
    ),
    morningMin: clampMinute(
      getNumber(db, SETTING.morningMin, DEFAULT_PREFS.morningMin)
    ),
    eveningEnabled: getBool(
      db,
      SETTING.eveningEnabled,
      DEFAULT_PREFS.eveningEnabled
    ),
    eveningMin: clampMinute(
      getNumber(db, SETTING.eveningMin, DEFAULT_PREFS.eveningMin)
    )
  }
}

export function setPrefs(db: Db, prefs: NotifyPrefs): NotifyPrefs {
  setSetting(db, SETTING.morningEnabled, prefs.morningEnabled ? '1' : '0')
  setSetting(db, SETTING.morningMin, String(clampMinute(prefs.morningMin)))
  setSetting(db, SETTING.eveningEnabled, prefs.eveningEnabled ? '1' : '0')
  setSetting(db, SETTING.eveningMin, String(clampMinute(prefs.eveningMin)))
  return getPrefs(db)
}

const clampMinute = (n: number): number =>
  Math.min(1439, Math.max(0, Math.round(n)))

/* ------------------------------------------------------------ the log */

/**
 * Claim a brief for a day, once. Returns false if it was already claimed —
 * whether it was delivered or deliberately skipped — so three launches before
 * lunch still produce exactly one morning brief.
 *
 * The insert itself is the lock: the primary key on (day_key, kind) means two
 * racing callers cannot both win.
 */
export function claim(
  db: Db,
  day: DateKey,
  kind: BriefKind,
  delivered: boolean
): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO notify_log (day_key, kind, sent_at, delivered)
       VALUES (?, ?, ?, ?)`
    )
    .run(day, kind, new Date().toISOString(), delivered ? 1 : 0)
  return info.changes > 0
}

export function alreadyClaimed(
  db: Db,
  day: DateKey,
  kind: BriefKind
): boolean {
  return (
    db
      .prepare<[string, string], { 1: number }>(
        `SELECT 1 FROM notify_log WHERE day_key = ? AND kind = ?`
      )
      .get(day, kind) !== undefined
  )
}

/* --------------------------------------------------------- the content */

interface OpenRow {
  title: string
  start_min: number | null
  duration_min: number
}

function openToday(db: Db, day: DateKey): OpenRow[] {
  return db
    .prepare<[string], OpenRow>(
      `SELECT title, start_min, duration_min FROM slots
        WHERE date = ? AND status = 'open'
        ORDER BY (start_min IS NULL) ASC, start_min ASC, sort_index ASC`
    )
    .all(day)
}

function humanMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * "Here is your day." Silent when there is nothing open — an empty day is not
 * worth interrupting someone for.
 */
export function buildMorning(db: Db, day: DateKey): BriefPreview | null {
  const open = openToday(db, day)
  if (open.length === 0) return null

  const minutes = open.reduce((n, r) => n + r.duration_min, 0)
  const firstTimed = open.find((r) => r.start_min !== null)

  const body = firstTimed
    ? `First up: ${firstTimed.title} at ${formatMinutes(firstTimed.start_min as number)}.`
    : `Nothing is pinned to a time — start wherever you like.`

  return {
    title: `Today · ${plural(open.length, 'task')} · ${humanMinutes(minutes)}`,
    body
  }
}

/**
 * "Here is what did not happen." Also silent on a clear day — the reward for
 * finishing everything is not being nagged about it.
 */
export function buildEvening(db: Db, day: DateKey): BriefPreview | null {
  const open = openToday(db, day)
  if (open.length === 0) return null

  const names = open.slice(0, 3).map((r) => r.title)
  const rest = open.length - names.length
  const list = rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ')

  return {
    title: `${plural(open.length, 'task')} still open`,
    body: `${list}. Unfinished work carries to tomorrow.`
  }
}

export function build(
  db: Db,
  day: DateKey,
  kind: BriefKind
): BriefPreview | null {
  return kind === 'morning' ? buildMorning(db, day) : buildEvening(db, day)
}

/* --------------------------------------------------------- the decision */

export type BriefDecision =
  | { action: 'send'; kind: BriefKind; brief: BriefPreview }
  /** Claim it so it cannot fire later, but stay quiet. */
  | { action: 'skip'; kind: BriefKind; reason: 'empty' | 'too-late' }
  | { action: 'wait' }

/**
 * Given the wall clock, decide what — if anything — should happen right now.
 *
 * Pure apart from reading the db, and takes `nowMin` rather than reading the
 * clock itself, so every branch is testable without freezing time.
 */
export function decide(
  db: Db,
  day: DateKey,
  nowMin: number,
  kind: BriefKind
): BriefDecision {
  const prefs = getPrefs(db)
  const enabled = kind === 'morning' ? prefs.morningEnabled : prefs.eveningEnabled
  const at = kind === 'morning' ? prefs.morningMin : prefs.eveningMin

  if (!enabled) return { action: 'wait' }
  if (nowMin < at) return { action: 'wait' }
  if (alreadyClaimed(db, day, kind)) return { action: 'wait' }

  if (nowMin > at + GRACE_MINUTES) {
    return { action: 'skip', kind, reason: 'too-late' }
  }

  const brief = build(db, day, kind)
  if (!brief) return { action: 'skip', kind, reason: 'empty' }

  return { action: 'send', kind, brief }
}
