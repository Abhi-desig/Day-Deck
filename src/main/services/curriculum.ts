import type { DateKey } from '@shared/date'
import { todayKey } from '@shared/date'
import type {
  CurriculumInput,
  CurriculumPlan,
  CurriculumProgress,
  GoalsOverview,
  ReflowChange,
  ReflowPreview,
  SubdivideResult
} from '@shared/types'
import { SUBDIVIDE_BATCH } from '@shared/types'
import type { Db } from '../db'
import * as repo from '../db/curriculum'
import {
  DEFAULT_DAILY_CAP,
  getNumber,
  SETTING,
  setSetting
} from '../db/settings'
import { decomposeCurriculum, subdivideTopics } from './gemini'
import { requireApiKey } from './secrets'
import { eligibleDays, schedule } from './scheduler'

type Progress = (update: CurriculumProgress) => void

function planFor(db: Db, curriculumId: string): CurriculumPlan | null {
  const curriculum = repo.getById(db, curriculumId)
  if (!curriculum) return null

  const topics = repo.listTopics(db, curriculumId)
  const result = schedule({
    topics: topics.map((t) => ({ id: t.id, estMinutes: t.estMinutes })),
    from: curriculum.startDate,
    deadline: curriculum.deadline,
    minutesPerDay: curriculum.minutesPerDay,
    restDays: curriculum.restDays
  })

  return { curriculum, topics, summary: result.summary }
}

export function getPlan(db: Db, curriculumId: string): CurriculumPlan | null {
  return planFor(db, curriculumId)
}

export function getPlans(db: Db): CurriculumPlan[] {
  return repo
    .listActive(db)
    .map((c) => planFor(db, c.id))
    .filter((p): p is CurriculumPlan => p !== null)
}

/**
 * Every goal, plus the one number no single goal can know: whether they add up
 * to more day than exists.
 *
 * Each goal's scheduler run is independent and exact against *its own* slice of
 * the day, which is what keeps every deadline honest. The failure mode that
 * creates is silent over-commitment — three goals each confidently promising
 * 90 minutes of a day that only has so many. This surfaces it as a number
 * rather than enforcing a limit, because which goal to cut is not the app's
 * call to make.
 */
export function getOverview(db: Db): GoalsOverview {
  const plans = getPlans(db)
  const dailyCapMinutes = getNumber(
    db,
    SETTING.dailyCapMinutes,
    DEFAULT_DAILY_CAP
  )

  const committedMinutes = plans.reduce(
    (n, p) => n + p.curriculum.minutesPerDay,
    0
  )
  // What the work actually needs, which can exceed what the user asked for when
  // a goal is over capacity against its own deadline.
  const requiredMinutes = plans.reduce(
    (n, p) => n + p.summary.requiredPerDay,
    0
  )

  return {
    plans,
    dailyCapMinutes,
    committedMinutes,
    overCap: committedMinutes > dailyCapMinutes,
    requiredMinutes
  }
}

export function setDailyCap(db: Db, minutes: number): GoalsOverview {
  setSetting(db, SETTING.dailyCapMinutes, String(Math.round(minutes)))
  return getOverview(db)
}

/**
 * Turn pasted text into a dated plan.
 *
 * Gemini is asked only to decompose; every date below comes from the local
 * scheduler. That split is what makes the deadline exact and makes every later
 * reflow free and offline.
 *
 * Unlike the single-plan version this replaced, an existing goal is never
 * archived here — adding a second goal must not silently delete the first.
 */
export async function generatePlan(
  db: Db,
  input: CurriculumInput,
  onProgress: Progress
): Promise<CurriculumPlan> {
  const apiKey = requireApiKey()
  const start = todayKey()

  const days = eligibleDays(start, input.deadline, input.restDays)
  if (days.length === 0) {
    throw new Error(
      'There are no study days between today and that deadline. Move the deadline out, or un-tick some rest days.'
    )
  }

  onProgress({ phase: 'contacting', model: input.model })
  onProgress({ phase: 'decomposing' })

  const drafts = await decomposeCurriculum({
    apiKey,
    model: input.model,
    title: input.title,
    rawText: input.rawText,
    minutesPerDay: input.minutesPerDay,
    targetTopics: days.length
  })

  onProgress({ phase: 'scheduling', topics: drafts.length })

  // Nothing is written until Gemini has actually returned something, so a
  // failed call leaves the existing goals untouched.
  const curriculum = repo.create(db, input, start)
  const topics = repo.replaceTopics(db, curriculum.id, drafts)

  const result = schedule({
    topics: topics.map((t) => ({ id: t.id, estMinutes: t.estMinutes })),
    from: start,
    deadline: input.deadline,
    minutesPerDay: input.minutesPerDay,
    restDays: input.restDays
  })
  repo.applyAssignments(db, result.assignments)

  onProgress({ phase: 'materialising', topics: topics.length })
  repo.materialise(db, curriculum.id)

  // The breakdown is a bonus pass over a plan that already exists and is
  // already on the deck. If it fails — rate limit, dropped connection, a model
  // that will not produce the schema — the goal is still complete and usable,
  // so the failure is swallowed here and offered again as a button in Goals
  // Admin rather than taking a good plan down with it.
  try {
    await subdivideGoal(db, curriculum.id, onProgress)
  } catch {
    /* the plan stands; Goals Admin can break it down later */
  }

  onProgress({ phase: 'done', topics: topics.length })

  return {
    curriculum,
    topics: repo.listTopics(db, curriculum.id),
    summary: result.summary
  }
}

