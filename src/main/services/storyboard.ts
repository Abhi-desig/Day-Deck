import type {
  CutProposal,
  CutSegmentInput,
  PromptApply,
  PromptPlanProposal,
  SceneApply,
  ScenePlanProposal,
  StoryCutSegment,
  StoryFrame,
  StoryListItem
} from '@shared/types'
import { FRAME_H, FRAME_W } from '@shared/types'
import type { Db } from '../db'
import { replaceSegments } from '../db/cut'
import * as boards from '../db/storyboards'
import * as styles from '../db/styles'
import {
  planCut,
  planPrompts as askForPrompts,
  planScenes as askForScenes,
  reviseScenePrompt,
  sortStyleText,
  type CutClip,
  type SheetLine,
  type StyleSortResult
} from './ai'
import { chosenTake, getTake } from '../db/takes'
import { callContext } from './providers'
import { deleteFile, uploadFile } from './providers/files'
import { borrowedModel } from './providers/model'
import { measureTakes } from './render'
import { takePath } from './takes'

/**
 * Turning a brief into scenes, in two separate operations.
 *
 * Proposing and applying are deliberately not one call. `propose` reads, asks
 * the model and returns — it writes nothing at all, so "nothing changes until you
 * approve it" is a property of this module's surface rather than a promise the
 * approval window is making on its own. `apply` then takes only what came back
 * ticked.
 *
 * The split also means a plan the user rejects costs them nothing but the wait,
 * and a plan they partly accept is applied exactly as partly as they said.
 */

/**
 * Where a newly planned scene goes on the canvas.
 *
 * To the right of the brief, in a row that wraps — the planner does not know what
 * the board looks like, and a column of cards under each other is easier to read
 * through than a pile at the origin. The user moves them afterwards; this only
 * has to be somewhere sensible.
 */
const LANE_X = 420
const LANE_GAP_X = FRAME_W + 60
const LANE_GAP_Y = FRAME_H + 50
const PER_ROW = 4

function slot(index: number): { x: number; y: number } {
  return {
    x: LANE_X + (index % PER_ROW) * LANE_GAP_X,
    y: Math.floor(index / PER_ROW) * LANE_GAP_Y - LANE_GAP_Y
  }
}

/** The most recently placed style wins. Two styles on one board is a question
    with no good answer, and asking the model to reconcile them would produce a
    look that is neither. */
function placedStyle(db: Db, boardId: string) {
  const placed = styles.listStyleNodes(db, boardId)
  return placed.length
    ? styles.getStyle(db, placed[placed.length - 1].styleId)
    : null
}

const describeItem = (item: StoryListItem): string =>
  `${item.label}${item.mediaKind ? ` (${item.mediaKind})` : ''}`

/**
 * The board's cast, flattened for the prompt builders.
 *
 * A sheet with no name or no description is dropped rather than sent half-empty:
 * an unnamed character cannot be referred to, and a named one with nothing said
 * about them would have the model invent the description — which is the exact
 * inconsistency the cast exists to prevent.
 */
const castOf = (db: Db, boardId: string): SheetLine[] =>
  boards
    .listSheets(db, boardId)
    .filter((s) => s.name.trim() && s.description.trim())
    .map((s) => ({ name: s.name, description: s.description }))

export async function propose(
  db: Db,
  boardId: string
): Promise<ScenePlanProposal> {
  const board = boards.getBoard(db, boardId)
  if (!board.brief.trim() && !board.visualStyle.trim()) {
    throw new Error(
      'Write the creative brief first — the planner has nothing to work from.'
    )
  }

  const frames = boards.listFrames(db, boardId)
  const items = boards.listItems(db, boardId)
  const style = placedStyle(db, boardId)

  // References wired to the brief are film-wide; say so, so the breakdown can
  // lean on them without being told which scene they belong to.
  const briefWired = new Set(
    boards.listBriefRefs(db, boardId).map((r) => r.itemId)
  )

  const scenes = await askForScenes({
    db,
    model: modelFor(db, 'scenes'),
    brief: board.brief,
    visualStyle: board.visualStyle,
    style,
    existing: frames.map((f) => ({
      title: f.title,
      description: f.description,
      hasPrompt: f.prompt.trim() !== ''
    })),
    references: items
      .filter((i) => i.label.trim())
      .map(
        (i) => `${describeItem(i)}${briefWired.has(i.id) ? ' [film-wide]' : ''}`
      ),
    characters: castOf(db, boardId)
  })

  // The breakdown never proposes prompt changes: a scene paired with an
  // existing card keeps that card's prompt verbatim, so applying a breakdown
  // cannot wipe prompts — stage two is the only thing that writes them.
  for (let i = 0; i < scenes.length && i < frames.length; i++) {
    scenes[i].prompt = frames[i].prompt
  }

  return { scenes, model: modelFor(db, 'scenes'), styleName: style?.name ?? null }
}

