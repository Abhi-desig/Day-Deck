import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test', getVersion: () => '0.1.0' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

vi.mock('../src/main/services/secrets', () => ({
  getApiKey: () => 'test-key',
  keyStatus: () => ({ present: true, encryptionAvailable: true }),
  setApiKey: () => {},
  clearApiKey: () => {}
}))

const repo = await import('../src/main/db/curriculum')
const slotsRepo = await import('../src/main/db/slots')
const { schedule } = await import('../src/main/services/scheduler')
const { runRollover } = await import('../src/main/services/rollover')
const { commitReflow, subdivideGoal } = await import(
  '../src/main/services/curriculum'
)
const tracker = await import('../src/main/services/tracker')
const { makeDb } = await import('./helpers')

/**
 * The whole chain, once, on one database.
 *
 * Every other test file checks one seam. This one walks the path a real week
 * takes — decompose, schedule, project onto day cards, complete some, miss some,
 * roll them forward, reflow what is left, then read the Tracker — and finishes
 * by counting the same rows in raw SQL. If the Tracker's arithmetic and the
 * database ever disagree, this is the test that says so.
 *
 * Dates are explicit rather than "today" throughout, which is why every service
 * involved takes the date as an argument.
 */

/**
 * Mon 10 Aug 2026 – Sun 16 Aug 2026.
 *   Mon 10 · Tue 11 · Wed 12 · Thu 13 · Fri 14 · Sat 15 · Sun 16
 */
const MONDAY = '2026-08-10'

const GOAL = {
  title: 'Become a Creative Technologist',
  rawText: 'Shaders. Physical computing. Generative type.',
  // Tight enough that six topics land one per day across the week.
  deadline: '2026-08-15',
  minutesPerDay: 90,
  restDays: [],
  model: 'gemini-3.5-flash'
}

const TOPICS = [
  'Shaders, part 1',
  'Shaders, part 2',
  'Physical computing basics',
  'Sensors and input',
  'Generative type, part 1',
  'Generative type, part 2'
]

function mockFetch(points: string[]) {
  const fn = vi.fn(
    async (_url: string, init: RequestInit) => {
      // Answer for whatever topic ids the prompt actually carried, so the
      // breakdown goes through the same id-matching path as production.
      const prompt = JSON.parse(init.body as string).contents[0].parts[0]
        .text as string
      const ids = [...prompt.matchAll(/id: ([0-9a-f-]{36})/g)].map((m) => m[1])

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      breakdowns: ids.map((id) => ({ id, points }))
                    })
                  }
                ]
              },
              finishReason: 'STOP'
            }
          ]
        }),
        text: async () => ''
      } as unknown as Response
    }
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Marks a slot done at a chosen local instant, through the real status path. */
function complete(db: TestDb, slotId: string, day: number, hour: number): void {
  slotsRepo.setStatus(db, slotId, 'done')
  // setStatus stamps completed_at with the real now, which no test can rely on.
  // Overwriting it afterwards keeps the status/topic-sync path under test while
  // making the Tracker's buckets deterministic.
  db.prepare(`UPDATE slots SET completed_at = ? WHERE id = ?`).run(
    new Date(2026, 7, day, hour).toISOString(),
    slotId
  )
}

function addManualSlot(
  db: TestDb,
  opts: { date: string; title: string; category: string; durationMin: number }
): string {
  const slot = slotsRepo.createSlot(db, {
    date: opts.date,
    title: opts.title,
    durationMin: opts.durationMin,
    category: opts.category as never
  })
  return slot.id
}

