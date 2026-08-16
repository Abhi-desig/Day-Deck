import { randomUUID } from 'node:crypto'
import type { JobKind, JobStatus, StoryJob, StoryTake } from '@shared/types'
import type { Db } from './index'

/**
 * Generation jobs and the takes they produce.
 *
 * Split from `storyboards.ts` because these two tables are the only ones in the
 * app whose rows are *durable state about work in flight* rather than about
 * something the user typed. A job row exists so that quitting mid-generation
 * loses nothing: the provider's operation name is written down before the wait
 * starts, and re-polled on the next launch.
 */

/* ------------------------------------------------------------------ jobs */

interface JobRow {
  id: string
  board_id: string
  frame_id: string | null
  kind: string
  operation: string
  model: string
  prompt: string
  status: string
  error: string
  created_at: string
  updated_at: string
}

const toJob = (r: JobRow): StoryJob => ({
  id: r.id,
  boardId: r.board_id,
  frameId: r.frame_id,
  kind: r.kind as JobKind,
  operation: r.operation,
  model: r.model,
  prompt: r.prompt,
  status: r.status as JobStatus,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function createJob(
  db: Db,
  input: {
    boardId: string
    frameId: string | null
    kind: JobKind
    model: string
    prompt: string
  },
  now = new Date().toISOString()
): StoryJob {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO storyboard_jobs
       (id, board_id, frame_id, kind, operation, model, prompt, status, error,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?, 'queued', '', ?, ?)`
  ).run(
    id,
    input.boardId,
    input.frameId,
    input.kind,
    input.model,
    input.prompt,
    now,
    now
  )
  return getJob(db, id) as StoryJob
}

export function getJob(db: Db, id: string): StoryJob | null {
  const row = db
    .prepare<[string], JobRow>(`SELECT * FROM storyboard_jobs WHERE id = ?`)
    .get(id)
  return row ? toJob(row) : null
}

/**
 * Move a job along.
 *
 * One statement per transition rather than a patch object, because the field
 * that matters — `operation` — has to be written the instant the provider hands
 * it over. A job that is running with no operation recorded is precisely the
 * state that cannot be resumed.
 */
export function updateJob(
  db: Db,
  id: string,
  patch: { status?: JobStatus; operation?: string; error?: string },
  now = new Date().toISOString()
): void {
  const sets: string[] = ['updated_at = ?']
  const values: unknown[] = [now]

  if (patch.status !== undefined) {
    sets.push('status = ?')
    values.push(patch.status)
  }
  if (patch.operation !== undefined) {
    sets.push('operation = ?')
    values.push(patch.operation)
  }
  if (patch.error !== undefined) {
    sets.push('error = ?')
    values.push(patch.error)
  }

  values.push(id)
  db.prepare(
    `UPDATE storyboard_jobs SET ${sets.join(', ')} WHERE id = ?`
  ).run(...values)
}

/** Jobs that were mid-flight when the app stopped, oldest first. */
export function listResumableJobs(db: Db): StoryJob[] {
  return db
    .prepare<[], JobRow>(
      `SELECT * FROM storyboard_jobs
        WHERE status = 'running' AND operation <> ''
        ORDER BY created_at ASC`
    )
    .all()
    .map(toJob)
}

/**
 * Whether anything is already generating.
 *
 * One Veo job in flight at a time, ever — the guardrail that keeps a mis-click
 * on "Generate all" from becoming a fan-out nobody costed. Asked of the
 * database rather than of a variable in memory so a job left running by a
 * previous launch still counts.
 */
export function hasJobInFlight(db: Db): boolean {
  const row = db
    .prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM storyboard_jobs
        WHERE status IN ('queued','running')`
    )
    .get()
  return (row?.n ?? 0) > 0
}

/**
 * Mark everything still marked running as failed.
 *
 * Called at startup for jobs with no operation to resume from: a job that never
 * got as far as recording one cannot be recovered, and leaving it `running`
 * would block every future generation on the in-flight check above.
 */
export function failOrphanedJobs(
  db: Db,
  now = new Date().toISOString()
): number {
  const result = db
    .prepare(
      `UPDATE storyboard_jobs
          SET status = 'error',
              error = 'Interrupted before the provider answered.',
              updated_at = ?
        WHERE status IN ('queued','running') AND operation = ''`
    )
    .run(now)
  return result.changes
}

/* ----------------------------------------------------------------- takes */

interface TakeRow {
  id: string
  frame_id: string
  job_id: string | null
  take_index: number
  file_name: string
  duration_sec: number
  model: string
  prompt: string
  poster: string | null
  chosen: number
  created_at: string
}

const toTake = (r: TakeRow): StoryTake => ({
  id: r.id,
  frameId: r.frame_id,
  jobId: r.job_id,
  takeIndex: r.take_index,
  fileName: r.file_name,
  durationSec: r.duration_sec,
  model: r.model,
  prompt: r.prompt,
  poster: r.poster,
  chosen: r.chosen === 1,
  createdAt: r.created_at
})

/**
 * Newest first — the take you just paid for is the one you want to look at.
 * Ties break on index so a batch of three keeps the order it was generated in.
 */
export function listTakes(db: Db, frameId: string): StoryTake[] {
  return db
    .prepare<[string], TakeRow>(
      `SELECT * FROM storyboard_takes
        WHERE frame_id = ?
        ORDER BY created_at DESC, take_index ASC`
    )
    .all(frameId)
    .map(toTake)
}

export function listTakesForBoard(db: Db, boardId: string): StoryTake[] {
  return db
    .prepare<[string], TakeRow>(
      `SELECT t.* FROM storyboard_takes t
         JOIN storyboard_frames f ON f.id = t.frame_id
        WHERE f.board_id = ?
        ORDER BY f.sort_index ASC, t.created_at DESC, t.take_index ASC`
    )
    .all(boardId)
    .map(toTake)
}

export function getTake(db: Db, id: string): StoryTake | null {
  const row = db
    .prepare<[string], TakeRow>(`SELECT * FROM storyboard_takes WHERE id = ?`)
    .get(id)
  return row ? toTake(row) : null
}

/**
 * Record a downloaded clip.
 *
 * The id is generated here and handed back so the caller can name the file
 * after it — that ordering is what keeps the filename derivable from the row
 * rather than stored as an independent fact that could disagree with it.
 */
export function createTake(
  db: Db,
  input: {
    id?: string
    frameId: string
    jobId: string | null
    takeIndex: number
    fileName: string
    durationSec: number
    model: string
    prompt: string
    poster: string | null
  },
  now = new Date().toISOString()
): StoryTake {
  const id = input.id ?? randomUUID()
  db.prepare(
    `INSERT INTO storyboard_takes
       (id, frame_id, job_id, take_index, file_name, duration_sec, model,
        prompt, poster, chosen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    input.frameId,
    input.jobId,
    input.takeIndex,
    input.fileName,
    input.durationSec,
    input.model,
    input.prompt,
    input.poster,
    now
  )
  return getTake(db, id) as StoryTake
}

/**
 * Pick the take this scene contributes to the cut.
 *
 * One transaction, because "chosen" is a property of the *scene* expressed on
 * its takes — clearing the others and setting this one are two halves of one
 * fact, and a crash between them would leave a scene with two chosen takes for
 * the timeline to disagree about.
 */
export function chooseTake(db: Db, takeId: string): StoryTake | null {
  const take = getTake(db, takeId)
  if (!take) return null

  db.transaction(() => {
    db.prepare(
      `UPDATE storyboard_takes SET chosen = 0 WHERE frame_id = ?`
    ).run(take.frameId)
    db.prepare(`UPDATE storyboard_takes SET chosen = 1 WHERE id = ?`).run(
      takeId
    )
  })()

  return getTake(db, takeId)
}

/**
 * The take a scene contributes, with a fallback.
 *
 * A scene whose takes have never been chosen between still has an obvious
 * answer — the newest one — and making the timeline demand an explicit choice
 * before it will populate would be ceremony for its own sake.
 */
export function chosenTake(db: Db, frameId: string): StoryTake | null {
  const takes = listTakes(db, frameId)
  return takes.find((t) => t.chosen) ?? takes[0] ?? null
}

/** Returns the deleted row, so the caller can unlink the file it named. */
export function deleteTake(db: Db, id: string): StoryTake | null {
  const take = getTake(db, id)
  if (!take) return null
  db.prepare(`DELETE FROM storyboard_takes WHERE id = ?`).run(id)
  return take
}

/** Every file name the database still expects to exist, for the startup sweep. */
export function allTakeFileNames(db: Db): Set<string> {
  return new Set(
    db
      .prepare<[], { file_name: string }>(
        `SELECT file_name FROM storyboard_takes`
      )
      .all()
      .map((r) => r.file_name)
  )
}
