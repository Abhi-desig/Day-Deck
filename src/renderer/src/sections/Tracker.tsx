import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { DateKey } from '@shared/date'
import { addDays, labelFor, startOfWeek, todayKey } from '@shared/date'
import type { SlotCategory, TrackerDay, TrackerWeek } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { goalStyle, humanMinutes } from '../lib/goalColor'
import { derivation, tagStyle, UNTAGGED_BAR, weekdayName } from '../lib/tagColor'
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

/**
 * What the bars are cut by.
 *
 * Two segmentations of the same bars, never two charts. A day's height is its
 * completion count either way — only the division inside it changes — so
 * switching is a re-colour rather than a re-measure, and the shape of the week
 * stays comparable across both.
 */
type Segmentation = 'category' | 'tag'

interface Segment {
  key: string
  label: string
  /** A solid fill class. The colour *is* the data here. */
  className: string
  value: number
  minutes: number
}

/**
 * One day's bar, cut whichever way is being asked for.
 *
 * In tag mode the segment values deliberately do not sum to `day.total`: work
 * carrying two tags is counted under both. Segments are laid out with
 * `flexGrow`, which normalises against their own sum, so the bar keeps the
 * height its count earned and the tags divide it proportionally.
 */
function segmentsFor(
  day: TrackerDay,
  week: TrackerWeek,
  mode: Segmentation
): Segment[] {
  if (mode === 'category') {
    return CATEGORIES.filter((c) => day.counts[c] > 0).map((c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      className: CATEGORY_BAR[c],
      value: day.counts[c],
      minutes: day.minutes[c]
    }))
  }

  const segments: Segment[] = week.tags
    .filter((tag) => (day.tagCounts[tag.id] ?? 0) > 0)
    .map((tag) => ({
      key: tag.id,
      label: tag.label,
      className: tagStyle(tag.color).bar,
      value: day.tagCounts[tag.id],
      minutes: day.tagMinutes[tag.id] ?? 0
    }))

  // Untagged work last and in a neutral grey, so it reads as the remainder
  // rather than as one more category competing for attention.
  if (day.untagged > 0) {
    segments.push({
      key: '__untagged',
      label: 'Untagged',
      className: UNTAGGED_BAR,
      value: day.untagged,
      minutes: day.untaggedMinutes
    })
  }

  return segments
}

export function Tracker() {
  const [anchor, setAnchor] = useState<DateKey>(() => todayKey())
  const [week, setWeek] = useState<TrackerWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Segmentation>('category')

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
        // Scrolls as one column rather than giving the completions list its own
        // scroller: with the cutoff panels in play the page is taller than the
        // viewport on any week with open work, and a nested scroll area inside
        // a short page is the worst of both.
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 transition-opacity duration-150',
            loading && 'opacity-60'
          )}
        >
          <Summary week={week} />
          <Chart week={week} mode={mode} onMode={setMode} />
          <Cutoffs week={week} />
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

