import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkBuffer } from '../src/main/services/pty-buffer'

/**
 * A pty emits hundreds of tiny writes a second under a test runner. Coalescing
 * them is what keeps the IPC boundary from becoming the bottleneck — but only
 * if the size cap works too, or a large `cat` would buffer megabytes in main.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChunkBuffer', () => {
  it('joins writes that arrive inside one window into a single flush', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({ onFlush: (d) => flushed.push(d), delayMs: 8 })

    buffer.push('a')
    buffer.push('b')
    buffer.push('c')
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(8)
    expect(flushed).toEqual(['abc'])
  })

  it('does not restart the timer on every write', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({ onFlush: (d) => flushed.push(d), delayMs: 10 })

    buffer.push('a')
    vi.advanceTimersByTime(6)
    buffer.push('b')
    // 4ms left on the original timer; a restart would push this out to 16ms.
    vi.advanceTimersByTime(4)

    expect(flushed).toEqual(['ab'])
  })

  it('flushes immediately once the size cap is reached', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({
      onFlush: (d) => flushed.push(d),
      maxChars: 8,
      delayMs: 1000
    })

    buffer.push('1234')
    buffer.push('5678')

    // No timer has fired, and it will not for another second.
    expect(flushed).toEqual(['12345678'])
  })

  it('starts a fresh window after a size-triggered flush', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({
      onFlush: (d) => flushed.push(d),
      maxChars: 4,
      delayMs: 8
    })

    buffer.push('abcd')
    buffer.push('ef')
    vi.advanceTimersByTime(8)

    expect(flushed).toEqual(['abcd', 'ef'])
  })

  it('ignores empty writes rather than scheduling a flush for nothing', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({ onFlush: (d) => flushed.push(d) })

    buffer.push('')
    vi.advanceTimersByTime(100)

    expect(flushed).toEqual([])
  })

  /** The last thing a failing command prints is the part you most want. */
  it('dispose flushes what is still pending', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({ onFlush: (d) => flushed.push(d), delayMs: 500 })

    buffer.push('error: something went wrong')
    buffer.dispose()

    expect(flushed).toEqual(['error: something went wrong'])
  })

  it('dispose on an empty buffer emits nothing and cancels the timer', () => {
    const flushed: string[] = []
    const buffer = new ChunkBuffer({ onFlush: (d) => flushed.push(d) })

    buffer.push('x')
    buffer.flush()
    buffer.dispose()
    vi.advanceTimersByTime(100)

    expect(flushed).toEqual(['x'])
  })
})
