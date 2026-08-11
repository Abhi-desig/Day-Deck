import { describe, expect, it, vi } from 'vitest'
import type { Hotkey, Registration } from '../src/renderer/src/lib/keyboard'
import {
  LAYER,
  eventCombo,
  isTypingTarget,
  normaliseCombo,
  resolveHotkeys
} from '../src/renderer/src/lib/keyboard'

/**
 * The conflict policy, not the DOM plumbing.
 *
 * Five hand-rolled window listeners were replaced by one dispatcher, and the
 * thing that has to be right is which handler a keystroke reaches. That is
 * `resolveHotkeys`, which takes plain data — so it is tested directly rather
 * than through a simulated browser.
 */

let seq = 0

function reg(layer: number, hotkeys: Hotkey[]): Registration {
  return { layer, seq: seq++, hotkeys }
}

const noop = (): void => {}

const key = (combo: string, extra: Partial<Hotkey> = {}): Hotkey => ({
  combo,
  handler: noop,
  ...extra
})

describe('combo normalisation', () => {
  it('does not care about modifier order or case', () => {
    expect(normaliseCombo('shift+mod+S')).toBe('mod+shift+s')
    expect(normaliseCombo('MOD+Shift+s')).toBe('mod+shift+s')
    expect(normaliseCombo(' mod + k ')).toBe('mod+k')
  })

  it('treats ⌘ and Ctrl as the same modifier', () => {
    expect(eventCombo({ key: 'k', metaKey: true })).toBe('mod+k')
    expect(eventCombo({ key: 'k', ctrlKey: true })).toBe('mod+k')
  })

  it('keeps modifiers in a fixed order regardless of the event', () => {
    expect(
      eventCombo({ key: 'S', metaKey: true, shiftKey: true, altKey: true })
    ).toBe('mod+shift+alt+s')
  })

  it('matches a bare key with no modifiers', () => {
    expect(eventCombo({ key: 'Escape' })).toBe('escape')
    expect(eventCombo({ key: 'ArrowLeft' })).toBe('arrowleft')
  })

  it('does not confuse a modified key with its bare form', () => {
    expect(eventCombo({ key: 't' })).not.toBe(normaliseCombo('mod+t'))
  })
})

describe('the typing guard', () => {
  const el = (
    tagName: string,
    opts: { editable?: boolean; inside?: string | null } = {}
  ) => ({
    tagName,
    isContentEditable: opts.editable ?? false,
    closest: (selector: string) =>
      opts.inside && selector.includes(opts.inside) ? {} : null
  })

  it('is true for form controls', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
  })

  it('is true for contenteditable', () => {
    expect(isTypingTarget(el('DIV', { editable: true }))).toBe(true)
  })

  /** Monaco and xterm both take focus on elements that are not form controls. */
  it('is true anywhere inside the editor or a terminal', () => {
    expect(isTypingTarget(el('DIV', { inside: 'monaco-editor' }))).toBe(true)
    expect(isTypingTarget(el('DIV', { inside: 'xterm' }))).toBe(true)
  })

  it('is false for an ordinary element, and for nothing at all', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(el('DIV'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })
})

describe('resolving a keystroke', () => {
  it('gives the key to the highest layer that wants it', () => {
    const section = key('escape')
    const overlay = key('escape')

    const run = resolveHotkeys(
      [reg(LAYER.section, [section]), reg(LAYER.overlay, [overlay])],
      'escape',
      false
    )

    expect(run).toEqual([overlay])
  })

  /** Escape must close the dialog, not the panel behind it as well. */
  it('stops at the first handler by default', () => {
    const dialog = vi.fn()
    const panel = vi.fn()

    const run = resolveHotkeys(
      [
        reg(LAYER.overlay, [key('escape', { handler: panel })]),
        reg(LAYER.overlay, [key('escape', { handler: dialog })])
      ],
      'escape',
      false
    )

    expect(run).toHaveLength(1)
    // Newest registration within a layer wins, which is the dialog that
    // mounted over the panel.
    expect(run[0].handler).toBe(dialog)
  })

  it('carries on to lower layers when a handler asks to pass through', () => {
    const first = key('mod+s', { passthrough: true })
    const second = key('mod+s')

    const run = resolveHotkeys(
      [reg(LAYER.section, [second]), reg(LAYER.overlay, [first])],
      'mod+s',
      false
    )

    expect(run).toEqual([first, second])
  })

  it('skips bindings that do not match', () => {
    expect(
      resolveHotkeys([reg(LAYER.section, [key('mod+t')])], 'mod+k', false)
    ).toEqual([])
  })

  /** The bug this guard exists to prevent: a shortcut eating a keystroke. */
  it('withholds ordinary bindings while the user is typing', () => {
    const run = resolveHotkeys(
      [reg(LAYER.section, [key('arrowleft')])],
      'arrowleft',
      true
    )

    expect(run).toEqual([])
  })

  it('still delivers bindings that opt into inputs', () => {
    const palette = key('mod+k', { allowInInput: true })

    expect(
      resolveHotkeys([reg(LAYER.app, [palette])], 'mod+k', true)
    ).toEqual([palette])
  })

  /**
   * ⌘K opens the palette from anywhere; ← must not move the deck while a task
   * title is being typed. Both rules at once is the whole point of the flag.
   */
  it('applies the guard per binding, not per registration', () => {
    const bindings = [
      key('arrowleft'),
      key('mod+k', { allowInInput: true })
    ]
    const registrations = [reg(LAYER.section, bindings)]

    expect(resolveHotkeys(registrations, 'arrowleft', true)).toEqual([])
    expect(resolveHotkeys(registrations, 'arrowleft', false)).toEqual([
      bindings[0]
    ])
    expect(resolveHotkeys(registrations, 'mod+k', true)).toEqual([bindings[1]])
  })

  it('lets the palette layer beat an open overlay', () => {
    const overlayEscape = key('escape', { allowInInput: true })
    const paletteEscape = key('escape', { allowInInput: true })

    const run = resolveHotkeys(
      [
        reg(LAYER.overlay, [overlayEscape]),
        reg(LAYER.palette, [paletteEscape])
      ],
      'escape',
      true
    )

    expect(run).toEqual([paletteEscape])
  })

  it('accepts a binding written with modifiers in any order', () => {
    const saveAll = key('shift+mod+s', { allowInInput: true })

    expect(
      resolveHotkeys([reg(LAYER.section, [saveAll])], 'mod+shift+s', true)
    ).toEqual([saveAll])
  })
})
