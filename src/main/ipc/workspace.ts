import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { getDb } from '../db'
import { openInEditor } from '../services/editor'
import * as projects from '../services/projects'
import * as pty from '../services/pty'
import {
  listDirectory,
  readTextFile,
  writeTextFile
} from '../services/workspace-fs'

/**
 * Everything Phase 3 added to the bridge: the project registry, the file
 * access the embedded editor needs, and the terminal stream.
 *
 * The rule this file exists to enforce is that the renderer never names an
 * absolute path. It sends a project id, main looks up the folder, and
 * `workspace-fs` refuses anything that resolves outside it. A compromised or
 * simply buggy renderer therefore cannot read `~/.ssh` no matter what it asks
 * for.
 */

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty id`)
  }
}

function assertPath(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
}

function rootOf(projectId: unknown): string {
  assertId(projectId, 'project id')
  return projects.requireProjectRoot(getDb(), projectId).root
}

export function registerWorkspaceIpc(): void {
  /* ---------------------------------------------------------- registry */

  ipcMain.handle(IPC.projectsList, () => projects.listProjects(getDb()))

  ipcMain.handle(IPC.projectsAdd, (event) =>
    projects.addProject(getDb(), BrowserWindow.fromWebContents(event.sender))
  )

  ipcMain.handle(IPC.projectsRemove, (_e, id: unknown) => {
    assertId(id, 'project id')
    // Its shells go too — the workspace they belonged to is about to vanish.
    pty.killProject(id)
    projects.removeProject(getDb(), id)
    return projects.listProjects(getDb())
  })

  ipcMain.handle(IPC.projectsSetPinned, (_e, id: unknown, pinned: unknown) => {
    assertId(id, 'project id')
    return projects.setPinned(getDb(), id, pinned === true)
  })

  ipcMain.handle(IPC.projectsReorder, (_e, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      throw new Error('orderedIds must be an array of project ids')
    }
    return projects.reorderProjects(getDb(), orderedIds as string[])
  })

  ipcMain.handle(IPC.projectsRename, (_e, id: unknown, name: unknown) => {
    assertId(id, 'project id')
    if (typeof name !== 'string') throw new Error('name must be a string')
    return projects.renameProject(getDb(), id, name)
  })

  ipcMain.handle(IPC.projectsTouch, (_e, id: unknown) => {
    assertId(id, 'project id')
    return projects.touchProject(getDb(), id)
  })

  ipcMain.handle(IPC.projectsOpenInEditor, async (_e, id: unknown) => {
    assertId(id, 'project id')
    const { root } = projects.requireProjectRoot(getDb(), id)
    return openInEditor(root)
  })

  /* ------------------------------------------------------------- files */

  ipcMain.handle(IPC.filesTree, (_e, projectId: unknown, dir: unknown) => {
    const root = rootOf(projectId)
    assertPath(dir, 'dir')
    return listDirectory(root, dir)
  })

  ipcMain.handle(IPC.filesRead, (_e, projectId: unknown, path: unknown) => {
    const root = rootOf(projectId)
    assertPath(path, 'path')
    return readTextFile(root, path)
  })

  ipcMain.handle(
    IPC.filesWrite,
    (
      _e,
      projectId: unknown,
      path: unknown,
      text: unknown,
      expectedMtimeMs: unknown
    ) => {
      const root = rootOf(projectId)
      assertPath(path, 'path')
      if (typeof text !== 'string') throw new Error('Contents must be a string')
      const expected =
        typeof expectedMtimeMs === 'number' && Number.isFinite(expectedMtimeMs)
          ? expectedMtimeMs
          : undefined
      return writeTextFile(root, path, text, expected)
    }
  )

  /* ---------------------------------------------------------- terminal */

  pty.setPtyEvents({
    onData: (id, data, owner) => owner.send(IPC.ptyData, { id, data }),
    onExit: (id, exitCode, signal, owner) =>
      owner.send(IPC.ptyExit, { id, exitCode, signal })
  })

  ipcMain.handle(
    IPC.ptyCreate,
    (event, projectId: unknown, cols: unknown, rows: unknown) => {
      assertId(projectId, 'project id')
      const { root } = projects.requireProjectRoot(getDb(), projectId)
      projects.touchProject(getDb(), projectId)
      return pty.createSession(
        projectId,
        root,
        typeof cols === 'number' ? cols : 80,
        typeof rows === 'number' ? rows : 24,
        event.sender
      )
    }
  )

  /**
   * A renderer may only drive the sessions it created. Sessions are per-window
   * anyway today, but the check costs nothing and keeps the invariant true if a
   * second window ever exists.
   */
  const owns = (event: IpcMainEvent, id: unknown): id is string =>
    typeof id === 'string' && pty.ownerOf(id) === event.sender.id

  ipcMain.on(IPC.ptyWrite, (event, id: unknown, data: unknown) => {
    if (!owns(event, id) || typeof data !== 'string') return
    pty.write(id, data)
  })

  ipcMain.on(IPC.ptyResize, (event, id: unknown, cols: unknown, rows: unknown) => {
    if (!owns(event, id)) return
    if (typeof cols !== 'number' || typeof rows !== 'number') return
    pty.resize(id, cols, rows)
  })

  ipcMain.on(IPC.ptyKill, (event, id: unknown) => {
    if (!owns(event, id)) return
    pty.kill(id)
  })

  ipcMain.on(IPC.ptyKillProject, (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') return
    pty.killProject(projectId)
  })
}

/**
 * A reload replaces the renderer without unmounting anything, so the React
 * cleanup that would have killed these shells never runs. Without this, every
 * hot reload during development leaks a login shell — and any dev server
 * running inside one keeps its port.
 */
export function bindPtyLifecycle(contents: WebContents): void {
  const release = (): void => {
    pty.killForOwner(contents.id)
  }
  contents.on('destroyed', release)
  // Fires before the new document loads, which is exactly when the old
  // session's terminals stop having anywhere to render.
  contents.on('did-start-navigation', (details) => {
    if (details.isSameDocument || !details.isMainFrame) return
    release()
  })
}
