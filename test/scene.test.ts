import { describe, expect, it } from 'vitest'
import {
  boardDuration,
  formatDuration,
  isAutoNamed,
  sceneLabel
} from '../src/renderer/src/lib/scene'

/**
 * Scene numbers are derived from board order rather than stored in a column, so
 * these are the tests that stand in for the renumbering logic that choice avoids
 * needing.
 */
describe('scene naming', () => {
  it('numbers from one, not zero', () => {
    expect(sceneLabel({ title: '' }, 0)).toBe('Scene 1')
    expect(sceneLabel({ title: '' }, 4)).toBe('Scene 5')
  })

  it('a typed title replaces the number', () => {
    expect(sceneLabel({ title: 'The arrival' }, 0)).toBe('The arrival')
  })

  it('treats whitespace as no name at all', () => {
    // Otherwise clearing a title by selecting it and hitting space leaves a card
    // with a name that is invisible and un-numbered.
    expect(sceneLabel({ title: '   ' }, 2)).toBe('Scene 3')
    expect(isAutoNamed({ title: '\n ' })).toBe(true)
  })

  it('knows which cards are still auto-named', () => {
    expect(isAutoNamed({ title: '' })).toBe(true)
    expect(isAutoNamed({ title: 'Cold open' })).toBe(false)
  })

  it('renumbers implicitly when a scene is removed', () => {
    const board = [{ title: '' }, { title: 'Middle' }, { title: '' }]
    const after = board.filter((_, i) => i !== 1)

    // The third card was "Scene 3"; with the middle one gone it is "Scene 2"
    // without anything having to be rewritten.
    expect(sceneLabel(board[2], 2)).toBe('Scene 3')
    expect(sceneLabel(after[1], 1)).toBe('Scene 2')
  })
})

describe('board duration', () => {
  it('adds up what is decided and counts what is not', () => {
    const result = boardDuration([
      { durationSec: 5 },
      { durationSec: 10 },
      { durationSec: null },
      { durationSec: null }
    ])

    // Reported as a pair, because "15s" alone would read as the whole board.
    expect(result).toEqual({ seconds: 15, undecided: 2 })
  })

  it('is zero and empty for a board with nothing on it', () => {
    expect(boardDuration([])).toEqual({ seconds: 0, undecided: 0 })
  })

  it('counts an all-undecided board as no run time at all', () => {
    expect(boardDuration([{ durationSec: null }])).toEqual({
      seconds: 0,
      undecided: 1
    })
  })
})

describe('duration formatting', () => {
  it('stays in seconds below a minute', () => {
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(45)).toBe('45s')
  })

  it('switches to m:ss at a minute', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(80)).toBe('1:20')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('pads the seconds so 1:05 never reads as 1:5', () => {
    expect(formatDuration(65)).toBe('1:05')
  })
})
