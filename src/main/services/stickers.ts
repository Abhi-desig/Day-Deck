import type { DateKey } from '@shared/date'
import { todayKey } from '@shared/date'
import type { Sticker } from '@shared/types'
import type { Db } from '../db'
import { deleteMany, listExpired } from '../db/stickers'

/**
 * Clear temporary notes whose day has been and gone.
 *
 * Runs once at launch alongside rollover and weekly seeding, and returns what
 * it removed rather than just doing it quietly. The renderer uses that list to
 * fade the notes off the wall, so a sticker disappearing is something the user
 * watches happen instead of something they notice missing later — the same
 * reason `BootstrapResult` already reports rollovers and weekly seeds.
 *
 * Deleting is the right call over marking them hidden: a temp sticker's whole
 * contract is that it goes away, and keeping a graveyard of them would make
 * every later query carry a filter for rows nobody will ever look at again.
 */
export function sweepStickers(db: Db, today: DateKey = todayKey()): Sticker[] {
  const expired = listExpired(db, today)
  if (expired.length === 0) return []

  deleteMany(
    db,
    expired.map((s) => s.id)
  )
  return expired
}
