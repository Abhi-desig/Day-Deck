import { beforeEach, describe, expect, it } from 'vitest'
import * as cut from '../src/main/db/cut'
import * as takes from '../src/main/db/takes'
import { makeDb, type TestDb } from './helpers'

/**
 * The cut.
 *
 * The shape being defended is that a segment names a take and a range, not a
 * scene — so one scene may appear twice, or contribute two of its takes back to
 * back. Half of these cases exist to prove that stays true, because a
 * well-meaning refactor to "one row per scene" would pass every other test in
 * this file.
 */

let db: TestDb

function seed(): void {
  db.prepare(
    `INSERT INTO storyboards (id, title, brief, visual_style, color,
                              sort_index, created_at)
     VALUES ('b1', 'Launch film', '', '', 'amber', 0, 'now')`
  ).run()
  db.prepare(
    `INSERT INTO storyboard_frames
       (id, board_id, title, description, prompt, x, y, w, h, color,
        sort_index, created_at)
     VALUES ('f1', 'b1', 'Opening', '', 'p', 0, 0, 300, 240, 'amber', 0, 'now')`
  ).run()

  for (const n of [1, 2]) {
    takes.createTake(db, {
      id: `t${n}`,
      frameId: 'f1',
      jobId: null,
      takeIndex: 0,
      fileName: `t${n}.mp4`,
      durationSec: 8,
      model: 'veo',
      prompt: 'p',
      poster: null
    })
  }
}

beforeEach(() => {
  db = makeDb()
  seed()
})

describe('the timeline', () => {
  it('is created on first use rather than with the board', () => {
    expect(cut.getCut(db, 'b1')).toBeNull()
    const created = cut.ensureCut(db, 'b1')
    expect(created.boardId).toBe('b1')
    // Idempotent: asking twice is the same timeline, not two.
    expect(cut.ensureCut(db, 'b1').id).toBe(created.id)
  })

  it('allows only one per board', () => {
    cut.ensureCut(db, 'b1')
    expect(() =>
      db
        .prepare(
          `INSERT INTO storyboard_cuts (id, board_id, x, y, created_at)
           VALUES ('c2', 'b1', 0, 0, 'now')`
        )
        .run()
    ).toThrow()
  })

  it('remembers where it was put', () => {
    cut.ensureCut(db, 'b1')
    cut.moveCut(db, 'b1', 1200, -80)
    expect(cut.getCut(db, 'b1')).toMatchObject({ x: 1200, y: -80 })
  })
})

describe('segments', () => {
  it('lets one take appear twice at different trims', () => {
    const saved = cut.replaceSegments(db, 'b1', [
      { takeId: 't1', startSec: 0, endSec: 2 },
      { takeId: 't2', startSec: 1, endSec: 5 },
      { takeId: 't1', startSec: 4, endSec: 8 }
    ])

    // The whole point of (take, start, end): a flag on the take could not say
    // this, and neither could one row per scene.
    expect(saved).toHaveLength(3)
    expect(saved.map((s) => s.takeId)).toEqual(['t1', 't2', 't1'])
    expect(saved.map((s) => s.sortIndex)).toEqual([0, 1, 2])
    expect(saved[2].startSec).toBe(4)
  })

  it('replaces the list rather than appending to it', () => {
    cut.replaceSegments(db, 'b1', [{ takeId: 't1', startSec: 0, endSec: 4 }])
    const second = cut.replaceSegments(db, 'b1', [
      { takeId: 't2', startSec: 0, endSec: 4 }
    ])
    expect(second.map((s) => s.takeId)).toEqual(['t2'])
  })

  it('drops a segment with no length instead of storing an empty cut', () => {
    // ffmpeg's `-t 0.000` writes a zero-length file, which then breaks the
    // concat that follows it — so this never reaches the renderer.
    const saved = cut.replaceSegments(db, 'b1', [
      { takeId: 't1', startSec: 2, endSec: 2 },
      { takeId: 't2', startSec: 5, endSec: 1 },
      { takeId: 't1', startSec: 0, endSec: 3 }
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0].takeId).toBe('t1')
    // And the surviving segment is still index 0 in the saved order.
    expect(saved[0].sortIndex).toBe(2)
  })

  it('sums the running time from the trims, not the take lengths', () => {
    const saved = cut.replaceSegments(db, 'b1', [
      { takeId: 't1', startSec: 0, endSec: 2.5 },
      { takeId: 't2', startSec: 1, endSec: 4 }
    ])
    expect(cut.cutDuration(saved)).toBe(5.5)
  })

  it('loses its segments when the take they point at is deleted', () => {
    cut.replaceSegments(db, 'b1', [
      { takeId: 't1', startSec: 0, endSec: 4 },
      { takeId: 't2', startSec: 0, endSec: 4 }
    ])

    takes.deleteTake(db, 't1')

    // A segment pointing at a deleted clip would render as a missing file
    // halfway through an export. Cascade is the honest answer.
    expect(cut.listSegments(db, 'b1').map((s) => s.takeId)).toEqual(['t2'])
  })

  it('goes with the board', () => {
    cut.replaceSegments(db, 'b1', [{ takeId: 't1', startSec: 0, endSec: 4 }])
    db.prepare(`DELETE FROM storyboards WHERE id = 'b1'`).run()

    const rows = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM storyboard_cut_segments`
      )
      .get()
    expect(rows?.n).toBe(0)
  })
})
