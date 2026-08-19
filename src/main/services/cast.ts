import { randomUUID } from 'node:crypto'
import {
  DEFAULT_ASPECT,
  PACK_VIEWS,
  type PackProgress,
  type PackStatus,
  type PackView,
  type SheetShot,
  type StorySheet
} from '@shared/types'
import type { Db } from '../db'
import {
  createShot,
  deleteShot,
  getShot,
  listShots,
  markProposed,
  packViewsPresent,
  sheetsWithIncompletePack,
  approvePortrait as writeApproval,
  unlockSheet
} from '../db/cast'
import { getSheet } from '../db/storyboards'
import { hasJobInFlight } from '../db/takes'
import { listStyleNodes, getStyle } from '../db/styles'
import { buildPackPrompt, buildPortraitPrompt } from './ai'
import { resolveProcess } from './processes'
import {
  AiError,
  generateImage,
  imageReferenceLimit,
  modelFor
} from './providers'
import {
  deleteShotFile,
  readShotFile,
  shotFileName,
  writeShotFile
} from './portraits'

/**
 * Making a character *fixed* rather than merely described.
 *
 * The words have always been restated in every prompt — that is necessary and
 * it is not sufficient, because two generations from identical words are two
 * different faces. What fixes a person is an image the generator is
 * conditioned on, and this service is the thing that produces one, gets it
 * approved, and then builds a small pack of other angles **from the approved
 * image itself**.
 *
 * That last distinction is the load-bearing one and it is easy to get wrong
 * invisibly: re-prompting the description produces a second person who matches
 * the description, where passing the approved portrait in as an input reference
 * produces the *same* person from another angle. Every call in `buildPack`
 * attaches the portrait. A pack built the other way looks identical until two
 * of its images are put side by side, which is why the rule is stated here as
 * well as enforced below.
 *
 * Like `services/video.ts` this one both reads and writes, and for the same
 * narrow reason: an image that cost money is durable state the moment it
 * exists. Each write is its own transaction, and none of them touch anything
 * the user typed.
 */

export type Send = (progress: PackProgress) => void

/**
 * One image call in flight at a time, app-wide.
 *
 * A module-level latch rather than a database check, unlike video's: an image
 * call is request/response and leaves no row behind until it returns, so a
 * previous launch cannot have left one running. What this guards against is the
 * fan-out — a user clicking Generate portrait four times, or a resumed pack
 * racing a fresh one — which is entirely within this process's knowledge.
 */
let imageInFlight = false

/** How long to wait between checks that a video generation has finished. */
const VIDEO_WAIT_MS = 5_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The aspect each image is asked for.
 *
 * Portrait-shaped for everything but the full-length view, because a face is
 * the point and a 16:9 frame spends most of itself on the wall behind them.
 */
const ASPECT: Record<PackView | 'portrait', string> = {
  portrait: '3:4',
  front: '3:4',
  'three-quarter': '3:4',
  profile: '3:4',
  'full-body': '9:16',
  expression: '3:4'
}

/** The most recently placed style wins, matching `services/storyboard.ts`. */
function placedStyle(db: Db, boardId: string) {
  const placed = listStyleNodes(db, boardId)
  return placed.length ? getStyle(db, placed[placed.length - 1].styleId) : null
}

function assertDescribed(sheet: StorySheet): void {
  if (!sheet.name.trim()) {
    throw new AiError(
      'Give this character a name first — a portrait with nobody attached to it is not a character.',
      'config'
    )
  }
  if (!sheet.description.trim() && !sheet.sourcePrompt.trim()) {
    throw new AiError(
      'Describe this character first. Generating a portrait from an empty description just buys a random face.',
      'config'
    )
  }
}

/**
 * Generate one portrait candidate. Writes a file and a row, and nothing else.
 *
 * Deliberately does not touch the sheet beyond marking that a candidate now
 * exists: what the user approves is *which image is them*, and that is a
 * separate question from whether an image was made. Same shape as
 * `StoryFrame.isFinal` against `StoryTake.chosen`.
 */
