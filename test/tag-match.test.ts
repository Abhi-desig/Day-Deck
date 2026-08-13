import { describe, expect, it } from 'vitest'
import {
  extractTypedTags,
  matchTags,
  normalise,
  slugify,
  termsFor
} from '../src/shared/tag-match'
import type { Tag } from '../src/shared/types'

/** Only the fields the matcher reads. */
const tag = (
  label: string,
  keywords: string[] = [],
  id = label.toLowerCase()
): Pick<Tag, 'id' | 'label' | 'slug' | 'keywords'> => ({
  id,
  label,
  slug: slugify(label),
  keywords
})

const AMBER = tag('Amber', ['amberstudent', 'amber student'], 'seed-tag-amber')

describe('normalise', () => {
  it('pads so a plain includes is a word-boundary match', () => {
    expect(normalise('Amber Automation')).toBe(' amber automation ')
  })

  it('collapses punctuation to single spaces', () => {
    expect(normalise('amber--automation, now!')).toBe(' amber automation now ')
  })

  it('leaves an empty string as a single space', () => {
    expect(normalise('')).toBe('  ')
  })
})

describe('slugify', () => {
  it('turns a label into a slug', () => {
    expect(slugify('Amber Automation')).toBe('amber-automation')
  })

  it('is idempotent, so re-slugifying a slug is a no-op', () => {
    expect(slugify(slugify('Amber Automation'))).toBe('amber-automation')
  })

  it('strips leading and trailing separators', () => {
    expect(slugify('  #Amber!  ')).toBe('amber')
  })
})

describe('termsFor', () => {
  it('answers to its own label and slug without any keywords', () => {
    expect(termsFor(tag('Shaders'))).toEqual(['shaders'])
  })

  /**
   * The slug never contributes a term of its own. `slugify` turns separators
   * into `-` and `normalise` turns them back into spaces, so a slug always
   * normalises to exactly its label — and the de-duplication collapses the two.
   * Worth pinning: it means a multi-word tag matches the words, not the hyphens.
   */
  it('collapses the slug into the label', () => {
    expect(termsFor(tag('Amber Automation'))).toEqual(['amber automation'])
    expect(matchTags('the amber automation pass', [tag('Amber Automation')]))
      .toHaveLength(1)
  })

  /**
   * A keyword that normalises to nothing would pad out to `" "`, which is
   * inside every non-empty title — it would silently tag the whole app.
   */
  it('drops keywords that normalise to nothing', () => {
    expect(termsFor(tag('Amber', ['', '   ', '!!!', 'ambr']))).toEqual([
      'amber',
      'ambr'
    ])
  })

  it('de-duplicates', () => {
    expect(termsFor(tag('Amber', ['amber', 'Amber']))).toEqual(['amber'])
  })
})

describe('matchTags', () => {
  it('files a title that merely contains the tag name', () => {
    expect(matchTags('Amber automation pass', [AMBER])).toEqual([
      { tagId: 'seed-tag-amber', matched: 'amber' }
    ])
  })

  it('is case-insensitive', () => {
    expect(matchTags('amber student onboarding copy', [AMBER])).toHaveLength(1)
  })

  /** The padding is the whole reason `includes` is safe here. */
  it('does not match a tag name buried inside a longer word', () => {
    expect(matchTags('Reseal the chamber door', [AMBER])).toEqual([])
    expect(matchTags('Ambergris research', [AMBER])).toEqual([])
  })

  it('matches on an explicit keyword and reports which one hit', () => {
    const shaders = tag('Shaders', ['glsl', 'fragment'])
    expect(matchTags('Write a GLSL fragment shader', [shaders])).toEqual([
      { tagId: 'shaders', matched: 'glsl' }
    ])
  })

  /** Two of a tag's terms in one title is still one attachment. */
  it('reports the earliest-declared term when several hit', () => {
    const shaders = tag('Shaders', ['glsl', 'fragment'])
    const matches = matchTags('fragment glsl shaders', [shaders])
    expect(matches).toHaveLength(1)
    expect(matches[0].matched).toBe('shaders')
  })

  it('files one title under several tags', () => {
    const result = matchTags('Amber shaders review', [AMBER, tag('Shaders')])
    expect(result.map((m) => m.tagId)).toEqual(['seed-tag-amber', 'shaders'])
  })

  it('leaves unrelated work untagged', () => {
    expect(matchTags('Refactor the deck store', [AMBER])).toEqual([])
  })

  it('never matches an empty title', () => {
    expect(matchTags('', [AMBER])).toEqual([])
    expect(matchTags('   ', [AMBER])).toEqual([])
  })
})

describe('extractTypedTags', () => {
  it('pulls a token out of the title', () => {
    expect(extractTypedTags('Review #amber PRs')).toEqual({
      text: 'Review PRs',
      slugs: ['amber']
    })
  })

  it('keeps one space where the token was', () => {
    expect(extractTypedTags('ship #amber deck').text).toBe('ship deck')
  })

  it('de-duplicates and preserves typed order', () => {
    expect(extractTypedTags('#shaders #amber #shaders').slugs).toEqual([
      'shaders',
      'amber'
    ])
  })

  /** A `#` inside a word is not a tag: `C#`, `issue#4`. */
  it('ignores a hash that is not at a word boundary', () => {
    expect(extractTypedTags('Learn C# basics')).toEqual({
      text: 'Learn C# basics',
      slugs: []
    })
    expect(extractTypedTags('Fix issue#4')).toEqual({
      text: 'Fix issue#4',
      slugs: []
    })
  })

  it('takes a token at the very start', () => {
    expect(extractTypedTags('#amber sync')).toEqual({
      text: 'sync',
      slugs: ['amber']
    })
  })

  it('lowercases the slug', () => {
    expect(extractTypedTags('Ship #Amber').slugs).toEqual(['amber'])
  })

  it('leaves a bare hash alone', () => {
    expect(extractTypedTags('Sprint # planning').slugs).toEqual([])
  })
})
