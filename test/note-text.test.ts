import { describe, expect, it } from 'vitest'
import { parseNoteSchedule } from '../src/shared/note-text'

/**
 * Tuesday 11 Aug 2026, so every weekday in the tests has an unambiguous past
 * and future instance either side of it.
 *
 *   Sat 8th · Sun 9th · Mon 10th · [Tue 11th] · Wed 12th · Sat 15th · Wed 19th
 */
const TODAY = '2026-08-11'

describe('parseNoteSchedule', () => {
  /** The sentence the whole feature was specified with. */
  it('reads the brief’s own example in both directions', () => {
    expect(
      parseNoteSchedule(
        'I learned this on Saturday, but review it on Wednesday',
        TODAY
      )
    ).toEqual({ learnedDate: '2026-08-08', surfaceDate: '2026-08-12' })
  })

  it('sends an uncued date forward — a bare date in a note is a reminder', () => {
    expect(parseNoteSchedule('Shader uniforms on Wednesday', TODAY)).toEqual({
      learnedDate: null,
      surfaceDate: '2026-08-12'
    })
  })

  it('lets the nearest verb decide, not the order the dates appear in', () => {
    // Future clause first, past clause second — the opposite of the example.
    expect(
      parseNoteSchedule(
        'Review the pointer chapter on Wednesday; I read it on Saturday',
        TODAY
      )
    ).toEqual({ learnedDate: '2026-08-08', surfaceDate: '2026-08-12' })
  })

  it('resolves today’s own weekday backwards for "learned", forwards for "review"', () => {
    // Said on a Tuesday. "Learned it Tuesday" is today; "review Tuesday" is not.
    expect(parseNoteSchedule('Learned this on Tuesday', TODAY).learnedDate).toBe(
      TODAY
    )
    expect(parseNoteSchedule('Review it on Tuesday', TODAY).surfaceDate).toBe(
      '2026-08-18'
    )
  })

  it('understands relative words without any verb to help', () => {
    expect(parseNoteSchedule('Check this tomorrow', TODAY).surfaceDate).toBe(
      '2026-08-12'
    )
    expect(parseNoteSchedule('Did this yesterday', TODAY).learnedDate).toBe(
      '2026-08-10'
    )
    expect(parseNoteSchedule('Come back to it in 5 days', TODAY).surfaceDate).toBe(
      '2026-08-16'
    )
    expect(parseNoteSchedule('Covered this 3 days ago', TODAY).learnedDate).toBe(
      '2026-08-08'
    )
    expect(parseNoteSchedule('Revisit next week', TODAY).surfaceDate).toBe(
      '2026-08-18'
    )
  })

  it('puts "today" in whichever column the verb asks for', () => {
    expect(parseNoteSchedule('Learned this today', TODAY)).toEqual({
      learnedDate: TODAY,
      surfaceDate: null
    })
    expect(parseNoteSchedule('Remind me today', TODAY)).toEqual({
      learnedDate: null,
      surfaceDate: TODAY
    })
  })

  it('takes an explicit key verbatim and still routes it by verb', () => {
    expect(
      parseNoteSchedule('Studied on 2026-08-08, review on 2026-08-19', TODAY)
    ).toEqual({ learnedDate: '2026-08-08', surfaceDate: '2026-08-19' })
  })

  it('ignores an impossible key rather than inventing a date', () => {
    expect(parseNoteSchedule('Review on 2026-02-31', TODAY).surfaceDate).toBeNull()
  })

  it('honours an explicit "last" or "next" over the verb', () => {
    expect(
      parseNoteSchedule('Review what I did last Saturday', TODAY).learnedDate
    ).toBe('2026-08-08')
    expect(parseNoteSchedule('Learned it, redo next Saturday', TODAY).surfaceDate).toBe(
      '2026-08-15'
    )
  })

  it('keeps the first date in each direction and ignores the rest', () => {
    expect(
      parseNoteSchedule('Review on Wednesday and again on Saturday', TODAY)
    ).toEqual({ learnedDate: null, surfaceDate: '2026-08-12' })
  })

  it('matches abbreviations and is case-insensitive', () => {
    expect(parseNoteSchedule('REVIEW ON WED', TODAY).surfaceDate).toBe(
      '2026-08-12'
    )
    expect(parseNoteSchedule('Learnt this Sat', TODAY).learnedDate).toBe(
      '2026-08-08'
    )
  })

  /** The common case: a note that names no date at all keeps the picked one. */
  it('returns nothing for a note with no date in it', () => {
    expect(
      parseNoteSchedule('Remember that uniforms are per-draw, not per-vertex', TODAY)
    ).toEqual({ learnedDate: null, surfaceDate: null })
  })

  it('does not read a weekday out of the middle of another word', () => {
    expect(
      parseNoteSchedule('Read the Sunderland case study', TODAY)
    ).toEqual({ learnedDate: null, surfaceDate: null })
  })

  it('survives an empty note', () => {
    expect(parseNoteSchedule('', TODAY)).toEqual({
      learnedDate: null,
      surfaceDate: null
    })
  })
})