/**
 * The model to plan with.
 *
 * There is no app-wide model setting, and inventing one for this would be a new
 * concept in a codebase that deliberately picks per record. Reusing whatever the
 * user's own goals are already generating with keeps it to one choice they have
 * made once, in a place they know about.
 *
 * That reuse is now conditional on the two slots being the same provider —
 * see `borrowedModel`. A board planned on a slot pointed at a different vendor
 * uses that slot's own model instead, because a Gemini model id is not
 * something xAI can be asked for.
 */
function modelFor(db: Db, slot: 'scenes' | 'prompts'): string {
  const row = db
    .prepare<[], { model: string }>(
      `SELECT model FROM curricula ORDER BY created_at DESC LIMIT 1`
    )
    .get()
  return borrowedModel(db, slot, row?.model ?? null)
}

/**
 * Write the accepted subset.
 *
 * One transaction, so a plan is either applied as approved or not at all — a
 * half-written board is worse than an unchanged one, because the user has no way
 * to tell which half they are looking at.
 */
export function apply(
  db: Db,
  boardId: string,
  applies: readonly SceneApply[]
): StoryFrame[] {
  const board = boards.getBoard(db, boardId)

  const run = db.transaction(() => {
    // Positions for created scenes continue after what is already there, so a
    // second run does not stack new cards on top of the first run's.
    let created = boards.listFrames(db, boardId).length

    for (const change of applies) {
      if (change.kind === 'update') {
        const frame = boards.getFrame(db, change.frameId)
        if (frame.boardId !== boardId) {
          throw new Error('That scene is not on this board.')
        }
        boards.updateFrame(db, change.frameId, {
          title: change.scene.title,
          description: change.scene.description,
          prompt: change.scene.prompt,
          durationSec: change.scene.durationSec
        })
      }

      if (change.kind === 'create') {
        const at = slot(created)
        created += 1
        boards.createFrame(db, {
          boardId,
          title: change.scene.title,
          description: change.scene.description,
          prompt: change.scene.prompt,
          durationSec: change.scene.durationSec,
          x: at.x,
          y: at.y,
          w: FRAME_W,
          h: FRAME_H,
          color: board.color
        })
      }

      if (change.kind === 'delete') {
        const frame = boards.getFrame(db, change.frameId)
        if (frame.boardId !== boardId) {
          throw new Error('That scene is not on this board.')
        }
        boards.deleteFrame(db, change.frameId)
      }
    }
  })

  run()
  return boards.listFrames(db, boardId)
}

/* ---------------------------------------------------------- prompt stage */

/**
 * Scenes per prompt-writing call.
 *
 * Four, down from fifteen. One giant call is more likely to hit the output
 * limit and fail the whole board, and batches run sequentially so a board of
 * forty scenes never fans out into parallel requests — that was always the
 * reasoning, and a credit-metered provider sharpened it into a hard one.
 *
 * Such a provider reserves the request's whole output ceiling before it runs
 * anything, so the size of the batch, not the size of the answer, is what an
 * account has to be able to afford. Fifteen scenes reserved 12k tokens and were
 * refused outright on a balance that covered 4.4k. Four reserve a quarter of
 * that, which means the same balance carries four times as much of the board,
 * and a batch that does fail costs four scenes rather than fifteen.
 *
 * The whole board still goes into every call as context — batching changes how
 * many prompts come back, never how much the model has read.
 */
const PROMPT_BATCH = 4

/**
 * Stage two: write a prompt for every scene on the board.
 *
 * Reads and asks; writes nothing — same contract as `propose`. Every call
 * carries the whole board as context and asks for one batch of prompts, so
 * shot 20 is written by a model that has read shots 1 through 19.
 */