export async function proposePortrait(
  db: Db,
  sheetId: string,
  extra = ''
): Promise<SheetShot> {
  const sheet = getSheet(db, sheetId)
  assertDescribed(sheet)

  const spec = resolveProcess(db, 'cast.portrait')
  const model = modelFor(db, spec.slot)
  const prompt = buildPortraitPrompt(spec, {
    name: sheet.name,
    description: sheet.sourcePrompt || sheet.description,
    extra,
    style: placedStyle(db, sheet.boardId)
  })

  const [image] = await runOneImage(db, {
    model,
    prompt,
    references: [],
    aspectRatio: ASPECT.portrait,
    count: 1
  })

  return writeShot(db, {
    sheetId,
    kind: 'candidate',
    view: '',
    model,
    prompt,
    bytes: image.bytes,
    after: () => markProposed(db, sheetId)
  })
}

/**
 * Approve one candidate. One transaction, and the only call that locks.
 *
 * The pack is not started here — the caller starts it, so that "approve" stays
 * a synchronous write the UI can trust and "build five more images" stays
 * background work that can fail without unapproving anybody.
 */
export function approvePortrait(db: Db, sheetId: string, shotId: string): void {
  writeApproval(db, sheetId, shotId)
}

/** Back to described. Keeps every image, clears the pointer. */
export function unlock(db: Db, sheetId: string): void {
  unlockSheet(db, sheetId)
}

/** Throw away one candidate, file and row together. */
export function discardShot(db: Db, shotId: string): void {
  const shot = getShot(db, shotId)
  const sheet = getSheet(db, shot.sheetId)
  if (sheet.portraitId === shotId) {
    throw new AiError(
      'That is the approved portrait. Unlock the character first — deleting the image the whole board is locked to is not something to do by accident.',
      'config'
    )
  }
  deleteShot(db, shotId)
  deleteShotFile(shotId)
}

/** Which pack views exist and which are missing. */
export function packProgress(db: Db, sheetId: string): PackStatus {
  const present = packViewsPresent(db, sheetId)
  const missing = PACK_VIEWS.filter((v) => !present.has(v))
  return {
    done: PACK_VIEWS.length - missing.length,
    total: PACK_VIEWS.length,
    missing: [...missing]
  }
}

/**
 * Build the reference pack: the missing views, one at a time.
 *
 * **Every image is generated with the approved portrait attached as an input
 * reference.** That is the whole feature; see the note at the top of this file.
 *
 * Sequential, and it yields to video before each image. Video is the expensive
 * one and the user is watching it, where this is background work they were told
 * they would not have to watch — so a pack must never be the reason a clip
 * waits.
 *
 * A pack that fails degrades to *locked, with a portrait and an incomplete
 * pack*. It never degrades to a half-locked character, and the failure is
 * reported once rather than once per view.
 */
