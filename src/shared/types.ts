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
  /**
   * Which tags this slot is filed under, denormalised for the same reason as
   * `sourceLabel`. A second dimension to `category`, not a replacement for it:
   * every slot still has exactly one category, and may have any number of tags
   * — including none.
   */
  tags: SlotTag[]
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
  /**
   * Slugs the user typed as `#tag`. Attached with origin `typed`, on top of
   * whatever the keyword rules match on their own.
   */
  tagSlugs?: string[]
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

/* ------------------------------------------------------------------- tags */

/**
 * Tag colours.
 *
 * Wider than `GOAL_COLORS` because tags are the one thing here the user adds
 * indefinitely — five would start repeating by the sixth tag, and a segmented
 * chart whose segments share a colour is worse than no segmentation. Amber is
 * still first so a single tag looks like the rest of the app.
 */
export const TAG_COLORS = [
  'amber',
  'violet',
  'sky',
  'mint',
  'rose',
  'coral',
  'lime',
  'cyan'
] as const

export type TagColor = (typeof TAG_COLORS)[number]

/**
 * How a tag came to be on a slot — the "derivation" shown beside it.
 *
 * Worth storing rather than recomputing: a keyword can be edited or deleted
 * after the fact, and a slot that says "auto-filed on 'amber'" when the rule
 * that did it no longer exists is still telling the truth about what happened.
 */
export type TagOrigin = 'auto' | 'typed' | 'manual'

export interface Tag {
  id: string
  label: string
  /** Lowercase and space-free — what `#slug` in the quick-add bar matches. */
  slug: string
  color: TagColor
  /**
   * Lowercased match terms. A new task whose title contains any of them files
   * itself here without being asked, which is the whole point: typing
   * "amber automation" should land in the amber box on its own.
   */
  keywords: string[]
  /**
   * The weekly cutoff, 0 = Sunday … 6 = Saturday. Friday is the default.
   * null means this tag is not on a deadline and the Tracker stays quiet
   * about it.
   */
  dueWeekday: number | null
  sortIndex: number
  createdAt: string
}

export type NewTag = Omit<Tag, 'id' | 'createdAt' | 'sortIndex' | 'slug'> & {
  /** Derived from the label when omitted. */
  slug?: string
  sortIndex?: number
}

export type TagPatch = Partial<
  Pick<Tag, 'label' | 'slug' | 'color' | 'keywords' | 'dueWeekday' | 'sortIndex'>
>

/**
 * A tag as it hangs off a slot: enough to render the chip, plus why it is
 * there.
 */
export interface SlotTag {
  id: string
  label: string
  slug: string
  color: TagColor
  origin: TagOrigin
  /** The keyword that matched, when `origin` is 'auto'. Null otherwise. */
  matched: string | null
}

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

/**
 * What kind of work a project holds, and therefore what clicking it does.
 *
 * `code` opens the embedded workspace — file tree, Monaco, a real shell. `creative`
 * hands its entry file to whichever application owns that file type, because
 * nothing this app could build would be a better Premiere than Premiere.
 */
export const PROJECT_KINDS = ['code', 'creative'] as const

export type ProjectKind = (typeof PROJECT_KINDS)[number]

/**
 * File types the creative-project picker offers.
 *
 * Only a convenience for the dialog — the app never launches these itself, it hands
 * the path to LaunchServices, which already knows what owns each one. "All files"
 * stays reachable, so this list being incomplete costs nothing.
 */
export const CREATIVE_EXTENSIONS = [
  'prproj', // Premiere Pro
  'aep', // After Effects
  'psd', // Photoshop
  'ai', // Illustrator
  'indd', // InDesign
  'xd',
  'sesx', // Audition
  'drp', // DaVinci Resolve
  'fcpbundle', // Final Cut Pro
  'motn', // Motion
  'logicx', // Logic Pro
  'als', // Ableton Live
  'ptx', // Pro Tools
  'blend', // Blender
  'c4d', // Cinema 4D
  'sketch',
  'fig',
  'afdesign',
  'afphoto',
  'afpub'
] as const

