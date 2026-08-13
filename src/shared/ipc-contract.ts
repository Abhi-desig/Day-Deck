import type { DateKey } from './date'
import type {
  AgentMessage,
  AgentReply,
  AssetsFiled,
  AssetsMoved,
  BackupWritten,
  BinListing,
  BinSourceId,
  BootstrapResult,
  BriefPreview,
  FileMode,
  DbInfo,
  ImportSummary,
  CurriculumInput,
  CurriculumPlan,
  CurriculumProgress,
  DayCard,
  EditorLaunch,
  FileNode,
  FileReadResult,
  FileSaved,
  GeminiModel,
  GoalNote,
  GoalNotePatch,
  GoalsOverview,
  KeySlot,
  KeyStatus,
  MediaKind,
  NewGoalNote,
  NewSlot,
  NewSticker,
  NewStickerFolder,
  NewStoryboard,
  NewStoryFrame,
  NewStoryList,
  NewStoryListItem,
  NewStoryStyleNode,
  NewTag,
  NewVideoStyle,
  NewWeeklyTemplate,
  NotifyPrefs,
  Project,
  ProjectAdded,
  ProjectFolder,
  ProjectHomes,
  ProjectKind,
  PromptApply,
  PromptPlanProposal,
  PtyChunk,
  PtyExit,
  PtySession,
  ReflowPreview,
  SceneApply,
  ScenePlanProposal,
  Slot,
  SlotPatch,
  SlotStatus,
  Sticker,
  StickerFolder,
  StickerFolderPatch,
  StickerPatch,
  Storyboard,
  StoryboardPatch,
  StoryBriefRef,
  StoryFrame,
  StoryFramePatch,
  StoryFrameRef,
  StoryList,
  StoryListItem,
  StoryListItemPatch,
  StoryListPatch,
  StoryStyleNode,
  SubdivideResult,
  Tag,
  TagOrigin,
  TagPatch,
  TrackerWeek,
  VideoStyle,
  VideoStylePatch,
  WeeklyTemplate
} from './types'

/**
 * Single source of truth for every main<->renderer channel. Both sides import
 * from here, so a renamed channel is a compile error rather than a silent
 * no-op at runtime.
 */
