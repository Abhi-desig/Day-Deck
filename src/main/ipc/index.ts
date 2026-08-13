import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { isValidKey, todayKey } from '@shared/date'
import { IPC } from '@shared/ipc-contract'
import {
  GOAL_COLORS,
  KEY_SLOTS,
  MEDIA_EXTENSIONS,
  MEDIA_KINDS,
  OMNI_DURATIONS,
  STICKER_COLORS,
  STYLE_FIELDS,
  TAG_COLORS,
  isOmniDuration,
  mediaKindFor
} from '@shared/types'
import type {
  AgentMessage,
  KeySlot,
  CurriculumInput,
  CurriculumProgress,
  GoalNotePatch,
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
  PromptApply,
  SceneApply,
  ScenePlan,
  SlotPatch,
  SlotStatus,
  Sticker,
  StickerFolderPatch,
  StickerPatch,
  StoryboardPatch,
  StoryFramePatch,
  StoryListItemPatch,
  StoryListPatch,
  TagOrigin,
  TagPatch,
  VideoStylePatch
} from '@shared/types'
import { dbPath, getDb } from '../db'
import { MIGRATIONS } from '../db/migrations'
import * as notes from '../db/notes'
import * as slots from '../db/slots'
import * as stickers from '../db/stickers'
import * as storyboards from '../db/storyboards'
import * as styles from '../db/styles'
import * as tags from '../db/tags'
import * as weekly from '../db/weekly'
import * as agent from '../services/agent'
import { exportBackup, importBackup } from '../services/backup'
import { bootstrap } from '../services/bootstrap'
import { launchAtLoginEnabled, setLaunchAtLogin } from '../services/launch'
import * as curriculum from '../services/curriculum'
import * as notify from '../services/notify'
import * as storyboardPlan from '../services/storyboard'
import * as tracker from '../services/tracker'
import { checkReminders } from '../services/reminders'
import { listModels, testConnection } from '../services/gemini'
import * as rateLimit from '../services/rate-limit'
import {
  clearApiKey,
  keyStatus,
  requireApiKey,
  setApiKey
} from '../services/secrets'
import { registerWorkspaceIpc } from './workspace'

/**
 * The renderer is our own code, but these handlers are the process boundary —
 * validating here keeps a renderer bug from writing rows that violate the
 * schema's CHECK constraints and blow up much further from the cause.
 */
/** Key slots arrive over IPC as strings; unknown ones are refused, and an
    omitted slot means the default one. */
function assertSlot(value: unknown): KeySlot {
  if (value === undefined || value === null) return 'default'
  if (
    typeof value !== 'string' ||
    !(KEY_SLOTS as readonly string[]).includes(value)
  ) {
    throw new Error(`Not a key slot: ${String(value)}`)
  }
  return value as KeySlot
}

function assertKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !isValidKey(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got ${String(value)}`)
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty id`)
  }
}

const STATUSES: readonly SlotStatus[] = ['open', 'done', 'rolled', 'skipped']

const NOTE_STATUSES = ['active', 'dismissed'] as const

const STICKER_KINDS: readonly Sticker['kind'][] = ['temp', 'permanent']

/** Long enough for a paragraph of context, short enough not to be an essay. */
const MAX_NOTE_BODY = 1_000