export interface Project {
  id: string
  name: string
  path: string
  kind: ProjectKind
  /**
   * The file a creative project opens, absolute. Null for code projects, and null
   * for a creative project that is only a folder of assets so far.
   */
  entryPath: string | null
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

/**
 * A folder in the Project Panel, backed by a real directory.
 *
 * The mapping is the point: creating one here creates the directory, and dropping
 * an asset in copies the file there. Otherwise the panel would be a second, prettier
 * place for things to be lost, and the files would still be on the desktop.
 */
export interface ProjectFolder {
  id: string
  projectId: string
  parentId: string | null
  name: string
  /** Relative to the project root, POSIX-separated. */
  relPath: string
  sortIndex: number
  createdAt: string
  /** Computed at read time: the directory is not there any more. */
  missing: boolean
  /** How many files are in it right now, directories excluded. */
  fileCount: number
}

/** What a copy-in actually did. Skipped names already existed. */
export interface AssetsFiled {
  folder: ProjectFolder
  copied: string[]
  skipped: string[]
}

/**
 * The subfolders a new project starts with.
 *
 * A project is not a bare directory in practice — it is a shape you end up
 * recreating by hand every time. These are created on disk *and* registered in the
 * panel, so they are immediately droppable targets. Any of them can be renamed or
 * removed afterwards; nothing depends on these names.
 */
export const PROJECT_TEMPLATE: Record<ProjectKind, readonly string[]> = {
  creative: ['Footage', 'References', 'Exports', 'Project files'],
  code: ['src', 'assets', 'docs']
}

/** Where new projects of each kind are created. Null until you have set one. */
export interface ProjectHomes {
  code: string | null
  creative: string | null
}

/* --------------------------------------------------------- the desktop bin */

/**
 * A place files pile up.
 *
 * Fixed rather than user-defined: these are the two directories macOS itself
 * dumps things into, which is the whole problem being solved. Both are resolved
 * from `app.getPath`, so they follow the account rather than being hard-coded.
 */
export const BIN_SOURCES = ['desktop', 'downloads'] as const

export type BinSourceId = (typeof BIN_SOURCES)[number]

export const BIN_SOURCE_LABEL: Record<BinSourceId, string> = {
  desktop: 'Desktop',
  downloads: 'Downloads'
}

/**
 * One entry in the bin.
 *
 * Distinct from `FileNode` — which the code editor's file tree uses — because the
 * bin needs a modified time to sort newest-first, and the editor's tree walks
 * directories large enough that stat-ing every entry for a field it never shows
 * would be a real cost.
 */
export interface BinEntry {
  /** Path relative to the source root, POSIX-separated. */
  path: string
  name: string
  directory: boolean
  /** Bytes. For a directory this is 0 — its contents are not walked. */
  size: number
  modifiedMs: number
}

export interface BinListing {
  source: BinSourceId
  /** '' is the source root. */
  rel: string
  entries: BinEntry[]
  /** The listing was capped; there are more entries than this. */
  truncated: boolean
}

/** Move takes the original with it. Copy leaves it where it was. */
export type FileMode = 'move' | 'copy'

/**
 * What a filing operation actually did, per name.
 *
 * Three lists rather than a count, because which files did not make it is the
 * part you need to act on: a skip means something of that name was already there
 * and the original is still sitting where it was.
 */
export interface AssetsMoved {
  folder: ProjectFolder
  mode: FileMode
  moved: string[]
  copied: string[]
  skipped: string[]
  /** Names whose original could not be removed after a cross-volume copy. */
  leftBehind: string[]
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
  /**
   * The folder this note is filed under, or null for a loose one.
   *
   * Nullable on purpose and forever. Grouping is something you reach for when a
   * topic has enough notes to be worth separating — forcing every scrap onto
   * the wall to declare a folder first would turn a scratchpad into filing.
   */
  folderId: string | null
}

/**
 * A group of stickers on the wall.
 *
 * A filter, not a container: the board shows every note by default and folders
 * narrow it. Deleting one releases its notes back to loose rather than taking
 * them with it, which is why `stickers.folder_id` is ON DELETE SET NULL.
 */
export interface StickerFolder {
  id: string
  name: string
  color: StickerColor
  sortIndex: number
  createdAt: string
}

export type NewStickerFolder = Pick<StickerFolder, 'name' | 'color'>

export type StickerFolderPatch = Partial<
  Pick<StickerFolder, 'name' | 'color' | 'sortIndex'>
>

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
    | 'folderId'
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

/**
 * One key slot per feature that calls out.
 *
 * All Gemini, but separate quotas: a heavy storyboard session must not starve
 * the daily planner. Every slot falls back to `default` when empty, so one key
 * in the default slot is all that is ever required.
 */
export const KEY_SLOTS = [
  'default',
  'goals',
  'agent',
  'scenes',
  'prompts'
] as const

export type KeySlot = (typeof KEY_SLOTS)[number]

export const KEY_SLOT_LABEL: Record<KeySlot, { label: string; hint: string }> = {
  default: {
    label: 'Default',
    hint: 'Used by everything below that has no key of its own'
  },
  goals: { label: 'Goals planning', hint: 'Curriculum breakdown and subtopics' },
  agent: { label: 'Day agent', hint: 'The assistant on each day card' },
  scenes: {
    label: 'Scene planning',
    hint: 'Storyboard breakdowns and style sorting'
  },
  prompts: { label: 'Prompt writing', hint: 'Per-scene generation prompts' }
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
  /** Carried through so the completions list can show what it was filed under. */
  tags: SlotTag[]
}

export interface TrackerDay {
  date: DateKey
  counts: Record<SlotCategory, number>
  minutes: Record<SlotCategory, number>
  total: number
  totalMinutes: number
  /**
   * The same day counted by tag instead of by category, keyed by tag id.
   *
   * A separate map rather than a second `counts` because the two do not add up
   * to the same number: a slot with two tags is counted under both, and one
   * with none appears in neither. `untagged` is what the chart uses to keep a
   * tag-segmented bar the same height as its category-segmented twin.
   */
  tagCounts: Record<string, number>
  tagMinutes: Record<string, number>
  untagged: number
  untaggedMinutes: number
}

/**
 * One tag's week against its cutoff.
 *
 * Counting is deliberately asymmetric with the rest of the Tracker: `done`
 * buckets on the day work was *finished*, the same as everywhere else, while
 * `open` buckets on the day it is *planned* for — unfinished work has no
 * completion date to bucket on, and the only honest question about it is
 * whether it is scheduled to land before the cutoff.
 */
export interface TagDue {
  tagId: string
  /** The cutoff itself, resolved into the week being viewed. */
  dueDate: DateKey
  done: number
  doneMinutes: number
  open: number
  openMinutes: number
  /** The open work itself, so the panel can list it and not just count it. */
  openItems: TagWorkItem[]
  /** The cutoff has passed and `open` is still not zero. */
  missed: boolean
}

export interface TagWorkItem {
  slotId: string
  title: string
  date: DateKey
  durationMin: number
  category: SlotCategory
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
  /** Every tag that exists, so the chart legend is stable across quiet weeks. */
  tags: Tag[]
  tagTotals: Record<string, number>
  tagMinutes: Record<string, number>
  /** Finished work carrying no tag at all, as its own segment. */
  untaggedTotal: number
  untaggedMinutes: number
  /** One entry per tag that has a cutoff weekday set. */
  tagDue: TagDue[]
}

/* ------------------------------------------------------- storyboards */

/**
 * A board: one segment of the storyboard space.
 *
 * Boards are the segmentation. Frames live on an unbounded canvas and are
 * positioned absolutely, so nothing stops two projects' work from sharing a
 * surface except the board they are on — which is exactly why switching boards
 * swaps the whole canvas rather than filtering it.
 */
export interface Storyboard {
  id: string
  title: string
  /** The project this board belongs to, when it belongs to one. */
  projectId: string | null
  /**
   * The creative brief and visual style, rendered on the canvas as the Brief
   * node. They live on the board rather than in a node table so that there is
   * no row to delete — the brief cannot be removed, because it was never a
   * separate thing in the first place.
   */
  brief: string
  visualStyle: string
  color: GoalColor
  sortIndex: number
  createdAt: string
}

export type NewStoryboard = Pick<Storyboard, 'title'> &
  Partial<Pick<Storyboard, 'projectId' | 'color'>>

export type StoryboardPatch = Partial<
  Pick<
    Storyboard,
    'title' | 'projectId' | 'brief' | 'visualStyle' | 'color' | 'sortIndex'
  >
>

/**
 * One frame on a board: what the shot is, and the prompt allocated to it.
 *
 * `prompt` is a first-class column rather than part of `description` because it
 * is the thing that gets copied out and pasted into a generator — a frame's
 * description is for the human reading the board, its prompt is for the machine
 * that renders it, and mixing the two means hand-editing every time.
 */
export interface StoryFrame {
  id: string
  boardId: string
  title: string
  description: string
  prompt: string
  /** Canvas coordinates in px, from the origin of the board's space. */
  x: number
  y: number
  w: number
  h: number
  /**
   * Generation length in seconds, always one of OMNI_DURATIONS. `null` means no
   * duration has been decided yet, which is a different thing from any number.
   */
  durationSec: number | null
  color: GoalColor
  sortIndex: number
  createdAt: string
}

export type NewStoryFrame = Pick<StoryFrame, 'boardId'> &
  Partial<Omit<StoryFrame, 'id' | 'boardId' | 'createdAt'>>

export type StoryFramePatch = Partial<
  Pick<
    StoryFrame,
    | 'title'
    | 'description'
    | 'prompt'
    | 'x'
    | 'y'
    | 'w'
    | 'h'
    | 'durationSec'
    | 'color'
    | 'sortIndex'
  >
>

/**
 * Default size of a new scene card.
 *
 * Shared rather than duplicated: the canvas and the DB layer used to carry their
 * own numbers and disagreed (300x240 against 280x200), which stayed invisible
 * only while every frame was born from a double-click on the canvas.
 */
export const FRAME_W = 300
export const FRAME_H = 240

/**
 * The generation lengths the Omni model supports, in seconds.
 *
 * One array, shared by the main process that validates a duration and the
 * renderer that builds the dropdown, so the two can never disagree about what a
 * legal length is. Changing what the model supports is a change to this line.
 */
export const OMNI_DURATIONS = [4, 6, 8, 10] as const

export type OmniDuration = (typeof OMNI_DURATIONS)[number]

export const isOmniDuration = (value: unknown): value is OmniDuration =>
  (OMNI_DURATIONS as readonly number[]).includes(value as number)

/**
 * Snap an arbitrary number to the nearest supported duration.
 *
 * Used on the way out of the model: a generator told to pick from an enum will
 * occasionally return 7 anyway, and a 7-second scene is not something that can
 * be rendered. Nearest is kinder than rejecting the whole plan.
 */
export function snapDuration(value: number): OmniDuration {
  return OMNI_DURATIONS.reduce((best, d) =>
    Math.abs(d - value) < Math.abs(best - value) ? d : best
  )
}

/* --------------------------------------------------- storyboard references */

/**
 * A list of reference material, drawn as a container node on the canvas.
 *
 * Its rows are the connection points: each item can be wired to any number of
 * scene cards, which is what makes "these three plates belong to shot 4" a fact
 * the board holds rather than something you remember.
 */
export interface StoryList {
  id: string
  boardId: string
  title: string
  x: number
  y: number
  w: number
  h: number
  color: GoalColor
  sortIndex: number
  createdAt: string
}

export type NewStoryList = Pick<StoryList, 'boardId'> &
  Partial<Omit<StoryList, 'id' | 'boardId' | 'createdAt'>>

export type StoryListPatch = Partial<
  Pick<StoryList, 'title' | 'x' | 'y' | 'w' | 'h' | 'color' | 'sortIndex'>
>

/**
 * The custom scheme that serves linked reference media.
 *
 * Shared so the renderer builds the same URLs the main-process handler answers,
 * and so the CSP string and the URL builder cannot drift apart. See
 * src/main/services/media.ts and src/renderer/src/lib/media.ts.
 */
export const MEDIA_SCHEME = 'deck-media'

export const MEDIA_KINDS = ['image', 'video'] as const

export type MediaKind = (typeof MEDIA_KINDS)[number]

/**
 * Extensions the reference picker offers, by kind.
 *
 * Not a security boundary — the protocol handler serves whatever path the row
 * holds regardless — just the set worth showing in a file dialog, and the map
 * used to decide which kind a chosen file is.
 */
export const MEDIA_EXTENSIONS: Record<MediaKind, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'bmp'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']
}

