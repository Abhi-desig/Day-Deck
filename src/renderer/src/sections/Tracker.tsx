import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { DateKey } from '@shared/date'
import { addDays, labelFor, startOfWeek, todayKey } from '@shared/date'
import type { SlotCategory, TrackerDay, TrackerWeek } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { goalStyle, humanMinutes } from '../lib/goalColor'
import { EASE_OUT, SPRING, STAGGER } from '../lib/motion'
import { NumberTicker } from '../components/magicui/NumberTicker'
import { AnimatedGroup } from '../components/motion-primitives/AnimatedGroup'

/** Bar colours match the category dots used on every slot row. */
const CATEGORY_BAR: Record<SlotCategory, string> = {
  vibe_code: 'bg-cat-vibe',
  amber: 'bg-cat-amber',
  personal_learning: 'bg-cat-learn'
}

const CATEGORIES: SlotCategory[] = ['vibe_code', 'amber', 'personal_learning']

/** Shortest bar that still reads as "something happened here". */
const MIN_BAR_PX = 3
const CHART_H = 168

export function Tracker() {
  const [anchor, setAnchor] = useState<DateKey>(() => todayKey())
  const [week, setWeek] = useState<TrackerWeek | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (at: DateKey) => {
    setLoading(true)
    try {
      setWeek(await api.tracker.week(at))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(anchor)
  }, [anchor, load])

  const thisWeek = startOfWeek(todayKey())
  const isCurrent = week?.weekStart === thisWeek
  // Nothing has been completed in the future, so there is nowhere to go.
  const canGoForward = !!week && week.weekStart < thisWeek

  return (
    <div className="flex min-h-0 flex-1 flex-col px-7 pb-7">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">Tracker</h1>
          <span className="text-[12.5px] text-ink-faint">
            Everything you have finished, by the day you finished it
          </span>
        </div>

        <WeekNav
          weekStart={week?.weekStart ?? thisWeek}
          isCurrent={!!isCurrent}
          canGoForward={canGoForward}
          onPrev={() => setAnchor((a) => addDays(a, -7))}
          onNext={() => setAnchor((a) => addDays(a, 7))}
          onToday={() => setAnchor(todayKey())}
        />
      </header>

      {!week ? (
        <p className="py-8 text-[12.5px] text-ink-faint">Loading…</p>
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 transition-opacity duration-150',
            loading && 'opacity-60'
          )}
        >
          <Summary week={week} />
          <Chart week={week} />
          <Completions week={week} />
        </div>
      )}
    </div>
  )
}

function WeekNav({
  weekStart,
  isCurrent,
  canGoForward,
  onPrev,
  onNext,
  onToday
}: {
  weekStart: DateKey
  isCurrent: boolean
  canGoForward: boolean
  onPrev(): void
  onNext(): void
  onToday(): void
}) {
  const from = labelFor(weekStart)
  const to = labelFor(addDays(weekStart, 6))
  const span =
    from.month === to.month
      ? `${from.month} ${from.dayNum}–${to.dayNum}`
      : `${from.month} ${from.dayNum} – ${to.month} ${to.dayNum}`

  return (
    <div className="flex items-center gap-1 rounded-full border border-line-soft p-1">
      <Arrow direction="prev" onClick={onPrev} />

      <div className="min-w-[128px] px-1 text-center">
        <motion.div
          key={weekStart}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="text-[12.5px] tabular-nums text-ink"
        >
          {span}
        </motion.div>
      </div>

      <Arrow direction="next" onClick={onNext} disabled={!canGoForward} />

      <button
        type="button"
        onClick={onToday}
        disabled={isCurrent}
        className={cn(
          'ml-0.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors',
          isCurrent ? 'text-ink-faint/60' : 'text-amber-soft hover:bg-amber/12'
        )}
      >
        This week
      </button>
    </div>
  )
}

