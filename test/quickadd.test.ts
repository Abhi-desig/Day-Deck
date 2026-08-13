import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../src/renderer/src/lib/quickadd'

describe('quick-add parsing', () => {
  it('takes a bare title', () => {
    expect(parseQuickAdd('Ship the deck')).toEqual({
      title: 'Ship the deck',
      startMin: null,
      durationMin: 30,
      tagSlugs: []
    })
  })

  it('pulls a leading clock time', () => {
    expect(parseQuickAdd('09:30 Ship the deck')).toEqual({
      title: 'Ship the deck',
      startMin: 570,
      durationMin: 30,
      tagSlugs: []
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
      durationMin: 45,
      tagSlugs: []
    })
  })

  it('handles both at once', () => {
    expect(parseQuickAdd('09:30 Ship the deck 45m')).toEqual({
      title: 'Ship the deck',
      startMin: 570,
      durationMin: 45,
      tagSlugs: []
    })
  })

  it('leaves an invalid time in the title rather than guessing', () => {
    expect(parseQuickAdd('99:99 Something')).toEqual({
      title: '99:99 Something',
      startMin: null,
      durationMin: 30,
      tagSlugs: []
    })
  })

  it('pulls #tags out of the title', () => {
    expect(parseQuickAdd('Review #amber PRs')).toEqual({
      title: 'Review PRs',
      startMin: null,
      durationMin: 30,
      tagSlugs: ['amber']
    })
  })

  /**
   * The ordering trap the parser exists to avoid: a tag token between the time
   * and the duration leaves whitespace behind, and stripping it too late means
   * the anchored `\s(\d+)m$` no longer matches.
   */
  it('still sees the duration when a tag sits in front of it', () => {
    expect(parseQuickAdd('09:30 Ship it #amber 45m')).toEqual({
      title: 'Ship it',
      startMin: 570,
      durationMin: 45,
      tagSlugs: ['amber']
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