export const IPC = {
  systemBootstrap: 'system:bootstrap',
  daysRange: 'days:range',
  slotCreate: 'slot:create',
  slotUpdate: 'slot:update',
  slotDelete: 'slot:delete',
  slotSetStatus: 'slot:setStatus',
  slotReorder: 'slot:reorder',
  weeklyList: 'weekly:list',
  weeklyUpsert: 'weekly:upsert',
  weeklyDelete: 'weekly:delete',

  /** Every active goal plus the shared daily-budget arithmetic. */
  curriculumOverview: 'curriculum:overview',
  curriculumGenerate: 'curriculum:generate',
  curriculumArchive: 'curriculum:archive',
  curriculumReflowPreview: 'curriculum:reflowPreview',
  curriculumReflowCommit: 'curriculum:reflowCommit',
  curriculumSetCap: 'curriculum:setCap',
  /** Fills in missing learning points for a goal's topics. */
  curriculumSubdivide: 'curriculum:subdivide',
  /** main -> renderer, one-way progress during a long Gemini call. */
  curriculumProgress: 'curriculum:progress',

  notesList: 'notes:list',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesDelete: 'notes:delete',

  /** Answers a question about one day, from that day's plan and nothing else. */
  agentAsk: 'agent:ask',

  /** One Monday-to-Sunday week of finished work. Derived, never stored. */
  trackerWeek: 'tracker:week',

  /** Where the database lives, and a way to point Finder at it. */
  systemDbInfo: 'system:dbInfo',
  systemRevealDb: 'system:revealDb',
  backupExport: 'backup:export',
  backupImport: 'backup:import',
  systemGetLaunchAtLogin: 'system:getLaunchAtLogin',
  systemSetLaunchAtLogin: 'system:setLaunchAtLogin',

  stickersList: 'stickers:list',
  stickersCreate: 'stickers:create',
  stickersUpdate: 'stickers:update',
  stickersDelete: 'stickers:delete',
  stickerFoldersList: 'stickerFolders:list',
  stickerFoldersCreate: 'stickerFolders:create',
  stickerFoldersUpdate: 'stickerFolders:update',
  stickerFoldersDelete: 'stickerFolders:delete',

  /** The second dimension on a slot. Categories are untouched by all of these. */
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsUpdate: 'tags:update',
  tagsDelete: 'tags:delete',
  tagsReorder: 'tags:reorder',
  /** Attaching by hand outranks the keyword rules; detaching is absolute. */
  tagsAttach: 'tags:attach',
  tagsDetach: 'tags:detach',

  boardsList: 'boards:list',
  boardsCreate: 'boards:create',
  boardsUpdate: 'boards:update',
  boardsDelete: 'boards:delete',
  framesList: 'frames:list',
  framesCreate: 'frames:create',
  framesUpdate: 'frames:update',
  framesDelete: 'frames:delete',
  listsList: 'lists:list',
  listsCreate: 'lists:create',
  listsUpdate: 'lists:update',
  listsDelete: 'lists:delete',
  itemsList: 'items:list',
  itemsCreate: 'items:create',
  itemsUpdate: 'items:update',
  itemsDelete: 'items:delete',
  refsList: 'refs:list',
  refsCreate: 'refs:create',
  refsDelete: 'refs:delete',
  /** References wired to the brief itself — film-wide, one set per board. */
  briefRefsList: 'briefRefs:list',
  briefRefsCreate: 'briefRefs:create',
  briefRefsDelete: 'briefRefs:delete',
  /** Opens a native picker for reference media. Returns the chosen paths. */
  mediaPick: 'media:pick',

  stylesList: 'styles:list',
  stylesCreate: 'styles:create',
  stylesUpdate: 'styles:update',
  stylesDelete: 'styles:delete',
  stylesDuplicate: 'styles:duplicate',
  /** Sorts a style's source text into its named fields. Writes nothing. */
  stylesParse: 'styles:parse',
  styleNodesList: 'styleNodes:list',
  styleNodesPlace: 'styleNodes:place',
  styleNodesMove: 'styleNodes:move',
  styleNodesRemove: 'styleNodes:remove',
  /** Asks Gemini for a scene breakdown. Writes nothing. */
  boardsPlanScenes: 'boards:planScenes',
  /** Writes the subset of a plan the user approved, in one transaction. */
  boardsApplyScenePlan: 'boards:applyScenePlan',
  /** Asks Gemini for a prompt per existing scene. Writes nothing. */
  boardsPlanPrompts: 'boards:planPrompts',
  /** Writes the approved prompts — the prompt column only. */
  boardsApplyPromptPlan: 'boards:applyPromptPlan',

  notifyGetPrefs: 'notify:getPrefs',
  notifySetPrefs: 'notify:setPrefs',
  /** What today's briefs would say right now, without sending anything. */
  notifyPreview: 'notify:preview',

  settingsKeyStatus: 'settings:keyStatus',
  settingsSetKey: 'settings:setKey',
  settingsClearKey: 'settings:clearKey',
  settingsTestKey: 'settings:testKey',
  /** Gemini calls per minute, per feature slot. */
  settingsGetRate: 'settings:getRate',
  settingsSetRate: 'settings:setRate',
  geminiModels: 'gemini:models',

  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsSetPinned: 'projects:setPinned',
  projectsReorder: 'projects:reorder',
  projectsRename: 'projects:rename',
  projectsAddCreative: 'projects:addCreative',
  projectsOpenExternal: 'projects:openExternal',
  /** Creates the folder under the kind's home and registers it, templated. */
  projectsCreate: 'projects:create',
  projectsHomes: 'projects:homes',
  projectsPickHome: 'projects:pickHome',
  foldersList: 'projectFolders:list',
  foldersCreate: 'projectFolders:create',
  foldersRename: 'projectFolders:rename',
  foldersRemove: 'projectFolders:remove',
  foldersFileAssets: 'projectFolders:fileAssets',
  foldersPickAssets: 'projectFolders:pickAssets',
  foldersReveal: 'projectFolders:reveal',
  foldersListAll: 'projectFolders:listAll',
  /** The desktop bin: fixed sources, read-only listing, gated filing. */
  binList: 'bin:list',
  binFile: 'bin:file',
  /** Pushed when a watched bin changes. Payload is the source id. */
  binChanged: 'bin:changed',
  projectsTouch: 'projects:touch',
  projectsOpenInEditor: 'projects:openInEditor',

  /** All three take a project id plus a path *relative to that project*. */
  filesTree: 'files:tree',
  filesRead: 'files:read',
  filesWrite: 'files:write',

  ptyCreate: 'pty:create',
  /**
   * Keystrokes and output are `send`, not `invoke`. There is nothing to return
   * and a round trip per keypress would put the renderer's paint behind the
   * main process's event loop.
   */
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyKillProject: 'pty:killProject',
  /** main -> renderer. */
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** The exact shape bridged onto `window.deck` by the preload script. */
export interface DeckApi {
  /**
   * Where a dropped file actually is on disk, or null.
   *
   * Not an IPC call — it is resolved in the preload, because Electron removed the
   * non-standard `File.path` and `webUtils` is the only replacement. Needed for
   * filing dropped assets into a project folder.
   */
  pathForFile(file: File): string | null
  system: {
    /** Runs rollover + weekly seeding, then reports what changed. */
    bootstrap(): Promise<BootstrapResult>
    /** Path, size and schema version of the live database. */
    dbInfo(): Promise<DbInfo>
    /** Opens Finder with the database file selected. */
    revealDb(): Promise<void>
    launchAtLogin(): Promise<boolean>
    setLaunchAtLogin(enabled: boolean): Promise<boolean>
  }
  backup: {
    /**
     * Opens a save dialog and writes a JSON dump. null means the user cancelled.
     */
    exportToFile(): Promise<BackupWritten | null>
    /**
     * Opens an open dialog and replaces everything with the file's contents.
     * null means cancelled; a newer-schema file is refused, not merged.
     */
    importFromFile(): Promise<ImportSummary | null>
  }
  days: {
    range(from: DateKey, to: DateKey): Promise<DayCard[]>
  }
  slots: {
    create(input: NewSlot): Promise<Slot>
    update(id: string, patch: SlotPatch): Promise<Slot>
    remove(id: string): Promise<void>
    setStatus(id: string, status: SlotStatus): Promise<Slot>
    reorder(date: DateKey, orderedIds: string[]): Promise<void>
  }
  weekly: {
    list(): Promise<WeeklyTemplate[]>
    upsert(input: NewWeeklyTemplate & { id?: string }): Promise<WeeklyTemplate>
    remove(id: string): Promise<void>
  }
  curriculum: {
    /** Several goals can be active at once; this is all of them. */
    overview(): Promise<GoalsOverview>
    generate(input: CurriculumInput): Promise<CurriculumPlan>
    archive(id: string): Promise<void>
    /** Reflow is per goal — repacking one must not disturb the others. */
    reflowPreview(id: string): Promise<ReflowPreview | null>
    reflowCommit(id: string): Promise<CurriculumPlan | null>
    setDailyCap(minutes: number): Promise<GoalsOverview>
    /**
     * Breaks each of the goal's topics into learning points. Only touches
     * topics that have none, so re-running it is cheap and never overwrites a
     * breakdown that is already there.
     */
    subdivide(id: string): Promise<SubdivideResult>
    /** Returns an unsubscribe function. */
    onProgress(handler: (update: CurriculumProgress) => void): () => void
  }
  /**
   * Reminders, not tasks. The deck reads them through `days.range`; these calls
   * are the admin side.
   */
  notes: {
    /** Every note for one goal, or all of them when the id is omitted. */
    list(curriculumId?: string | null): Promise<GoalNote[]>
    create(input: NewGoalNote): Promise<GoalNote>
    update(id: string, patch: GoalNotePatch): Promise<GoalNote>
    remove(id: string): Promise<void>
  }
  agent: {
    /**
     * `history` is the conversation so far for this one day. It is not stored —
     * the card owns it and it goes away when the card does.
     */
    ask(
      date: DateKey,
      question: string,
      history: AgentMessage[]
    ): Promise<AgentReply>
  }
  tracker: {
    /** `anchor` is any day in the wanted week; the boundary is main's problem. */
    week(anchor: DateKey): Promise<TrackerWeek>
  }
  stickers: {
    /** The whole wall. Expired temp notes are already gone by the time you see it. */
    list(): Promise<Sticker[]>
    create(input: NewSticker): Promise<Sticker>
    /**
     * Dragging writes through this on drop, not on every frame.
     *
     * `null` means the note is no longer in the database — swept or restored
     * away underneath the wall — and the caller should drop it rather than
     * treat it as a failed write.
     */
    update(id: string, patch: StickerPatch): Promise<Sticker | null>
    remove(id: string): Promise<void>
    /** Optional grouping. A note with no folder is the normal case. */
    folders(): Promise<StickerFolder[]>
    createFolder(input: NewStickerFolder): Promise<StickerFolder>
    updateFolder(id: string, patch: StickerFolderPatch): Promise<StickerFolder>
    /** Releases its notes back onto the loose wall rather than deleting them. */
    removeFolder(id: string): Promise<void>
  }
  /**
   * Tags, and the attachments between them and slots.
   *
   * `attach`/`detach` are the manual path only. Keyword matching happens inside
   * the slot writes themselves, so nothing in the renderer has to remember to
   * trigger it.
   */
  tags: {
    list(): Promise<Tag[]>
    create(input: NewTag): Promise<Tag>
    /**
     * Editing what a tag matches re-files every existing slot against the new
     * rules — auto attachments only, never one made by hand.
     */
    update(id: string, patch: TagPatch): Promise<Tag>
    remove(id: string): Promise<void>
    reorder(orderedIds: string[]): Promise<Tag[]>
    /** Returns the slot's whole tag set, which is what the row re-renders from. */
    attach(slotId: string, tagId: string, origin?: TagOrigin): Promise<Slot>
    detach(slotId: string, tagId: string): Promise<Slot>
  }
  /** The storyboard space: boards are the segments, frames live on a canvas. */
  storyboards: {
    list(): Promise<Storyboard[]>
    create(input: NewStoryboard): Promise<Storyboard>
    update(id: string, patch: StoryboardPatch): Promise<Storyboard>
    remove(id: string): Promise<void>
    /** Every frame on one board. Frames carry their own canvas coordinates. */
    frames(boardId: string): Promise<StoryFrame[]>
    createFrame(input: NewStoryFrame): Promise<StoryFrame>
    /** Dragging writes through this on drop, same as the stickers wall. */
    updateFrame(id: string, patch: StoryFramePatch): Promise<StoryFrame>
    removeFrame(id: string): Promise<void>

    /** Reference lists: container nodes whose rows are connection points. */
    lists(boardId: string): Promise<StoryList[]>
    createList(input: NewStoryList): Promise<StoryList>
    updateList(id: string, patch: StoryListPatch): Promise<StoryList>
    removeList(id: string): Promise<void>

    /**
     * Every reference item on a board, across all its lists. `missing` on each is
     * computed at read time from the filesystem, not stored.
     */
    items(boardId: string): Promise<StoryListItem[]>
    createItem(input: NewStoryListItem): Promise<StoryListItem>
    updateItem(id: string, patch: StoryListItemPatch): Promise<StoryListItem>
    removeItem(id: string): Promise<void>

    /** The wires from reference items to scene cards. Connecting is idempotent. */
    refs(boardId: string): Promise<StoryFrameRef[]>
    connect(frameId: string, itemId: string): Promise<StoryFrameRef>
    disconnect(frameId: string, itemId: string): Promise<void>

    /**
     * References wired to the brief itself. Film-wide: a brief ref informs
     * every scene's prompt where a frame ref informs only its own.
     */
    briefRefs(boardId: string): Promise<StoryBriefRef[]>
    connectBrief(boardId: string, itemId: string): Promise<StoryBriefRef>
    disconnectBrief(boardId: string, itemId: string): Promise<void>

    /**
     * Native file picker for reference media. Returns absolute paths and their
     * kind; nothing is copied, so these are the paths that get stored.
     */
    pickMedia(): Promise<{ path: string; kind: MediaKind }[]>

    /**
     * Ask for a scene breakdown of the board's brief.
     *
     * Writes nothing — the proposal comes back for approval, and `applyScenePlan`
     * is the only thing that touches a row. That split is what makes "nothing
     * changes until you approve it" true of the API and not just of the UI.
     */
    planScenes(boardId: string): Promise<ScenePlanProposal>
    /** Returns the board's frames as they now stand. */
    applyScenePlan(boardId: string, applies: SceneApply[]): Promise<StoryFrame[]>

    /**
     * Stage two: ask for a prompt per existing scene, consistent with the
     * placed style, the brief and both tiers of references. Writes nothing;
     * `applyPromptPlan` writes exactly the approved subset, prompt column only.
     */
    planPrompts(boardId: string): Promise<PromptPlanProposal>
    applyPromptPlan(
      boardId: string,
      applies: PromptApply[]
    ): Promise<StoryFrame[]>
  }

  /**
   * The style library, and where styles have been placed.
   *
   * Its own namespace because the library is board-independent: a look outlives
   * whichever board it was worked out on.
   */
  styles: {
    list(): Promise<VideoStyle[]>
    create(input: NewVideoStyle): Promise<VideoStyle>
    update(id: string, patch: VideoStylePatch): Promise<VideoStyle>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<VideoStyle>

    /**
     * Sort the style's own source text into the named fields. Only words from
     * the text may come back, unmentioned fields come back absent, and nothing
     * is written — the result is a proposed patch for the panel to show.
     */
    parse(id: string): Promise<VideoStylePatch>

    /** Placements on one board. */
    placed(boardId: string): Promise<StoryStyleNode[]>
    /** Idempotent per board — dropping the same style again moves it. */
    place(input: NewStoryStyleNode): Promise<StoryStyleNode>
    move(id: string, x: number, y: number): Promise<StoryStyleNode>
    /** Takes it off this board. The library keeps it. */
    unplace(id: string): Promise<void>
  }
  notify: {
    prefs(): Promise<NotifyPrefs>
    setPrefs(prefs: NotifyPrefs): Promise<NotifyPrefs>
    preview(): Promise<{
      morning: BriefPreview | null
      evening: BriefPreview | null
    }>
  }
  settings: {
    /** Omitting the slot means the default one, everywhere below. */
    keyStatus(slot?: KeySlot): Promise<KeyStatus>
    /**
     * One-way on purpose. There is no matching getter — the renderer can learn
     * that a key exists, never what it is.
     */
    setKey(key: string, slot?: KeySlot): Promise<KeyStatus>
    clearKey(slot?: KeySlot): Promise<KeyStatus>
    /** Validates `key` if given, otherwise the slot's saved (or default) one. */
    testKey(key?: string, slot?: KeySlot): Promise<{ models: number }>
    models(): Promise<GeminiModel[]>
    /** Gemini calls allowed per minute, per feature slot. */
    rate(): Promise<number>
    setRate(perMinute: number): Promise<number>
  }
  projects: {
    list(): Promise<Project[]>
    /** Opens the folder picker. null means the user cancelled. */
    add(): Promise<ProjectAdded | null>
    /** The mutators return the whole list, because order is a global property. */
    remove(id: string): Promise<Project[]>
    setPinned(id: string, pinned: boolean): Promise<Project[]>
    reorder(orderedIds: string[]): Promise<Project[]>
    rename(id: string, name: string): Promise<Project>
    touch(id: string): Promise<Project>
    /** Reports which route worked, since it is never `code` on PATH here. */
    openInEditor(id: string): Promise<EditorLaunch>

    /** Opens the file picker for a creative project. null means cancelled. */
    addCreative(): Promise<ProjectAdded | null>
    /** Hands the entry file to whichever application owns its type. */
    openExternal(id: string): Promise<void>

    /**
     * Create a project from nothing: a named folder under the kind's home,
     * started with the template subfolders. `add` adopts a folder that already
     * exists; this is the one that makes it.
     */
    create(kind: ProjectKind, name: string): Promise<ProjectAdded>
    /** Where new projects of each kind go. Null until chosen. */
    homes(): Promise<ProjectHomes>
    /** Folder picker for one kind's home. null means cancelled. */
    pickHome(kind: ProjectKind): Promise<ProjectHomes | null>

    /** Folders in the panel, each backed by a real directory. */
    folders(projectId: string): Promise<ProjectFolder[]>
    createFolder(
      projectId: string,
      parentId: string | null,
      name: string
    ): Promise<ProjectFolder>
    renameFolder(id: string, name: string): Promise<ProjectFolder>
    /** Forgets the folder. The directory and its contents stay on disk. */
    removeFolder(id: string): Promise<void>
    /**
     * Copies files into a folder's directory. Never moves, never overwrites — a
     * name that already exists comes back in `skipped`.
     */
    fileAssets(folderId: string, paths: string[]): Promise<AssetsFiled>
    /** Opens a picker, then files whatever was chosen. null means cancelled. */
    pickAssets(folderId: string): Promise<AssetsFiled | null>
    /** Reveals a folder's directory in Finder. */
    revealFolder(id: string): Promise<void>
    /** Every reachable project's folders at once — the bin's target list. */
    allFolders(): Promise<ProjectFolder[]>
  }
  /**
   * The desktop bin: Desktop and Downloads, read-only until you approve a
   * move. Sources are fixed; filing goes through the same trash-safe mover the
   * folder panel uses, gated so it can only take things *from* the two bins.
   */
  bin: {
    list(source: BinSourceId): Promise<BinListing>
    /**
     * Files listed entries into a project folder. Entries are named, never
     * pathed — main resolves the names inside the source root, so this call
     * cannot be pointed anywhere but a bin.
     */
    file(
      folderId: string,
      source: BinSourceId,
      names: string[],
      mode: FileMode
    ): Promise<AssetsMoved>
    /** Something changed in a bin; list again. Returns an unsubscribe. */
    onChanged(handler: (source: BinSourceId) => void): () => void
  }
  /**
   * The renderer has no `fs`. It names a project and a path inside it, and main
   * refuses anything that resolves outside that project's folder.
   */
  files: {
    /** One level. Directories are expanded on demand, never walked up front. */
    tree(projectId: string, dir: string): Promise<FileNode[]>
    read(projectId: string, path: string): Promise<FileReadResult>
    write(
      projectId: string,
      path: string,
      text: string,
      /** Guards against overwriting a change made outside the app. */
      expectedMtimeMs?: number
    ): Promise<FileSaved>
  }
  terminal: {
    create(projectId: string, cols: number, rows: number): Promise<PtySession>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    /** Closing a workspace takes every shell in it with it. */
    killProject(projectId: string): void
    /** Both return an unsubscribe function. */
    onData(handler: (chunk: PtyChunk) => void): () => void
    onExit(handler: (exit: PtyExit) => void): () => void
  }
}
