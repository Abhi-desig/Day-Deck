import type { TagColor, TagOrigin } from '@shared/types'

/**
 * Tailwind scans source text for complete class names, so these are written out
 * rather than interpolated — same reason as lib/goalColor.ts and
 * lib/stickerColor.ts. An interpolated `bg-tag-${color}` compiles to nothing and
 * the chip silently loses its colour.
 */
interface TagStyle {
  dot: string
  text: string
  border: string
  soft: string
  /** Solid fill, for chart segments where the colour *is* the data. */
  bar: string
}

const STYLES: Record<TagColor, TagStyle> = {
  amber: {
    dot: 'bg-tag-amber',
    text: 'text-tag-amber',
    border: 'border-tag-amber/40',
    soft: 'bg-tag-amber/12',
    bar: 'bg-tag-amber'
  },
  violet: {
    dot: 'bg-tag-violet',
    text: 'text-tag-violet',
    border: 'border-tag-violet/40',
    soft: 'bg-tag-violet/12',
    bar: 'bg-tag-violet'
  },
  sky: {
    dot: 'bg-tag-sky',
    text: 'text-tag-sky',
    border: 'border-tag-sky/40',
    soft: 'bg-tag-sky/12',
    bar: 'bg-tag-sky'
  },
  mint: {
    dot: 'bg-tag-mint',
    text: 'text-tag-mint',
    border: 'border-tag-mint/40',
    soft: 'bg-tag-mint/12',
    bar: 'bg-tag-mint'
  },
  rose: {
    dot: 'bg-tag-rose',
    text: 'text-tag-rose',
    border: 'border-tag-rose/40',
    soft: 'bg-tag-rose/12',
    bar: 'bg-tag-rose'
  },
  coral: {
    dot: 'bg-tag-coral',
    text: 'text-tag-coral',
    border: 'border-tag-coral/40',
    soft: 'bg-tag-coral/12',
    bar: 'bg-tag-coral'
  },
  lime: {
    dot: 'bg-tag-lime',
    text: 'text-tag-lime',
    border: 'border-tag-lime/40',
    soft: 'bg-tag-lime/12',
    bar: 'bg-tag-lime'
  },
  cyan: {
    dot: 'bg-tag-cyan',
    text: 'text-tag-cyan',
    border: 'border-tag-cyan/40',
    soft: 'bg-tag-cyan/12',
    bar: 'bg-tag-cyan'
  }
}

export function tagStyle(color: TagColor | null | undefined): TagStyle {
  return STYLES[color ?? 'amber'] ?? STYLES.amber
}

/** Work carrying no tag at all, as a chart segment. Neutral, never a hue. */
export const UNTAGGED_BAR = 'bg-line'

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

export const weekdayName = (n: number): string => WEEKDAYS[n] ?? 'Friday'

/**
 * Why a tag is on a task, in words.
 *
 * The derivation is the whole reason `origin` and `matched` are stored rather
 * than recomputed: a tag that appeared on its own needs to be able to say so,
 * or the automatic filing reads as the app guessing.
 */
export function derivation(origin: TagOrigin, matched: string | null): string {
  if (origin === 'manual') return 'added by hand'
  if (origin === 'typed') return 'typed as #tag'
  return matched ? `matched “${matched}”` : 'matched automatically'
}
