import type { StoryFrame } from '@shared/types'

/**
 * Scene numbering, derived rather than stored.
 *
 * A scene's number is its position in the board's order, computed on read. The
 * alternative — a `scene_no` column — has to be renumbered after every insert,
 * delete and reorder, and every one of those is a chance to leave the board with
 * two scene 4s. Deriving it means a delete renumbers for free and cannot be
 * wrong.
 *
 * Which also settles the naming: an empty title *is* the auto-name, and typing
 * one *is* the manual override. There is no third piece of state recording which
 * of the two a card is currently using.
 */
export function sceneLabel(frame: Pick<StoryFrame, 'title'>, index: number): string {
  const named = frame.title.trim()
  return named || `Scene ${index + 1}`
}

/** True when the card is still showing its derived number. */
export const isAutoNamed = (frame: Pick<StoryFrame, 'title'>): boolean =>
  frame.title.trim() === ''

/**
 * Total run time of the board, and how much of it is still undecided.
 *
 * Reported as a pair because "1m 20s" over a board where four scenes have no
 * duration yet is a misleading number on its own.
 */
export function boardDuration(
  frames: readonly Pick<StoryFrame, 'durationSec'>[]
): { seconds: number; undecided: number } {
  let seconds = 0
  let undecided = 0
  for (const frame of frames) {
    if (frame.durationSec == null) undecided += 1
    else seconds += frame.durationSec
  }
  return { seconds, undecided }
}

/** `0:45`, `1:20` — seconds are what these clips are measured in. */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}:${String(secs).padStart(2, '0')}`
}
