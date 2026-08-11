import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { EditorLaunch } from '@shared/types'

/**
 * "Open in VS Code", for a machine where `code` is *not* on PATH.
 *
 * Shelling out to `code` is the obvious implementation and it fails here: the
 * PATH shim is opt-in inside VS Code, and a GUI app launched from Finder gets a
 * minimal PATH regardless. So the real binary is looked for at the paths it is
 * actually installed at, and `open -a` — which asks LaunchServices rather than
 * PATH — is the fallback.
 */

const run = promisify(execFile)

const APP_DIRS = ['/Applications', join(homedir(), 'Applications')]
const APP_NAMES = [
  'Visual Studio Code.app',
  'Visual Studio Code - Insiders.app',
  'VSCodium.app'
]

/** Inside the bundle, the CLI lives at a fixed sub-path for every variant. */
const CLI_SUFFIXES: Record<string, string> = {
  'Visual Studio Code.app': 'Contents/Resources/app/bin/code',
  'Visual Studio Code - Insiders.app': 'Contents/Resources/app/bin/code-insiders',
  'VSCodium.app': 'Contents/Resources/app/bin/codium'
}

export interface EditorCandidate {
  bundle: string
  cli: string
}

/** Every place VS Code plausibly is, best match first. */
export function editorCandidates(): EditorCandidate[] {
  const out: EditorCandidate[] = []
  for (const dir of APP_DIRS) {
    for (const name of APP_NAMES) {
      const bundle = join(dir, name)
      out.push({ bundle, cli: join(bundle, CLI_SUFFIXES[name]) })
    }
  }
  return out
}

export type EditorPlan =
  /** The bundled CLI binary — opens the folder in an existing window. */
  | { kind: 'cli'; command: string; bundle: string }
  /** `open -a <bundle>`, when the app is installed but its CLI is missing. */
  | { kind: 'bundle'; bundle: string }
  /**
   * `open -a "Visual Studio Code"`. Nothing was found on disk, but
   * LaunchServices indexes apps we did not think to look for, so it is worth
   * one attempt before telling the user it is not installed.
   */
  | { kind: 'by-name'; name: string }

/**
 * Pure: given a way to test whether a path exists, decide how to launch. Kept
 * separate from the launching so the fallback order can be tested without
 * anything installed.
 */
export function planEditorLaunch(
  exists: (path: string) => boolean,
  candidates: EditorCandidate[] = editorCandidates()
): EditorPlan {
  for (const candidate of candidates) {
    if (exists(candidate.cli)) {
      return { kind: 'cli', command: candidate.cli, bundle: candidate.bundle }
    }
  }
  for (const candidate of candidates) {
    if (exists(candidate.bundle)) return { kind: 'bundle', bundle: candidate.bundle }
  }
  return { kind: 'by-name', name: 'Visual Studio Code' }
}

const NOT_INSTALLED =
  'Visual Studio Code was not found. Looked for it in /Applications and ~/Applications, and macOS does not know of a copy anywhere else.'

/** Open `projectPath` in VS Code, reporting which route actually worked. */
export async function openInEditor(projectPath: string): Promise<EditorLaunch> {
  const plan = planEditorLaunch(existsSync)

  if (plan.kind === 'cli') {
    await run(plan.command, [projectPath])
    return { via: 'cli', path: plan.bundle }
  }

  const target = plan.kind === 'bundle' ? plan.bundle : plan.name
  try {
    await run('open', ['-a', target, projectPath])
  } catch (err) {
    // `open` failing on the by-name attempt is the real "not installed" signal;
    // anything else is worth passing through verbatim.
    if (plan.kind === 'by-name') throw new Error(NOT_INSTALLED)
    throw new Error(
      `Could not open ${target}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return { via: 'open', path: target }
}
