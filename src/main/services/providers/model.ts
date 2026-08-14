import type { KeySlot } from '@shared/types'
import type { Db } from '../../db'
import { modelFor, slotConfig } from './index'

/**
 * Borrowing the model the user already chose, but only when that is meaningful.
 *
 * Two features here have never had a model setting of their own: the day agent
 * and the storyboard planner both reuse whatever a goal is already generating
 * with, on the reasoning that it is one choice the user has made once in a
 * place they know about. That was free while everything was Gemini.
 *
 * It stops being free the moment a slot can be a different vendor. A model id
 * is only meaningful to the provider it was chosen from — ask xAI for
 * `gemini-3.5-flash` and the answer is a 404 about a missing model, which says
 * nothing about the actual mistake. So the borrow is conditional: take the
 * candidate when this slot resolves to the same provider the candidate came
 * from, and fall back to this slot's own configured model otherwise.
 */
export function borrowedModel(
  db: Db,
  slot: KeySlot,
  candidate: string | null
): string {
  const own = slotConfig(db, slot)

  // An explicit choice for this slot always outranks a borrowed one.
  if (own.model) return own.model

  if (candidate && own.provider === slotConfig(db, 'goals').provider) {
    return candidate
  }

  // Nothing to borrow, or borrowing would cross vendors. `modelFor` supplies
  // the provider's default and states the problem plainly when there is none.
  return modelFor(db, slot)
}