function Arrow({
  direction,
  onClick,
  disabled
}: {
  direction: 'prev' | 'next'
  onClick(): void
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      aria-label={direction === 'prev' ? 'Previous week' : 'Next week'}
      className="grid size-7 place-items-center rounded-full text-ink-dim transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <path
          d={direction === 'prev' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  )
}

function Summary({ week }: { week: TrackerWeek }) {
  const { pace } = week

  return (
    <div className="shrink-0 rounded-xl border border-line-soft bg-surface/70 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Finished" value={week.totalCount} accent />
        {CATEGORIES.map((category) => (
          <Stat
            key={category}
            label={CATEGORY_LABEL[category]}
            value={week.totals[category]}
            dot={CATEGORY_BAR[category]}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-ink-faint">
          {week.totalMinutes > 0
            ? `${humanMinutes(week.totalMinutes)} of planned work completed this week`
            : 'Nothing ticked off this week yet'}
        </span>

        {pace.hasGoals && <Pace pace={week.pace} />}
      </div>
    </div>
  )
}

/**
 * The one number that can be uncomfortable, so it is stated plainly.
 *
 * "Behind" is topics whose day has passed and which are still open — not a
 * score, and not something being early can offset.
 */
function Pace({ pace }: { pace: TrackerWeek['pace'] }) {
  return (
    <motion.span
      key={pace.behind}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px]',
        pace.onPace
          ? 'border-cat-learn/35 bg-cat-learn/10 text-cat-learn'
          : 'border-amber/35 bg-amber/10 text-amber-soft'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          pace.onPace ? 'bg-cat-learn' : 'bg-amber'
        )}
      />
      {pace.onPace
        ? `On pace · ${pace.done} of ${pace.total} topics done`
        : `Behind by ${pace.behind} ${pace.behind === 1 ? 'topic' : 'topics'}`}
    </motion.span>
  )
}

function Stat({
  label,
  value,
  accent,
  dot
}: {
  label: string
  value: number
  accent?: boolean
  dot?: string
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
      <div className="mt-0.5 flex items-center gap-1.5">
        {dot && <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />}
        <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          {label}
        </span>
      </div>
    </div>
  )
}

function Chart({ week }: { week: TrackerWeek }) {
  const reduced = useReducedMotion()

  // Scaled against the busiest day of the week being viewed, so a quiet week
  // still reads as a shape rather than a flat line.
  const peak = useMemo(
    () => Math.max(1, ...week.days.map((d) => d.total)),
    [week]
  )

  return (
    <div className="shrink-0 rounded-xl border border-line-soft bg-surface/40 px-5 pb-4 pt-5">
      <div className="flex items-end gap-2" style={{ height: CHART_H }}>
        {week.days.map((day, i) => (
          <DayBar
            key={day.date}
            day={day}
            peak={peak}
            index={i}
            reduced={!!reduced}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3">
        {CATEGORIES.map((category) => (
          <span
            key={category}
            className="flex items-center gap-1.5 text-[11px] text-ink-faint"
          >
            <span
              className={cn('size-2 rounded-[3px]', CATEGORY_BAR[category])}
            />
            {CATEGORY_LABEL[category]}
            <span className="tabular-nums text-ink-faint/60">
              {humanMinutes(week.minutes[category])}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function DayBar({
  day,
  peak,
  index,
  reduced
}: {
  day: TrackerDay
  peak: number
  index: number
  reduced: boolean
}) {
  const label = labelFor(day.date)
  const height = (day.total / peak) * (CHART_H - 34)

  // Staggered by weekday so the week draws itself left to right — the reason
  // the delay is on the index and not on a list position.
  const transition = reduced
    ? { duration: 0 }
    : { ...SPRING.soft, delay: index * STAGGER.timeline }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div className="flex w-full flex-1 items-end justify-center">
        <motion.div
          className="flex w-full max-w-[54px] flex-col-reverse overflow-hidden rounded-md"
          initial={{ height: 0 }}
          animate={{ height: day.total === 0 ? MIN_BAR_PX : height }}
          transition={transition}
          title={
            day.total === 0
              ? 'Nothing finished'
              : `${day.total} finished · ${humanMinutes(day.totalMinutes)}`
          }
        >
          {day.total === 0 ? (
            <div className="h-full w-full rounded-md bg-line-soft" />
          ) : (
            CATEGORIES.map((category) =>
              day.counts[category] > 0 ? (
                <div
                  key={category}
                  className={cn('w-full', CATEGORY_BAR[category])}
                  style={{ flexGrow: day.counts[category] }}
                />
              ) : null
            )
          )}
        </motion.div>
      </div>

      <div className="text-center">
        <div
          className={cn(
            'text-[11px]',
            label.isToday ? 'text-amber' : 'text-ink-faint'
          )}
        >
          {label.weekday.slice(0, 3)}
        </div>
        <div
          className={cn(
            'text-[11px] tabular-nums',
            day.total > 0 ? 'text-ink-dim' : 'text-ink-faint/40'
          )}
        >
          {day.total}
        </div>
      </div>
    </div>
  )
}

function Completions({ week }: { week: TrackerWeek }) {
  // Newest first, which is the order the query already returns.
  const byDay = useMemo(() => {
    const groups = new Map<DateKey, TrackerWeek['entries']>()
    for (const entry of week.entries) {
      const list = groups.get(entry.doneOn)
      if (list) list.push(entry)
      else groups.set(entry.doneOn, [entry])
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [week])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line-soft bg-surface/40">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={week.weekStart}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {byDay.length === 0 ? (
            <p className="px-5 py-6 text-[12.5px] leading-relaxed text-ink-faint">
              Nothing was completed this week. The Tracker fills itself in as you
              tick things off — there is nothing to write here by hand.
            </p>
          ) : (
            <AnimatedGroup preset="blur-slide" stagger={0.02} className="p-3">
              {byDay.map(([date, entries]) => {
                const label = labelFor(date)
                return (
                  <div key={date} className="mb-1 flex gap-4 px-2 py-1.5">
                    <div className="w-[92px] shrink-0 pt-0.5">
                      <div
                        className={cn(
                          'text-[12px] tabular-nums',
                          label.isToday ? 'text-amber' : 'text-ink-dim'
                        )}
                      >
                        {label.month} {label.dayNum}
                      </div>
                      <div className="text-[10.5px] text-ink-faint/70">
                        {label.weekday.slice(0, 3)}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      {entries.map((entry) => (
                        <div
                          key={entry.slotId}
                          className="flex items-baseline gap-2"
                        >
                          <span
                            className={cn(
                              'mt-1.5 size-1.5 shrink-0 rounded-full',
                              CATEGORY_BAR[entry.category]
                            )}
                          />
                          <span className="min-w-0 truncate text-[13px] leading-5 text-ink-dim">
                            {entry.title}
                          </span>

                          {/* Already denormalised onto the row by the
                              WITH_GOAL join — no second lookup here. */}
                          {entry.sourceLabel && (
                            <span
                              className={cn(
                                'max-w-[150px] shrink-0 truncate rounded-full border px-1.5 py-px text-[10px]',
                                goalStyle(entry.sourceColor).border,
                                goalStyle(entry.sourceColor).text
                              )}
                              title={entry.sourceLabel}
                            >
                              {entry.sourceLabel}
                            </span>
                          )}

                          <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint/60">
                            {entry.durationMin}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </AnimatedGroup>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
