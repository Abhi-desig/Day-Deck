import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent
} from 'electron'
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
 * deliberately no way to read a stored API key back out.
 */
const api: DeckApi = {
  /**
   * The filesystem path of a dropped file.
   *
   * Electron removed the non-standard `File.path` property, so this is the only
   * way to learn where a dropped file actually lives. It reads a path off an object
   * the user themselves dragged in — it cannot be pointed at anything else — and
   * the paths only ever get copied *from*.
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
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
    removeFrame: (id) => ipcRenderer.invoke(IPC.framesDelete, id),

    lists: (boardId) => ipcRenderer.invoke(IPC.listsList, boardId),
    createList: (input) => ipcRenderer.invoke(IPC.listsCreate, input),
    updateList: (id, patch) => ipcRenderer.invoke(IPC.listsUpdate, id, patch),
    removeList: (id) => ipcRenderer.invoke(IPC.listsDelete, id),

    items: (boardId) => ipcRenderer.invoke(IPC.itemsList, boardId),
    createItem: (input) => ipcRenderer.invoke(IPC.itemsCreate, input),
    updateItem: (id, patch) => ipcRenderer.invoke(IPC.itemsUpdate, id, patch),
    removeItem: (id) => ipcRenderer.invoke(IPC.itemsDelete, id),

    refs: (boardId) => ipcRenderer.invoke(IPC.refsList, boardId),
    connect: (frameId, itemId) =>
      ipcRenderer.invoke(IPC.refsCreate, frameId, itemId),
    disconnect: (frameId, itemId) =>
      ipcRenderer.invoke(IPC.refsDelete, frameId, itemId),

    briefRefs: (boardId) => ipcRenderer.invoke(IPC.briefRefsList, boardId),
    connectBrief: (boardId, itemId) =>
      ipcRenderer.invoke(IPC.briefRefsCreate, boardId, itemId),
    disconnectBrief: (boardId, itemId) =>
      ipcRenderer.invoke(IPC.briefRefsDelete, boardId, itemId),

    sheets: (boardId) => ipcRenderer.invoke(IPC.sheetsList, boardId),
    createSheet: (input) => ipcRenderer.invoke(IPC.sheetsCreate, input),
    updateSheet: (id, patch) => ipcRenderer.invoke(IPC.sheetsUpdate, id, patch),
    deleteSheet: (id) => ipcRenderer.invoke(IPC.sheetsDelete, id),

    pickMedia: () => ipcRenderer.invoke(IPC.mediaPick),

    planScenes: (boardId) => ipcRenderer.invoke(IPC.boardsPlanScenes, boardId),
    applyScenePlan: (boardId, applies) =>
      ipcRenderer.invoke(IPC.boardsApplyScenePlan, boardId, applies),
    planPrompts: (boardId) => ipcRenderer.invoke(IPC.boardsPlanPrompts, boardId),
    applyPromptPlan: (boardId, applies) =>
      ipcRenderer.invoke(IPC.boardsApplyPromptPlan, boardId, applies)
  },
  styles: {
    list: () => ipcRenderer.invoke(IPC.stylesList),
    create: (input) => ipcRenderer.invoke(IPC.stylesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.stylesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.stylesDelete, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.stylesDuplicate, id),
    parse: (id) => ipcRenderer.invoke(IPC.stylesParse, id),

    placed: (boardId) => ipcRenderer.invoke(IPC.styleNodesList, boardId),
    place: (input) => ipcRenderer.invoke(IPC.styleNodesPlace, input),
    move: (id, x, y) => ipcRenderer.invoke(IPC.styleNodesMove, id, x, y),
    unplace: (id) => ipcRenderer.invoke(IPC.styleNodesRemove, id)
  },
  notify: {
    prefs: () => ipcRenderer.invoke(IPC.notifyGetPrefs),
    setPrefs: (prefs) => ipcRenderer.invoke(IPC.notifySetPrefs, prefs),
    preview: () => ipcRenderer.invoke(IPC.notifyPreview)
  },
  settings: {
    keyStatus: (slot) => ipcRenderer.invoke(IPC.settingsKeyStatus, slot),
    setKey: (key, slot) => ipcRenderer.invoke(IPC.settingsSetKey, key, slot),
    clearKey: (slot) => ipcRenderer.invoke(IPC.settingsClearKey, slot),
    testKey: (key, slot) => ipcRenderer.invoke(IPC.settingsTestKey, key, slot),
    slotConfigs: () => ipcRenderer.invoke(IPC.settingsSlotConfigs),
    setProvider: (slot, provider) =>
      ipcRenderer.invoke(IPC.settingsSetProvider, slot, provider),
    setBaseUrl: (slot, url) =>
      ipcRenderer.invoke(IPC.settingsSetBaseUrl, slot, url),
    setModel: (slot, model) =>
      ipcRenderer.invoke(IPC.settingsSetModel, slot, model),
    models: (slot, key) => ipcRenderer.invoke(IPC.aiModels, slot, key),
    rate: () => ipcRenderer.invoke(IPC.settingsGetRate),
    setRate: (perMinute) => ipcRenderer.invoke(IPC.settingsSetRate, perMinute),
    prefs: () => ipcRenderer.invoke(IPC.settingsGetPrefs),
    setTheme: (theme) => ipcRenderer.invoke(IPC.settingsSetTheme, theme),
    setSceneNumbers: (on) =>
      ipcRenderer.invoke(IPC.settingsSetSceneNumbers, on)
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
    openInEditor: (id) => ipcRenderer.invoke(IPC.projectsOpenInEditor, id),

    addCreative: () => ipcRenderer.invoke(IPC.projectsAddCreative),
    openExternal: (id) => ipcRenderer.invoke(IPC.projectsOpenExternal, id),

    create: (kind, name) => ipcRenderer.invoke(IPC.projectsCreate, kind, name),
    homes: () => ipcRenderer.invoke(IPC.projectsHomes),
    pickHome: (kind) => ipcRenderer.invoke(IPC.projectsPickHome, kind),

    folders: (projectId) => ipcRenderer.invoke(IPC.foldersList, projectId),
    createFolder: (projectId, parentId, name) =>
      ipcRenderer.invoke(IPC.foldersCreate, projectId, parentId, name),
    renameFolder: (id, name) => ipcRenderer.invoke(IPC.foldersRename, id, name),
    removeFolder: (id) => ipcRenderer.invoke(IPC.foldersRemove, id),
    fileAssets: (folderId, paths) =>
      ipcRenderer.invoke(IPC.foldersFileAssets, folderId, paths),
    pickAssets: (folderId) => ipcRenderer.invoke(IPC.foldersPickAssets, folderId),
    revealFolder: (id) => ipcRenderer.invoke(IPC.foldersReveal, id),
    allFolders: () => ipcRenderer.invoke(IPC.foldersListAll)
  },
  bin: {
    list: (source) => ipcRenderer.invoke(IPC.binList, source),
    file: (folderId, source, names, mode) =>
      ipcRenderer.invoke(IPC.binFile, folderId, source, names, mode),
    onChanged: (handler) => subscribe(IPC.binChanged, handler)
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
