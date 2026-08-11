import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../src/renderer/src/lib/quickadd'

describe('quick-add parsing', () => {
  it('takes a bare title', () => {
    expect(parseQuickAdd('Ship the deck')).toEqual({
      title: 'Ship the deck',
      startMin: null,
      durationMin: 30
    })
  })

  it('pulls a leading clock time', () => {
    expect(parseQuickAdd('09:30 Ship the deck')).toEqual({
      title: 'Ship the deck',
      startMin: 570,
      durationMin: 30
    })
    expect(parseQuickAdd('9:05 Standup')).toMatchObject({
      title: 'Standup',
      startMin: 545
    })
  })

  it('pulls a trailing duration', () => {
    expect(parseQuickAdd('Ship the deck 45m')).toEqual({
      title: 'Ship the deck',
      startMin: null,
      durationMin: 45
    })
  })

  it('handles both at once', () => {
    expect(parseQuickAdd('09:30 Ship the deck 45m')).toEqual({
      title: 'Ship the deck',
      startMin: 570,
      durationMin: 45
    })
  })

  it('leaves an invalid time in the title rather than guessing', () => {
    expect(parseQuickAdd('99:99 Something')).toEqual({
      title: '99:99 Something',
      startMin: null,
      durationMin: 30
    })
  })

  it('only treats a trailing token as a duration', () => {
    expect(parseQuickAdd('Read 30m of the docs')).toMatchObject({
      title: 'Read 30m of the docs',
      durationMin: 30
    })
  })

  it('trims noise', () => {
    expect(parseQuickAdd('   Padded title   ').title).toBe('Padded title')
    expect(parseQuickAdd('').title).toBe('')
  })
})