/** The kind a path looks like, or null if it is not media we display. */
export function mediaKindFor(path: string): MediaKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  for (const kind of MEDIA_KINDS) {
    if (MEDIA_EXTENSIONS[kind].includes(ext)) return kind
  }
  return null
}

/**
 * One row in a reference list.
 *
 * `mediaPath` is an absolute path to a file this app does not own and never
 * copies. That is a deliberate trade: no duplication and no import wait, at the
 * cost of a reference that dies if the file moves. `missing` is computed on read
 * rather than stored, because a stored flag would be wrong the moment the file
 * came back.
 */
export interface StoryListItem {
  id: string
  listId: string
  label: string
  mediaPath: string | null
  mediaKind: MediaKind | null
  /** Small JPEG data URI generated at import; null until then, or if it failed. */
  thumb: string | null
  /** Computed per read: the path no longer resolves to a file on disk. */
  missing: boolean
  sortIndex: number
  createdAt: string
}

export type NewStoryListItem = Pick<StoryListItem, 'listId'> &
  Partial<Omit<StoryListItem, 'id' | 'listId' | 'missing' | 'createdAt'>>

export type StoryListItemPatch = Partial<
  Pick<
    StoryListItem,
    'label' | 'mediaPath' | 'mediaKind' | 'thumb' | 'sortIndex'
  >
