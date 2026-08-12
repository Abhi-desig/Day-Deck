import { parseMinutes } from '@shared/date'
import { extractTypedTags } from '@shared/tag-match'

export interface QuickAddParts {
  title: string
  startMin: number | null
  durationMin: number
  /** Slugs typed as `#tag`, already stripped out of the title. */
  tagSlugs: string[]
}

/**
 * Pulls a leading clock time, a trailing duration and any `#tag` tokens out of
 * a typed line, so "09:30 Review #amber PRs 45m" becomes a scheduled
 * 45-minute slot filed under amber without the user touching a form field.
 *
 * Order matters. Tags come out first, because a token sitting between the time
 * and the duration would otherwise leave stray whitespace that the trailing
 * `\s(\d+)m$` match no longer sees — "Ship it #amber 45m" would keep its "45m"
 * in the title and default to thirty minutes.
 *
 * Lives outside the component so React Fast Refresh keeps working — a module
 * that exports both a component and a plain function loses it.
 */
export function parseQuickAdd(raw: string): QuickAddParts {
  const { text, slugs } = extractTypedTags(raw)

  let rest = text
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

  return { title: rest.trim(), startMin, durationMin, tagSlugs: slugs }
}
