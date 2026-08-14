import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { ThemeName } from '@shared/types'
import { api } from '../../lib/api'
import { usePrefs } from '../../store/usePrefs'

/**
 * One xterm bound to one pty, for the lifetime of this component.
 *
 * The session is created on mount and killed on unmount, with no route between
 * them — closing a tab therefore cannot leave a shell (or the dev server inside
 * it) running with nothing attached. Everything below the React layer is
 * imperative and lives in refs, because xterm owns its own DOM and re-rendering
 * into it would destroy the scrollback.
 */
interface TerminalViewProps {
  projectId: string
  active: boolean
  /**
   * Increments when a layout animation *finishes*. Fitting is driven off this
   * and nothing else: calling `fit()` on every frame of the split resizer
   * reflows the pty dozens of times a second and the output tears.
   */
  settleToken: number
  onReady(shell: string): void
  onExit(exitCode: number): void
  onError(message: string): void
}

const THEME = {
  background: '#00000000',
  foreground: '#e8e8ef',
  cursor: '#ffb020',
  cursorAccent: '#16161b',
  selectionBackground: '#ffb02040',
  black: '#2a2a33',
  red: '#fb7185',
  green: '#5eead4',
  yellow: '#ffc95f',
  blue: '#7c9cff',
  magenta: '#a78bfa',
  cyan: '#67e8f9',
  white: '#d8d8e3',
  brightBlack: '#5a5a68',
  brightRed: '#fda4af',
  brightGreen: '#99f6e4',
  brightYellow: '#ffdb99',
  brightBlue: '#a5b8ff',
  brightMagenta: '#c4b5fd',
  brightCyan: '#a5f3fc',
  brightWhite: '#f6f6f9'
}

/**
 * The same terminal on a light workspace.
 *
 * Not an inversion. The dark theme's `yellow` is 1.4:1 on white and its `cyan`
 * is 1.5:1 — both literally unreadable — so every base colour comes down to
 * roughly 6-7:1. "Bright" then cannot mean lighter without vanishing, so the
 * bright set sits at 4.2-5:1: still visibly more vivid than the base set, still
 * legible. That is what Solarized Light and One Light do too.
 *
 * Two that are easy to get wrong. `brightBlack` is what every CLI reaches for
 * to dim its own output, so it has to stay readable — it is the single biggest
 * tell of a badly ported light terminal. And `white` stays a light grey rather
 * than going dark, because TUIs use it as a *background* fill; only
 * `brightWhite` is an emphasis foreground, so only that one inverts.
 */
const THEME_LIGHT = {
  background: '#00000000',
  foreground: '#1f2229',
  cursor: '#9a5b00',
  // The glyph under a block cursor, so it has to be the ground.
  cursorAccent: '#ffffff',
  selectionBackground: '#c98a1a40',
  black: '#1f2229',
  red: '#b3243c',
  green: '#0b6b53',
  yellow: '#8a5a00',
  blue: '#2a52bd',
  magenta: '#6f3fbe',
  cyan: '#0a6273',
  white: '#b4b8c2',
  brightBlack: '#6a6f7d',
  brightRed: '#d1355a',
  brightGreen: '#128a6c',
  brightYellow: '#a8700a',
  brightBlue: '#3a6ad6',
  brightMagenta: '#8a55d6',
  brightCyan: '#0d7d92',
  brightWhite: '#3c4150'
}

const themeFor = (theme: ThemeName): typeof THEME =>
  theme === 'light' ? THEME_LIGHT : THEME

