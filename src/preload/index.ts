import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { DeckApi } from '@shared/ipc-contract'
import type { CurriculumProgress, PtyChunk, PtyExit } from '@shared/types'

/** Subscribe to a one-way main -> renderer channel, returning an unsubscribe. */
function subscribe<T>(
  channel: string,
  handler: (payload: T) => void
): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

/**
 * The entire privileged surface the renderer gets. Everything is an `invoke`
 * round-trip to a validating handler in main/ipc — no fs, no db, no Node, and
 * deliberately no way to read the stored Gemini API key back out.
 */
const api: DeckApi = {
  system: {
    bootstrap: () => ipcRenderer.invoke(IPC.systemBootstrap),
    dbInfo: () => ipcRenderer.invoke(IPC.systemDbInfo),
    revealDb: () => ipcRenderer.invoke(IPC.systemRevealDb),
    launchAtLogin: () => ipcRenderer.invoke(IPC.systemGetLaunchAtLogin),
    setLaunchAtLogin: (enabled) =>
      ipcRenderer.invoke(IPC.systemSetLaunchAtLogin, enabled)
  },
  backup: {
    exportToFile: () => ipcRenderer.invoke(IPC.backupExport),
    importFromFile: () => ipcRenderer.invoke(IPC.backupImport)
  },
  days: {
    range: (from, to) => ipcRenderer.invoke(IPC.daysRange, from, to)
  },
  slots: {
    create: (input) => ipcRenderer.invoke(IPC.slotCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.slotUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.slotDelete, id),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.slotSetStatus, id, status),
    reorder: (date, orderedIds) =>
      ipcRenderer.invoke(IPC.slotReorder, date, orderedIds)
  },
  weekly: {
    list: () => ipcRenderer.invoke(IPC.weeklyList),
    upsert: (input) => ipcRenderer.invoke(IPC.weeklyUpsert, input),
    remove: (id) => ipcRenderer.invoke(IPC.weeklyDelete, id)
  },
  curriculum: {
    overview: () => ipcRenderer.invoke(IPC.curriculumOverview),
    generate: (input) => ipcRenderer.invoke(IPC.curriculumGenerate, input),
    archive: (id) => ipcRenderer.invoke(IPC.curriculumArchive, id),
    reflowPreview: (id) =>
      ipcRenderer.invoke(IPC.curriculumReflowPreview, id),
    reflowCommit: (id) => ipcRenderer.invoke(IPC.curriculumReflowCommit, id),
    setDailyCap: (minutes) =>
      ipcRenderer.invoke(IPC.curriculumSetCap, minutes),
    subdivide: (id) => ipcRenderer.invoke(IPC.curriculumSubdivide, id),
    onProgress: (handler) => {
      const listener = (_e: IpcRendererEvent, update: CurriculumProgress) =>
        handler(update)
      ipcRenderer.on(IPC.curriculumProgress, listener)
      return () => {
        ipcRenderer.off(IPC.curriculumProgress, listener)
      }
    }
  },
  notes: {
    list: (curriculumId) => ipcRenderer.invoke(IPC.notesList, curriculumId ?? null),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.notesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.notesDelete, id)
  },
  agent: {
    ask: (date, question, history) =>
      ipcRenderer.invoke(IPC.agentAsk, date, question, history)
  },
  tracker: {
    week: (anchor) => ipcRenderer.invoke(IPC.trackerWeek, anchor)
  },
  stickers: {
    list: () => ipcRenderer.invoke(IPC.stickersList),
    create: (input) => ipcRenderer.invoke(IPC.stickersCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.stickersUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.stickersDelete, id),
    folders: () => ipcRenderer.invoke(IPC.stickerFoldersList),
    createFolder: (input) => ipcRenderer.invoke(IPC.stickerFoldersCreate, input),
    updateFolder: (id, patch) =>
      ipcRenderer.invoke(IPC.stickerFoldersUpdate, id, patch),
    removeFolder: (id) => ipcRenderer.invoke(IPC.stickerFoldersDelete, id)
  },
  tags: {
    list: () => ipcRenderer.invoke(IPC.tagsList),
    create: (input) => ipcRenderer.invoke(IPC.tagsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.tagsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.tagsDelete, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC.tagsReorder, orderedIds),
    attach: (slotId, tagId, origin) =>
      ipcRenderer.invoke(IPC.tagsAttach, slotId, tagId, origin),
    detach: (slotId, tagId) => ipcRenderer.invoke(IPC.tagsDetach, slotId, tagId)
  },
  storyboards: {
    list: () => ipcRenderer.invoke(IPC.boardsList),
    create: (input) => ipcRenderer.invoke(IPC.boardsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.boardsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.boardsDelete, id),
    frames: (boardId) => ipcRenderer.invoke(IPC.framesList, boardId),
    createFrame: (input) => ipcRenderer.invoke(IPC.framesCreate, input),
    updateFrame: (id, patch) => ipcRenderer.invoke(IPC.framesUpdate, id, patch),
    removeFrame: (id) => ipcRenderer.invoke(IPC.framesDelete, id)
  },
  notify: {
    prefs: () => ipcRenderer.invoke(IPC.notifyGetPrefs),
    setPrefs: (prefs) => ipcRenderer.invoke(IPC.notifySetPrefs, prefs),
    preview: () => ipcRenderer.invoke(IPC.notifyPreview)
  },
  settings: {
    keyStatus: () => ipcRenderer.invoke(IPC.settingsKeyStatus),
    setKey: (key) => ipcRenderer.invoke(IPC.settingsSetKey, key),
    clearKey: () => ipcRenderer.invoke(IPC.settingsClearKey),
    testKey: (key) => ipcRenderer.invoke(IPC.settingsTestKey, key),
    models: () => ipcRenderer.invoke(IPC.geminiModels)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    add: () => ipcRenderer.invoke(IPC.projectsAdd),
    remove: (id) => ipcRenderer.invoke(IPC.projectsRemove, id),
    setPinned: (id, pinned) =>
      ipcRenderer.invoke(IPC.projectsSetPinned, id, pinned),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC.projectsReorder, orderedIds),
    rename: (id, name) => ipcRenderer.invoke(IPC.projectsRename, id, name),
    touch: (id) => ipcRenderer.invoke(IPC.projectsTouch, id),
    openInEditor: (id) => ipcRenderer.invoke(IPC.projectsOpenInEditor, id)
  },
  files: {
    tree: (projectId, dir) => ipcRenderer.invoke(IPC.filesTree, projectId, dir),
    read: (projectId, path) => ipcRenderer.invoke(IPC.filesRead, projectId, path),
    write: (projectId, path, text, expectedMtimeMs) =>
      ipcRenderer.invoke(IPC.filesWrite, projectId, path, text, expectedMtimeMs)
  },
  terminal: {
    create: (projectId, cols, rows) =>
      ipcRenderer.invoke(IPC.ptyCreate, projectId, cols, rows),
    // Fire-and-forget: a keystroke has no reply worth waiting for, and one
    // round trip per character is enough to make typing feel laggy.
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.ptyKill, id),
    killProject: (projectId) => ipcRenderer.send(IPC.ptyKillProject, projectId),
    onData: (handler) => subscribe<PtyChunk>(IPC.ptyData, handler),
    onExit: (handler) => subscribe<PtyExit>(IPC.ptyExit, handler)
  }
}

contextBridge.exposeInMainWorld('deck', api)