export async function buildPack(
  db: Db,
  sheetId: string,
  send: Send
): Promise<void> {
  const sheet = getSheet(db, sheetId)
  if (sheet.status !== 'locked' || !sheet.portraitId) return

  const missing = packProgress(db, sheetId).missing
  if (missing.length === 0) {
    send({ phase: 'ready', sheetId, shots: listShots(db, sheetId) })
    return
  }

  if (imageReferenceLimit(db) < 1) {
    // Worth saying rather than building anyway: a pack whose images were
    // generated without the portrait attached is five plausible strangers, and
    // it looks exactly like a working pack.
    send({
      phase: 'error',
      sheetId,
      message:
        'The image slot is set to a provider that takes no input reference, so the extra angles could not be built from the approved portrait — only from the description again, which produces a different person each time. The character is still locked to the portrait you approved. Point the image slot at a provider that accepts a reference image to build the pack.'
    })
    return
  }

  const spec = resolveProcess(db, 'cast.pack')
  const model = modelFor(db, spec.slot)
  const portrait = readShotFile(sheet.portraitId)

  try {
    for (const view of missing) {
      // Never in front of a clip. Checked before each image rather than once,
      // because a pack takes minutes and a generation can start inside one.
      while (hasJobInFlight(db)) await sleep(VIDEO_WAIT_MS)

      const prompt = buildPackPrompt(spec, {
        name: sheet.name,
        description: sheet.description,
        view
      })

      const [image] = await runOneImage(db, {
        model,
        prompt,
        references: [{ bytes: portrait, mimeType: 'image/png' }],
        aspectRatio: ASPECT[view],
        count: 1
      })

      writeShot(db, {
        sheetId,
        kind: 'pack',
        view,
        model,
        prompt,
        bytes: image.bytes
      })

      const at = packProgress(db, sheetId)
      send({ phase: 'building', sheetId, done: at.done, total: at.total })
    }

    send({ phase: 'ready', sheetId, shots: listShots(db, sheetId) })
  } catch (err) {
    // Once, not per view. The character keeps its portrait and stays locked;
    // an incomplete pack is a smaller loss than an unapproved character.
    send({
      phase: 'error',
      sheetId,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Finish any locked character whose pack is short, at startup.
 *
 * A query rather than a table, which is strictly better than a job row that
 * could disagree with the files: the pack rows *are* the progress, so there is
 * no second record to fall out of sync. Fire-and-forget, like `resumeJobs` — a
 * resume that fails must not stop the app from launching.
 */
export async function resumePacks(db: Db, send: Send): Promise<void> {
  for (const sheetId of sheetsWithIncompletePack(db, PACK_VIEWS.length)) {
    try {
      await buildPack(db, sheetId, send)
    } catch {
      // buildPack reports its own failures on the channel; anything escaping it
      // is a sheet that vanished mid-resume, which is not worth a message.
    }
  }
}

/* ------------------------------------------------------------- internals */

/** One image call, behind the app-wide latch. */
async function runOneImage(
  db: Db,
  req: Parameters<typeof generateImage>[1]
): Promise<Awaited<ReturnType<typeof generateImage>>> {
  if (imageInFlight) {
    throw new AiError(
      'An image is already generating. These run one at a time on purpose — each one is metered, and a fan-out is the expensive kind of mistake.',
      'config'
    )
  }

  imageInFlight = true
  try {
    const images = await generateImage(db, req)
    if (images.length === 0) {
      throw new AiError('The provider returned no image.', 'parse')
    }
    return images
  } finally {
    imageInFlight = false
  }
}

/**
 * File first, row second, and undo the file if the row fails.
 *
 * The id is minted before the write so the file can be named after it — which
 * is what keeps the path derivable from the id rather than stored beside it as
 * a second fact that could disagree. Same order, and the same rollback, as
 * `downloadAll` in services/video.ts.
 */
function writeShot(
  db: Db,
  input: {
    sheetId: string
    kind: 'candidate' | 'pack'
    view: PackView | ''
    model: string
    prompt: string
    bytes: Buffer
    after?: () => void
  }
): SheetShot {
  const id = randomUUID()
  writeShotFile(id, input.bytes)

  try {
    const shot = createShot(db, {
      id,
      sheetId: input.sheetId,
      kind: input.kind,
      view: input.view,
      fileName: shotFileName(id),
      model: input.model,
      prompt: input.prompt,
      // No poster: the renderer reads the file itself over `deck-media://shot/`,
      // so a second copy of the same pixels in a text column would be storage
      // spent on nothing. The column stays for the day a list view wants one.
      poster: null
    })
    input.after?.()
    return shot
  } catch (err) {
    // A row that failed to write leaves a file nothing points at. The startup
    // sweep would collect it eventually, but not before it has taken up space
    // for a session — cheaper to undo it here.
    deleteShotFile(id)
    throw err
  }
}

/** The default aspect, exported so the UI can say what it is asking for. */
export { DEFAULT_ASPECT }
