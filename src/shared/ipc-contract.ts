import type { DateKey } from './date'
import type { ProcessId, ProcessLimits, ResolvedProcess } from './processes'
import type {
  AgentMessage,
  AgentReply,
  AiModel,
  AiProvider,
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
  NewStoryCastNode,
  NewStorySheet,
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
  PackProgress,
  PackStatus,
  PromptApply,
  PromptPlanProposal,
  PtyChunk,
  PtyExit,
  PtySession,
  ReflowPreview,
  SceneApply,
  ScenePlanProposal,
  SheetShot,
  Slot,
  SlotConfig,
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
  StorySheet,
  StorySheetPatch,
  CutProposal,
  StoryCut,
  StoryCutSegment,
  CutSegmentInput,
  StoryCastNode,
  StoryStyleNode,
  StoryTake,
  SubdivideResult,
  TakeGenerateOptions,
  Tag,
  TagOrigin,
  TagPatch,
  SceneLayout,
  ThemeName,
  TrackerWeek,
  UiPrefs,
  VideoJobProgress,
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
  /** main -> renderer, one-way progress during a long model call. */
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
  /** The cast: named characters restated verbatim in every prompt showing them. */
  sheetsList: 'sheets:list',
  sheetsCreate: 'sheets:create',
  sheetsUpdate: 'sheets:update',
  sheetsDelete: 'sheets:delete',
  /** Metered: one image. Writes a candidate and does not touch the sheet. */
  sheetsProposePortrait: 'sheets:proposePortrait',
  /** The only call that makes a character real. One transaction. */
  sheetsApprovePortrait: 'sheets:approvePortrait',
  sheetsShots: 'sheets:shots',
  sheetsDiscardShot: 'sheets:discardShot',
  /** Back to described. Keeps every image, clears the pointer. */
  sheetsUnlock: 'sheets:unlock',
  /** Starts the background reference pack. Returns as soon as it is running. */
  sheetsBuildPack: 'sheets:buildPack',
  sheetsPackProgress: 'sheets:packProgress',
  /** Placements: this character, on this board's canvas. Mirrors styleNodes. */
  sheetsPlaced: 'sheets:placed',
  sheetsPlace: 'sheets:place',
  sheetsMoveNode: 'sheets:moveNode',
  sheetsUnplace: 'sheets:unplace',
  /**
   * Reference-pack progress, pushed rather than invoked.
   *
   * Its own channel rather than a widening of `boardsJobProgress`. That one is
   * single because there is one long-running-work indicator in the UI — and an
   * invisible background pack is deliberately not it. Sharing the channel would
   * light the generation UI up every few seconds for work nobody is waiting on.
   */
  castPackProgress: 'cast:packProgress',
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
  /** Asks the scenes slot's provider for a scene breakdown. Writes nothing. */
  boardsPlanScenes: 'boards:planScenes',
  /** Writes the subset of a plan the user approved, in one transaction. */
  boardsApplyScenePlan: 'boards:applyScenePlan',
  /** Asks the prompts slot's provider for a prompt per scene. Writes nothing. */
  boardsPlanPrompts: 'boards:planPrompts',
  /** Writes the approved prompts — the prompt column only. */
  boardsApplyPromptPlan: 'boards:applyPromptPlan',
  /** Rewrites one scene's prompt to a note. Writes nothing; applies through
      `boardsApplyPromptPlan`, so a revision has no write path of its own. */
  boardsProposeRevision: 'boards:proposeRevision',
  /**
   * Generation progress, pushed rather than invoked.
   *
   * The first push channel Storyboards has. Necessary because a Veo job is
   * minutes of waiting with nothing to show, and a spinner that cannot say
   * "still queued" versus "downloading take 2 of 3" is a spinner people quit
   * the app during.
   */
  boardsJobProgress: 'boards:jobProgress',

  takesList: 'takes:list',
  /** Metered: submits, waits, downloads. One in flight across the whole app. */
  takesGenerate: 'takes:generate',
  /** What a run would cost, so the confirmation can say it in numbers. */
  takesPlan: 'takes:plan',
  takesChoose: 'takes:choose',
  takesDelete: 'takes:delete',
  /** The gate on what flows into the cut. */
  framesSetFinal: 'frames:setFinal',

  cutGet: 'cut:get',
  cutMove: 'cut:move',
  /** Replaces the whole segment list — reorder, trim and remove are all this. */
  cutSetSegments: 'cut:setSegments',
  /** One segment per final scene's chosen take, full length. */
  cutPopulate: 'cut:populate',
  /** Real clip lengths, read off the files rather than the rows. */
  cutMeasure: 'cut:measure',
  /** Opens the save dialog and renders. Progress on `boardsJobProgress`. */
  cutExport: 'cut:export',
  /** Uploads the named clips, asks for cut points, writes nothing. */
  cutPropose: 'cut:propose',

  notifyGetPrefs: 'notify:getPrefs',
  notifySetPrefs: 'notify:setPrefs',
  /** What today's briefs would say right now, without sending anything. */
  notifyPreview: 'notify:preview',

  settingsKeyStatus: 'settings:keyStatus',
  settingsSetKey: 'settings:setKey',
  settingsClearKey: 'settings:clearKey',
  settingsTestKey: 'settings:testKey',
  /**
   * Which provider each slot talks to, where to reach it, and what to ask for.
   *
   * Separate from the key channels above because these are ordinary settings —
   * readable, backed up, and safe to send back to the renderer, none of which
   * is true of the key itself.
   */
  settingsSlotConfigs: 'settings:slotConfigs',
  settingsSetProvider: 'settings:setProvider',
  settingsSetBaseUrl: 'settings:setBaseUrl',
  settingsSetModel: 'settings:setModel',
  /** AI calls per minute, per feature slot. */
  settingsGetRate: 'settings:getRate',
  settingsSetRate: 'settings:setRate',
  /** Every AI process, resolved: defaults with the user's edits merged in. */
  settingsProcesses: 'settings:processes',
  settingsSetProcess: 'settings:setProcess',
  settingsResetProcess: 'settings:resetProcess',
  /**
   * Appearance and view preferences.
   *
   * One pair for every boolean-or-enum the UI wants to remember across launches.
   * They live in SQLite with everything else rather than in localStorage so a
   * backup carries them and the main process can read the theme before the
   * window is built.
   */
  settingsGetPrefs: 'settings:getPrefs',
  settingsSetTheme: 'settings:setTheme',
  settingsSetSceneNumbers: 'settings:setSceneNumbers',
  settingsSetSceneLayout: 'settings:setSceneLayout',
  /** One slot's provider, asked live. Never a hardcoded list. */
  aiModels: 'ai:models',

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
     * The cast. Board-scoped, because a look is reusable across films and a
     * cast is not.
     */
    sheets(boardId: string): Promise<StorySheet[]>
    createSheet(input: NewStorySheet): Promise<StorySheet>
    updateSheet(id: string, patch: StorySheetPatch): Promise<StorySheet>
    deleteSheet(id: string): Promise<void>

    /**
     * Locking a character to a face.
     *
     * `proposePortrait` costs one metered image and writes a candidate; it does
     * not touch the sheet, because what the user approves is *which image is
     * them*. `approvePortrait` is the write that makes them real, and
     * `buildPack` is the background work that follows it — started separately
     * so that a pack which fails cannot unapprove anybody.
     */
    proposePortrait(sheetId: string, extra?: string): Promise<SheetShot>
    approvePortrait(sheetId: string, shotId: string): Promise<StorySheet>
    /** Fire-and-forget: progress arrives on `onPackProgress`. */
    buildPack(sheetId: string): Promise<void>
    packProgress(sheetId: string): Promise<PackStatus>
    shots(sheetId: string): Promise<SheetShot[]>
    /** Refused for the approved portrait — unlock the character first. */
    discardShot(shotId: string): Promise<void>
    unlockSheet(sheetId: string): Promise<StorySheet>

    /**
     * Placing a character on the board is what attaches their *image* to every
     * generation on it. Their words are sent either way — placement adds the
     * lock, it does not gate the description.
     */
    placedCast(boardId: string): Promise<StoryCastNode[]>
    placeCast(input: NewStoryCastNode): Promise<StoryCastNode>
    moveCastNode(id: string, x: number, y: number): Promise<StoryCastNode>
    unplaceCast(id: string): Promise<void>

    /** Returns an unsubscribe function. */
    onPackProgress(handler: (update: PackProgress) => void): () => void

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

    /**
     * Rewrite one scene's prompt to a note, in the user's own words.
     *
     * Comes back as a one-row `PromptPlanProposal` on purpose: applying it goes
     * through `applyPromptPlan` like any other prompt change, so a revision
     * introduces no second write path and the diff window renders it unchanged.
     */
    proposeRevision(
      frameId: string,
      note: string
    ): Promise<PromptPlanProposal>

    /** Whether this shot is settled, and so flows into the cut. */
    setFinal(frameId: string, isFinal: boolean): Promise<StoryFrame>
  }

  /**
   * Generated clips.
   *
   * The only surface in the app that can spend money on a click, which is why
   * `plan` exists beside `generate`: the confirmation states the clip count and
   * total seconds before anything is submitted.
   */
  takes: {
    list(frameId: string): Promise<StoryTake[]>
    /** What generating for these scenes would cost. Submits nothing. */
    plan(
      frameIds: string[],
      takes: number
    ): Promise<{
      scenes: number
      clips: number
      seconds: number
      /**
       * What the run cannot honour, if anything — more characters locked to
       * the board than the provider takes references for, or a portrait gone
       * missing. Null when everything the board is locked to will be sent.
       */
      castNotice: string | null
    }>
    /** Submits, waits and downloads. Progress arrives on `onProgress`. */
    generate(
      frameId: string,
      options: Partial<TakeGenerateOptions>
    ): Promise<StoryTake[]>
    /** Which take this scene contributes to the cut. */
    choose(takeId: string): Promise<StoryTake | null>
    /** Deletes the row and unlinks its file. */
    remove(takeId: string): Promise<void>
    /** Returns an unsubscribe function, like the curriculum's. */
    onProgress(handler: (update: VideoJobProgress) => void): () => void
  }

  /**
   * The cut: one timeline per board, made of trimmed segments.
   *
   * A segment is `(take, start, end)`, so one scene can contribute more than
   * once — which is why `setSegments` replaces the list rather than patching
   * it. Reordering, trimming and removing are all edits to the list.
   */
  cut: {
    get(boardId: string): Promise<{
      cut: StoryCut | null
      segments: StoryCutSegment[]
    }>
    move(boardId: string, x: number, y: number): Promise<void>
    setSegments(
      boardId: string,
      segments: CutSegmentInput[]
    ): Promise<StoryCutSegment[]>
    populate(boardId: string): Promise<StoryCutSegment[]>
    /** Take id to real length in seconds. Missing means "keep the stored one". */
    measure(boardId: string): Promise<Record<string, number>>
    /** Opens the save dialog. null means the user cancelled. */
    export(boardId: string): Promise<string | null>

    /**
     * Let the model watch the named clips and propose where to cut them.
     *
     * Writes nothing. The proposal comes back with a reason per segment, and
     * `setSegments` is what writes it if the user approves — so an AI cut is
     * not a second way to modify the timeline, it is the same way reached by a
     * different route.
     */
    propose(boardId: string, takeIds: string[]): Promise<CutProposal>
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

    /**
     * Which provider every slot resolves to, in one round trip.
     *
     * All of them at once because they are read together and one depends on
     * another: a slot showing an inherited provider is showing the default
     * slot's, so fetching them separately would let the panel render a set that
     * never existed at any single moment.
     */
    slotConfigs(): Promise<SlotConfig[]>
    /**
     * Clears the slot's saved model — a model id does not survive the switch.
     * `''` clears the slot's own choice so it follows the default slot again.
     */
    setProvider(slot: KeySlot, provider: AiProvider | ''): Promise<SlotConfig>
    /** Only meaningful for `custom`. Must be an http(s) origin. */
    setBaseUrl(slot: KeySlot, url: string): Promise<SlotConfig>
    /** '' hands the slot back to its provider's default. */
    setModel(slot: KeySlot, model: string): Promise<SlotConfig>

    /**
     * The models one slot's provider actually offers, asked live.
     *
     * `key` lets Settings list against a key that has not been saved yet, which
     * is the only way to find out whether one works before committing it to the
     * keychain.
     */
    models(slot?: KeySlot, key?: string): Promise<AiModel[]>

    /** AI calls allowed per minute, per feature slot. */
    rate(): Promise<number>
    setRate(perMinute: number): Promise<number>

    /**
     * The editable half of every AI prompt in the app.
     *
     * Resolved rather than raw: what comes back is the defaults with the user's
     * overrides merged in and *validated* — blank roles fall back, pinned rules
     * survive, and every limit is clamped. Showing the number the user typed
     * while the app used a different one would be the worst of both, so this is
     * what the panel renders.
     */
    processes(): Promise<ResolvedProcess[]>
    setProcess(
      id: ProcessId,
      override: {
        role?: string
        rules?: string[]
        limits?: Partial<ProcessLimits>
      }
    ): Promise<ResolvedProcess>
    resetProcess(id: ProcessId): Promise<ResolvedProcess>

    /** Everything the UI remembers between launches, in one round trip. */
    prefs(): Promise<UiPrefs>
    setTheme(theme: ThemeName): Promise<ThemeName>
    setSceneNumbers(on: boolean): Promise<boolean>
    setSceneLayout(layout: SceneLayout): Promise<SceneLayout>
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