/** Curriculum text sent as grounding. Enough to steer, small enough to repeat. */
const EXCERPT_CHARS = 4_000

/**
 * Break a goal's topics into learning points, filling only the gaps.
 *
 * Runs on generate and again on demand, which is what lets a goal created
 * before this feature existed be brought up to date without regenerating it —
 * and what makes a partial failure recoverable by pressing the button again.
 */
export async function subdivideGoal(
  db: Db,
  curriculumId: string,
  onProgress: Progress = () => {}
): Promise<SubdivideResult> {
  const curriculum = repo.getById(db, curriculumId)
  if (!curriculum) return { plan: null, topicsSubdivided: 0, error: null }

  const pending = repo.listWithoutPoints(db, curriculumId)
  if (pending.length === 0) {
    return { plan: planFor(db, curriculumId), topicsSubdivided: 0, error: null }
  }

  const apiKey = requireApiKey()
  const excerpt = curriculum.rawText.slice(0, EXCERPT_CHARS)

  let updated = 0
  let failure: string | null = null

  for (let i = 0; i < pending.length; i += SUBDIVIDE_BATCH) {
    const batch = pending.slice(i, i + SUBDIVIDE_BATCH)
    onProgress({ phase: 'subdividing', done: updated, total: pending.length })

    try {
      const breakdowns = await subdivideTopics({
        apiKey,
        model: curriculum.model,
        goalTitle: curriculum.title,
        curriculumExcerpt: excerpt,
        topics: batch.map((t) => ({
          id: t.id,
          title: t.title,
          module: t.module,
          detail: t.detail,
          estMinutes: t.estMinutes
        }))
      })

      // A batch may only answer for the topics it was sent. Left unfiltered, a
      // model that helpfully repeats ids from an earlier batch would rewrite
      // points the user has already read, and inflate the count of what this
      // pass actually did. The repo's curriculum scoping is the outer guard;
      // this is the one that keeps a batch honest about its own scope.
      const allowed = new Set(batch.map((t) => t.id))
      updated += repo.setTopicPoints(
        db,
        curriculumId,
        breakdowns.filter((b) => allowed.has(b.topicId))
      )
    } catch (err) {
      // Keep the batches that worked and report the first thing that went
      // wrong. A half-broken-down goal is strictly better than none, and the
      // next run picks up exactly where this one stopped.
      failure = err instanceof Error ? err.message : String(err)
      break
    }
  }

  onProgress({ phase: 'subdividing', done: updated, total: pending.length })

  return {
    plan: planFor(db, curriculumId),
    topicsSubdivided: updated,
    error: failure
  }
}

function reflowResult(db: Db, curriculumId: string, from: DateKey) {
  const curriculum = repo.getById(db, curriculumId)
  if (!curriculum || curriculum.status !== 'active') return null

  const pending = repo.listPending(db, curriculum.id)
  const result = schedule({
    topics: pending.map((t) => ({ id: t.id, estMinutes: t.estMinutes })),
    from,
    deadline: curriculum.deadline,
    minutesPerDay: curriculum.minutesPerDay,
    restDays: curriculum.restDays
  })

  return { curriculum, pending, result }
}

/**
 * What reflow *would* do. Nothing is written — the user confirms first, because
 * silently rewriting a month of plans is not a thing to do on a single click.
 *
 * Reflow is per goal: repacking one goal must not disturb the others, and the
 * diff the user confirms has to be the diff for the goal they clicked.
 */
export function previewReflow(
  db: Db,
  curriculumId: string,
  from: DateKey = todayKey()
): ReflowPreview | null {
  const context = reflowResult(db, curriculumId, from)
  if (!context) return null

  const { pending, result } = context
  const byId = new Map(result.assignments.map((a) => [a.topicId, a.date]))

  const changes: ReflowChange[] = []
  for (const topic of pending) {
    const to = byId.get(topic.id)
    if (!to || to === topic.assignedDate) continue
    changes.push({
      topicId: topic.id,
      title: topic.title,
      from: topic.assignedDate,
      to
    })
  }

  return {
    changes,
    unchanged: pending.length - changes.length,
    summary: result.summary
  }
}

export function commitReflow(
  db: Db,
  curriculumId: string,
  from: DateKey = todayKey()
): CurriculumPlan | null {
  const context = reflowResult(db, curriculumId, from)
  if (!context) return null

  const { curriculum, result } = context
  repo.applyAssignments(db, result.assignments)
  repo.materialise(db, curriculum.id)

  return {
    curriculum,
    topics: repo.listTopics(db, curriculum.id),
    summary: result.summary
  }
}

export function archiveGoal(db: Db, curriculumId: string): void {
  repo.archive(db, curriculumId)
}
