import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/renderer/src/lib/error'

/**
 * Every AI failure in the app reaches the user through this function, so what
 * it strips is the difference between an explanation and a stack trace. The
 * cases below are the real strings Electron produced for the storyboard
 * planner.
 */
describe('errorMessage', () => {
  it('drops the channel name and the error class Electron prepends', () => {
    expect(
      errorMessage(
        new Error(
          "Error invoking remote method 'boards:planScenes': GeminiError: Gemini is overloaded right now (503)."
        )
      )
    ).toBe('Gemini is overloaded right now (503).')
  })

  it('keeps a colon that belongs to the message', () => {
    expect(
      errorMessage(
        new Error(
          "Error invoking remote method 'boards:planScenes': Error: Rate limit: too many AI calls in the last minute."
        )
      )
    ).toBe('Rate limit: too many AI calls in the last minute.')
  })

  it('leaves a message that was never wrapped alone', () => {
    expect(errorMessage(new Error('Write the creative brief first.'))).toBe(
      'Write the creative brief first.'
    )
  })

  it('has something to say about a throw that was not an error', () => {
    expect(errorMessage(undefined)).toBe('undefined')
    expect(errorMessage(new Error('   '))).toBe('Something went wrong.')
  })
})