>

/** A wire from a reference item to a scene card. */
export interface StoryFrameRef {
  frameId: string
  itemId: string
  createdAt: string
}

/**
 * A reference wired to the brief itself.
 *
 * Keyed by board id because the brief is the board — there is exactly one per
 * board and it has no id of its own. A brief ref informs every scene's prompt;
 * a frame ref informs only its scene's.
 */
export interface StoryBriefRef {
  boardId: string
  itemId: string
  createdAt: string
}

/* ------------------------------------------------------------ appearance */

export const THEME_NAMES = ['dark', 'light'] as const

export type ThemeName = (typeof THEME_NAMES)[number]

export const isThemeName = (value: unknown): value is ThemeName =>
  (THEME_NAMES as readonly string[]).includes(value as string)

/**
 * What Electron paints the window with before the renderer has drawn anything.
 *
 * Must track `--color-canvas` in globals.css for each theme. It is the only
 * thing on screen between the window opening and React's first paint, so a
 * stale value here is a flash of the wrong theme on every cold launch — which
 * is exactly why it lives beside the theme names rather than as a literal in
 * main/index.ts.
 */
export const WINDOW_BACKGROUND: Record<ThemeName, string> = {
  dark: '#16161b',
  light: '#e8eaf0'
}

/**
 * What the interface remembers between launches.
 *
 * Fetched as one object rather than a call per preference: they are all read at
 * boot, before the first paint, and three round trips there is three chances to
 * render the wrong thing first.
 */
