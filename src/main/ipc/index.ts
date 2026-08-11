import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { isValidKey, todayKey } from '@shared/date'
import { IPC } from '@shared/ipc-contract'
import { GOAL_COLORS, STICKER_COLORS } from '@shared/types'
import type {
  AgentMessage,
  CurriculumInput,
  CurriculumProgress,
  GoalNotePatch,
  NewGoalNote,
  NewSlot,
  NewSticker,
  NewWeeklyTemplate,
  NotifyPrefs,
  SlotPatch,
  SlotStatus,
  Sticker,
  StickerPatch
} from '@shared/types'
import { dbPath, getDb } from '../db'
import { MIGRATIONS } from '../db/migrations'
import * as notes from '../db/notes'
import * as slots from '../db/slots'
import * as stickers from '../db/stickers'
import * as weekly from '../db/weekly'
import * as agent from '../services/agent'
import { exportBackup, importBackup } from '../services/backup'
import { bootstrap } from '../services/bootstrap'
import { launchAtLoginEnabled, setLaunchAtLogin } from '../services/launch'
import * as curriculum from '../services/curriculum'
import * as notify from '../services/notify'
import * as tracker from '../services/tracker'
import { checkReminders } from '../services/reminders'
import { listModels, testConnection } from '../services/gemini'
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

  ipcMain.handle(IPC.settingsKeyStatus, () => keyStatus())

  ipcMain.handle(IPC.settingsSetKey, (_e, key: unknown) => {
    if (typeof key !== 'string') throw new Error('API key must be a string')
    setApiKey(key)
    return keyStatus()
  })

  ipcMain.handle(IPC.settingsClearKey, () => {
    clearApiKey()
    return keyStatus()
  })

  ipcMain.handle(IPC.settingsTestKey, async (_e, key: unknown) => {
    const candidate =
      typeof key === 'string' && key.trim() ? key.trim() : requireApiKey()
    return { models: await testConnection(candidate) }
  })

  ipcMain.handle(IPC.geminiModels, async () => listModels(requireApiKey()))

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
const MAX_STICKER_BODY = 2_000

function validateStickerPatch(patch: StickerPatch): void {
  if (patch.body !== undefined) {
    if (typeof patch.body !== 'string' || !patch.body.trim()) {
      throw new Error('A sticker needs something written on it.')
    }
    if (patch.body.length > MAX_STICKER_BODY) {
      throw new Error(`A sticker has to be under ${MAX_STICKER_BODY} characters.`)
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
