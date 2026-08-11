import type { GoalColor } from '@shared/types'

/**
 * Tailwind scans source text for complete class names, so these have to be
 * written out rather than built as `bg-goal-${color}` at runtime — an
 * interpolated name compiles to nothing and the dot silently disappears.
 */
interface GoalStyle {
  dot: string
  text: string
  border: string
  soft: string
  bar: string
}

const STYLES: Record<GoalColor, GoalStyle> = {
  amber: {
    dot: 'bg-goal-amber',
    text: 'text-goal-amber',
    border: 'border-goal-amber/40',
    soft: 'bg-goal-amber/12',
    bar: 'bg-goal-amber/70'
  },
  violet: {
    dot: 'bg-goal-violet',
    text: 'text-goal-violet',
    border: 'border-goal-violet/40',
    soft: 'bg-goal-violet/12',
    bar: 'bg-goal-violet/70'
  },
  sky: {
    dot: 'bg-goal-sky',
    text: 'text-goal-sky',
    border: 'border-goal-sky/40',
    soft: 'bg-goal-sky/12',
    bar: 'bg-goal-sky/70'
  },
  mint: {
    dot: 'bg-goal-mint',
    text: 'text-goal-mint',
    border: 'border-goal-mint/40',
    soft: 'bg-goal-mint/12',
    bar: 'bg-goal-mint/70'
  },
  rose: {
    dot: 'bg-goal-rose',
    text: 'text-goal-rose',
    border: 'border-goal-rose/40',
    soft: 'bg-goal-rose/12',
    bar: 'bg-goal-rose/70'
  }
}

export function goalStyle(color: GoalColor | null | undefined): GoalStyle {
  return STYLES[color ?? 'amber'] ?? STYLES.amber
}

/** "2h 15m" — used anywhere a minute total is shown to a person. */
export function humanMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = Math.round(total % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
