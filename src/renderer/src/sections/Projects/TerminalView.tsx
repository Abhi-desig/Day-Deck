import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { api } from '../../lib/api'

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
      theme: THEME
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
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
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
    }
  }, [projectId])

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
