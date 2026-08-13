import { describe, expect, it } from 'vitest'
import {
  clamp,
  clampToBoard,
  findFreeSpot,
  type Rect
} from '../src/renderer/src/lib/board'

/** The real note and board geometry from the Stickers section. */
const NOTE = { w: 208, h: 168 }
const BOARD = { w: 1282, h: 1400 }

describe('clamp', () => {
  it('passes a value already in range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })

  it('pins to each bound', () => {
    expect(clamp(-10, 0, 100)).toBe(0)
    expect(clamp(200, 0, 100)).toBe(100)
  })

  /**
   * On a board narrower than one note the upper bound goes negative. The lower
   * bound has to win, or the note is parked off the left edge instead.
   */
  it('lets the lower bound win when the range is inverted', () => {
    expect(clamp(40, 0, -60)).toBe(0)
  })
})

describe('clampToBoard', () => {
  it('leaves a note that is already inside alone', () => {
    expect(clampToBoard({ x: 300, y: 200 }, NOTE, BOARD)).toEqual({
      x: 300,
      y: 200
    })
  })

  /** The whole note, not its top-left corner. */
  it('pins the far edge, not the origin', () => {
    expect(clampToBoard({ x: 1250, y: 0 }, NOTE, BOARD).x).toBe(
      BOARD.w - NOTE.w
    )
    expect(clampToBoard({ x: 0, y: 1399 }, NOTE, BOARD).y).toBe(
      BOARD.h - NOTE.h
    )
  })

  it('pulls a negative origin back to zero', () => {
    expect(clampToBoard({ x: -600, y: -400 }, NOTE, BOARD)).toEqual({
      x: 0,
      y: 0
    })
  })

  it('honours padding on both edges', () => {
    const padded = clampToBoard({ x: 9000, y: -5 }, NOTE, BOARD, 16)
    expect(padded).toEqual({ x: BOARD.w - NOTE.w - 16, y: 16 })
  })

  it('parks at the origin when the board is narrower than a note', () => {
    expect(clampToBoard({ x: 40, y: 40 }, NOTE, { w: 120, h: 1400 }).x).toBe(0)
  })

  /**
   * The case that stranded notes off-screen: a position that was legal on a wide
   * board has to come back inside once the window is narrowed.
   */
  it('brings a note placed on a wide board inside a narrow one', () => {
    const placedWide = { x: BOARD.w - NOTE.w - 16, y: 40 }
    const narrow = { w: 602, h: 1400 }
    const landed = clampToBoard(placedWide, NOTE, narrow)
    expect(landed.x).toBe(narrow.w - NOTE.w)
    expect(landed.x + NOTE.w).toBeLessThanOrEqual(narrow.w)
  })
})

describe('findFreeSpot', () => {
  const PAD = 16

  it('takes the first cell on an empty board', () => {
    expect(findFreeSpot([], NOTE, BOARD, PAD, PAD)).toEqual({
      x: PAD,
      y: PAD
    })
  })

  it('walks across before it walks down', () => {
    const first: Rect = { x: PAD, y: PAD, ...NOTE }
    expect(findFreeSpot([first], NOTE, BOARD, PAD, PAD)).toEqual({
      x: PAD + NOTE.w + PAD,
      y: PAD
    })
  })

  it('drops to the next row once a row is full', () => {
    const narrow = { w: NOTE.w + PAD * 2, h: 1400 }
    const first: Rect = { x: PAD, y: PAD, ...NOTE }
    expect(findFreeSpot([first], NOTE, narrow, PAD, PAD)).toEqual({
      x: PAD,
      y: PAD + NOTE.h + PAD
    })
  })

  it('never returns a cell that overlaps an existing note', () => {
    const taken: Rect[] = [
      { x: PAD, y: PAD, ...NOTE },
      { x: PAD + 224, y: PAD, ...NOTE },
      { x: PAD + 448, y: PAD, ...NOTE }
    ]
    const spot = findFreeSpot(taken, NOTE, BOARD, PAD, PAD)
    for (const rect of taken) {
      const hit =
        spot.x < rect.x + rect.w &&
        spot.x + NOTE.w > rect.x &&
        spot.y < rect.y + rect.h &&
        spot.y + NOTE.h > rect.y
      expect(hit).toBe(false)
    }
  })

  /**
   * A wall that refuses a note is worse than one that stacks it, so a full board
   * gives up and returns its last cell rather than searching for ever.
   */
  it('falls back to the last cell when the board is full', () => {
    const tiny = { w: NOTE.w + PAD * 2, h: NOTE.h + PAD * 2 }
    const only: Rect = { x: PAD, y: PAD, ...NOTE }
    expect(findFreeSpot([only], NOTE, tiny, PAD, PAD)).toEqual({
      x: PAD,
      y: PAD
    })
  })

  it('always offers at least one cell, however small the board', () => {
    expect(findFreeSpot([], NOTE, { w: 10, h: 10 }, PAD, PAD)).toEqual({
      x: PAD,
      y: PAD
    })
  })
})
