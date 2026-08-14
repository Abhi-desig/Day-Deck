import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { labelFor } from '@shared/date'
import type { CurriculumPlan, Topic } from '@shared/types'
import { PROVIDER_INFO, SUBDIVIDE_BATCH } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'
import { NumberTicker } from '../../components/magicui/NumberTicker'
import { AnimatedGroup } from '../../components/motion-primitives/AnimatedGroup'

export function PlanSummary({ plan }: { plan: CurriculumPlan }) {
  const openReflow = useCurriculum((s) => s.openReflow)
  const reflowBusy = useCurriculum((s) => s.reflowBusy)
  const archive = useCurriculum((s) => s.archive)
  const subdivide = useCurriculum((s) => s.subdivide)
  const subdividing = useCurriculum((s) => s.subdividing)
  const progress = useCurriculum((s) => s.progress)
  const provider = useCurriculum((s) => s.goalsProvider)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const { curriculum, topics, summary } = plan
  const style = goalStyle(curriculum.color)
  const done = topics.filter((t) => t.status === 'done').length
  const deadline = labelFor(curriculum.deadline)

  const brokenDown = topics.filter((t) => t.points.length > 0).length
  const missing = topics.length - brokenDown
  const busy = subdividing === curriculum.id
  const calls = Math.ceil(missing / SUBDIVIDE_BATCH)

  // Reset the destructive confirm whenever the pane switches goals, or a second
  // click would archive a goal the user never armed.
  useEffect(() => setConfirmReplace(false), [curriculum.id])

  const byDate = useMemo(() => {
    const groups = new Map<string, Topic[]>()
    for (const topic of topics) {
      const key = topic.assignedDate ?? 'unscheduled'
      const list = groups.get(key)
      if (list) list.push(topic)
      else groups.set(key, [topic])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [topics])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-xl border border-line-soft bg-surface/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2.5 text-[20px] font-medium tracking-[-0.02em]">
              <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />
              {curriculum.title}
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-faint">
              Finishes{' '}
              <span className="text-ink-dim">
                {summary.lastDate
                  ? `${labelFor(summary.lastDate).month} ${labelFor(summary.lastDate).dayNum}`
                  : '—'}
              </span>{' '}
              · deadline {deadline.month} {deadline.dayNum} {deadline.year} ·{' '}
              <span className="font-mono text-[11.5px]">{curriculum.model}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <motion.button
              type="button"
              onClick={() => void openReflow(curriculum.id)}
              whileTap={{ scale: 0.96 }}
              disabled={reflowBusy}
              className="rounded-lg border border-line-soft px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-40"
            >
              {reflowBusy ? 'Checking…' : 'Reflow'}
            </motion.button>

            {confirmReplace ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void archive(curriculum.id)}
                  className="rounded-lg bg-amber/20 px-3 py-1.5 text-[12px] text-amber-soft transition-colors hover:bg-amber/30"
                >
                  Archive it
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReplace(false)}
                  className="rounded-lg px-2 py-1.5 text-[12px] text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReplace(true)}
                title="Removes unstarted work from your day cards. Completed work stays."
                className="rounded-lg px-3 py-1.5 text-[12px] text-ink-faint transition-colors hover:text-ink"
              >
                Archive goal
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Topics" value={topics.length} />
          <Stat label="Done" value={done} accent />
          <Stat label="Study days" value={summary.daysUsed} />
          <Stat label="Min / day" value={summary.perDayMinutes} />
        </div>

        {/* The breakdown pass is offered rather than assumed. It runs
            automatically on a new goal, so this is here for goals that predate
            it and for a pass that stopped partway through. */}
        {missing > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line-soft bg-canvas/50 px-3.5 py-2.5">
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-faint">
              {brokenDown === 0 ? (
                <>
                  None of these {topics.length} topics has been broken into
                  learning points yet. The points show under each task on your
                  day cards.
                </>
              ) : (
                <>
                  {brokenDown} of {topics.length} topics have learning points.{' '}
                  {missing} still {missing === 1 ? 'does' : 'do'} not.
                </>
              )}{' '}
              {/* Named up front — 300 topics is 20 calls, and finding that out
                  afterwards is not the moment to learn it. */}
              <span className="text-ink-faint/70">
                About {calls} {calls === 1 ? 'call' : 'calls'} to{' '}
                {PROVIDER_INFO[provider].label}.
              </span>
            </p>

            <motion.button
              type="button"
              onClick={() => void subdivide(curriculum.id)}
              whileTap={{ scale: 0.97 }}
              disabled={busy}
              className="shrink-0 rounded-lg bg-amber/20 px-3 py-1.5 text-[12px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-40"
            >
              {busy
                ? progress?.phase === 'subdividing'
                  ? `Breaking down… ${progress.done}/${progress.total}`
                  : 'Breaking down…'
                : brokenDown === 0
                  ? 'Break into subtopics'
                  : `Break down the other ${missing}`}
            </motion.button>
          </div>
        )}

        {summary.overCapacity && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.snap}
            className="mt-4 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-soft"
          >
            This plan needs about {summary.requiredPerDay} minutes a day to hit
            the deadline, but you set {curriculum.minutesPerDay}. It still fits
            in the calendar — the days are just heavier than you asked for.
          </motion.p>
        )}

        {!summary.overCapacity && summary.bufferDays > 0 && (
          <p className="mt-4 text-[12px] text-ink-faint">
            {summary.bufferDays} study{' '}
            {summary.bufferDays === 1 ? 'day' : 'days'} of slack after the last
            topic.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line-soft bg-surface/40">
        <AnimatedGroup preset="blur-slide" stagger={0.02} className="p-3">
          {byDate.map(([date, group]) => {
            const label = date === 'unscheduled' ? null : labelFor(date)
            return (
              <div key={date} className="mb-1 flex gap-4 px-2 py-1.5">
                <div className="w-[92px] shrink-0 pt-0.5">
                  <div
                    className={cn(
                      'text-[12px] tabular-nums',
                      label?.isToday ? 'text-amber' : 'text-ink-dim'
                    )}
                  >
                    {label ? `${label.month} ${label.dayNum}` : 'Unscheduled'}
                  </div>
                  {label && (
                    <div className="text-[10.5px] text-ink-faint/70">
                      {label.weekday.slice(0, 3)}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  {group.map((topic) => (
                    <div key={topic.id}>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            'mt-1.5 size-1.5 shrink-0 rounded-full',
                            topic.status === 'done'
                              ? 'bg-amber'
                              : topic.status === 'skipped'
                                ? 'bg-line'
                                : 'bg-cat-learn/60'
                          )}
                        />
                        <span
                          className={cn(
                            'text-[13px] leading-5',
                            topic.status === 'done'
                              ? 'text-ink-faint line-through'
                              : 'text-ink-dim'
                          )}
                        >
                          {topic.title}
                        </span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint/60">
                          {topic.estMinutes}m
                        </span>
                      </div>

                      {/* Always open here. The day card collapses these to stay
                          readable; this pane is where you check the breakdown
                          is right before it reaches a day. */}
                      {topic.points.length > 0 && (
                        <ul className="ml-[13px] mt-1 space-y-0.5 border-l border-line-soft pl-2.5">
                          {topic.points.map((point, i) => (
                            <li
                              key={`${i}-${point}`}
                              className="text-[11.5px] leading-snug text-ink-faint"
                            >
                              {point}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </AnimatedGroup>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-canvas/50 px-3 py-2.5">
      <div
        className={cn(
          'text-[22px] font-medium tracking-[-0.02em]',
          accent ? 'text-amber' : 'text-ink'
        )}
      >
        <NumberTicker value={value} />
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </div>
    </div>
  )
}
