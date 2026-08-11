import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, posix, relative, resolve, sep } from 'node:path'
import type {
  FileContents,
  FileNode,
  FileReadResult,
  FileSaved
} from '@shared/types'

/**
 * Every filesystem read and write the workspace performs. The renderer never
 * sees an absolute path and never names one — it asks for a project id and a
 * path *relative to that project*, and this module is the only thing that turns
 * the pair into a real location on disk.
 */

/** Anything bigger is not what a quick-edit pane is for. Monaco crawls, too. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** A directory with more entries than this is a build output, not a source tree. */
const MAX_ENTRIES = 4000

/** Enough to catch a NUL in any real binary's header. */
const SNIFF_BYTES = 8192

/**
 * Resolve a renderer-supplied relative path inside `root`, or throw.
 *
 * `resolve` collapses `..` before the comparison, so `src/../../etc/passwd`
 * fails the prefix test rather than sneaking through. The check is on the
 * logical path: a symlink *inside* the project that points outside it is
 * followed deliberately, since real repos use them and anyone who can plant one
 * already has write access to the folder the user chose.
 */
export function resolveInRoot(root: string, rel: string): string {
  if (typeof rel !== 'string') throw new Error('Path must be a string')
  // A NUL truncates the path at the syscall boundary, so a name containing one
  // can mean a different file than the one that was checked.
  if (rel.includes('\0')) throw new Error('Path contains a null byte')

  const base = resolve(root)
  const target = resolve(base, rel)

  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Path escapes the project folder: ${rel}`)
  }
  return target
}

/** The inverse: an absolute path back to the POSIX-separated relative form. */
export function toRelative(root: string, absolute: string): string {
  const rel = relative(resolve(root), absolute)
  return sep === '/' ? rel : rel.split(sep).join(posix.sep)
}

/**
 * Directories first, then case-insensitive by name. The leading dot sorts ahead
 * of letters, so `.env` and `.github` land at the top of their group — which is
 * where every other file tree puts them, and where people look.
 */
export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** A NUL byte in the header is the same heuristic git uses, and it is enough. */
export function isProbablyBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

/**
 * Monaco language ids. Only the extensions worth having highlighted in a
 * planner's side editor — anything unmapped opens as plaintext, which is a
 * perfectly good outcome rather than a bug.
 */
const BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.sql': 'sql',
  '.xml': 'xml',
  '.svg': 'xml',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.php': 'php',
  '.lua': 'lua',
  '.dart': 'dart'
}

/** Config files that carry their whole name instead of an extension. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.env': 'shell'
}

export function languageFor(name: string): string {
  const lower = name.toLowerCase()
  return BY_NAME[lower] ?? BY_EXTENSION[extname(lower)] ?? 'plaintext'
}

/**
 * One level of the tree. Expanding is a separate call per directory, so opening
 * a repo never walks node_modules — the cost is paid only where the user looks.
 */
export function listDirectory(root: string, rel: string): FileNode[] {
  const dir = resolveInRoot(root, rel)
  const entries = readdirSync(dir, { withFileTypes: true }).slice(0, MAX_ENTRIES)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    let directory = entry.isDirectory()
    let size = 0

    // A dirent for a symlink reports neither file nor directory, so ask.
    try {
      if (entry.isSymbolicLink()) {
        const stat = statSync(absolute)
        directory = stat.isDirectory()
        size = directory ? 0 : stat.size
      } else if (!directory) {
        size = statSync(absolute).size
      }
    } catch {
      // Dangling symlink or a race with something deleting it mid-listing.
      continue
    }

    nodes.push({
      path: toRelative(root, absolute),
      name: entry.name,
      directory,
      size
    })
  }

  return sortNodes(nodes)
}

export function readTextFile(root: string, rel: string): FileReadResult {
  const absolute = resolveInRoot(root, rel)
  const stat = statSync(absolute)

  if (stat.size > MAX_FILE_BYTES) {
    return { ok: false, error: { path: rel, reason: 'too-large', size: stat.size } }
  }

  const buffer = readFileSync(absolute)
  if (isProbablyBinary(buffer)) {
    return { ok: false, error: { path: rel, reason: 'binary', size: stat.size } }
  }

  const file: FileContents = {
    path: rel,
    text: buffer.toString('utf8'),
    language: languageFor(rel),
    mtimeMs: stat.mtimeMs
  }
  return { ok: true, file }
}

/**
 * `expectedMtimeMs` is the mtime the renderer last saw. VS Code is one button
 * away and a dev server rewrites files on its own, so a save that silently
 * discarded someone else's write would be a real way to lose work — mismatches
 * are refused and reported instead.
 */
export function writeTextFile(
  root: string,
  rel: string,
  text: string,
  expectedMtimeMs?: number
): FileSaved {
  const absolute = resolveInRoot(root, rel)

  if (expectedMtimeMs !== undefined) {
    const current = statSync(absolute).mtimeMs
    // Filesystem mtimes are not exact to the millisecond everywhere, so compare
    // with a tolerance rather than flagging a phantom conflict on every save.
    if (Math.abs(current - expectedMtimeMs) > 1) {
      throw new Error(
        `${rel} changed on disk since you opened it. Reopen it to pick up the newer version, or save again to overwrite.`
      )
    }
  }

  writeFileSync(absolute, text, 'utf8')
  return { path: rel, mtimeMs: statSync(absolute).mtimeMs }
}
