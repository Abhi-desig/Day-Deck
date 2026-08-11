import { useEffect, useRef } from 'react'

/**
 * One keyboard listener for the whole app.
 *
 * Before this there were five independent `window.addEventListener('keydown')`
 * calls — the deck's arrows and ⌘T, the workspace's ⌘S, and an Escape handler
 * in each of the three overlays — plus Monaco's own bindings inside the editor.
 * Every one of them saw every keystroke and decided for itself whether to act,
 * which worked only because none of them wanted the same key. A command palette
 * on ⌘K breaks that immediately: it has to beat the section underneath it, and
 * it must not fire while someone is typing a task title.
 *
 * So: registrations are stacked in layers, the highest layer that matches a
 * combo handles it, and by default a handled key stops there. That makes
 * "Escape closes the dialog, not the panel behind it" a property of the system
 * rather than something each dialog has to get right on its own.
 */

/** Higher wins. Gaps are deliberate — there is room to slot things between. */
export const LAYER = {
  /** Always-on shortcuts: section navigation, the palette's own opener. */
  app: 0,
  /** Whatever section is currently mounted. */
  section: 10,
  /** Panels and dialogs drawn over a section. */
  overlay: 20,
  /** The command palette, which sits over everything including overlays. */
  palette: 30
} as const

export interface Hotkey {
  /**
   * Modifiers plus a key, e.g. `mod+k`, `escape`, `arrowleft`, `mod+shift+s`.
   * `mod` is ⌘ or Ctrl. Order does not matter; case does not matter.
   */
  combo: string
  handler(event: KeyboardEvent): void
  /**
   * Fire even while a text field or the editor has focus. Off by default —
   * the overwhelmingly common bug is a single-letter shortcut eating a
   * character out of an input.
   */
  allowInInput?: boolean
  /** Let lower layers see this key too. Off by default. */
  passthrough?: boolean
  /** Skip `preventDefault()`. Off by default. */
  allowDefault?: boolean
}

export interface Registration {
  layer: number
  /** Registration order within a layer, so the newest mount wins ties. */
  seq: number
  hotkeys: Hotkey[]
}

/** Everything the matcher needs from a keydown. Kept minimal so it is testable. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/**
 * Where the caret is, as far as shortcuts are concerned.
 *
 * Monaco focuses a hidden `<textarea>` and xterm focuses its own helper
 * textarea, so both are already caught by the tag test; the container check is
 * there for the editor's own widgets, which take focus on elements that are
 * not form controls.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false

  const el = target as {
    tagName?: string
    isContentEditable?: boolean
    closest?: (selector: string) => unknown
  }

  if (el.isContentEditable) return true
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    return true
  }

  return typeof el.closest === 'function'
    ? el.closest('.monaco-editor, .xterm') != null
    : false
}

const MODIFIER_ORDER = ['mod', 'shift', 'alt'] as const

/** Canonical form, so `shift+mod+s` and `mod+shift+s` are the same binding. */
export function normaliseCombo(combo: string): string {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
  const key = parts.filter((p) => !MODIFIER_ORDER.includes(p as never)).join('')
  const mods = MODIFIER_ORDER.filter((m) => parts.includes(m))
  return [...mods, key].join('+')
}

export function eventCombo(event: KeyLike): string {
  const mods: string[] = []
  // ⌘ on macOS, Ctrl elsewhere — accepting both matches what the handlers this
  // replaced already did, and costs nothing on a Mac-only build.
  if (event.metaKey || event.ctrlKey) mods.push('mod')
  if (event.shiftKey) mods.push('shift')
  if (event.altKey) mods.push('alt')
  return [...mods, event.key.toLowerCase()].join('+')
}

/**
 * Which handlers a keystroke reaches, in the order they run.
 *
 * The whole conflict-resolution policy is this function, and it is separated
 * from the DOM so it can be tested directly: highest layer first, newest
 * registration first within a layer, non-matching and input-guarded bindings
 * skipped, and the chain stopped at the first handler that does not opt into
 * passthrough.
 */
export function resolveHotkeys(
  registrations: readonly Registration[],
  combo: string,
  typing: boolean
): Hotkey[] {
  const ordered = [...registrations].sort(
    (a, b) => b.layer - a.layer || b.seq - a.seq
  )

  const run: Hotkey[] = []
  for (const registration of ordered) {
    for (const hotkey of registration.hotkeys) {
      if (normaliseCombo(hotkey.combo) !== combo) continue
      if (typing && !hotkey.allowInInput) continue

      run.push(hotkey)
      if (!hotkey.passthrough) return run
    }
  }
  return run
}

const registrations: Registration[] = []
let listening = false
let nextSeq = 0

function dispatch(event: KeyboardEvent): void {
  const matched = resolveHotkeys(
    registrations,
    eventCombo(event),
    isTypingTarget(event.target)
  )

  for (const hotkey of matched) {
    if (!hotkey.allowDefault) event.preventDefault()
    hotkey.handler(event)
  }
}

function ensureListening(): void {
  if (listening) return
  window.addEventListener('keydown', dispatch)
  listening = true
}

/**
 * Bind hotkeys for as long as the component is mounted.
 *
 * `hotkeys` is read through a ref, so the handlers can close over fresh props
 * without the binding being torn down and rebuilt on every render — the exact
 * problem the old hand-rolled listeners had to memoise around.
 */
export function useHotkeys(
  hotkeys: Hotkey[],
  options: { layer?: number; enabled?: boolean } = {}
): void {
  const { layer = LAYER.section, enabled = true } = options

  const latest = useRef(hotkeys)
  latest.current = hotkeys

  useEffect(() => {
    if (!enabled) return

    const registration: Registration = {
      layer,
      seq: nextSeq++,
      // Reading through the ref at dispatch time is what keeps this effect's
      // dependencies down to `layer` and `enabled`.
      get hotkeys() {
        return latest.current
      }
    }

    registrations.push(registration)
    ensureListening()

    return () => {
      const i = registrations.indexOf(registration)
      if (i !== -1) registrations.splice(i, 1)
    }
  }, [layer, enabled])
}
