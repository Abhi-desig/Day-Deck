import { beforeEach, describe, expect, it } from 'vitest'
import * as takes from '../src/main/db/takes'
import { makeDb, type TestDb } from './helpers'

/**
 * Jobs and takes.
 *
 * The interesting assertions here are not the CRUD — they are the three rules
 * that keep generation from costing money twice: only one job may be in flight,
 * a scene has at most one chosen take, and a job that cannot be resumed must
 * not be left blocking the ones that can.
 */

let db: TestDb

function seedBoard(): { boardId: string; frameId: string } {
  db.prepare(
    `INSERT INTO storyboards (id, title, brief, visual_style, color,
                              sort_index, created_at)
     VALUES ('b1', 'Launch film', 'A brief', '', 'amber', 0, 'now')`
  ).run()
  db.prepare(
    `INSERT INTO storyboard_frames
       (id, board_id, title, description, prompt, x, y, w, h, color,
        sort_index, created_at)
     VALUES ('f1', 'b1', 'Opening', '', 'a prompt', 0, 0, 300, 240, 'amber',
             0, 'now')`
  ).run()
  return { boardId: 'b1', frameId: 'f1' }
}

const job = (overrides: Partial<{ boardId: string; frameId: string }> = {}) =>
  takes.createJob(db, {
    boardId: overrides.boardId ?? 'b1',
    frameId: overrides.frameId ?? 'f1',
    kind: 'generate',
    model: 'veo-3.0-generate-001',
    prompt: 'a prompt'
  })

const take = (n: number, jobId: string | null = null) =>
  takes.createTake(
    db,
    {
      id: `t${n}`,
      frameId: 'f1',
      jobId,
      takeIndex: 0,
      fileName: `t${n}.mp4`,
      durationSec: 8,
      model: 'veo-3.0-generate-001',
      prompt: 'a prompt',
      poster: null
    },
    `2026-08-1${n}T00:00:00Z`
  )

beforeEach(() => {
  db = makeDb()
  seedBoard()
})

describe('jobs', () => {
  it('starts queued with no operation to resume from', () => {
    const created = job()
    expect(created.status).toBe('queued')
    expect(created.operation).toBe('')
  })

  /**
   * The single guardrail that keeps a mis-click from becoming a fan-out. Asked
   * of the database rather than of a variable in memory, so a job left running
   * by a previous launch still counts.
   */
  it('reports a job in flight for queued and running alike', () => {
    expect(takes.hasJobInFlight(db)).toBe(false)

    const created = job()
    expect(takes.hasJobInFlight(db)).toBe(true)

    takes.updateJob(db, created.id, { status: 'running', operation: 'op/1' })
    expect(takes.hasJobInFlight(db)).toBe(true)

    takes.updateJob(db, created.id, { status: 'done' })
    expect(takes.hasJobInFlight(db)).toBe(false)
  })

  it('offers only jobs that recorded an operation for resume', () => {
    const withOp = job()
    const withoutOp = job()
    takes.updateJob(db, withOp.id, { status: 'running', operation: 'op/1' })
    takes.updateJob(db, withoutOp.id, { status: 'running' })

    expect(takes.listResumableJobs(db).map((j) => j.id)).toEqual([withOp.id])
  })

  /**
   * A job that never got as far as an operation name cannot be recovered, and
   * leaving it `running` would block every future generation on the in-flight
   * check above — the app would refuse to generate anything, forever, with no
   * way for the user to see why.
   */
  it('fails orphans at startup without touching resumable jobs', () => {
    const resumable = job()
    takes.updateJob(db, resumable.id, { status: 'running', operation: 'op/1' })
    const orphan = job()
    takes.updateJob(db, orphan.id, { status: 'running' })

    expect(takes.failOrphanedJobs(db)).toBe(1)
    expect(takes.getJob(db, orphan.id)?.status).toBe('error')
    expect(takes.getJob(db, orphan.id)?.error).not.toBe('')
    expect(takes.getJob(db, resumable.id)?.status).toBe('running')
    // And the resumable one still counts as in flight, so nothing else starts.
    expect(takes.hasJobInFlight(db)).toBe(true)
  })
})

describe('takes', () => {
  it('lists newest first', () => {
    take(1)
    take(3)
    take(2)
    expect(takes.listTakes(db, 'f1').map((t) => t.id)).toEqual([
      't3',
      't2',
      't1'
    ])
  })

  it('leaves a take standing when the job that made it is deleted', () => {
    const created = job()
    take(1, created.id)
    db.prepare(`DELETE FROM storyboard_jobs WHERE id = ?`).run(created.id)

    // ON DELETE SET NULL, not CASCADE: the clip is the thing that was paid for
    // and it must outlive the bookkeeping about how it was made.
    expect(takes.getTake(db, 't1')?.jobId).toBeNull()
  })

  it('keeps exactly one chosen take per scene', () => {
    take(1)
    take(2)

    takes.chooseTake(db, 't1')
    expect(takes.listTakes(db, 'f1').filter((t) => t.chosen)).toHaveLength(1)

    takes.chooseTake(db, 't2')
    const chosen = takes.listTakes(db, 'f1').filter((t) => t.chosen)
    expect(chosen).toHaveLength(1)
    expect(chosen[0].id).toBe('t2')
  })

  it('falls back to the newest take when nothing was chosen', () => {
    take(1)
    take(2)
    // Demanding an explicit choice before the timeline will populate would be
    // ceremony: there is an obvious answer and this is it.
    expect(takes.chosenTake(db, 'f1')?.id).toBe('t2')

    takes.chooseTake(db, 't1')
    expect(takes.chosenTake(db, 'f1')?.id).toBe('t1')
  })

  it('hands the deleted row back so its file can be unlinked', () => {
    take(1)
    expect(takes.deleteTake(db, 't1')?.fileName).toBe('t1.mp4')
    expect(takes.deleteTake(db, 't1')).toBeNull()
  })

  /**
   * The set the startup sweep diffs the directory against. A name missing from
   * here is a file that gets deleted, so it must include every take on every
   * board rather than only the open one.
   */
  it('names every take file the database still expects', () => {
    take(1)
    take(2)
    expect(takes.allTakeFileNames(db)).toEqual(
      new Set(['t1.mp4', 't2.mp4'])
    )
  })
})
