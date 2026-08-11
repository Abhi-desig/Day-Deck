import { motion } from 'motion/react'
import { labelFor } from '@shared/date'
import type { CurriculumPlan } from '@shared/types'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'

interface GoalListProps {
  plans: CurriculumPlan[]
  selectedId: string | null
  composing: boolean
  onSelect(id: string): void
  onNew(): void
}

export function GoalList({
  plans,
  selectedId,
  composing,
  onSelect,
  onNew
}: GoalListProps) {
  return (
    <div className="flex w-[228px] shrink-0 flex-col gap-1.5">
      {plans.map((plan) => (
        <GoalRow
          key={plan.curriculum.id}
          plan={plan}
          active={!composing && plan.curriculum.id === selectedId}
          onSelect={() => onSelect(plan.curriculum.id)}
        />
      ))}

      <motion.button
        type="button"
        onClick={onNew}
        whileTap={{ scale: 0.98 }}
        className={cn(
          'rounded-xl border border-dashed px-3 py-2.5 text-left text-[12.5px] transition-colors',
          composing
            ? 'border-amber/40 text-amber-soft'
            : 'border-line text-ink-faint hover:border-line hover:text-ink-dim'
        )}
      >
        + New goal
      </motion.button>

      {plans.length === 0 && !composing && (
        <p className="px-1 pt-2 text-[11.5px] leading-relaxed text-ink-faint/70">
          Paste a curriculum and Day Deck turns it into dated work on your day
          cards.
        </p>
      )}
    </div>
  )
}

function GoalRow({
  plan,
  active,
  onSelect
}: {
  plan: CurriculumPlan
  active: boolean
  onSelect(): void
}) {
  const { curriculum, topics, summary } = plan
  const style = goalStyle(curriculum.color)

  const done = topics.filter((t) => t.status === 'done').length
  const progress = topics.length === 0 ? 0 : done / topics.length
  const deadline = labelFor(curriculum.deadline)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className="relative rounded-xl px-3 py-2.5 text-left transition-colors"
    >
      {active && (
        <motion.span
          layoutId="goal-selection"
          transition={SPRING.snap}
          className="absolute inset-0 rounded-xl border border-line bg-raised"
        />
      )}

      <span className="relative block">
        <span className="flex items-center gap-2">
          <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px] tracking-[-0.005em]',
              active ? 'text-ink' : 'text-ink-dim'
            )}
          >
            {curriculum.title}
          </span>
        </span>

        <span className="mt-1.5 block pl-[14px]">
          <span className="flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas/80">
              <motion.span
                className={cn('block h-full rounded-full', style.bar)}
                initial={false}
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={SPRING.soft}
              />
            </span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
              {done}/{topics.length}
            </span>
          </span>

          <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-faint/80">
            <span className="tabular-nums">
              {curriculum.minutesPerDay}m/day
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              by {deadline.month} {deadline.dayNum}
            </span>
            {summary.overCapacity && (
              <span className="text-amber-soft" title="Needs more time per day">
                ⚠
              </span>
            )}
          </span>
        </span>
      </span>
    </button>
  )
}
