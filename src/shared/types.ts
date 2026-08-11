import type { DateKey } from './date'

/* ------------------------------------------------------------------ slots */

/** Where a slot came from. Drives its icon, colour, and whether it can roll. */
export type SlotSource = 'manual' | 'curriculum' | 'amber_weekly' | 'project'

/** The three Tracker buckets. Every slot is attributable to exactly one. */
export type SlotCategory = 'vibe_code' | 'amber' | 'personal_learning'

/**
 * `rolled` is a tombstone, not a failure state: the slot stays on its original
 * day so the Tracker can show the miss, while a fresh slot carries the work
 * forward. See main/services/rollover.ts.
 */
export type SlotStatus = 'open' | 'done' | 'rolled' | 'skipped'

export interface Slot {
  id: string
  date: DateKey
  /** Minutes from local midnight. null = unscheduled, floats to the top. */
  startMin: number | null
  durationMin: number
  title: string
  note: string | null
  source: SlotSource
  /** topic id, project id, or weekly template id depending on `source`. */
  sourceRef: string | null
  category: SlotCategory
  status: SlotStatus
  rolledFrom: string | null
  rollCount: number
  sortIndex: number
  completedAt: string | null
  createdAt: string
  /**
   * Human name of whatever produced this slot — the goal title for curriculum
   * work, null for everything else. Denormalised onto the row at read time
   * because a day card with three active goals on it is unreadable when every
   * row just says "curriculum".
   */
  sourceLabel: string | null
  /** Goal colour key, for the same reason. See GOAL_COLORS. */
  sourceColor: GoalColor | null
  /**
   * The owning topic's AI-generated learning points, denormalised for the same
   * reason as `sourceLabel` — the day card has to show what a task actually
   * involves without a second round trip per row.
   *
   * Empty for every non-curriculum slot, and for curriculum work whose goal has
   * not been broken down yet.
   */
  sourcePoints: string[]
}

export interface NewSlot {
  date: DateKey
  title: string
  startMin?: number | null
  durationMin?: number
  note?: string | null
  source?: SlotSource
  sourceRef?: string | null
  category?: SlotCategory
}

export type SlotPatch = Partial<
  Pick<
    Slot,
    | 'title'
    | 'note'
    | 'startMin'
    | 'durationMin'
    | 'category'
    | 'status'
    | 'date'
    | 'sortIndex'
  >
>

export interface DayCard {
  date: DateKey
  slots: Slot[]
  /**
   * Reminders surfacing on this day. Separate from `slots` on purpose: they are
   * context, not work, and nothing that counts completion may see them.
   */
  notes: GoalNote[]
}

/* --------------------------------------------------------------- weekly */

export interface WeeklyTemplate {
  id: string
  title: string
  /** 0 = Sunday … 6 = Saturday. Amber tasks default to 1 (Monday). */
  weekday: number
  startMin: number | null
  durationMin: number
  category: SlotCategory
  active: boolean
  sortIndex: number
}

export type NewWeeklyTemplate = Omit<WeeklyTemplate, 'id'>

/* ------------------------------------------------------------- bootstrap */

export interface RolloverRecord {
  slotId: string
  newSlotId: string
  fromDate: DateKey
  title: string
  rollCount: number
}

/**
 * What the main process did to the data before the first render. The renderer
 * uses this to animate the consequences rather than silently showing a
 * different day than the user left.
 */
export interface BootstrapResult {
  today: DateKey
  rolled: RolloverRecord[]
  seededWeek: DateKey | null
  seededSlotIds: string[]
  /**
   * Temp stickers the launch sweep cleared. Already deleted by the time this
   * arrives — the list exists so the wall can animate them off rather than
   * having them silently absent.
   */
  expiredStickers: Sticker[]
}

/* ------------------------------------------------------------- projects */

export interface Project {
  id: string
  name: string
  path: string
  /** Reuses the goal palette — see GOAL_COLORS. */
  color: GoalColor
  /**
   * Branch name, or a short SHA when HEAD is detached. Cached in the row but
   * re-read from `.git/HEAD` on every list, so it is current whenever the
   * folder is reachable and merely stale when it is not.
   */
  branch: string | null
  lastOpenedAt: string | null
  pinned: boolean
  sortIndex: number
  createdAt: string
  /**
   * The folder is not there any more — moved, deleted, or on an unmounted
   * volume. Computed at read time rather than stored, because it is a fact
   * about right now.
   */
  missing: boolean
}

