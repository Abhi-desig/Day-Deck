/**
 * Where a new note goes, and how a dragged one is kept on the board.
 *
 * Pure so it can be reasoned about (and tested) without a DOM: everything here
 * is arithmetic on rectangles.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const clamp = (value: number, min: number, max: number): number =>
  // `max` before `min` on purpose: on a board narrower than one note the upper
  // bound goes negative, and clamping to it last would park the note off the
  // left edge. This way the lower bound wins and it stays at the origin.
  Math.max(min, Math.min(max, value))

/**
 * Pin a rect fully inside a surface.
 *
 * The whole note, not its top-left corner. Constraining only the origin is what
 * lets a note sit three-quarters off the right-hand edge — visible enough to
 * know it is there, too far out to read or grab.
 */
export function clampToBoard(
  rect: Pick<Rect, 'x' | 'y'>,
  size: Pick<Rect, 'w' | 'h'>,
  board: { w: number; h: number },
  padding = 0
): { x: number; y: number } {
  return {
    x: clamp(rect.x, padding, board.w - size.w - padding),
    y: clamp(rect.y, padding, board.h - size.h - padding)
  }
}

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.w + gap &&
  a.x + a.w + gap > b.x &&
  a.y < b.y + b.h + gap &&
  a.y + a.h + gap > b.y

/**
 * The first spot on the board where a new note does not land on an existing
 * one.
 *
 * Notes were previously dropped in a fixed diagonal cascade, which is fine for
 * two and unreadable by five — 46px of stagger under a 208px-wide note means
 * every card is four-fifths buried. This walks a grid in reading order and
 * takes the first genuinely free cell instead.
 *
 * When the board really is full it gives up and returns the last cell rather
 * than searching forever; a note landing on top of another is a bad outcome,
 * but a wall that will not accept a note at all is a worse one.
 */
export function findFreeSpot(
  taken: readonly Rect[],
  size: Pick<Rect, 'w' | 'h'>,
  board: { w: number; h: number },
  gap = 16,
  padding = 16
): { x: number; y: number } {
  const stepX = size.w + gap
  const stepY = size.h + gap
  const columns = Math.max(1, Math.floor((board.w - padding * 2 + gap) / stepX))
  const rows = Math.max(1, Math.floor((board.h - padding * 2 + gap) / stepY))

  let last = { x: padding, y: padding }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const candidate: Rect = {
        x: padding + column * stepX,
        y: padding + row * stepY,
        w: size.w,
        h: size.h
      }
      last = { x: candidate.x, y: candidate.y }
      // `gap: 0` here — the grid already spaces the cells, and demanding a
      // second gap between a candidate and its neighbour would reject every
      // cell adjacent to an occupied one.
      if (!taken.some((rect) => overlaps(candidate, rect, 0))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }

  return last
}
