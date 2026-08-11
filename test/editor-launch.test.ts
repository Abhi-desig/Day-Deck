import { describe, expect, it } from 'vitest'
import {
  editorCandidates,
  planEditorLaunch,
  type EditorCandidate
} from '../src/main/services/editor'

/**
 * `code` is not on this machine's PATH, and a GUI app launched from Finder gets
 * a nearly empty PATH regardless — so the launcher looks for the real binary
 * where it is installed, and falls back to LaunchServices. The order matters
 * and is easy to break, which is what these lock down.
 */

const CANDIDATES: EditorCandidate[] = [
  { bundle: '/Applications/Visual Studio Code.app', cli: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
  { bundle: '/Applications/Visual Studio Code - Insiders.app', cli: '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders' }
]

const only = (...paths: string[]) => (path: string) => paths.includes(path)

describe('planEditorLaunch', () => {
  it('prefers the bundled CLI', () => {
    const plan = planEditorLaunch(only(CANDIDATES[0].cli, CANDIDATES[0].bundle), CANDIDATES)
    expect(plan).toEqual({
      kind: 'cli',
      command: CANDIDATES[0].cli,
      bundle: CANDIDATES[0].bundle
    })
  })

  /** A damaged or trimmed install still has the .app to hand to `open`. */
  it('falls back to open -a when the app is there but its CLI is not', () => {
    const plan = planEditorLaunch(only(CANDIDATES[0].bundle), CANDIDATES)
    expect(plan).toEqual({ kind: 'bundle', bundle: CANDIDATES[0].bundle })
  })

  it('falls back to opening by name when nothing is on disk', () => {
    const plan = planEditorLaunch(() => false, CANDIDATES)
    expect(plan).toEqual({ kind: 'by-name', name: 'Visual Studio Code' })
  })

  /**
   * Stable beats Insiders even when only Insiders has a CLI — otherwise
   * someone with both installed gets sent to the wrong editor.
   */
  it('takes a CLI from an earlier candidate over a bundle from a later one', () => {
    const plan = planEditorLaunch(
      only(CANDIDATES[0].cli, CANDIDATES[1].bundle, CANDIDATES[1].cli),
      CANDIDATES
    )
    expect(plan.kind).toBe('cli')
    if (plan.kind !== 'cli') return
    expect(plan.command).toBe(CANDIDATES[0].cli)
  })

  it('finds Insiders when stable is not installed at all', () => {
    const plan = planEditorLaunch(only(CANDIDATES[1].cli), CANDIDATES)
    expect(plan.kind).toBe('cli')
    if (plan.kind !== 'cli') return
    expect(plan.command).toContain('code-insiders')
  })
})

describe('editorCandidates', () => {
  it('looks in /Applications before ~/Applications, stable variant first', () => {
    const candidates = editorCandidates()
    expect(candidates[0].bundle).toBe('/Applications/Visual Studio Code.app')
    expect(candidates[0].cli).toBe(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    )
    expect(candidates.some((c) => c.bundle.includes('VSCodium'))).toBe(true)
    expect(candidates.some((c) => !c.bundle.startsWith('/Applications'))).toBe(true)
  })

  it('gives every candidate a CLI path inside its own bundle', () => {
    for (const candidate of editorCandidates()) {
      expect(candidate.cli.startsWith(`${candidate.bundle}/`)).toBe(true)
    }
  })
})