describe('a full week, end to end', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeDb()
    vi.unstubAllGlobals()
  })

  it('plans, works, misses, rolls, reflows, and reports the same numbers as SQL', async () => {
    /* ---------------------------------------------- 1. create the goal */

    const curriculum = repo.create(db, GOAL, MONDAY)
    const topics = repo.replaceTopics(
      db,
      curriculum.id,
      TOPICS.map((title, i) => ({
        seq: i + 1,
        module: null,
        title,
        detail: null,
        estMinutes: 60
      }))
    )

    const planned = schedule({
      topics: topics.map((t) => ({ id: t.id, estMinutes: t.estMinutes })),
      from: MONDAY,
      deadline: GOAL.deadline,
      minutesPerDay: GOAL.minutesPerDay,
      restDays: GOAL.restDays
    })
    repo.applyAssignments(db, planned.assignments)
    repo.materialise(db, curriculum.id)

    // Six topics, all inside the week, none past the deadline.
    expect(planned.summary.totalTopics).toBe(6)
    expect(planned.summary.lastDate).toBe(GOAL.deadline)

    /* ------------------------------------------ 2. break them down */

    mockFetch(['Read the reference', 'Build the smallest thing that works'])
    const subdivided = await subdivideGoal(db, curriculum.id)
    expect(subdivided.topicsSubdivided).toBe(6)
    expect(subdivided.error).toBeNull()

    // The points reach the day card, which is the only place they matter.
    const week = () => slotsRepo.listRange(db, MONDAY, '2026-08-16')
    expect(
      week()
        .flatMap((c) => c.slots)
        .every((s) => s.sourcePoints.length === 2)
    ).toBe(true)

    /* -------------------------- 3. work three days across all buckets */

    const byDate = new Map(
      week()
        .flatMap((c) => c.slots)
        .map((s) => [s.date, s])
    )

    const monday = byDate.get(MONDAY)!
    const tuesday = byDate.get('2026-08-11')!
    const wednesday = byDate.get('2026-08-12')!

    complete(db, monday.id, 10, 9)
    complete(db, tuesday.id, 11, 10)
    complete(db, wednesday.id, 12, 11)

    // Completing a curriculum slot has to close its topic too.
    const afterWork = repo.listTopics(db, curriculum.id)
    expect(afterWork.filter((t) => t.status === 'done')).toHaveLength(3)

    // The other two categories only exist on manual work, so the Tracker needs
    // some to have anything to group.
    const vibe = addManualSlot(db, {
      date: '2026-08-11',
      title: 'Ship the deck swipe fix',
      category: 'vibe_code',
      durationMin: 120
    })
    const amber = addManualSlot(db, {
      date: '2026-08-12',
      title: 'Weekly amber sync',
      category: 'amber',
      durationMin: 45
    })
    complete(db, vibe, 11, 16)
    complete(db, amber, 12, 15)

    /* ------------------------------- 4. skip two days, then roll over */

    // Thursday and Friday go untouched. Rolling over on Saturday should carry
    // both forward rather than leaving them stranded in the past.
    const rolled = runRollover(db, '2026-08-15')

    expect(rolled).toHaveLength(2)
    expect(rolled.every((r) => r.fromDate < '2026-08-15')).toBe(true)

    // A tombstone stays on the original day so the miss is still visible, and a
    // fresh slot carries the work.
    const thursday = slotsRepo.listRange(db, '2026-08-13', '2026-08-13')[0]
    expect(thursday.slots.map((s) => s.status)).toEqual(['rolled'])

    const saturday = slotsRepo.listRange(db, '2026-08-15', '2026-08-15')[0]
    // Saturday's own topic plus the two carried onto it.
    expect(saturday.slots.filter((s) => s.status === 'open')).toHaveLength(3)

    /* ------------------------------------------------- 5. reflow */

    repo.syncTopicsToSlots(db)
    const reflowed = commitReflow(db, curriculum.id, '2026-08-15')

    expect(reflowed).not.toBeNull()
    // Three topics still pending, and reflow must not invent or lose any.
    expect(reflowed!.topics).toHaveLength(6)
    expect(
      reflowed!.topics.filter((t) => t.status === 'pending')
    ).toHaveLength(3)

    // Reflow is a reconcile, not a duplicator: still exactly one live slot per
    // pending topic.
    const live = slotsRepo
      .listRange(db, MONDAY, '2026-08-31')
      .flatMap((c) => c.slots)
      .filter((s) => s.source === 'curriculum' && s.status === 'open')
    expect(live).toHaveLength(3)
    expect(new Set(live.map((s) => s.sourceRef)).size).toBe(3)

    /* --------------------------------- 6. read the Tracker, then SQL */

    const result = tracker.week(db, MONDAY)

    expect(result.weekStart).toBe(MONDAY)
    expect(result.totals).toEqual({
      personal_learning: 3,
      vibe_code: 1,
      amber: 1
    })
    expect(result.minutes).toEqual({
      personal_learning: 180, // three 60-minute topics
      vibe_code: 120,
      amber: 45
    })
    expect(result.totalCount).toBe(5)
    expect(result.totalMinutes).toBe(345)

    // Per-day: Monday 1, Tuesday 2, Wednesday 2, then nothing.
    expect(result.days.map((d) => d.total)).toEqual([1, 2, 2, 0, 0, 0, 0])

    /*
     * The cross-check the brief asks for. `date(completed_at, 'localtime')` is
     * SQLite doing the UTC-to-local conversion that services/tracker.ts does in
     * JS — two independent routes to the same buckets. If they ever disagree,
     * one of them is wrong.
     */
    const sqlCounts = db
      .prepare<[string, string], { category: string; n: number; mins: number }>(
        `SELECT category, COUNT(*) AS n, SUM(duration_min) AS mins
           FROM slots
          WHERE status = 'done'
            AND completed_at IS NOT NULL
            AND date(completed_at, 'localtime') BETWEEN ? AND ?
          GROUP BY category`
      )
      .all(MONDAY, '2026-08-16')

    const fromSql = Object.fromEntries(
      sqlCounts.map((r) => [r.category, { n: r.n, mins: r.mins }])
    )

    expect(fromSql).toEqual({
      personal_learning: { n: 3, mins: 180 },
      vibe_code: { n: 1, mins: 120 },
      amber: { n: 1, mins: 45 }
    })

    // And the same again as one number, straight from the table.
    const sqlTotal = db
      .prepare<[string, string], { n: number; mins: number }>(
        `SELECT COUNT(*) AS n, SUM(duration_min) AS mins
           FROM slots
          WHERE status = 'done'
            AND date(completed_at, 'localtime') BETWEEN ? AND ?`
      )
      .get(MONDAY, '2026-08-16')

    expect(sqlTotal?.n).toBe(result.totalCount)
    expect(sqlTotal?.mins).toBe(result.totalMinutes)

    /* ------------------------------------------------- 7. the pace */

    // Reflow moved the three remaining topics to 15th onward, so nothing is
    // overdue as of the 15th.
    expect(tracker.pace(db, '2026-08-15')).toMatchObject({
      behind: 0,
      done: 3,
      total: 6,
      onPace: true,
      hasGoals: true
    })

    // A fortnight later, with nothing further done, the same plan is behind.
    expect(tracker.pace(db, '2026-08-29').behind).toBe(3)
  })

  /** A tombstone is history; it must never be counted as work done. */
  it('does not let a rolled-over slot inflate the Tracker', () => {
    const id = slotsRepo.createSlot(db, {
      date: '2026-08-13',
      title: 'Missed it',
      durationMin: 60
    }).id

    runRollover(db, '2026-08-15')

    const result = tracker.week(db, MONDAY)
    expect(result.totalCount).toBe(0)

    // Now finish the carried copy: exactly one completion, not two.
    const carried = slotsRepo
      .listRange(db, '2026-08-15', '2026-08-15')[0]
      .slots.find((s) => s.rolledFrom === id)!
    complete(db, carried.id, 15, 12)

    const after = tracker.week(db, MONDAY)
    expect(after.totalCount).toBe(1)
    expect(after.days[5].total).toBe(1) // Saturday
  })
})
