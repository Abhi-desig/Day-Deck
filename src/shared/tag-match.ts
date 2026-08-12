import type { Tag } from './types'

/**
 * Deciding which tags a piece of text belongs to.
 *
 * Pure, and shared by both processes on purpose: main runs it on every write so
 * the stored attachment is authoritative, and the renderer runs the same code
 * to preview what a title *would* match while it is still being typed. Two
 * implementations of "does this count as amber work" would disagree eventually,
 * and the disagreement would show up as a task landing in a different box than
 * the one the quick-add bar promised.
 */

/** Everything that is not a letter or a digit separates words. */
const SEPARATORS = /[^a-z0-9]+/g

/**
 * Lowercase, strip punctuation to single spaces, and pad with one space at each
 * end.
 *
 * The padding is what makes a plain `includes` a word-boundary match: searching
 * for `" amber "` inside `" amber automation "` hits, and inside `" chamber "`
 * it does not. Doing it this way rather than with a per-keyword RegExp means no
 * escaping of user input and no regex compiled per title per tag.
 */
export function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(SEPARATORS, ' ').trim()} `
}

/** `"Amber Automation"` -> `"amber-automation"`. Stable and idempotent. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(SEPARATORS, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The terms a tag answers to.
 *
 * Its own label and slug are always among them, which is what makes a tag work
 * the moment it is created: naming one "Amber" is enough for "amber automation"
 * to file itself there, with no keyword list to fill in first. Explicit keywords
 * are for the words that are *not* the name — "ambr", "student housing", a
 * client's initials.
 */
export function termsFor(tag: Pick<Tag, 'label' | 'slug' | 'keywords'>): string[] {
  const seen = new Set<string>()
  const terms: string[] = []

  for (const raw of [tag.label, tag.slug, ...tag.keywords]) {
    const term = normalise(raw).trim()
    // A keyword that normalises to nothing would pad out to `" "`, which is
    // inside every non-empty title — it would silently tag the whole app.
    if (!term || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }

  return terms
}

export interface TagMatch {
  tagId: string
  /** The term that hit, kept so the UI can say *why* the tag is there. */
  matched: string
}

/**
 * Which tags a title files itself under, and on what word.
 *
 * The first matching term per tag wins; a title that contains two of a tag's
 * keywords is still one attachment, and reporting the earliest-declared term
 * keeps the derivation stable when the keyword list is reordered.
 */
export function matchTags(
  title: string,
  tags: ReadonlyArray<Pick<Tag, 'id' | 'label' | 'slug' | 'keywords'>>
): TagMatch[] {
  const haystack = normalise(title)
  if (haystack.trim() === '') return []

  const matches: TagMatch[] = []
  for (const tag of tags) {
    const hit = termsFor(tag).find((term) => haystack.includes(` ${term} `))
    if (hit) matches.push({ tagId: tag.id, matched: hit })
  }
  return matches
}

/**
 * `#slug` tokens anywhere in a typed line.
 *
 * Anchored to a word boundary so a `#` inside a word — `C#`, `issue#4` — is not
 * read as a tag. Tokens are pulled out of the title rather than left in it: the
 * tag is the metadata, and leaving `#amber` in the task's name means reading it
 * twice on every card.
 */
const TAG_TOKEN = /(?:^|\s)#([a-zA-Z0-9][a-zA-Z0-9_-]*)/g

export interface TypedTags {
  /** The line with its tokens removed and whitespace tidied. */
  text: string
  /** Slugs, lowercased and de-duplicated, in the order they were typed. */
  slugs: string[]
}

export function extractTypedTags(raw: string): TypedTags {
  const slugs: string[] = []
  const seen = new Set<string>()

  const text = raw
    .replace(TAG_TOKEN, (_match, token: string) => {
      const slug = slugify(token)
      if (slug && !seen.has(slug)) {
        seen.add(slug)
        slugs.push(slug)
      }
      // One space, not none: `"ship #amber deck"` must not become `"shipdeck"`.
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()

  return { text, slugs }
}