export async function proposePrompts(
  db: Db,
  boardId: string
): Promise<PromptPlanProposal> {
  const board = boards.getBoard(db, boardId)
  const frames = boards.listFrames(db, boardId)
  if (frames.length === 0) {
    throw new Error(
      'There are no scenes to write prompts for — plan or add scenes first.'
    )
  }

  const items = boards.listItems(db, boardId)
  const byId = new Map(items.map((i) => [i.id, i]))
  const style = placedStyle(db, boardId)

  const briefReferences = boards
    .listBriefRefs(db, boardId)
    .flatMap((r) => {
      const item = byId.get(r.itemId)
      return item && item.label.trim() ? [describeItem(item)] : []
    })

  const refsByFrame = new Map<string, string[]>()
  for (const ref of boards.listRefs(db, boardId)) {
    const item = byId.get(ref.itemId)
    if (!item || !item.label.trim()) continue
    const bucket = refsByFrame.get(ref.frameId)
    if (bucket) bucket.push(describeItem(item))
    else refsByFrame.set(ref.frameId, [describeItem(item)])
  }

  const scenes = frames.map((frame, i) => ({
    number: i + 1,
    title: frame.title,
    description: frame.description,
    durationSec: frame.durationSec,
    references: refsByFrame.get(frame.id) ?? []
  }))

  const model = modelFor(db, 'prompts')
  // Read once, not once per batch — the cast cannot change while the loop runs,
  // and re-reading it per batch was work that only looked free.
  const characters = castOf(db, boardId)
  const prompts: PromptPlanProposal['prompts'] = []

  for (let start = 0; start < scenes.length; start += PROMPT_BATCH) {
    const write = scenes
      .slice(start, start + PROMPT_BATCH)
      .map((s) => s.number)

    const batch = await askForPrompts({
      db,
      model,
      brief: board.brief,
      visualStyle: board.visualStyle,
      style,
      briefReferences,
      characters,
      scenes,
      write
    })

    // A scene the model skipped is simply absent — its card stays untouched
    // rather than being proposed an empty prompt.
    for (const [number, prompt] of batch) {
      const frame = frames[number - 1]
      if (frame) prompts.push({ frameId: frame.id, prompt })
    }
  }

  if (prompts.length === 0) {
    throw new Error('The model did not return a prompt for any scene.')
  }

  return { prompts, model, styleName: style?.name ?? null }
}

/* ------------------------------------------------------ revising one shot */

/**
 * Rewrite one scene's prompt to a note the user typed.
 *
 * Reads and asks; writes nothing — same contract as `propose` and
 * `proposePrompts`, and deliberately returning a `PromptPlanProposal` with a
 * single row rather than a new shape. That is not laziness: it means the
 * existing `boards:applyPromptPlan` channel, `applyPrompts`, and the diff UI in
 * `PromptWindow` all carry a revision unchanged. A second write path for
 * "prompt, but from a different button" would be a second place for the
 * approval rule to be got wrong.
 *
 * The prompt it revises is the one that produced the current take, not the
 * frame's prompt — those differ the moment a take is generated and the frame is
 * edited afterwards, and revising the one you did not watch is confusing in a
 * way that is very hard to see.
 */
export async function proposeRevision(
  db: Db,
  frameId: string,
  note: string
): Promise<PromptPlanProposal> {
  const trimmed = note.trim()
  if (!trimmed) {
    throw new Error('Say what to change about the shot first.')
  }

  const frame = boards.getFrame(db, frameId)
  const board = boards.getBoard(db, frame.boardId)
  const frames = boards.listFrames(db, frame.boardId)
  const number = frames.findIndex((f) => f.id === frameId) + 1

  const take = chosenTake(db, frameId)
  const current = take?.prompt.trim() || frame.prompt.trim()
  if (!current) {
    throw new Error(
      'This scene has no prompt to revise yet — write prompts for the board first.'
    )
  }

  const items = boards.listItems(db, frame.boardId)
  const byId = new Map(items.map((i) => [i.id, i]))
  const references = boards
    .listRefs(db, frame.boardId)
    .filter((r) => r.frameId === frameId)
    .flatMap((r) => {
      const item = byId.get(r.itemId)
      return item && item.label.trim() ? [describeItem(item)] : []
    })

  const style = placedStyle(db, frame.boardId)
  const model = modelFor(db, 'prompts')

  const prompt = await reviseScenePrompt({
    db,
    model,
    brief: board.brief,
    visualStyle: board.visualStyle,
    style,
    characters: castOf(db, frame.boardId),
    scene: {
      number: number > 0 ? number : 1,
      title: frame.title,
      description: frame.description,
      durationSec: frame.durationSec,
      references
    },
    current,
    note: trimmed
  })

  return { prompts: [{ frameId, prompt }], model, styleName: style?.name ?? null }
}