export function TerminalView({
  projectId,
  active,
  settleToken,
  onReady,
  onExit,
  onError
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  /** Held so a theme change can invalidate its glyph cache — see below. */
  const webglRef = useRef<WebglAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  /** Keystrokes typed before the pty finished starting. */
  const pendingRef = useRef<string[]>([])
  /** Once the shell is gone there is nothing to queue *for*. */
  const finishedRef = useRef(false)

  // Kept in refs so the setup effect can run exactly once per mount without
  // listing callbacks that change identity on every parent render.
  const callbacks = useRef({ onReady, onExit, onError })
  callbacks.current = { onReady, onExit, onError }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false

    const term = new Terminal({
      allowProposedApi: true,
      fontFamily:
        "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      // Deep enough to scroll back through a failed build, cheap enough to keep
      // several of these alive at once.
      scrollback: 8000,
      // The pane behind this is glass; an opaque terminal would punch a hole
      // in it.
      allowTransparency: true,
      theme: themeFor(usePrefs.getState().theme)
    })
    termRef.current = term

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)

    term.open(host)

    // WebGL is a large win with a busy dev server and a small risk: a lost
    // context, or a machine that cannot give us one. Either way the canvas
    // renderer is still there, so failure is not worth surfacing.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        // Or a later theme change calls into a disposed addon.
        webglRef.current = null
      })
      term.loadAddon(webgl)
      webglRef.current = webgl
    } catch {
      /* canvas renderer it is */
    }

    try {
      fit.fit()
    } catch {
      /* not laid out yet; the settle pass will catch it */
    }

    void (async () => {
      try {
        const session = await api.terminal.create(
          projectId,
          term.cols,
          term.rows
        )
        // Unmounted while the shell was starting — kill it rather than leak it.
        if (disposed) {
          api.terminal.kill(session.id)
          return
        }

        sessionRef.current = session.id
        callbacks.current.onReady(session.shell)

        for (const queued of pendingRef.current) {
          api.terminal.write(session.id, queued)
        }
        pendingRef.current = []
      } catch (err) {
        if (disposed) return
        finishedRef.current = true
        const message = err instanceof Error ? err.message : String(err)
        callbacks.current.onError(message)
        term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
      }
    })()

    const typed = term.onData((data) => {
      const id = sessionRef.current
      if (id) api.terminal.write(id, data)
      // Queue only while the shell is still starting. Typing at a dead terminal
      // must be discarded, not accumulated forever.
      else if (!finishedRef.current) pendingRef.current.push(data)
    })

    const offData = api.terminal.onData((chunk) => {
      if (chunk.id !== sessionRef.current) return
      term.write(chunk.data)
    })

    const offExit = api.terminal.onExit((exit) => {
      if (exit.id !== sessionRef.current) return
      sessionRef.current = null
      finishedRef.current = true
      term.write(
        `\r\n\x1b[38;5;244m[process exited with code ${exit.exitCode}]\x1b[0m\r\n`
      )
      callbacks.current.onExit(exit.exitCode)
    })

    return () => {
      disposed = true
      typed.dispose()
      offData()
      offExit()
      if (sessionRef.current) api.terminal.kill(sessionRef.current)
      sessionRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      webglRef.current = null
    }
  }, [projectId])

  /*
   * Repaint on a theme change.
   *
   * Its own effect, deliberately: adding the theme to the setup effect's deps
   * would tear down the pty and take the scrollback with it every time the
   * toggle is flipped.
   *
   * Two steps, and the second is not optional. `options.theme` is compared by
   * reference, so a fresh object is required — mutating the existing one does
   * nothing. And the WebGL renderer caches every glyph it has drawn *with its
   * colour baked in*, so without clearing that atlas the scrollback keeps
   * repainting in the old palette until each cell happens to change.
   */
  const theme = usePrefs((s) => s.theme)
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.theme = { ...themeFor(theme) }
    // Absent on the canvas-renderer fallback path, which honours a theme
    // change on its own.
    webglRef.current?.clearTextureAtlas()
    term.refresh(0, term.rows - 1)
  }, [theme])

  /**
   * Re-fit only when a layout has finished moving, and tell the pty its new
   * size so full-screen programs redraw at the right width.
   */
  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return

    // One frame of slack: the settle signal arrives with the animation's last
    // commit, and the box is not measurable until that has painted.
    const frame = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        return
      }
      const id = sessionRef.current
      if (id) api.terminal.resize(id, term.cols, term.rows)
    })
    return () => cancelAnimationFrame(frame)
  }, [settleToken, active])

  // Focus follows the visible tab, so switching tabs and typing works without
  // an extra click.
  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      // `visibility` rather than `display`: a hidden tab keeps its layout box,
      // so its terminal still has real dimensions to fit against and its
      // scrollback survives being in the background.
      style={{ visibility: active ? 'visible' : 'hidden' }}
    />
  )
}
