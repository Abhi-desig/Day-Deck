import { todayKey } from '@shared/date'
import type { BootstrapResult } from '@shared/types'
import type { Db } from '../db'
import { syncTopicsToSlots } from '../db/curriculum'
import { runRollover } from './rollover'
import { sweepStickers } from './stickers'
import { runWeeklySeeding } from './weekly'

/**
 * Everything that must happen to the data before the first frame renders.
 *
 * Order matters: seed first, then roll. A Monday amber task seeded during a
 * Wednesday launch has to be eligible to roll forward in the same pass,
 * otherwise it would sit stranded on a day that has already gone by.
 *
 * The sticker sweep is independent of both and goes last — it touches no slots,
 * and its result is reported for the same reason the other two are: so the
 * renderer can show what changed rather than presenting a different wall than
 * the one the user left.
 */
export function bootstrap(db: Db): BootstrapResult {
  const today = todayKey()
  const seeded = runWeeklySeeding(db, today)
  const rolled = runRollover(db, today)

  // Rollover may have carried curriculum work to today. Point each topic at
  // wherever its live slot actually is, so the next reconcile does not treat
  // the carried slot as an orphan and delete it.
  syncTopicsToSlots(db)

  const expiredStickers = sweepStickers(db, today)

  return {
    today,
    rolled,
    seededWeek: seeded.week,
    seededSlotIds: seeded.slotIds,
    expiredStickers
  }
}
