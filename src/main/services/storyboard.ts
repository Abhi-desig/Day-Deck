import type {
  PromptApply,
  PromptPlanProposal,
  SceneApply,
  ScenePlanProposal,
  StoryFrame,
  StoryListItem
} from '@shared/types'
import { FRAME_H, FRAME_W } from '@shared/types'
import type { Db } from '../db'
import * as boards from '../db/storyboards'
import * as styles from '../db/styles'
import {
  planPrompts as askForPrompts,
  planScenes as askForScenes,
  sortStyleText,
  type SheetLine,
  type StyleSortResult
} from './gemini'
import { requireApiKey } from './secrets'

/**
 * Turning a brief into scenes, in two separate operations.
 *
 * Proposing and applying are deliberately not one call. `propose` reads, asks
 * Gemini and returns — it writes nothing at all, so "nothing changes until you
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
    apiKey: requireApiKey('scenes'),
    model: modelFor(db),
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

  return { scenes, model: modelFor(db), styleName: style?.name ?? null }
}

/**
 * The model to plan with.
 *
 * There is no app-wide model setting, and inventing one for this would be a new
 * concept in a codebase that deliberately picks per record. Reusing whatever the
 * user's own goals are already generating with keeps it to one choice they have
 * made once, in a place they know about.
 */
function modelFor(db: Db): string {
  const row = db
    .prepare<[], { model: string }>(
      `SELECT model FROM curricula ORDER BY created_at DESC LIMIT 1`
    )
    .get()
  return row?.model ?? DEFAULT_MODEL
}

const DEFAULT_MODEL = 'gemini-3.5-flash'

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
 * Matches the SUBDIVIDE_BATCH precedent: one giant call is far more likely to
 * hit the output limit and fail the whole board, and batches run sequentially
 * so a board of forty scenes never fans out into parallel requests.
 */
const PROMPT_BATCH = 15

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

  const apiKey = requireApiKey('prompts')
  const model = modelFor(db)
  const prompts: PromptPlanProposal['prompts'] = []

  for (let start = 0; start < scenes.length; start += PROMPT_BATCH) {
    const write = scenes
      .slice(start, start + PROMPT_BATCH)
      .map((s) => s.number)

    const batch = await askForPrompts({
      apiKey,
      model,
      brief: board.brief,
      visualStyle: board.visualStyle,
      style,
      briefReferences,
      characters: castOf(db, boardId),
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
    throw new Error('Gemini did not return a prompt for any scene.')
  }

  return { prompts, model, styleName: style?.name ?? null }
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
    apiKey: requireApiKey('scenes'),
    model: modelFor(db),
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