function validateNoteBody(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('A reminder needs something written in it.')
  }
  if (value.length > MAX_NOTE_BODY) {
    throw new Error(`A reminder has to be under ${MAX_NOTE_BODY} characters.`)
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.systemBootstrap, () => bootstrap(getDb()))

  ipcMain.handle(IPC.daysRange, (_e, from: unknown, to: unknown) => {
    assertKey(from, 'from')
    assertKey(to, 'to')
    return slots.listRange(getDb(), from, to)
  })

  ipcMain.handle(IPC.slotCreate, (_e, input: NewSlot) => {
    assertKey(input?.date, 'date')
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new Error('Slot title cannot be empty')
    }
    return slots.createSlot(getDb(), input)
  })

  ipcMain.handle(IPC.slotUpdate, (_e, id: unknown, patch: SlotPatch) => {
    assertId(id, 'slot id')
    if (patch.date !== undefined) assertKey(patch.date, 'date')
    if (patch.title !== undefined && patch.title.trim().length === 0) {
      throw new Error('Slot title cannot be empty')
    }
    return slots.updateSlot(getDb(), id, patch)
  })

  ipcMain.handle(IPC.slotDelete, (_e, id: unknown) => {
    assertId(id, 'slot id')
    slots.deleteSlot(getDb(), id)
  })

  ipcMain.handle(IPC.slotSetStatus, (_e, id: unknown, status: unknown) => {
    assertId(id, 'slot id')
    if (!STATUSES.includes(status as SlotStatus)) {
      throw new Error(`Unknown slot status: ${String(status)}`)
    }
    return slots.setStatus(getDb(), id, status as SlotStatus)
  })

  ipcMain.handle(
    IPC.slotReorder,
    (_e, date: unknown, orderedIds: unknown) => {
      assertKey(date, 'date')
      if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array')
      slots.reorder(getDb(), date, orderedIds as string[])
    }
  )

  ipcMain.handle(IPC.weeklyList, () => weekly.listTemplates(getDb()))

  ipcMain.handle(
    IPC.weeklyUpsert,
    (_e, input: NewWeeklyTemplate & { id?: string }) => {
      if (typeof input?.title !== 'string' || input.title.trim().length === 0) {
        throw new Error('Weekly template title cannot be empty')
      }
      if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
        throw new Error('weekday must be an integer 0–6')
      }
      return weekly.upsertTemplate(getDb(), input)
    }
  )

  ipcMain.handle(IPC.weeklyDelete, (_e, id: unknown) => {
    assertId(id, 'template id')
    weekly.deleteTemplate(getDb(), id)
  })

  /* ------------------------------------------------------- curriculum */

  ipcMain.handle(IPC.curriculumOverview, () => curriculum.getOverview(getDb()))

  ipcMain.handle(
    IPC.curriculumGenerate,
    async (event: IpcMainInvokeEvent, input: CurriculumInput) => {
      validateCurriculumInput(input)
      rateLimit.takeToken(getDb(), 'goals')

      // A large curriculum can take a minute or more. Streaming phases back
      // keeps the UI honest about what is happening instead of showing an
      // undifferentiated spinner.
      const send = (update: CurriculumProgress): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.curriculumProgress, update)
        }
      }

      try {
        return await curriculum.generatePlan(getDb(), input, send)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send({ phase: 'error', message })
        throw err
      }
    }
  )

  ipcMain.handle(IPC.curriculumArchive, (_e, id: unknown) => {
    assertId(id, 'goal id')
    curriculum.archiveGoal(getDb(), id)
  })

  ipcMain.handle(IPC.curriculumReflowPreview, (_e, id: unknown) => {
    assertId(id, 'goal id')
    return curriculum.previewReflow(getDb(), id)
  })

  ipcMain.handle(IPC.curriculumReflowCommit, (_e, id: unknown) => {
    assertId(id, 'goal id')
    return curriculum.commitReflow(getDb(), id)
  })

  ipcMain.handle(IPC.curriculumSetCap, (_e, minutes: unknown) => {
    if (
      typeof minutes !== 'number' ||
      !Number.isFinite(minutes) ||
      minutes < 5 ||
      minutes > 1440
    ) {
      throw new Error('Daily cap must be between 5 and 1440 minutes.')
    }
    return curriculum.setDailyCap(getDb(), minutes)
  })

  ipcMain.handle(
    IPC.curriculumSubdivide,
    async (event: IpcMainInvokeEvent, id: unknown) => {
      assertId(id, 'goal id')
      rateLimit.takeToken(getDb(), 'goals')

      const send = (update: CurriculumProgress): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.curriculumProgress, update)
        }
      }

      try {
        return await curriculum.subdivideGoal(getDb(), id, send)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send({ phase: 'error', message })
        throw err
      }
    }
  )

  /* ------------------------------------------------------- goal notes */

  ipcMain.handle(IPC.notesList, (_e, curriculumId: unknown) => {
    if (curriculumId !== undefined && curriculumId !== null) {
      assertId(curriculumId, 'goal id')
    }
    return notes.listForGoal(getDb(), (curriculumId as string | null) ?? null)
  })

  ipcMain.handle(IPC.notesCreate, (_e, input: NewGoalNote) => {
    validateNoteBody(input?.body)
    assertKey(input?.surfaceDate, 'reminder date')
    if (input.learnedDate != null) assertKey(input.learnedDate, 'learned date')
    if (input.curriculumId != null) assertId(input.curriculumId, 'goal id')
    return notes.createNote(getDb(), input)
  })

  ipcMain.handle(IPC.notesUpdate, (_e, id: unknown, patch: GoalNotePatch) => {
    assertId(id, 'note id')
    if (patch?.body !== undefined) validateNoteBody(patch.body)
    if (patch?.surfaceDate !== undefined) {
      assertKey(patch.surfaceDate, 'reminder date')
    }
    if (patch?.learnedDate != null) assertKey(patch.learnedDate, 'learned date')
    if (patch?.status !== undefined && !NOTE_STATUSES.includes(patch.status)) {
      throw new Error(`Unknown note status: ${String(patch.status)}`)
    }
    return notes.updateNote(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.notesDelete, (_e, id: unknown) => {
    assertId(id, 'note id')
    notes.deleteNote(getDb(), id)
  })

  /* ------------------------------------------------------------ agent */

  ipcMain.handle(
    IPC.agentAsk,
    (_e, date: unknown, question: unknown, history: unknown) => {
      assertKey(date, 'date')
      if (typeof question !== 'string' || !question.trim()) {
        throw new Error('Ask a question first.')
      }
      rateLimit.takeToken(getDb(), 'agent')
      return agent.ask(
        getDb(),
        date,
        question,
        Array.isArray(history) ? (history as AgentMessage[]) : []
      )
    }
  )

  /* ------------------------------------------------------ data safety */

  ipcMain.handle(IPC.systemDbInfo, () => {
    const path = dbPath()
    let sizeBytes: number | null = null
    try {
      sizeBytes = statSync(path).size
    } catch {
      // The file is created on first open, so a missing one is a fact to
      // report rather than an error to throw.
    }
    return { path, sizeBytes, schemaVersion: MIGRATIONS.length }
  })

  ipcMain.handle(IPC.systemRevealDb, () => {
    shell.showItemInFolder(dbPath())
  })

  ipcMain.handle(IPC.systemGetLaunchAtLogin, () => launchAtLoginEnabled())

  ipcMain.handle(IPC.systemSetLaunchAtLogin, (_e, enabled: unknown) => {
    setLaunchAtLogin(enabled === true)
    return launchAtLoginEnabled()
  })

  ipcMain.handle(IPC.backupExport, async () => {
    const stamp = todayKey()
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export a Day Deck backup',
      defaultPath: `day-deck-backup-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return null

    const payload = exportBackup(getDb(), app.getVersion())
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')

    const rows = Object.values(payload.tables).reduce((n, t) => n + t.length, 0)
    return { path: filePath, rows }
  })

  ipcMain.handle(IPC.backupImport, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Restore a Day Deck backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    const file = filePaths?.[0]
    if (canceled || !file) return null

    // Replacing everything is not something to do on a stray click, and the
    // renderer cannot be the only thing standing between a misclick and a wiped
    // database — so the confirmation is native and blocking, in main.
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Replace everything', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore from backup?',
      message: 'This replaces everything currently in Day Deck.',
      detail:
        'Every goal, task, project, sticker and setting is deleted and rebuilt from the file. This cannot be undone — export a backup first if you are unsure.'
    })
    if (response !== 0) return null

    return importBackup(getDb(), readFileSync(file, 'utf8'))
  })

  /* --------------------------------------------------------- stickers */

  ipcMain.handle(IPC.stickersList, () => stickers.listStickers(getDb()))

  ipcMain.handle(IPC.stickersCreate, (_e, input: NewSticker) => {
    validateSticker(input)
    return stickers.createSticker(getDb(), input)
  })

  ipcMain.handle(IPC.stickersUpdate, (_e, id: unknown, patch: StickerPatch) => {
    assertId(id, 'sticker id')
    validateStickerPatch(patch ?? {})
    return stickers.updateSticker(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.stickersDelete, (_e, id: unknown) => {
    assertId(id, 'sticker id')
    stickers.deleteSticker(getDb(), id)
  })

  ipcMain.handle(IPC.stickerFoldersList, () => stickers.listFolders(getDb()))

  ipcMain.handle(IPC.stickerFoldersCreate, (_e, input: NewStickerFolder) => {
    validateFolderName(input?.name)
    if (!(STICKER_COLORS as readonly string[]).includes(input?.color)) {
      throw new Error(`Unknown folder colour: ${String(input?.color)}`)
    }
    return stickers.createFolder(getDb(), input)
  })

  ipcMain.handle(
    IPC.stickerFoldersUpdate,
    (_e, id: unknown, patch: StickerFolderPatch) => {
      assertId(id, 'folder id')
      if (patch?.name !== undefined) validateFolderName(patch.name)
      if (
        patch?.color !== undefined &&
        !(STICKER_COLORS as readonly string[]).includes(patch.color)
      ) {
        throw new Error(`Unknown folder colour: ${String(patch.color)}`)
      }
      return stickers.updateFolder(getDb(), id, patch ?? {})
    }
  )

  ipcMain.handle(IPC.stickerFoldersDelete, (_e, id: unknown) => {
    assertId(id, 'folder id')
    stickers.deleteFolder(getDb(), id)
  })

  /* -------------------------------------------------------------- tags */

  ipcMain.handle(IPC.tagsList, () => tags.listTags(getDb()))

  ipcMain.handle(IPC.tagsCreate, (_e, input: NewTag) => {
    validateTagInput(input)
    return tags.createTag(getDb(), input)
  })

  ipcMain.handle(IPC.tagsUpdate, (_e, id: unknown, patch: TagPatch) => {
    assertId(id, 'tag id')
    validateTagPatch(patch ?? {})
    return tags.updateTag(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.tagsDelete, (_e, id: unknown) => {
    assertId(id, 'tag id')
    tags.deleteTag(getDb(), id)
  })

  ipcMain.handle(IPC.tagsReorder, (_e, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array')
    const db = getDb()
    tags.reorderTags(db, orderedIds as string[])
    return tags.listTags(db)
  })

  ipcMain.handle(
    IPC.tagsAttach,
    (_e, slotId: unknown, tagId: unknown, origin: unknown) => {
      assertId(slotId, 'slot id')
      assertId(tagId, 'tag id')
      // Defaults to `manual`: this channel exists for the picker on a row, and
      // anything arriving without a stated origin came from a person clicking.
      const how: TagOrigin =
        origin === 'auto' || origin === 'typed' ? origin : 'manual'
      const db = getDb()
      tags.attachTag(db, slotId, tagId, how)
      return slots.getSlot(db, slotId)
    }
  )

  ipcMain.handle(IPC.tagsDetach, (_e, slotId: unknown, tagId: unknown) => {
    assertId(slotId, 'slot id')
    assertId(tagId, 'tag id')
    const db = getDb()
    tags.detachTag(db, slotId, tagId)
    return slots.getSlot(db, slotId)
  })

  /* ------------------------------------------------------- storyboards */

  ipcMain.handle(IPC.boardsList, () => storyboards.listBoards(getDb()))

  ipcMain.handle(IPC.boardsCreate, (_e, input: NewStoryboard) => {
    validateBoardTitle(input?.title)
    if (input?.projectId != null) assertId(input.projectId, 'project id')
    if (input?.color !== undefined && !(GOAL_COLORS as readonly string[]).includes(input.color)) {
      throw new Error(`Unknown board colour: ${String(input.color)}`)
    }
    return storyboards.createBoard(getDb(), input)
  })

  ipcMain.handle(IPC.boardsUpdate, (_e, id: unknown, patch: StoryboardPatch) => {
    assertId(id, 'board id')
    if (patch?.title !== undefined) validateBoardTitle(patch.title)
    if (patch?.projectId != null) assertId(patch.projectId, 'project id')
    if (
      patch?.color !== undefined &&
      !(GOAL_COLORS as readonly string[]).includes(patch.color)
    ) {
      throw new Error(`Unknown board colour: ${String(patch.color)}`)
    }
    return storyboards.updateBoard(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.boardsDelete, (_e, id: unknown) => {
    assertId(id, 'board id')
    storyboards.deleteBoard(getDb(), id)
  })

  ipcMain.handle(IPC.framesList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return storyboards.listFrames(getDb(), boardId)
  })

  ipcMain.handle(IPC.framesCreate, (_e, input: NewStoryFrame) => {
    assertId(input?.boardId, 'board id')
    validateFramePatch(input ?? {})
    return storyboards.createFrame(getDb(), input)
  })

  ipcMain.handle(IPC.framesUpdate, (_e, id: unknown, patch: StoryFramePatch) => {
    assertId(id, 'frame id')
    validateFramePatch(patch ?? {})
    return storyboards.updateFrame(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.framesDelete, (_e, id: unknown) => {
    assertId(id, 'frame id')
    storyboards.deleteFrame(getDb(), id)
  })

  ipcMain.handle(IPC.listsList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return storyboards.listLists(getDb(), boardId)
  })

  ipcMain.handle(IPC.listsCreate, (_e, input: NewStoryList) => {
    assertId(input?.boardId, 'board id')
    validateListPatch(input ?? {})
    return storyboards.createList(getDb(), input)
  })

  ipcMain.handle(IPC.listsUpdate, (_e, id: unknown, patch: StoryListPatch) => {
    assertId(id, 'list id')
    validateListPatch(patch ?? {})
    return storyboards.updateList(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.listsDelete, (_e, id: unknown) => {
    assertId(id, 'list id')
    storyboards.deleteList(getDb(), id)
  })

  ipcMain.handle(IPC.itemsList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return storyboards.listItems(getDb(), boardId)
  })

  ipcMain.handle(IPC.itemsCreate, (_e, input: NewStoryListItem) => {
    assertId(input?.listId, 'list id')
    validateListItemPatch(input ?? {})
    return storyboards.createItem(getDb(), input)
  })

  ipcMain.handle(
    IPC.itemsUpdate,
    (_e, id: unknown, patch: StoryListItemPatch) => {
      assertId(id, 'reference id')
      validateListItemPatch(patch ?? {})
      return storyboards.updateItem(getDb(), id, patch ?? {})
    }
  )

  ipcMain.handle(IPC.itemsDelete, (_e, id: unknown) => {
    assertId(id, 'reference id')
    storyboards.deleteItem(getDb(), id)
  })

  ipcMain.handle(IPC.refsList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return storyboards.listRefs(getDb(), boardId)
  })

  ipcMain.handle(IPC.refsCreate, (_e, frameId: unknown, itemId: unknown) => {
    assertId(frameId, 'frame id')
    assertId(itemId, 'reference id')
    return storyboards.createRef(getDb(), frameId, itemId)
  })

  ipcMain.handle(IPC.refsDelete, (_e, frameId: unknown, itemId: unknown) => {
    assertId(frameId, 'frame id')
    assertId(itemId, 'reference id')
    storyboards.deleteRef(getDb(), frameId, itemId)
  })

  ipcMain.handle(IPC.briefRefsList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return storyboards.listBriefRefs(getDb(), boardId)
  })

  ipcMain.handle(IPC.briefRefsCreate, (_e, boardId: unknown, itemId: unknown) => {
    assertId(boardId, 'board id')
    assertId(itemId, 'reference id')
    return storyboards.createBriefRef(getDb(), boardId, itemId)
  })

  ipcMain.handle(IPC.briefRefsDelete, (_e, boardId: unknown, itemId: unknown) => {
    assertId(boardId, 'board id')
    assertId(itemId, 'reference id')
    storyboards.deleteBriefRef(getDb(), boardId, itemId)
  })

  ipcMain.handle(IPC.mediaPick, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add reference media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images and video',
          extensions: [...MEDIA_EXTENSIONS.image, ...MEDIA_EXTENSIONS.video]
        },
        { name: 'Images', extensions: [...MEDIA_EXTENSIONS.image] },
        { name: 'Video', extensions: [...MEDIA_EXTENSIONS.video] }
      ]
    })
    if (result.canceled) return []

    // A filter in the dialog is a suggestion, not a guarantee — "All Files" is
    // always reachable — so the kind is decided here rather than trusted.
    return result.filePaths.flatMap((path) => {
      const kind = mediaKindFor(path)
      return kind ? [{ path, kind }] : []
    })
  })

  /* ------------------------------------------------------ scene planning */

  ipcMain.handle(IPC.boardsPlanScenes, async (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    rateLimit.takeToken(getDb(), 'scenes')
    // Reads and asks; writes nothing. See services/storyboard.ts.
    return storyboardPlan.propose(getDb(), boardId)
  })

  ipcMain.handle(
    IPC.boardsApplyScenePlan,
    (_e, boardId: unknown, applies: unknown) => {
      assertId(boardId, 'board id')
      return storyboardPlan.apply(getDb(), boardId, validateApplies(applies))
    }
  )

  ipcMain.handle(IPC.boardsPlanPrompts, async (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    rateLimit.takeToken(getDb(), 'prompts')
    // Reads and asks; writes nothing. Same contract as planScenes.
    return storyboardPlan.proposePrompts(getDb(), boardId)
  })

  ipcMain.handle(
    IPC.boardsApplyPromptPlan,
    (_e, boardId: unknown, applies: unknown) => {
      assertId(boardId, 'board id')
      return storyboardPlan.applyPrompts(
        getDb(),
        boardId,
        validatePromptApplies(applies)
      )
    }
  )

  /* ------------------------------------------------------------- styles */

  ipcMain.handle(IPC.stylesList, () => styles.listStyles(getDb()))

  ipcMain.handle(IPC.stylesCreate, (_e, input: NewVideoStyle) => {
    if (!input || typeof input !== 'object') throw new Error('Missing style')
    validateStyleName(input.name)
    validateStylePatch(input)
    return styles.createStyle(getDb(), input)
  })

  ipcMain.handle(IPC.stylesUpdate, (_e, id: unknown, patch: VideoStylePatch) => {
    assertId(id, 'style id')
    if (patch?.name !== undefined) validateStyleName(patch.name)
    validateStylePatch(patch ?? {})
    return styles.updateStyle(getDb(), id, patch ?? {})
  })

  ipcMain.handle(IPC.stylesDelete, (_e, id: unknown) => {
    assertId(id, 'style id')
    styles.deleteStyle(getDb(), id)
  })

  ipcMain.handle(IPC.stylesDuplicate, (_e, id: unknown) => {
    assertId(id, 'style id')
    return styles.duplicateStyle(getDb(), id)
  })

  ipcMain.handle(IPC.stylesParse, async (_e, id: unknown) => {
    assertId(id, 'style id')
    rateLimit.takeToken(getDb(), 'scenes')
    // Reads and asks; writes nothing. The ordinary styles:update call is what
    // writes whatever the user keeps of the result.
    return storyboardPlan.parseStyle(getDb(), id)
  })

  ipcMain.handle(IPC.styleNodesList, (_e, boardId: unknown) => {
    assertId(boardId, 'board id')
    return styles.listStyleNodes(getDb(), boardId)
  })

  ipcMain.handle(IPC.styleNodesPlace, (_e, input: NewStoryStyleNode) => {
    assertId(input?.boardId, 'board id')
    assertId(input?.styleId, 'style id')
    for (const axis of ['x', 'y'] as const) {
      const value = input[axis]
      if (value === undefined) continue
      if (!Number.isFinite(value) || Math.abs(value) > MAX_CANVAS) {
        throw new Error(`Style ${axis} is out of range.`)
      }
    }
    return styles.placeStyle(getDb(), input)
  })

  ipcMain.handle(
    IPC.styleNodesMove,
    (_e, id: unknown, x: unknown, y: unknown) => {
      assertId(id, 'style placement id')
      for (const value of [x, y]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('Style position has to be a number.')
        }
        if (Math.abs(value) > MAX_CANVAS) {
          throw new Error('Style position is out of range.')
        }
      }
      return styles.moveStyleNode(getDb(), id, x as number, y as number)
    }
  )

  ipcMain.handle(IPC.styleNodesRemove, (_e, id: unknown) => {
    assertId(id, 'style placement id')
    styles.removeStyleNode(getDb(), id)
  })

  /* ---------------------------------------------------------- tracker */

  ipcMain.handle(IPC.trackerWeek, (_e, anchor: unknown) => {
    assertKey(anchor, 'week anchor')
    return tracker.week(getDb(), anchor)
  })

  /* -------------------------------------------------------- reminders */

  ipcMain.handle(IPC.notifyGetPrefs, () => notify.getPrefs(getDb()))

  ipcMain.handle(IPC.notifySetPrefs, (_e, prefs: unknown) => {
    const saved = notify.setPrefs(getDb(), validateNotifyPrefs(prefs))
    // Turning a brief on at 09:05 should not wait until 09:06 to consider it.
    checkReminders()
    return saved
  })

  ipcMain.handle(IPC.notifyPreview, () => {
    const db = getDb()
    const day = todayKey()
    return {
      morning: notify.buildMorning(db, day),
      evening: notify.buildEvening(db, day)
    }
  })

  /* --------------------------------------------------------- settings */

  ipcMain.handle(IPC.settingsKeyStatus, (_e, slot: unknown) =>
    keyStatus(assertSlot(slot))
  )

  ipcMain.handle(IPC.settingsSetKey, (_e, key: unknown, slot: unknown) => {
    if (typeof key !== 'string') throw new Error('API key must be a string')
    const which = assertSlot(slot)
    setApiKey(key, which)
    return keyStatus(which)
  })

  ipcMain.handle(IPC.settingsClearKey, (_e, slot: unknown) => {
    const which = assertSlot(slot)
    clearApiKey(which)
    return keyStatus(which)
  })

  ipcMain.handle(IPC.settingsTestKey, async (_e, key: unknown, slot: unknown) => {
    rateLimit.takeToken(getDb(), 'default')
    const candidate =
      typeof key === 'string' && key.trim()
        ? key.trim()
        : requireApiKey(assertSlot(slot))
    return { models: await testConnection(candidate) }
  })

  ipcMain.handle(IPC.geminiModels, async () => {
    rateLimit.takeToken(getDb(), 'default')
    return listModels(requireApiKey())
  })

  ipcMain.handle(IPC.settingsGetRate, () => rateLimit.ratePerMinute(getDb()))

  ipcMain.handle(IPC.settingsSetRate, (_e, perMinute: unknown) => {
    if (typeof perMinute !== 'number') {
      throw new Error('The rate has to be a number of calls per minute.')
    }
    return rateLimit.setRatePerMinute(getDb(), perMinute)
  })

  /* -------------------------------- projects, editor files and terminals */

  registerWorkspaceIpc()
}

function validateCurriculumInput(input: CurriculumInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Missing curriculum input')
  }
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw new Error('Give the goal a title.')
  }
  if (typeof input.rawText !== 'string' || input.rawText.trim().length < 20) {
    throw new Error('Paste the curriculum you want broken down.')
  }
  assertKey(input.deadline, 'deadline')
  if (
    !Number.isInteger(input.minutesPerDay) ||
    input.minutesPerDay < 5 ||
    input.minutesPerDay > 1440
  ) {
    throw new Error('Minutes per day must be between 5 and 1440.')
  }
  if (
    !Array.isArray(input.restDays) ||
    input.restDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    throw new Error('Rest days must be weekday numbers between 0 and 6.')
  }
  if (input.restDays.length >= 7) {
    throw new Error('At least one weekday has to be a study day.')
  }
  if (typeof input.model !== 'string' || !input.model.trim()) {
    throw new Error('Pick a Gemini model.')
  }
  if (
    input.color !== undefined &&
    !(GOAL_COLORS as readonly string[]).includes(input.color)
  ) {
    throw new Error(`Unknown goal colour: ${String(input.color)}`)
  }
}

/** Wall coordinates. Generous, but not "lost somewhere at x = 1e9". */
const MAX_COORD = 20_000

function validateStickerPatch(patch: StickerPatch): void {
  // Deliberately no length ceiling on the body. A sticker is wherever a thought
  // landed, and a cap only ever truncates the long one you needed. The card has
  // a fixed footprint and scrolls, so length costs nothing on the wall.
  if (patch.body !== undefined) {
    if (typeof patch.body !== 'string' || !patch.body.trim()) {
      throw new Error('A sticker needs something written on it.')
    }
  }
  if (
    patch.color !== undefined &&
    !(STICKER_COLORS as readonly string[]).includes(patch.color)
  ) {
    throw new Error(`Unknown sticker colour: ${String(patch.color)}`)
  }
  if (patch.kind !== undefined && !STICKER_KINDS.includes(patch.kind)) {
    throw new Error(`Unknown sticker kind: ${String(patch.kind)}`)
  }
  if (patch.expiresAt != null) assertKey(patch.expiresAt, 'expiry date')
  if (patch.attachedDate != null) assertKey(patch.attachedDate, 'attached date')
  // null is the meaningful value here — it is how a note is taken back out of
  // a folder — so only a non-null id has to look like one.
  if (patch.folderId != null) assertId(patch.folderId, 'folder id')

  for (const axis of ['x', 'y'] as const) {
    const value = patch[axis]
    if (value === undefined) continue
    if (!Number.isFinite(value) || Math.abs(value) > MAX_COORD) {
      throw new Error(`Sticker ${axis} is out of range.`)
    }
  }
  if (patch.rotation !== undefined) {
    if (!Number.isFinite(patch.rotation) || Math.abs(patch.rotation) > 360) {
      throw new Error('Sticker rotation is out of range.')
    }
  }
}

function validateSticker(input: NewSticker): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Missing sticker')
  }
  // A create is a patch with everything present, so the field rules live in one
  // place and cannot drift between the two paths.
  validateStickerPatch(input)
  if (input.body === undefined) throw new Error('A sticker needs a body.')
  if (input.kind === undefined) throw new Error('A sticker needs a kind.')
  if (input.color === undefined) throw new Error('A sticker needs a colour.')

  // A temp sticker with neither an expiry nor a day would never be swept, which
  // makes it a permanent sticker wearing the wrong label.
  if (input.kind === 'temp' && !input.expiresAt && !input.attachedDate) {
    throw new Error(
      'A temporary sticker needs either an expiry date or a day to attach to.'
    )
  }
}

const MAX_NAME = 60

function validateFolderName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Give the folder a name.')
  }
  if (value.length > MAX_NAME) {
    throw new Error(`A folder name has to be under ${MAX_NAME} characters.`)
  }
}

function validateBoardTitle(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Give the board a name.')
  }
  if (value.length > MAX_NAME) {
    throw new Error(`A board name has to be under ${MAX_NAME} characters.`)
  }
}

/**
 * Keywords are the one field here that can quietly break the whole app: a term
 * that trims to nothing matches every title ever written, so it is rejected at
 * the boundary as well as filtered in db/tags.
 */
function validateKeywords(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error('Keywords must be a list.')
  if (value.length > 40) throw new Error('That is too many keywords for one tag.')
  for (const keyword of value) {
    if (typeof keyword !== 'string') {
      throw new Error('Every keyword has to be text.')
    }
    if (keyword.length > MAX_NAME) {
      throw new Error(`A keyword has to be under ${MAX_NAME} characters.`)
    }
  }
}

function validateTagPatch(patch: TagPatch): void {
  if (patch.label !== undefined) {
    if (typeof patch.label !== 'string' || !patch.label.trim()) {
      throw new Error('Give the tag a name.')
    }
    if (patch.label.length > MAX_NAME) {
      throw new Error(`A tag name has to be under ${MAX_NAME} characters.`)
    }
  }
  if (patch.slug !== undefined && typeof patch.slug !== 'string') {
    throw new Error('A tag slug has to be text.')
  }
  if (
    patch.color !== undefined &&
    !(TAG_COLORS as readonly string[]).includes(patch.color)
  ) {
    throw new Error(`Unknown tag colour: ${String(patch.color)}`)
  }
  if (patch.keywords !== undefined) validateKeywords(patch.keywords)
  // null is not missing: it is how a tag is taken off a deadline.
  if (patch.dueWeekday !== undefined && patch.dueWeekday !== null) {
    if (
      !Number.isInteger(patch.dueWeekday) ||
      patch.dueWeekday < 0 ||
      patch.dueWeekday > 6
    ) {
      throw new Error('A cutoff day must be a weekday number between 0 and 6.')
    }
  }
}

function validateTagInput(input: NewTag): void {
  if (!input || typeof input !== 'object') throw new Error('Missing tag')
  validateTagPatch(input as TagPatch)
  if (input.label === undefined) throw new Error('Give the tag a name.')
  if (input.color === undefined) throw new Error('A tag needs a colour.')
}

/** Canvas coordinates. Same reasoning as the stickers wall's MAX_COORD. */
const MAX_CANVAS = 200_000
const MAX_PROMPT = 8_000

function validateFramePatch(patch: StoryFramePatch): void {
  for (const field of ['title', 'description', 'prompt'] as const) {
    const value = patch[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`A frame ${field} has to be text.`)
    if (value.length > MAX_PROMPT) {
      throw new Error(`A frame ${field} has to be under ${MAX_PROMPT} characters.`)
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const value = patch[axis]
    if (value === undefined) continue
    if (!Number.isFinite(value) || Math.abs(value) > MAX_CANVAS) {
      throw new Error(`Frame ${axis} is out of range.`)
    }
  }
  for (const side of ['w', 'h'] as const) {
    const value = patch[side]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < 80 || value > 4_000) {
      throw new Error(`Frame ${side} is out of range.`)
    }
  }
  // null is meaningful — it is how a scene goes back to having no decided
  // duration — so only a non-null value has to be a length the model supports.
  if (patch.durationSec != null && !isOmniDuration(patch.durationSec)) {
    throw new Error(
      `A scene has to be ${OMNI_DURATIONS.join(' or ')} seconds long.`
    )
  }
  if (
    patch.color !== undefined &&
    !(GOAL_COLORS as readonly string[]).includes(patch.color)
  ) {
    throw new Error(`Unknown frame colour: ${String(patch.color)}`)
  }
}

function validateListPatch(patch: StoryListPatch): void {
  if (patch.title !== undefined) {
    if (typeof patch.title !== 'string') {
      throw new Error('A list title has to be text.')
    }
    if (patch.title.length > MAX_NAME) {
      throw new Error(`A list title has to be under ${MAX_NAME} characters.`)
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const value = patch[axis]
    if (value === undefined) continue
    if (!Number.isFinite(value) || Math.abs(value) > MAX_CANVAS) {
      throw new Error(`List ${axis} is out of range.`)
    }
  }
  for (const side of ['w', 'h'] as const) {
    const value = patch[side]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < 80 || value > 4_000) {
      throw new Error(`List ${side} is out of range.`)
    }
  }
  if (
    patch.color !== undefined &&
    !(GOAL_COLORS as readonly string[]).includes(patch.color)
  ) {
    throw new Error(`Unknown list colour: ${String(patch.color)}`)
  }
}

/**
 * A generated poster frame, not an image library.
 *
 * The ceiling is deliberately low: these are 320px JPEGs and every one of them is
 * read back on every board load. Something megabytes long arriving here means the
 * renderer got its encoding wrong, and storing it would make the board slow in a
 * way that is hard to trace back to here.
 */
const MAX_THUMB = 96 * 1024

function validateListItemPatch(patch: StoryListItemPatch): void {
  if (patch.label !== undefined) {
    if (typeof patch.label !== 'string') {
      throw new Error('A reference label has to be text.')
    }
    if (patch.label.length > MAX_NAME) {
      throw new Error(`A reference label has to be under ${MAX_NAME} characters.`)
    }
  }
  // null clears the media off an item, so only a non-null path is checked.
  if (patch.mediaPath != null) {
    if (typeof patch.mediaPath !== 'string' || !isAbsolute(patch.mediaPath)) {
      throw new Error('Reference media needs an absolute path.')
    }
    if (patch.mediaPath.includes('\0')) {
      throw new Error('That is not a real path.')
    }
    // The stored path is what the deck-media protocol will later serve, so it
    // is constrained to what that protocol exists to serve: media files. A
    // renderer asking to link /etc/passwd is refused here, not at read time.
    if (mediaKindFor(patch.mediaPath) === null) {
      throw new Error(
        'Reference media has to be an image or video file the picker offers.'
      )
    }
  }
  if (patch.mediaKind != null && !MEDIA_KINDS.includes(patch.mediaKind)) {
    throw new Error(`Unknown media kind: ${String(patch.mediaKind)}`)
  }
  if (patch.thumb != null) {
    if (
      typeof patch.thumb !== 'string' ||
      !patch.thumb.startsWith('data:image/')
    ) {
      throw new Error('A thumbnail has to be an image data URI.')
    }
    if (patch.thumb.length > MAX_THUMB) {
      throw new Error('That thumbnail is too large.')
    }
  }
}

function validateStyleName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Give the style a name.')
  }
  if (name.length > MAX_NAME) {
    throw new Error(`A style name has to be under ${MAX_NAME} characters.`)
  }
}

/** A style is a description, not an essay — these end up inside every prompt. */
const MAX_STYLE_FIELD = 400
const MAX_EXTRAS = 24

function validateStylePatch(patch: VideoStylePatch): void {
  for (const field of STYLE_FIELDS) {
    const value = patch[field.key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new Error(`${field.label} has to be text.`)
    }
    if (value.length > MAX_STYLE_FIELD) {
      throw new Error(`${field.label} has to be under ${MAX_STYLE_FIELD} characters.`)
    }
  }

  // Read as unknown deliberately. The parameter's declared type describes what a
  // well-behaved caller sends, and this function exists precisely because that is
  // an assumption and not a fact.
  const extras: unknown = (patch as Record<string, unknown>).extras
  if (extras !== undefined) {
    if (!Array.isArray(extras)) {
      throw new Error('Style extras have to be a list.')
    }
    if (extras.length > MAX_EXTRAS) {
      throw new Error(`A style can have at most ${MAX_EXTRAS} extra settings.`)
    }
    for (const extra of extras as unknown[]) {
      if (!extra || typeof extra !== 'object') {
        throw new Error('Each style extra needs a name and a value.')
      }
      const { key, value } = extra as Record<string, unknown>
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new Error('Each style extra needs a name and a value.')
      }
      if (key.length > MAX_NAME || value.length > MAX_STYLE_FIELD) {
        throw new Error('That style extra is too long.')
      }
    }
  }

  if (patch.sourceText !== undefined) {
    if (typeof patch.sourceText !== 'string') {
      throw new Error('The look description has to be text.')
    }
    // Longer than a field on purpose: this is the user's own paragraph, the
    // thing the fields are sorted out of.
    if (patch.sourceText.length > 4_000) {
      throw new Error('The look description has to be under 4,000 characters.')
    }
  }

  if (
    patch.color !== undefined &&
    !(GOAL_COLORS as readonly string[]).includes(patch.color)
  ) {
    throw new Error(`Unknown style colour: ${String(patch.color)}`)
  }
}

/**
 * The approved subset of a plan, arriving back to be written.
 *
 * Checked field by field rather than trusted, for the same reason every other
 * handler here is: the renderer is our own code, but this is the process
 * boundary, and this particular payload ends in DELETE statements.
 */
function validateApplies(value: unknown): SceneApply[] {
  if (!Array.isArray(value)) throw new Error('Missing scene plan')
  if (value.length > 200) throw new Error('That plan is too large to apply.')

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Malformed scene change')
    }
    const change = entry as Record<string, unknown>

    if (change.kind === 'delete') {
      assertId(change.frameId, 'frame id')
      return { kind: 'delete', frameId: change.frameId }
    }

    if (change.kind === 'update' || change.kind === 'create') {
      const scene = validateScene(change.scene)
      if (change.kind === 'create') return { kind: 'create', scene }
      assertId(change.frameId, 'frame id')
      return { kind: 'update', frameId: change.frameId, scene }
    }

    throw new Error(`Unknown scene change: ${String(change.kind)}`)
  })
}

/** Same discipline as validateApplies: this payload ends in UPDATE statements. */
function validatePromptApplies(value: unknown): PromptApply[] {
  if (!Array.isArray(value)) throw new Error('Missing prompt plan')
  if (value.length > 200) throw new Error('That plan is too large to apply.')

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Malformed prompt change')
    }
    const change = entry as Record<string, unknown>
    assertId(change.frameId, 'frame id')
    if (typeof change.prompt !== 'string') {
      throw new Error('A prompt has to be text.')
    }
    if (change.prompt.length > MAX_PROMPT) {
      throw new Error(`A prompt has to be under ${MAX_PROMPT} characters.`)
    }
    return { frameId: change.frameId, prompt: change.prompt }
  })
}

function validateScene(value: unknown): ScenePlan {
  if (!value || typeof value !== 'object') throw new Error('Missing scene')
  const scene = value as Record<string, unknown>

  for (const field of ['title', 'description', 'prompt'] as const) {
    const text = scene[field]
    if (typeof text !== 'string') {
      throw new Error(`A scene ${field} has to be text.`)
    }
    if (text.length > MAX_PROMPT) {
      throw new Error(`A scene ${field} has to be under ${MAX_PROMPT} characters.`)
    }
  }

  if (!isOmniDuration(scene.durationSec)) {
    throw new Error(
      `A scene has to be ${OMNI_DURATIONS.join(' or ')} seconds long.`
    )
  }

  return {
    title: scene.title as string,
    description: scene.description as string,
    prompt: scene.prompt as string,
    durationSec: scene.durationSec
  }
}

function validateNotifyPrefs(value: unknown): NotifyPrefs {
  if (!value || typeof value !== 'object') {
    throw new Error('Missing reminder preferences')
  }
  const prefs = value as Record<string, unknown>

  const minute = (raw: unknown, label: string): number => {
    if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 1439) {
      throw new Error(`${label} must be a minute of the day between 0 and 1439.`)
    }
    return raw as number
  }

  return {
    morningEnabled: prefs['morningEnabled'] === true,
    morningMin: minute(prefs['morningMin'], 'Morning brief time'),
    eveningEnabled: prefs['eveningEnabled'] === true,
    eveningMin: minute(prefs['eveningMin'], 'Evening review time')
  }
}
