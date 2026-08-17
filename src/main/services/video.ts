import { randomUUID } from 'node:crypto'
import {
  DEFAULT_ASPECT,
  MAX_TAKES,
  type StoryTake,
  type TakeGenerateOptions,
  type VideoJobProgress
} from '@shared/types'
import type { Db } from '../db'
import { getBoard, getFrame } from '../db/storyboards'
import {
  createJob,
  createTake,
  hasJobInFlight,
  listResumableJobs,
  updateJob
} from '../db/takes'
import { AiError, callContext, modelFor, videoAdapterFor } from './providers'
import type { VideoAdapter, VideoOperation } from './providers/video-wire'
import { deleteTakeFile, takeFileName, writeTakeFile } from './takes'

/**
 * Generating clips: the one service here that both reads and writes.
 *
 * Every other AI surface in this app obeys a hard split — propose reads and
 * asks, apply writes in one transaction — and that split is what makes an AI
 * suggestion safe to refuse. This one cannot follow it, and the reason is worth
 * stating: a job *is* durable state. The operation name has to be on disk
 * before the wait begins, or quitting mid-generation loses a clip the provider
 * has already been paid to produce. So the rule is weakened deliberately and
 * narrowly: each write here is its own transaction, and none of them touch
 * anything the user typed.
 */

export type Send = (progress: VideoJobProgress) => void

/** How often to ask whether a generation has finished. */
const POLL_INTERVAL_MS = 10_000

/**
 * How long to wait before giving up on an operation.
 *
 * Ten minutes. Veo commonly takes one to three; past ten something has gone
 * wrong on the provider's side and the job is better reported than waited on.
 * The job row survives either way, so a timeout here is not a lost clip — the
 * next launch re-polls the same operation.
 */
const POLL_TIMEOUT_MS = 600_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * What a generation run will cost, before it is started.
 *
 * Returned to the UI so the confirmation can state the count out loud. Unlike
 * a token budget, this one is denominated in money on a bill the user will see,
 * and "are you sure" means nothing without a number beside it.
 */
export function generationPlan(
  db: Db,
  frameIds: string[],
  takes: number
): { scenes: number; clips: number; seconds: number } {
  const frames = frameIds.map((id) => getFrame(db, id))
  const seconds = frames.reduce((n, f) => n + (f.durationSec ?? 8), 0)
  return {
    scenes: frames.length,
    clips: frames.length * takes,
    seconds: seconds * takes
  }
}

function clampTakes(takes: number): number {
  if (!Number.isInteger(takes) || takes < 1) return 1
  return Math.min(takes, MAX_TAKES)
}

/**
 * Generate for one scene: submit, wait, download, record.
 *
 * Sequential by construction and guarded on a database-wide in-flight check, so
 * there is never more than one Veo job running — the fan-out guardrail. That
 * check asks the database rather than a variable in memory, so a job left
 * running by a previous launch still counts.
 */
export async function generate(
  db: Db,
  frameId: string,
  options: Partial<TakeGenerateOptions>,
  send: Send
): Promise<StoryTake[]> {
  const frame = getFrame(db, frameId)
  const board = getBoard(db, frame.boardId)
  const prompt = frame.prompt.trim()

  if (!prompt) {
    throw new AiError(
      'This scene has no prompt yet. Write prompts for the board first — generating from an empty prompt just buys a random clip.',
      'config'
    )
  }
  if (hasJobInFlight(db)) {
    throw new AiError(
      'A clip is already generating. Video runs one at a time on purpose — each one is metered, and a fan-out is the expensive kind of mistake.',
      'config'
    )
  }

  const ctx = callContext(db, 'video')
  // Resolved before the job row is written, so a slot pointed at a provider
  // that makes no video fails with a sentence and leaves nothing behind.
  const wire = videoAdapterFor(ctx.provider)
  const model = modelFor(db, 'video')
  // Two ceilings, and the provider's is the one that can surprise you: Veo
  // returns as many samples as one operation was asked for, where OpenAI's
  // `/videos` makes exactly one video per request. Asking for three there and
  // silently receiving one would be a shortfall on something metered.
  const takes = Math.min(clampTakes(options.takes ?? 1), wire.maxSamples)

  const job = createJob(db, {
    boardId: board.id,
    frameId,
    kind: 'generate',
    model,
    prompt
  })

  send({ phase: 'submitting', jobId: job.id, frameId })

  try {
    const operation = await wire.submit(ctx, {
      model,
      prompt,
      durationSec: frame.durationSec,
      sampleCount: takes,
      aspectRatio: options.aspectRatio ?? DEFAULT_ASPECT
    })

    // Written before the first sleep, which is the whole point of the row.
    updateJob(db, job.id, { status: 'running', operation: operation.name })

    const saved = await awaitAndCollect(db, ctx, wire, job.id, frameId, operation, {
      model,
      prompt,
      send
    })

    updateJob(db, job.id, { status: 'done' })
    send({ phase: 'done', jobId: job.id, frameId, takes: saved })
    return saved
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    updateJob(db, job.id, { status: 'error', error: message })
    send({ phase: 'error', jobId: job.id, frameId, message })
    throw err
  }
}

