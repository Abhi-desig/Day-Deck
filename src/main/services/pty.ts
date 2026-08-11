import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import type { PtySession } from '@shared/types'
import { ChunkBuffer } from './pty-buffer'

/**
 * Real shells, owned by the main process.
 *
 * node-pty is native and stays on this side of the bridge — the renderer never
 * spawns anything, it sends keystrokes and receives bytes. Every session is
 * tied to the webContents that asked for it, so a renderer reload cannot leave
 * an orphaned shell holding a dev server open.
 *
 * node-pty 1.1 targets N-API, so the prebuilt binary loads in Electron
 * unmodified — no electron-rebuild step, same as better-sqlite3. Its macOS
 * `spawn-helper` does need its executable bit restored after install; see the
 * postinstall script.
 */

/** Enough for a workspace with a dev server, a test watcher and room to spare. */
const MAX_SESSIONS = 24

/**
 * Variables that describe *this* process and would lie to a child. Electron
 * sets ELECTRON_RUN_AS_NODE when it re-execs itself as plain node; inheriting
 * it turns the user's shell into a node process that exits immediately.
 */
const STRIPPED = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'NODE_ENV'
]

interface Session {
  id: string
  projectId: string
  shell: string
  proc: pty.IPty
  buffer: ChunkBuffer
  ownerId: number
  exited: boolean
}

const sessions = new Map<string, Session>()

export interface PtyEvents {
  onData(id: string, data: string, owner: WebContents): void
  onExit(id: string, exitCode: number, signal: number | null, owner: WebContents): void
}

let events: PtyEvents | null = null

/** Wired once at startup by the IPC layer, which owns the channel names. */
export function setPtyEvents(next: PtyEvents): void {
  events = next
}

/**
 * The user's login shell, so their PATH, nvm and aliases are all present. A GUI
 * app inherits a nearly empty PATH from launchd, which is why `-l` is not
 * optional here — without it `pnpm` is not found in a packaged build.
 */
function resolveShell(): { file: string; args: string[] } {
  const candidates = [process.env['SHELL'], '/bin/zsh', '/bin/bash', '/bin/sh']
  const file = candidates.find((c): c is string => !!c && existsSync(c)) ?? '/bin/sh'
  return { file, args: ['-l'] }
}

export function buildEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || STRIPPED.includes(key)) continue
    env[key] = value
  }
  // xterm renders 256 colours and true colour; say so, or tools ship us plain
  // text and the terminal looks broken rather than merely uncoloured.
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  return env
}

export function createSession(
  projectId: string,
  cwd: string,
  cols: number,
  rows: number,
  owner: WebContents
): PtySession {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(
      `Too many terminals open (${MAX_SESSIONS}). Close one before starting another.`
    )
  }

  const { file, args } = resolveShell()
  const id = randomUUID()
  const ownerId = owner.id

  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    // A pty with zero columns wraps every character; clamp rather than trust
    // a renderer that measured before layout settled.
    cols: Math.max(2, Math.floor(cols) || 80),
    rows: Math.max(1, Math.floor(rows) || 24),
    cwd,
    env: buildEnv(process.env)
  })

  const buffer = new ChunkBuffer({
    onFlush: (data) => {
      if (owner.isDestroyed()) return
      events?.onData(id, data, owner)
    }
  })

  const session: Session = {
    id,
    projectId,
    shell: file,
    proc,
    buffer,
    ownerId,
    exited: false
  }
  sessions.set(id, session)

  proc.onData((data) => buffer.push(data))
  proc.onExit(({ exitCode, signal }) => {
    session.exited = true
    // Flush first: the last thing a failing command prints is the part you
    // most want to read, and it is still sitting in the buffer.
    buffer.dispose()
    sessions.delete(id)
    if (!owner.isDestroyed()) {
      events?.onExit(id, exitCode, signal ?? null, owner)
    }
  })

  return { id, projectId, shell: file }
}

export function write(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session || session.exited) return
  session.proc.write(data)
}

export function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (!session || session.exited) return
  try {
    session.proc.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
  } catch {
    // The process can exit between the check and the ioctl. Nothing to do.
  }
}

export function kill(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.buffer.dispose()
  try {
    session.proc.kill()
  } catch {
    // Already gone.
  }
}

/** Closing a workspace takes its shells with it. */
export function killProject(projectId: string): number {
  let killed = 0
  for (const session of [...sessions.values()]) {
    if (session.projectId !== projectId) continue
    kill(session.id)
    killed++
  }
  return killed
}

/** A reloaded or closed renderer can no longer read from its shells. */
export function killForOwner(ownerId: number): number {
  let killed = 0
  for (const session of [...sessions.values()]) {
    if (session.ownerId !== ownerId) continue
    kill(session.id)
    killed++
  }
  return killed
}

export function killAll(): void {
  for (const session of [...sessions.values()]) kill(session.id)
}

export function sessionCount(): number {
  return sessions.size
}

export function ownerOf(id: string): number | null {
  return sessions.get(id)?.ownerId ?? null
}