/** Adding a folder that is already in the grid is a no-op worth reporting. */
export interface ProjectAdded {
  project: Project
  duplicate: boolean
}

/* ------------------------------------------------- workspace file access */

/** One entry in a directory listing. Children are fetched on expand. */
export interface FileNode {
  /** Path relative to the project root, POSIX-separated. '' is the root. */
  path: string
  name: string
  directory: boolean
  /** Bytes. Always 0 for directories. */
  size: number
}

export interface FileContents {
  path: string
  text: string
  /** Monaco language id, guessed from the extension. */
  language: string
  /** Mtime at read time — the write path uses it to detect a clobber. */
  mtimeMs: number
}

export interface FileSaved {
  path: string
  mtimeMs: number
}

/**
 * Why a file could not be opened in the editor. The renderer shows the reason
 * rather than a blank editor, and "Open in VS Code" is always the way out.
 */
export type FileRejection = 'binary' | 'too-large'

export interface FileOpenError {
  path: string
  reason: FileRejection
  size: number
}

/**
 * A refused file is a normal outcome, not an exception — an image in the tree
 * is a thing you click by accident. Returning it as data lets the editor pane
 * explain itself instead of surfacing a thrown IPC error.
 */
export type FileReadResult =
  | { ok: true; file: FileContents }
  | { ok: false; error: FileOpenError }

/* ---------------------------------------------------------------- terminal */

export interface PtySession {
  id: string
  projectId: string
  /** The shell that was actually launched, for the tab's tooltip. */
  shell: string
}

export interface PtyChunk {
  id: string
  data: string
}

export interface PtyExit {
  id: string
  exitCode: number
  signal: number | null
}

/** What happened when the user asked for VS Code — reported, never guessed. */
export interface EditorLaunch {
  /** 'cli' = the bundled `code` binary, 'open' = `open -a`. */
  via: 'cli' | 'open'
  path: string
}

/**
 * Goals are visually distinguished by colour, not by shade of amber — amber
 * stays reserved for "now". Five is deliberate: past that many parallel goals
 * the daily budget is the problem, not the palette.
 */
export const GOAL_COLORS = [
  'amber',
  'violet',
  'sky',
  'mint',
  'rose'
] as const

export type GoalColor = (typeof GOAL_COLORS)[number]

export interface Curriculum {
  id: string
  title: string
  startDate: DateKey
  deadline: DateKey
  rawText: string
  model: string
  /** This goal's *slice* of the day, not the whole day. See GoalsOverview. */
  minutesPerDay: number
  /** Weekday numbers (0–6) with no study load. */
  restDays: number[]
  status: 'active' | 'archived'
  color: GoalColor
  sortIndex: number
  createdAt: string
}

export interface Topic {
  id: string
  curriculumId: string
  seq: number
  module: string | null
  title: string
  detail: string | null
  estMinutes: number
  assignedDate: DateKey | null
  status: 'pending' | 'done' | 'skipped'
  /**
   * What this topic actually breaks down into — the concrete things to learn or
   * do, generated by a second Gemini pass. Empty means "not broken down yet",
   * which is the state every topic starts in and every pre-existing goal is in.
   *
   * Display-only. Completion is a single yes/no on the parent task, so these
   * never touch the progress ring.
   */
  points: string[]
}

/**
 * A note on the wall.
 *
 * `temp` means it goes away on its own — either on `expiresAt`, or the day
 * after the `attachedDate` it was pinned to. `permanent` stays until deleted,
 * no matter how old. `x`/`y` are wall coordinates in px from the top-left of
 * the board, and rotation is the slight tilt each note is given so the wall
 * does not look like a spreadsheet.
 */
export interface Sticker {
  id: string
  body: string
  color: StickerColor
  kind: 'temp' | 'permanent'
  expiresAt: DateKey | null
  attachedDate: DateKey | null
  x: number
  y: number
  rotation: number
  createdAt: string
}

/** Paper colours. Deliberately not the goal palette — a note is not a goal. */
export const STICKER_COLORS = [
  'butter',
  'mint',
  'sky',
  'blush',
  'lilac'
] as const

export type StickerColor = (typeof STICKER_COLORS)[number]

export type NewSticker = Omit<Sticker, 'id' | 'createdAt'>

export type StickerPatch = Partial<
  Pick<
    Sticker,
    | 'body'
    | 'color'
    | 'kind'
    | 'expiresAt'
    | 'attachedDate'
    | 'x'
    | 'y'
    | 'rotation'
  >