export interface UiPrefs {
  theme: ThemeName
  /**
   * Whether scene cards show their position on the board.
   *
   * On by default. A scene's number is derived from board order and was only
   * ever visible as the placeholder of an empty title — so the moment the
   * planner names the scenes it writes, every number on the board disappears.
   */
  sceneNumbers: boolean
}

/* ------------------------------------------------------ character sheets */

export const SHEET_KINDS = ['character', 'location'] as const

export type SheetKind = (typeof SHEET_KINDS)[number]

/**
 * One member of the cast: who is in the film, described once.
 *
 * A style locks how the film is *shot*. A sheet locks who is *in* it — the
 * other half of shot-to-shot consistency, and the half a prompt cannot carry on
 * its own, because "the same woman as the last shot" means nothing to a
 * generator that never saw the last shot. The description is restated in full,
 * in identical wording, in every prompt whose shot shows this character.
 *
 * Board-scoped, unlike a style: a look is a house style worth reusing across
 * films, a cast belongs to one film.
 */
export interface StorySheet {
  id: string
  boardId: string
  kind: SheetKind
  name: string
  description: string
  sortIndex: number
  createdAt: string
}

export type NewStorySheet = Pick<StorySheet, 'boardId'> &
  Partial<Omit<StorySheet, 'id' | 'boardId' | 'createdAt'>>

export type StorySheetPatch = Partial<
  Pick<StorySheet, 'kind' | 'name' | 'description' | 'sortIndex'>
>

/* --------------------------------------------------------- video styles */

