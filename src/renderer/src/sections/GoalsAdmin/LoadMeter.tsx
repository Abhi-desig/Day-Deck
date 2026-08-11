import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { GoalsOverview } from '@shared/types'
import { cn } from '../../lib/cn'
import { goalStyle, humanMinutes } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'

/**
 * The one number no single goal can work out for itself.
 *
 * Each goal schedules exactly against its own slice of the day, which is what
 * makes its deadline trustworthy — and is also how you end up with three plans
 * quietly promising more hours a day than exist. This states the total out loud.
 * It never blocks anything: which goal to cut is the user's call.
 */
export function LoadMeter({
  overview,
  onSetCap
}: {
  overview: GoalsOverview
  onSetCap(minutes: number): void
}) {
  const { plans, dailyCapMinutes, committedMinutes, overCap } = overview
  const [draft, setDraft] = useState(String(dailyCapMinutes))

  // The cap can change from elsewhere (another pane, a fresh load), so the
  // field follows the store unless the user is mid-edit.
  useEffect(() => setDraft(String(dailyCapMinutes)), [dailyCapMinutes])

  if (plans.length === 0) return null

  // Bars are drawn against whichever is larger, so an overrun is visible as
  // bars that run past the cap marker rather than silently clipping.
  const scale = Math.max(committedMinutes, dailyCapMinutes) || 1
  const capPercent = (dailyCapMinutes / scale) * 100

  function commit() {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 1440) {
      setDraft(String(dailyCapMinutes))
      return
    }
    onSetCap(Math.round(parsed))
  }

  return (
    <div className="rounded-xl border border-line-soft bg-surface/50 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Daily load
        </span>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-[12.5px] tabular-nums',
              overCap ? 'text-amber-soft' : 'text-ink-dim'
            )}
          >
            {humanMinutes(committedMinutes)} committed
          </span>
          <span className="text-[12.5px] text-ink-faint/60">of</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label="Daily study cap in minutes"
            className="w-[52px] rounded border border-line-soft bg-canvas/60 px-1.5 py-0.5 text-center text-[12.5px] tabular-nums outline-none transition-colors focus:border-line"
          />
          <span className="text-[12.5px] text-ink-faint">min/day</span>
        </div>
      </div>

      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-canvas/70">
        <div className="flex h-full w-full">
          {plans.map((plan) => (
            <motion.div
              key={plan.curriculum.id}
              className={cn('h-full', goalStyle(plan.curriculum.color).bar)}
              initial={false}
              animate={{
                width: `${(plan.curriculum.minutesPerDay / scale) * 100}%`
              }}
              transition={SPRING.soft}
            />
          ))}
        </div>

        {/* Where the day runs out. */}
        {capPercent < 100 && (
          <span
            className="absolute inset-y-0 w-px bg-ink/70"
            style={{ left: `${capPercent}%` }}
            aria-hidden
          />
        )}
      </div>

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
        {overCap ? (
          <span className="text-amber-soft">
            Your goals want {humanMinutes(committedMinutes)} a day — that&apos;s{' '}
            {humanMinutes(committedMinutes - dailyCapMinutes)} more than you said
            you had. Every deadline below is still arithmetically correct; they
            just can&apos;t all be true at once.
          </span>
        ) : (
          `${humanMinutes(dailyCapMinutes - committedMinutes)} a day still unspoken for.`
        )}
      </p>
    </div>
  )
}
