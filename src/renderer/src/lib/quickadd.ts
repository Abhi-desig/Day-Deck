import { parseMinutes } from '@shared/date'

export interface QuickAddParts {
  title: string
  startMin: number | null
  durationMin: number
}

/**
 * Pulls a leading clock time and a trailing duration out of a typed line, so
 * "09:30 Review PRs 45m" becomes a scheduled 45-minute slot without the user
 * touching a single form field.
 *
 * Lives outside the component so React Fast Refresh keeps working — a module
 * that exports both a component and a plain function loses it.
 */
export function parseQuickAdd(raw: string): QuickAddParts {
  let rest = raw.trim()
  let startMin: number | null = null
  let durationMin = 30

  const timeMatch = /^(\d{1,2}:\d{2})\s+/.exec(rest)
  if (timeMatch) {
    const parsed = parseMinutes(timeMatch[1])
    if (parsed !== null) {
      startMin = parsed
      rest = rest.slice(timeMatch[0].length)
    }
  }

  const durationMatch = /\s(\d{1,3})m$/.exec(rest)
  if (durationMatch) {
    durationMin = Math.max(1, Number(durationMatch[1]))
    rest = rest.slice(0, durationMatch.index)
  }

  return { title: rest.trim(), startMin, durationMin }
}