/** One freeform dimension the named fields do not cover. */
export interface StyleExtra {
  key: string
  value: string
}

/**
 * A saved look: how the thing is shot, not what happens in it.
 *
 * The named fields are the dimensions worth assembling in a fixed order when
 * building a prompt — a lens has to read as a lens. `extras` is the escape hatch,
 * so a dimension nobody anticipated does not need a migration.
 *
 * Styles are board-independent: the library outlives any board that used it.
 */
export interface VideoStyle {
  id: string
  name: string
  videoStyle: string
  camera: string
  lens: string
  grade: string
  lighting: string
  filmStock: string
  aspect: string
  extras: StyleExtra[]
  /**
   * The look as the user described it, in their own words, kept verbatim.
   * The named fields above can be sorted out of this text by the model; this
   * is the copy that survives a bad sort.
   */
  sourceText: string
  color: GoalColor
  sortIndex: number
  createdAt: string
}

export type NewVideoStyle = Pick<VideoStyle, 'name'> &
  Partial<Omit<VideoStyle, 'id' | 'name' | 'createdAt'>>

export type VideoStylePatch = Partial<Omit<VideoStyle, 'id' | 'createdAt'>>

/** The named fields, in the order a prompt should state them. */
export const STYLE_FIELDS = [
  { key: 'videoStyle', label: 'Video style', hint: 'gritty urban indie' },
  { key: 'camera', label: 'Camera', hint: 'handheld, slight roll' },
  { key: 'lens', label: 'Lens', hint: '35mm anamorphic' },
  { key: 'grade', label: 'Grade', hint: 'teal-orange, crushed blacks' },
  { key: 'lighting', label: 'Lighting', hint: 'hard practicals, no fill' },
  { key: 'filmStock', label: 'Film stock', hint: 'Vision3 500T' },
  { key: 'aspect', label: 'Aspect', hint: '2.39:1' }
] as const satisfies readonly {
  key: keyof VideoStyle
  label: string
  hint: string
}[]

/** A style dropped onto one board's canvas. */
export interface StoryStyleNode {
  id: string
  boardId: string
  styleId: string
  x: number
  y: number
  createdAt: string
}

export type NewStoryStyleNode = Pick<StoryStyleNode, 'boardId' | 'styleId'> &
  Partial<Pick<StoryStyleNode, 'x' | 'y'>>

/* ------------------------------------------------------ scene planning */

/** One scene as the model proposes it. Not yet written anywhere. */
export interface ScenePlan {
  title: string
  description: string
  prompt: string
  durationSec: OmniDuration
}

/**
 * What the planner proposes, before anything is written.
 *
 * Returned from the propose call and handed straight to the approval window. The
 * split between proposing and applying is deliberate: "nothing is written until
 * you confirm" is then a property of the IPC surface rather than a promise the UI
 * is making on its own behalf.
 */
export interface ScenePlanProposal {
  scenes: ScenePlan[]
  /** What the model was working from, for the approval window to show. */
  model: string
  styleName: string | null
}

/** One accepted change, as the renderer sends it back to be written. */
export type SceneApply =
  | { kind: 'update'; frameId: string; scene: ScenePlan }
  | { kind: 'create'; scene: ScenePlan }
  | { kind: 'delete'; frameId: string }

/**
 * Stage two: prompts for scenes that already exist.
 *
 * Its own shape rather than a reuse of ScenePlan because identity matters here —
 * a prompt belongs to one frame by id, not by position, so a board the user
 * reorders between proposing and applying still gets every prompt on the card it
 * was written for.
 */
export interface PromptPlanProposal {
  prompts: { frameId: string; prompt: string }[]
  model: string
  styleName: string | null
}

/** One accepted prompt write. Only the prompt column is ever touched. */
export interface PromptApply {
  frameId: string
  prompt: string
}

/* ------------------------------------------------------------- sections */

export const SECTIONS = [
  'today',
  'projects',
  'goals',
  'tracker',
  'storyboards',
  'stickers',
  'settings'
] as const

export type SectionId = (typeof SECTIONS)[number]

export const CATEGORY_LABEL: Record<SlotCategory, string> = {
  vibe_code: 'Vibe Code',
  amber: 'Amber',
  personal_learning: 'Learning'
}
