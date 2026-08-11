import { Notification } from 'electron'
import { todayKey } from '@shared/date'
import type { Db } from '../db'
import { claim, decide, type BriefKind } from './notify'

/**
 * Drives the two daily briefs.
 *
 * This polls once a minute rather than computing the next fire time and
 * sleeping until then. A long `setTimeout` is the obvious design and the wrong
 * one here: macOS suspends timers across sleep, so a laptop closed at 8am and
 * opened at 11am fires the morning brief three hours late — and the same timer
 * has to be re-armed on clock changes, DST, and time-zone moves. A minute tick
 * re-reads the wall clock every time and cannot drift. One wakeup a minute in a
 * process that is already running is not a cost worth optimising.
 *
 * Everything about *whether* to fire lives in notify.ts, which has no electron
 * import and is directly testable. This file only knows how to show a banner.
 */

const TICK_MS = 60_000
const KINDS: BriefKind[] = ['morning', 'evening']

export interface Reminders {
  /** Run the checks immediately — used at launch and after prefs change. */
  check(): void
  stop(): void
}

/**
 * Held here rather than in main/index.ts so the IPC handlers can poke it after
 * a preferences change without importing the entry point back — that would be
 * an import cycle.
 */
let active: Reminders | null = null

/** Re-run the checks now, e.g. right after the user turns a brief on. */
export function checkReminders(): void {
  active?.check()
}

export function startReminders(db: Db, onActivate: () => void): Reminders {
  function check(): void {
    // A day boundary crossed mid-run just means the next tick uses a new key;
    // the log is keyed by day, so nothing double-fires.
    const day = todayKey()
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()

    for (const kind of KINDS) {
      const decision = decide(db, day, nowMin, kind)
      if (decision.action === 'wait') continue

      // Claim before showing. If the claim is lost, another pass already
      // handled this brief and showing it now would duplicate it.
      const won = claim(db, day, kind, decision.action === 'send')
      if (!won || decision.action !== 'send') continue

      show(decision.brief.title, decision.brief.body, onActivate)
    }
  }

  function show(title: string, body: string, activate: () => void): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', activate)
    notification.show()
  }

  const timer = setInterval(check, TICK_MS)
  // Never hold the process open on this alone.
  timer.unref?.()

  check()

  active = {
    check,
    stop: () => {
      clearInterval(timer)
      active = null
    }
  }
  return active
}