>

/** What the launch sweep cleared, so the wall can animate them away. */
export interface StickerSweep {
  expired: Sticker[]
}

/* ------------------------------------------------------- curriculum flow */

/** What Gemini returns. Deliberately date-free — scheduling is ours. */
export interface TopicDraft {
  seq: number
  module: string | null
  title: string
  detail: string | null
  estMinutes: number
}

export interface GeminiModel {
  id: string
  displayName: string
  inputTokenLimit: number | null
}

export interface CurriculumInput {
  title: string
  rawText: string
  deadline: DateKey
  minutesPerDay: number
  restDays: number[]
  model: string
  /** Omitted means "pick the next colour no active goal is using". */
  color?: GoalColor
}

/**
 * The honest arithmetic of a plan. `lastDate` and `bufferDays` are reported
 * rather than assumed so the UI can state what actually happens instead of
 * promising the deadline is met.
 */
export interface ScheduleSummary {
  totalTopics: number
  totalMinutes: number
  eligibleDays: number
  daysUsed: number
  perDayMinutes: number
  firstDate: DateKey | null
  lastDate: DateKey | null
  deadline: DateKey
  /** Eligible days left over after the last topic. Negative is impossible. */
  bufferDays: number
  /** The work cannot fit inside the stated minutes-per-day. */
  overCapacity: boolean
  requiredPerDay: number
}

export interface CurriculumPlan {
  curriculum: Curriculum
  topics: Topic[]
  summary: ScheduleSummary
}

/**
 * Every active goal plus the arithmetic that only makes sense across all of
 * them at once.
 *
 * Each goal packs its own topics against its own `minutesPerDay`, so nothing in
 * the scheduler knows the others exist. That is what makes each deadline exact
 * — and also what makes it possible to quietly promise more hours a day than
 * exist. `committedMinutes` against `dailyCapMinutes` is the honesty check, and
 * it is reported rather than enforced: the app states the overrun, the user
 * decides what to do about it.
 */
export interface GoalsOverview {
  plans: CurriculumPlan[]
  /** Total minutes a day you have said you're willing to study. */
  dailyCapMinutes: number
  /** Sum of every active goal's slice. */
  committedMinutes: number
  overCap: boolean
  /** Minutes a day the goals actually need to hit their deadlines. */
  requiredMinutes: number
}

export interface ReflowChange {
  topicId: string
  title: string
  from: DateKey | null
  to: DateKey
}

export interface ReflowPreview {
  changes: ReflowChange[]
  unchanged: number
  summary: ScheduleSummary
}

export type CurriculumProgress =
  | { phase: 'contacting'; model: string }
  | { phase: 'decomposing' }
  | { phase: 'scheduling'; topics: number }
  | { phase: 'materialising'; topics: number }
  | { phase: 'subdividing'; done: number; total: number }
  | { phase: 'done'; topics: number }
  | { phase: 'error'; message: string }

/**
 * How many topics go into one breakdown call.
 *
 * Small enough that a batch cannot run into the output limit and lose the whole
 * pass, large enough that a 60-topic goal is four calls rather than sixty. It
 * lives here because Goals Admin quotes the resulting call count before
 * spending them, and that estimate drifting from reality is worse than no
 * estimate.
 */
export const SUBDIVIDE_BATCH = 15

/**
 * How a subtopic pass went. Reported rather than thrown: the breakdown is
 * additive, so a plan whose points failed to generate is a complete plan
 * missing a nicety, not a failed plan.
 */
export interface SubdivideResult {
  plan: CurriculumPlan | null
  topicsSubdivided: number
  /** Present when some or all batches failed. The plan itself is still valid. */
  error: string | null
}

export interface KeyStatus {
  present: boolean
  /** False when the OS keychain is unavailable and we refuse to store a key. */
  encryptionAvailable: boolean
}

/* ------------------------------------------------------------ reminders */

/**
 * Two native notifications a day, both off by default — an app that starts
 * pinging you before you asked it to is one you turn off.
 *
 * Times are minutes from local midnight, matching `Slot.startMin`.
 */
export interface NotifyPrefs {
  morningEnabled: boolean
  morningMin: number
  eveningEnabled: boolean
  eveningMin: number
}

export interface BriefPreview {
  title: string
  body: string
}

/* ----------------------------------------------------------- goal notes */

