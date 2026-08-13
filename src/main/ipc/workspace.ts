import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import { isAbsolute } from 'node:path'
import { IPC } from '@shared/ipc-contract'
import { BIN_SOURCES, PROJECT_KINDS, type BinSourceId, type ProjectKind } from '@shared/types'
import { getDb } from '../db'
import * as bin from '../services/bin'
import { openInEditor } from '../services/editor'
import * as assets from '../services/projectAssets'
import * as projects from '../services/projects'
import * as pty from '../services/pty'
import {
  listDirectory,
  readTextFile,
  resolveInRoot,
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

/**
 * Absolute source paths for a copy-in.
 *
 * The one place in this file where the renderer does name absolute paths, because
 * the files being filed come from outside every project. They are only ever read
 * from, and the destination is still resolved inside a project root — so the rule
 * this file enforces still holds for everything that gets written.
 */
function assertPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('paths must be an array')
  if (value.length > 500) throw new Error('That is too many files at once.')
  for (const path of value) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error('Each path must be absolute')
    }
  }
  return value as string[]
}

function rootOf(projectId: unknown): string {
  assertId(projectId, 'project id')
  return projects.requireProjectRoot(getDb(), projectId).root
}

/** The DB has no CHECK on kind by design — this is where the enum lives. */
function assertKind(value: unknown): ProjectKind {
  if (
    typeof value !== 'string' ||
    !(PROJECT_KINDS as readonly string[]).includes(value)
  ) {
    throw new Error(`Not a project kind: ${String(value)}`)
  }
  return value as ProjectKind
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

  ipcMain.handle(IPC.projectsAddCreative, (event) =>
    projects.addCreativeProject(
      getDb(),
      BrowserWindow.fromWebContents(event.sender)
    )
  )

  ipcMain.handle(IPC.projectsOpenExternal, async (_e, id: unknown) => {
    assertId(id, 'project id')
    // Hands the file to LaunchServices. Nothing here decides which application
    // that is — the file extension and the user's own defaults do.
    await projects.openCreativeProject(getDb(), id)
  })

  ipcMain.handle(IPC.projectsCreate, (_e, kind: unknown, name: unknown) => {
    const projectKind = assertKind(kind)
    if (typeof name !== 'string') throw new Error('name must be a string')

    const added = projects.createProject(getDb(), projectKind, name)
    // Composed here on purpose: createProject and createTemplateFolders are
    // deliberately not composed in the service layer (circular import), and a
    // duplicate already has whatever folders it has.
    if (!added.duplicate) {
      assets.createTemplateFolders(getDb(), added.project.id, projectKind)
    }
    return added
  })

  ipcMain.handle(IPC.projectsHomes, () => projects.projectHomes(getDb()))

  ipcMain.handle(IPC.projectsPickHome, (event, kind: unknown) =>
    projects.pickProjectHome(
      getDb(),
      assertKind(kind),
      BrowserWindow.fromWebContents(event.sender)
    )
  )

  /* ----------------------------------------------------------- folders */

  ipcMain.handle(IPC.foldersList, (_e, projectId: unknown) => {
    assertId(projectId, 'project id')
    return assets.listFolders(getDb(), projectId)
  })

  ipcMain.handle(
    IPC.foldersCreate,
    (_e, projectId: unknown, parentId: unknown, name: unknown) => {
      assertId(projectId, 'project id')
      if (parentId != null) assertId(parentId, 'parent folder id')
      if (typeof name !== 'string') throw new Error('name must be a string')
      return assets.createFolder(
        getDb(),
        projectId,
        (parentId as string | null) ?? null,
        name
      )
    }
  )

  ipcMain.handle(IPC.foldersRename, (_e, id: unknown, name: unknown) => {
    assertId(id, 'folder id')
    if (typeof name !== 'string') throw new Error('name must be a string')
    return assets.renameFolder(getDb(), id, name)
  })

  ipcMain.handle(IPC.foldersRemove, (_e, id: unknown) => {
    assertId(id, 'folder id')
    // Forgets the folder. The directory and everything in it stays.
    assets.removeFolder(getDb(), id)
  })

  ipcMain.handle(IPC.foldersFileAssets, (_e, id: unknown, paths: unknown) => {
    assertId(id, 'folder id')
    return assets.fileAssets(getDb(), id, assertPaths(paths))
  })

  ipcMain.handle(IPC.foldersPickAssets, async (event, id: unknown) => {
    assertId(id, 'folder id')
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Add files to this folder',
      buttonLabel: 'Add',
      properties: ['openFile' as const, 'multiSelections' as const]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null
    return assets.fileAssets(getDb(), id, result.filePaths)
  })

  ipcMain.handle(IPC.foldersReveal, (_e, id: unknown) => {
    assertId(id, 'folder id')
    const folder = assets.getFolder(getDb(), id)
    const { root } = projects.requireProjectRoot(getDb(), folder.projectId)
    shell.showItemInFolder(resolveInRoot(root, folder.relPath))
  })

  ipcMain.handle(IPC.foldersListAll, () => assets.listAllFolders(getDb()))

  /* ------------------------------------------------------------ the bin */

  ipcMain.handle(IPC.binList, (_e, source: unknown) => {
    if (
      typeof source !== 'string' ||
      !(BIN_SOURCES as readonly string[]).includes(source)
    ) {
      throw new Error(`Not a bin source: ${String(source)}`)
    }
    return bin.listBin(source as BinSourceId)
  })

  ipcMain.handle(
    IPC.binFile,
    (_e, folderId: unknown, source: unknown, names: unknown, mode: unknown) => {
      assertId(folderId, 'folder id')
      if (
        typeof source !== 'string' ||
        !(BIN_SOURCES as readonly string[]).includes(source)
      ) {
        throw new Error(`Not a bin source: ${String(source)}`)
      }
      if (mode !== 'move' && mode !== 'copy') {
        throw new Error('mode must be "move" or "copy"')
      }
      if (
        !Array.isArray(names) ||
        names.length > 500 ||
        names.some((n) => typeof n !== 'string')
      ) {
        throw new Error('names must be a list of listed entries')
      }
      // The gate that makes the bin a bin: names are resolved inside the
      // source root by main, so this cannot be pointed anywhere else.
      const sources = bin.resolveBinPaths(
        source as BinSourceId,
        names as string[]
      )
      return assets.fileInto(getDb(), folderId, sources, mode)
    }
  )

  // Watch both bins for the life of the process, telling every window which
  // source changed. Nothing is moved by the watcher — it only says "list again".
  const stopBinWatch = bin.watchBins((source) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.binChanged, source)
    }
  })
  process.on('exit', stopBinWatch)

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
