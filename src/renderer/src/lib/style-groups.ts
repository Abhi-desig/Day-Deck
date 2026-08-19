import {
  STYLE_CATEGORIES,
  type StyleCategory,
  type VideoStyle
} from '@shared/types'

/**
 * The style library, filed into families.
 *
 * Pure and outside the component on purpose — the `board-graph.ts` precedent.
 * Grouping logic that lives inside JSX is invisible to a node-only test suite,
 * and this is exactly the kind of thing that regresses quietly: a style filed
 * under a category nobody defined simply stops being rendered, and nothing says
 * so.
 */

export interface StyleGroup {
  /** `''` is uncategorised, which is a real group rather than a gap. */
  id: StyleCategory | ''
  label: string
  hint: string
  styles: VideoStyle[]
}

/** The trailing group. Not hidden, and never silently filed under the first. */
const UNCATEGORISED = {
  id: '' as const,
  label: 'Uncategorised',
  hint: 'Everything you have written yourself, until you file it'
}

/**
 * Group and filter, in the order `STYLE_CATEGORIES` declares.
 *
 * Order comes from the list in code rather than from whatever strings happen to
 * be in rows, so which family reads first is a decision someone made once.
 * Empty groups are dropped — a heading over nothing is noise, and with a filter
 * applied it would be most of the panel.
 *
 * Within a group the caller's order is preserved, which is `sort_index,
 * created_at` from the query.
 */
export function groupStyles(
  styles: readonly VideoStyle[],
  filter = ''
): StyleGroup[] {
  const needle = filter.trim().toLowerCase()
  const matching = needle ? styles.filter((s) => matches(s, needle)) : styles

  const buckets = new Map<string, VideoStyle[]>()
  for (const style of matching) {
    // A category this build does not know is uncategorised rather than its own
    // orphan group. The DB layer already reads unknown values back as `''`;
    // this is the same rule stated where the grouping happens, so a style can
    // never fall out of the panel entirely.
    const key = STYLE_CATEGORIES.some((c) => c.id === style.category)
      ? style.category
      : ''
    const bucket = buckets.get(key)
    if (bucket) bucket.push(style)
    else buckets.set(key, [style])
  }

  const groups: StyleGroup[] = []
  for (const category of STYLE_CATEGORIES) {
    const found = buckets.get(category.id)
    if (found?.length) {
      groups.push({
        id: category.id,
        label: category.label,
        hint: category.hint,
        styles: found
      })
    }
  }

  const loose = buckets.get('')
  if (loose?.length) groups.push({ ...UNCATEGORISED, styles: loose })

  return groups
}

/**
 * What the filter searches.
 *
 * The name first, but not only the name: people look for a look by what it does
 * — "anamorphic", "500T", "handheld" — far more often than by the name someone
 * gave it, and a filter that only matched names would send them back to
 * scrolling.
 */
function matches(style: VideoStyle, needle: string): boolean {
  return [
    style.name,
    style.videoStyle,
    style.camera,
    style.lens,
    style.grade,
    style.lighting,
    style.filmStock,
    style.aspect,
    style.sourceText
  ].some((value) => value.toLowerCase().includes(needle))
}
