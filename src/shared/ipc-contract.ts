import type { DateKey } from './date'
import type {
  AgentMessage,
  AgentReply,
  BackupWritten,
  BootstrapResult,
  BriefPreview,
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
  KeyStatus,
  NewGoalNote,
  NewSlot,
  NewSticker,
  NewWeeklyTemplate,
  NotifyPrefs,
  Project,
  ProjectAdded,
  PtyChunk,
  PtyExit,
  PtySession,
  ReflowPreview,
  Slot,
  SlotPatch,
  SlotStatus,
  Sticker,
  StickerPatch,
  SubdivideResult,
  TrackerWeek,
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

  notifyGetPrefs: 'notify:getPrefs',
  notifySetPrefs: 'notify:setPrefs',
  /** What today's briefs would say right now, without sending anything. */
  notifyPreview: 'notify:preview',

  settingsKeyStatus: 'settings:keyStatus',
  settingsSetKey: 'settings:setKey',
  settingsClearKey: 'settings:clearKey',
  settingsTestKey: 'settings:testKey',
  geminiModels: 'gemini:models',

  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsSetPinned: 'projects:setPinned',
  projectsReorder: 'projects:reorder',
  projectsRename: 'projects:rename',
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
    /** Dragging writes through this on drop, not on every frame. */
    update(id: string, patch: StickerPatch): Promise<Sticker>
    remove(id: string): Promise<void>
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
    keyStatus(): Promise<KeyStatus>
    /**
     * One-way on purpose. There is no matching getter — the renderer can learn
     * that a key exists, never what it is.
     */
    setKey(key: string): Promise<KeyStatus>
    clearKey(): Promise<KeyStatus>
    /** Validates `key` if given, otherwise the saved one. */
    testKey(key?: string): Promise<{ models: number }>
    models(): Promise<GeminiModel[]>
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