/* -------------------------------------------------------- the AI's cut */

/**
 * Ask for cut points, having let the model watch the clips.
 *
 * Reads, uploads and asks; writes nothing — the same contract as every other
 * propose in this file, and the reason the timeline's AI mode can show a
 * proposal beside the manual one and write neither until asked.
 *
 * Uploads are capped at the takes the caller named. Never the whole board:
 * that is bandwidth and a Files API quota spent on clips nobody asked about,
 * and it is the kind of cost that is invisible until the bill.
 */
export async function proposeCut(
  db: Db,
  boardId: string,
  takeIds: readonly string[]
): Promise<CutProposal> {
  if (takeIds.length === 0) {
    throw new Error('Pick the clips to cut from first.')
  }

  const board = boards.getBoard(db, boardId)
  const frames = boards.listFrames(db, boardId)
  const numberByFrame = new Map(frames.map((f, i) => [f.id, i + 1]))
  const frameById = new Map(frames.map((f) => [f.id, f]))

  // Real lengths, not the requested ones: the model is told how long each clip
  // is and will happily return an out point past the end of a file if that
  // number is wrong.
  const lengths = await measureTakes(db, boardId)

  const ctx = callContext(db, 'prompts')
  const uploaded: string[] = []

  try {
    const clips: CutClip[] = []

    for (const takeId of takeIds) {
      const take = getTake(db, takeId)
      if (!take) continue
      const frame = frameById.get(take.frameId)
      if (!frame) continue

      const file = await uploadFile(ctx, takePath(take.id))
      uploaded.push(file.name)

      clips.push({
        takeId: take.id,
        sceneNumber: numberByFrame.get(take.frameId) ?? 0,
        sceneTitle: frame.title,
        description: frame.description,
        durationSec: lengths[take.id] ?? take.durationSec,
        uri: file.uri,
        mimeType: file.mimeType
      })
    }

    if (clips.length === 0) {
      throw new Error('None of those clips still exist.')
    }

    const model = modelFor(db, 'prompts')
    const segments = await planCut({
      db,
      model,
      brief: board.brief,
      clips,
      targetSec: null
    })

    return { segments, model }
  } finally {
    // Whatever happened, the copies on Google's side are not needed again.
    // They expire on their own in 48 hours; this is politeness, and it is in a
    // `finally` because a failed proposal is exactly when they would be left.
    for (const name of uploaded) await deleteFile(ctx, name)
  }
}

/**
 * Write an approved cut.
 *
 * One transaction, by way of `replaceSegments` — which is the same call the
 * manual timeline writes through. An AI cut is therefore not a second way to
 * modify the cut; it is the same way, reached by a different route.
 */
export function applyCut(
  db: Db,
  boardId: string,
  segments: readonly CutSegmentInput[]
): StoryCutSegment[] {
  return replaceSegments(db, boardId, segments)
}

/* ------------------------------------------------------- style sorting */

/**
 * Sort a style's own source text into its named fields.
 *
 * Reads and asks; writes nothing — the fields come back as a proposed patch
 * for the panel to show as a diff, and the ordinary styles:update call is what
 * writes whatever the user keeps. The source text itself is never touched, so
 * a bad sort costs nothing.
 */
export async function parseStyle(
  db: Db,
  styleId: string
): Promise<StyleSortResult> {
  const style = styles.getStyle(db, styleId)
  if (!style.sourceText.trim()) {
    throw new Error(
      'Describe the look first — the sorter has nothing to work from.'
    )
  }

  return sortStyleText({
    db,
    model: modelFor(db, 'scenes'),
    text: style.sourceText
  })
}

/**
 * Write the accepted prompts. One transaction, prompt column only — a prompt
 * pass that also moved a card or renamed a scene would be overreach.
 */
export function applyPrompts(
  db: Db,
  boardId: string,
  applies: readonly PromptApply[]
): StoryFrame[] {
  const run = db.transaction(() => {
    for (const change of applies) {
      const frame = boards.getFrame(db, change.frameId)
      if (frame.boardId !== boardId) {
        throw new Error('That scene is not on this board.')
      }
      boards.updateFrame(db, change.frameId, { prompt: change.prompt })
    }
  })

  run()
  return boards.listFrames(db, boardId)
}
