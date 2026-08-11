import { readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Which branch a folder is on, read straight out of `.git` rather than by
 * shelling out.
 *
 * `git` is not guaranteed to be on this machine's PATH — the same problem the
 * VS Code launcher has — and spawning a process per project on every list would
 * cost far more than two small file reads. Parsing HEAD ourselves also means a
 * folder that merely *looks* like a repo degrades to `null` instead of hanging
 * on a subprocess.
 */

/** Matches a full object id; HEAD holds one of these when it is detached. */
const SHA = /^[0-9a-f]{40}$/i

/**
 * Turn the contents of a `.git/HEAD` file into something displayable.
 *
 * - `ref: refs/heads/feature/x` → `feature/x`
 * - a bare object id → its short form, which is what git itself shows
 * - anything else → null, because a wrong branch name is worse than none
 */
export function parseHeadRef(contents: string): string | null {
  const line = contents.trim()
  if (!line) return null

  const ref = /^ref:\s*(.+)$/.exec(line)
  if (ref) {
    const name = ref[1].trim()
    if (!name) return null
    return name.startsWith('refs/heads/')
      ? name.slice('refs/heads/'.length)
      : name
  }

  if (SHA.test(line)) return line.slice(0, 7)
  return null
}

/**
 * Resolve the `gitdir:` pointer that stands in for `.git` inside a linked
 * worktree or a submodule. Relative pointers are relative to the folder that
 * holds the pointer file, which is why `root` is needed.
 */
export function parseGitDirPointer(contents: string, root: string): string | null {
  const match = /^gitdir:\s*(.+)$/m.exec(contents.trim())
  if (!match) return null

  const target = match[1].trim()
  if (!target) return null
  return isAbsolute(target) ? target : resolve(root, target)
}

/** The branch a project folder is on, or null if it is not a repo. */
export function readBranch(root: string): string | null {
  try {
    const dotGit = join(root, '.git')
    const stat = statSync(dotGit)

    // A worktree or submodule has a `.git` *file* pointing at the real gitdir.
    const gitDir = stat.isDirectory()
      ? dotGit
      : parseGitDirPointer(readFileSync(dotGit, 'utf8'), root)
    if (!gitDir) return null

    return parseHeadRef(readFileSync(join(gitDir, 'HEAD'), 'utf8'))
  } catch {
    // No .git, no read permission, or an unmounted volume. All the same to a
    // card that just wants a label.
    return null
  }
}

/**
 * A sensible display name for a folder the user just picked.
 *
 * Trailing separators are stripped first so `~/code/day-deck/` does not come
 * back as an empty string, and a picked volume root falls back to its path
 * rather than to nothing.
 */
export function projectNameFromPath(path: string): string {
  let trimmed = path.trim()
  while (trimmed.length > 1 && trimmed.endsWith(sep)) {
    trimmed = trimmed.slice(0, -1)
  }
  return basename(trimmed) || trimmed
}