function Chart({
  week,
  mode,
  onMode
}: {
  week: TrackerWeek
  mode: Segmentation
  onMode(mode: Segmentation): void
}) {
  const reduced = useReducedMotion()

  // Scaled against the busiest day of the week being viewed, so a quiet week
  // still reads as a shape rather than a flat line.
  const peak = useMemo(
    () => Math.max(1, ...week.days.map((d) => d.total)),
    [week]
  )

  // Only tags that actually appear this week, plus the untagged remainder if
  // there is one. A legend listing every tag ever created is a wall of zeroes
  // — the *chart* legend answers "what is in this picture", while the cutoff
  // panel below is where a tag with nothing in it still has to show up.
  const legend: Segment[] = useMemo(() => {
    if (mode === 'category') {
      return CATEGORIES.map((c) => ({
        key: c,
        label: CATEGORY_LABEL[c],
        className: CATEGORY_BAR[c],
        value: week.totals[c],
        minutes: week.minutes[c]
      }))
    }

    const items: Segment[] = week.tags
      .filter((tag) => (week.tagTotals[tag.id] ?? 0) > 0)
      .map((tag) => ({
        key: tag.id,
        label: tag.label,
        className: tagStyle(tag.color).bar,
        value: week.tagTotals[tag.id],
        minutes: week.tagMinutes[tag.id] ?? 0
      }))

    if (week.untaggedTotal > 0) {
      items.push({
        key: '__untagged',
        label: 'Untagged',
        className: UNTAGGED_BAR,
        value: week.untaggedTotal,
        minutes: week.untaggedMinutes
      })
    }

    return items
  }, [week, mode])

  return (
    <div className="shrink-0 rounded-xl border border-line-soft bg-surface/40 px-5 pb-4 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          Finished per day
        </span>
        <SegmentToggle mode={mode} onMode={onMode} hasTags={week.tags.length > 0} />
      </div>

      <div className="flex items-end gap-2" style={{ height: CHART_H }}>
        {week.days.map((day, i) => (
          <DayBar
            key={day.date}
            day={day}
            week={week}
            mode={mode}
            peak={peak}
            index={i}
            reduced={!!reduced}
          />
        ))}
      </div>

      <div className="mt-3 flex min-h-[18px] flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3">
        {legend.length === 0 ? (
          <span className="text-[11px] text-ink-faint/60">
            Nothing finished this week to break down.
          </span>
        ) : (
          legend.map((item) => (
            <span
              key={item.key}
              className="flex items-center gap-1.5 text-[11px] text-ink-faint"
            >
              <span className={cn('size-2 rounded-[3px]', item.className)} />
              {item.label}
              <span className="tabular-nums text-ink-faint/60">
                {humanMinutes(item.minutes)}
              </span>
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function SegmentToggle({
  mode,
  onMode,
  hasTags
}: {
  mode: Segmentation
  onMode(mode: Segmentation): void
  hasTags: boolean
}) {
  const options: Array<{ id: Segmentation; label: string }> = [
    { id: 'category', label: 'Category' },
    { id: 'tag', label: 'Tag' }
  ]

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-line-soft p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onMode(option.id)}
          // Nothing to segment by is not the same as a broken button: the tag
          // view of a database with no tags is an empty chart, so it says so
          // instead of showing one.
          disabled={option.id === 'tag' && !hasTags}
          title={
            option.id === 'tag' && !hasTags
              ? 'No tags yet — add one from the Today tab'
              : undefined
          }
          aria-pressed={mode === option.id}
          className={cn(
            'relative rounded-full px-2.5 py-1 text-[11px] transition-colors',
            'disabled:pointer-events-none disabled:opacity-35',
            mode === option.id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
          )}
        >
          {mode === option.id && (
            <motion.span
              layoutId="tracker-segmentation"
              transition={SPRING.snap}
              className="absolute inset-0 rounded-full bg-raised"
            />
          )}
          <span className="relative">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function DayBar({
  day,
  week,
  mode,
  peak,
  index,
  reduced
}: {
  day: TrackerDay
  week: TrackerWeek
  mode: Segmentation
  peak: number
  index: number
  reduced: boolean
}) {
  const label = labelFor(day.date)
  const height = (day.total / peak) * (CHART_H - 34)
  const segments = segmentsFor(day, week, mode)

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
          {segments.length === 0 ? (
            <div className="h-full w-full rounded-md bg-line-soft" />
          ) : (
            segments.map((segment) => (
              <motion.div
                key={segment.key}
                // `layout` so re-cutting the same bar animates the boundaries
                // moving rather than cutting to a new arrangement.
                layout={!reduced}
                transition={reduced ? { duration: 0 } : SPRING.soft}
                className={cn('w-full', segment.className)}
                style={{ flexGrow: segment.value }}
                title={`${segment.label} · ${segment.value} · ${humanMinutes(segment.minutes)}`}
              />
            ))
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

/**
 * Each tag against its own weekly cutoff.
 *
 * The one place in the Tracker that looks at unfinished work. Everywhere else
 * is a record of what happened; this answers "will it be done by Friday", which
 * cannot be said without counting what is still open.
 */
function Cutoffs({ week }: { week: TrackerWeek }) {
  const byId = useMemo(
    () => new Map(week.tags.map((t) => [t.id, t])),
    [week.tags]
  )

  if (week.tagDue.length === 0) return null

  return (
    <div className="shrink-0 space-y-2">
      {week.tagDue.map((due) => {
        const tag = byId.get(due.tagId)
        if (!tag) return null

        const style = tagStyle(tag.color)
        const label = labelFor(due.dueDate)
        const clear = due.open === 0

        return (
          <div
            key={due.tagId}
            className={cn(
              'rounded-xl border bg-surface/40 px-4 py-3',
              due.missed ? 'border-amber/35 bg-amber/5' : 'border-line-soft'
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', style.dot)} />
                <span className={cn('text-[13px]', style.text)}>{tag.label}</span>
              </span>

              <span className="text-[11.5px] text-ink-faint">
                by {weekdayName(tag.dueWeekday ?? 5)} EOD · {label.month}{' '}
                {label.dayNum}
              </span>

              <span className="flex-1" />

              <span className="text-[12px] tabular-nums text-ink-dim">
                <span className="text-ink">{due.done}</span> done
                {due.doneMinutes > 0 && (
                  <span className="text-ink-faint">
                    {' '}
                    · {humanMinutes(due.doneMinutes)}
                  </span>
                )}
              </span>

              <span
                className={cn(
                  'rounded-full border px-2 py-px text-[11px]',
                  clear
                    ? 'border-cat-learn/35 bg-cat-learn/10 text-cat-learn'
                    : due.missed
                      ? 'border-amber/40 bg-amber/12 text-amber-soft'
                      : 'border-line-soft text-ink-dim'
                )}
              >
                {clear
                  ? due.missed
                    ? 'cleared'
                    : 'nothing left'
                  : due.missed
                    ? `${due.open} missed the cutoff`
                    : `${due.open} still to do`}
              </span>
            </div>

            {due.open > 0 && (
              <ul className="mt-2 space-y-1 border-t border-line-soft pt-2">
                {due.openItems.map((item) => {
                  const on = labelFor(item.date)
                  return (
                    <li
                      key={item.slotId}
                      className="flex items-baseline gap-2 text-[12.5px]"
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          CATEGORY_BAR[item.category]
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink-dim">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-faint/70">
                        {on.weekday.slice(0, 3)} · {item.durationMin}m
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface DayGroup {
  date: DateKey
  count: number
  minutes: number
  /** Categories in `CATEGORIES` order, so the sequence is the same every day. */
  categories: { category: SlotCategory; entries: TrackerWeek['entries'] }[]
}

function Completions({ week }: { week: TrackerWeek }) {
  /*
   * Day, then category.
   *
   * Two levels rather than one because a flat day is only readable while it is
   * short: five finished things in a row is a wall, and the one question the
   * diary gets asked — "what did I actually spend Wednesday on" — is a question
   * about categories. Category order comes from the fixed CATEGORIES array
   * rather than from whatever finished first, so the eye can travel down the
   * week and find the same band in the same place.
   */
  const byDay = useMemo<DayGroup[]>(() => {
    const days = new Map<DateKey, TrackerWeek['entries']>()
    for (const entry of week.entries) {
      const list = days.get(entry.doneOn)
      if (list) list.push(entry)
      else days.set(entry.doneOn, [entry])
    }

    return [...days.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entries]) => ({
        date,
        count: entries.length,
        minutes: entries.reduce((sum, e) => sum + e.durationMin, 0),
        categories: CATEGORIES.flatMap((category) => {
          const inCategory = entries.filter((e) => e.category === category)
          return inCategory.length ? [{ category, entries: inCategory }] : []
        })
      }))
  }, [week])

  return (
    <div className="shrink-0 rounded-xl border border-line-soft bg-surface/40">
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
            <AnimatedGroup
              preset="blur-slide"
              stagger={0.02}
              className="divide-y divide-line-soft/60"
            >
              {byDay.map((day) => (
                <Day key={day.date} day={day} />
              ))}
            </AnimatedGroup>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/**
 * One finished day.
 *
 * The date gets a line of its own rather than a left-hand column. The column
 * was costing 92px on every row to say something that changes once per day, and
 * it forced the tasks into whatever width was left — which is why nothing below
 * it ever lined up.
 */
function Day({ day }: { day: DayGroup }) {
  const label = labelFor(day.date)

  return (
    <section className="px-4 py-3">
      <header className="flex items-baseline gap-2 pb-2">
        <h3
          className={cn(
            'text-[12.5px] tabular-nums',
            label.isToday ? 'text-amber' : 'text-ink'
          )}
        >
          {label.month} {label.dayNum}
        </h3>
        <span className="text-[11.5px] text-ink-faint">{label.weekday}</span>
        <span className="flex-1" />
        <span className="text-[11.5px] tabular-nums text-ink-faint">
          {day.count} done · {humanMinutes(day.minutes)}
        </span>
      </header>

      <div className="space-y-2.5">
        {day.categories.map((group) => (
          <div key={group.category}>
            <div className="flex items-center gap-1.5 pb-1">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  CATEGORY_BAR[group.category]
                )}
              />
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                {CATEGORY_LABEL[group.category]}
              </span>
              <span className="text-[10.5px] tabular-nums text-ink-faint/60">
                {group.entries.length}
              </span>
            </div>

            <ul>
              {group.entries.map((entry) => (
                <CompletionRow key={entry.slotId} entry={entry} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * One finished thing.
 *
 * The title takes the slack and the duration is pushed into its own right-hand
 * column, so durations line up down the whole week instead of floating along
 * behind however many chips a row happens to carry.
 *
 * The two chip families are deliberately drawn differently. A goal and a tag
 * are different questions — which plan is this, and what is it filed under —
 * and they were both outlined chips in the same amber, so "Creative
 * Technologist" and "Amber" read as the same kind of thing. The goal is filled,
 * the tag stays outlined.
 */
function CompletionRow({ entry }: { entry: TrackerWeek['entries'][number] }) {
  return (
    <li className="flex items-center gap-2 py-[3px] pl-3">
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-dim">
        {entry.title}
      </span>

      {/* Already denormalised onto the row by the WITH_GOAL join — no second
          lookup here. */}
      {entry.sourceLabel && (
        <span
          className={cn(
            'max-w-[170px] shrink-0 truncate rounded-full px-1.5 py-px text-[10px]',
            goalStyle(entry.sourceColor).soft,
            goalStyle(entry.sourceColor).text
          )}
          title={entry.sourceLabel}
        >
          {entry.sourceLabel}
        </span>
      )}

      {/* The derivation rides along on the title attribute so the diary can
          answer "why is this in the amber box" without a second click. */}
      {entry.tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            'shrink-0 rounded-full border px-1.5 py-px text-[10px]',
            tagStyle(tag.color).border,
            tagStyle(tag.color).text
          )}
          title={`${tag.label} — ${derivation(tag.origin, tag.matched)}`}
        >
          {tag.label}
        </span>
      ))}

      <span className="w-[42px] shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint/70">
        {entry.durationMin}m
      </span>
    </li>
  )
}