/**
 * Wait for an operation, then bring its clips down.
 *
 * Shared by a fresh generation and by a resumed one, because from the moment
 * the operation name exists the two are the same problem.
 */
async function awaitAndCollect(
  db: Db,
  ctx: ReturnType<typeof callContext>,
  wire: VideoAdapter,
  jobId: string,
  frameId: string,
  operation: VideoOperation,
  meta: { model: string; prompt: string; send: Send }
): Promise<StoryTake[]> {
  const startedAt = Date.now()

  for (;;) {
    const elapsed = Date.now() - startedAt
    if (elapsed > POLL_TIMEOUT_MS) {
      throw new AiError(
        `${ctx.label} has been generating this shot for over ${Math.round(
          POLL_TIMEOUT_MS / 60_000
        )} minutes. The job is saved, so reopening Day Deck will pick the same operation back up — but something is wrong on their side.`,
        'server'
      )
    }

    meta.send({
      phase: 'polling',
      jobId,
      frameId,
      elapsedSec: Math.round(elapsed / 1_000)
    })

    const result = await wire.poll(ctx, operation)
    if (result.done) {
      return downloadAll(db, ctx, wire, jobId, frameId, result.samples, meta)
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

async function downloadAll(
  db: Db,
  ctx: ReturnType<typeof callContext>,
  wire: VideoAdapter,
  jobId: string,
  frameId: string,
  samples: { uri: string }[],
  meta: { model: string; prompt: string; send: Send }
): Promise<StoryTake[]> {
  const frame = getFrame(db, frameId)
  const saved: StoryTake[] = []

  for (const [index, sample] of samples.entries()) {
    meta.send({ phase: 'downloading', jobId, frameId, index })

    // The id is minted before the download so the file can be named after it —
    // which is what keeps the path derivable from the row rather than stored
    // beside it as a second fact that could disagree.
    const takeId = randomUUID()
    const bytes = await wire.fetchBytes(ctx, sample.uri)

    writeTakeFile(takeId, bytes)

    try {
      saved.push(
        createTake(db, {
          id: takeId,
          frameId,
          jobId,
          takeIndex: index,
          fileName: takeFileName(takeId),
          // What was asked for. The real length is read off the file by ffprobe
          // in the trimmer; until then the requested length is the best answer
          // available and is right in the overwhelming majority of cases.
          durationSec: frame.durationSec ?? 0,
          model: meta.model,
          prompt: meta.prompt,
          poster: null
        })
      )
    } catch (err) {
      // A row that failed to write leaves a file nothing points at, and the
      // startup sweep would eventually collect it — but not before it has taken
      // up space for a session. Cheaper to undo it here.
      deleteTakeFile(takeId)
      throw err
    }
  }

  return saved
}

/**
 * Pick the operations back up after a restart.
 *
 * The reason the job table exists. Called once at startup, and deliberately
 * fire-and-forget: a resume that fails must not stop the app from launching, so
 * every failure is recorded on the job row and nothing is thrown out of here.
 */
export async function resumeJobs(db: Db, send: Send): Promise<void> {
  for (const job of listResumableJobs(db)) {
    if (!job.frameId) continue
    try {
      const ctx = callContext(db, 'video')
      const takes = await awaitAndCollect(
        db,
        ctx,
        videoAdapterFor(ctx.provider),
        job.id,
        job.frameId,
        { name: job.operation },
        { model: job.model, prompt: job.prompt, send }
      )
      updateJob(db, job.id, { status: 'done' })
      send({ phase: 'done', jobId: job.id, frameId: job.frameId, takes })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateJob(db, job.id, { status: 'error', error: message })
      send({ phase: 'error', jobId: job.id, frameId: job.frameId, message })
    }
  }
}