/**
 * A dated reminder attached to a goal — "I learned this on Saturday, review it
 * on Wednesday".
 *
 * It is not a task and never becomes one. `surfaceDate` is the day it appears
 * on the deck; dismissing it is the only completion it has, and that is
 * recorded here rather than as a slot status so nothing that counts finished
 * work ever sees it.
 */
export interface GoalNote {
  id: string
  /** Null for a note that belongs to the day rather than to a goal. */
  curriculumId: string | null
  body: string
  surfaceDate: DateKey
  /** Optional provenance — the day the thing being reviewed was first learned. */
  learnedDate: DateKey | null
  status: 'active' | 'dismissed'
  createdAt: string
  /** Denormalised from the goal, same reason as `Slot.sourceLabel`. */
  goalTitle: string | null
  goalColor: GoalColor | null
}

export interface NewGoalNote {
  curriculumId: string | null
  body: string
  surfaceDate: DateKey
  learnedDate?: DateKey | null
}

export type GoalNotePatch = Partial<
  Pick<GoalNote, 'body' | 'surfaceDate' | 'learnedDate' | 'status' | 'curriculumId'>
>

/* ---------------------------------------------------------------- agent */

/**
 * One turn of a day-card conversation. `model` rather than `assistant` to match
 * the role name the Gemini REST API expects, so nothing has to translate.
 */
export interface AgentMessage {
  role: 'user' | 'model'
  text: string
}

export interface AgentReply {
  text: string
  /**
   * False when the day had no goal-backed work to answer from. The card says so
   * instead of letting the model improvise a study plan of its own.
   */
  grounded: boolean
}

/* --------------------------------------------------------- data safety */

/**
 * Where everything actually lives.
 *
 * Surfaced because a local-first app that will not tell you where your data is
 * is asking for trust it has not earned — and because the file is the real
 * backup of last resort.
 */
export interface DbInfo {
  path: string
  /** Bytes, or null when the file cannot be read right now. */
  sizeBytes: number | null
  /** Migration count this build ships, which is the schema the file is at. */
  schemaVersion: number
}

export interface BackupWritten {
  path: string
  /** Rows written, across every table. */
  rows: number
}

export interface ImportSummary {
  counts: Record<string, number>
  total: number
  /** The schema version the file was written at. */
  fromVersion: number
}

/* -------------------------------------------------------------- tracker */

/**
 * One finished piece of work, as the Tracker sees it.
 *
 * `doneOn` is the local day the slot was *completed*, derived from
 * `completed_at` — not `Slot.date`. Those differ constantly: work planned for
 * Tuesday and ticked off on Thursday belongs to Thursday in a diary of what
 * actually happened, and bucketing on the planned date would quietly credit the
 * wrong day every time something ran late.
 */
export interface TrackerEntry {
  slotId: string
  title: string
  category: SlotCategory
  doneOn: DateKey
  durationMin: number
  source: SlotSource
  sourceLabel: string | null
  sourceColor: GoalColor | null
}

export interface TrackerDay {
  date: DateKey
  counts: Record<SlotCategory, number>
  minutes: Record<SlotCategory, number>
  total: number
  totalMinutes: number
}

/**
 * Honest arithmetic against the plans, not a motivational number.
 *
 * "Behind" counts topics whose day has already passed and which are still
 * pending — the ones the schedule expected to be finished by now. Work done
 * early is not counted as being ahead, because it does not make a missed topic
 * any less missed.
 */
export interface TrackerPace {
  behind: number
  done: number
  total: number
  onPace: boolean
  /** False when there are no active goals, so the readout can stay quiet. */
  hasGoals: boolean
}

export interface TrackerWeek {
  /** Monday, matching startOfWeek and the weekly seeding key. */
  weekStart: DateKey
  days: TrackerDay[]
  totals: Record<SlotCategory, number>
  minutes: Record<SlotCategory, number>
  totalCount: number
  totalMinutes: number
  /** Everything finished this week, newest day first. */
  entries: TrackerEntry[]
  pace: TrackerPace
}

/* ------------------------------------------------------------- sections */

export const SECTIONS = [
  'today',
  'projects',
  'goals',
  'tracker',
  'stickers'
] as const

export type SectionId = (typeof SECTIONS)[number]

export const CATEGORY_LABEL: Record<SlotCategory, string> = {
  vibe_code: 'Vibe Code',
  amber: 'Amber',
  personal_learning: 'Learning'
}
