import type { KeySlot } from '@shared/types'
import type { Db } from '../db'
import { getNumber, setSetting, SETTING } from '../db/settings'

/**
 * A token bucket per feature slot, in front of every Gemini call.
 *
 * The retry/backoff in gemini.ts is *reactive* — it answers a 429 that already
 * happened. This is the proactive half: nothing in the app, including a
 * renderer stuck in a loop, can fire more than the configured number of calls
 * a minute per feature. Slots get separate buckets for the same reason they
 * get separate keys — a heavy storyboard session must not starve the planner.
 *
 * In-memory on purpose. A restart refills the buckets, which is the correct
 * behaviour for a guard whose whole job is pacing a live process.
 */

const DEFAULT_PER_MINUTE = 8
const MIN_PER_MINUTE = 1
const MAX_PER_MINUTE = 60

interface Bucket {
  tokens: number
  lastMs: number
}

const buckets = new Map<KeySlot, Bucket>()

export function ratePerMinute(db: Db): number {
  return clampRate(
    getNumber(db, SETTING.geminiRatePerMinute, DEFAULT_PER_MINUTE)
  )
}

export function setRatePerMinute(db: Db, perMinute: number): number {
  if (!Number.isFinite(perMinute)) {
    throw new Error('The rate has to be a number of calls per minute.')
  }
  const clamped = clampRate(Math.round(perMinute))
  setSetting(db, SETTING.geminiRatePerMinute, String(clamped))
  return clamped
}

const clampRate = (rate: number): number =>
  Math.min(MAX_PER_MINUTE, Math.max(MIN_PER_MINUTE, rate))

/**
 * Spend one call from a slot's bucket, or refuse with how long to wait.
 *
 * Continuous refill rather than a fixed window: a burst of `rate` calls is
 * allowed, then calls flow at `rate` per minute — no cliff at the top of a
 * minute where everything suddenly works again.
 */
export function takeToken(
  db: Db,
  slot: KeySlot,
  nowMs: number = Date.now()
): void {
  const rate = ratePerMinute(db)
  const bucket = buckets.get(slot) ?? { tokens: rate, lastMs: nowMs }

  const elapsed = Math.max(0, nowMs - bucket.lastMs)
  bucket.tokens = Math.min(rate, bucket.tokens + (elapsed / 60_000) * rate)
  bucket.lastMs = nowMs

  if (bucket.tokens < 1) {
    buckets.set(slot, bucket)
    const waitSec = Math.ceil(((1 - bucket.tokens) / rate) * 60)
    throw new Error(
      `Rate limit: too many AI calls in the last minute. Try again in about ${waitSec}s, or raise the limit in Settings.`
    )
  }

  bucket.tokens -= 1
  buckets.set(slot, bucket)
}

/** Tests only — buckets are process state and tests share a process. */
export function resetBuckets(): void {
  buckets.clear()
}
