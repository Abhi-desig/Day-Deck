import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isProbablyBinary,
  languageFor,
  listDirectory,
  MAX_FILE_BYTES,
  readTextFile,
  resolveInRoot,
  sortNodes,
  toRelative,
  writeTextFile
} from '../src/main/services/workspace-fs'

/**
 * The renderer has no filesystem access; it names a project and a path inside
 * it. `resolveInRoot` is the only thing standing between a buggy renderer and
 * the rest of the disk, so it gets the most attention here.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'day-deck-fs-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveInRoot', () => {
  it('resolves an ordinary relative path', () => {
    expect(resolveInRoot('/repo', 'src/index.ts')).toBe('/repo/src/index.ts')
  })

  it('allows the root itself', () => {
    expect(resolveInRoot('/repo', '')).toBe('/repo')
    expect(resolveInRoot('/repo', '.')).toBe('/repo')
  })

  it('refuses to climb out with ..', () => {
    expect(() => resolveInRoot('/repo', '../secrets')).toThrow(/escapes/)
    expect(() => resolveInRoot('/repo', 'src/../../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveInRoot('/repo', '../../../../')).toThrow(/escapes/)
  })

  it('refuses an absolute path, which would ignore the root entirely', () => {
    expect(() => resolveInRoot('/repo', '/etc/passwd')).toThrow(/escapes/)
  })

  /** A NUL truncates at the syscall, so the checked path is not the opened one. */
  it('refuses a null byte', () => {
    expect(() => resolveInRoot('/repo', 'ok.txt\0../../etc/passwd')).toThrow(
      /null byte/
    )
  })

  /** '/repo-other' must not pass a naive startsWith('/repo') check. */
  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(() => resolveInRoot('/repo', '../repo-other/file')).toThrow(/escapes/)
  })

  it('normalises the root before comparing', () => {
    expect(resolveInRoot('/repo/', 'src')).toBe('/repo/src')
    expect(resolveInRoot('/repo/./sub/..', 'src')).toBe('/repo/src')
  })
})

describe('toRelative', () => {
  it('is the inverse of resolveInRoot', () => {
    const absolute = resolveInRoot('/repo', 'src/lib/util.ts')
    expect(toRelative('/repo', absolute)).toBe('src/lib/util.ts')
  })
})

describe('sortNodes', () => {
  const node = (name: string, directory: boolean) => ({
    path: name,
    name,
    directory,
    size: 0
  })

  it('puts directories first, then compares case-insensitively', () => {
    const sorted = sortNodes([
      node('README.md', false),
      node('src', true),
      node('index.ts', false),
      node('Assets', true)
    ])
    expect(sorted.map((n) => n.name)).toEqual([
      'Assets',
      'src',
      'index.ts',
      'README.md'
    ])
  })

  it('puts dotfiles at the top of their group, as every file tree does', () => {
    const sorted = sortNodes([
      node('package.json', false),
      node('.gitignore', false),
      node('eslint.config.js', false)
    ])
    expect(sorted.map((n) => n.name)).toEqual([
      '.gitignore',
      'eslint.config.js',
      'package.json'
    ])
  })

  it('applies the same rule to dot-directories, still above files', () => {
    const sorted = sortNodes([
      node('src', true),
      node('index.ts', false),
      node('.github', true)
    ])
    expect(sorted.map((n) => n.name)).toEqual(['.github', 'src', 'index.ts'])
  })
})

describe('isProbablyBinary', () => {
  it('is false for text, including UTF-8 beyond ASCII', () => {
    expect(isProbablyBinary(Buffer.from('const x = 1\n// café ☕\n'))).toBe(false)
  })

  it('is true when there is a NUL in the header', () => {
    expect(isProbablyBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]))).toBe(
      true
    )
  })

  it('is false for an empty file', () => {
    expect(isProbablyBinary(Buffer.alloc(0))).toBe(false)
  })
})

describe('languageFor', () => {
  it('maps by extension, case-insensitively', () => {
    expect(languageFor('src/App.TSX')).toBe('typescript')
    expect(languageFor('styles/globals.css')).toBe('css')
    expect(languageFor('notes.md')).toBe('markdown')
  })

  it('maps files that are all name and no extension', () => {
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('.editorconfig')).toBe('ini')
  })

  it('falls back to plaintext rather than guessing', () => {
    expect(languageFor('LICENSE')).toBe('plaintext')
    expect(languageFor('data.weird')).toBe('plaintext')
  })
})

describe('listDirectory', () => {
  it('lists one level, directories first, with sizes', () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'deep.ts'), 'nested')
    writeFileSync(join(root, 'readme.md'), 'hello')

    const nodes = listDirectory(root, '')
    expect(nodes.map((n) => n.name)).toEqual(['src', 'readme.md'])
    expect(nodes[0].directory).toBe(true)
    expect(nodes[1].size).toBe(5)
    // Nothing was walked into.
    expect(nodes.some((n) => n.name === 'deep.ts')).toBe(false)
  })

  it('returns paths relative to the root, so the renderer never sees one', () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), 'x')

    expect(listDirectory(root, 'src')[0].path).toBe('src/index.ts')
  })

  /** A dirent for a symlink is neither file nor directory until you stat it. */
  it('classifies a symlinked directory as a directory', () => {
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'link'))

    const link = listDirectory(root, '').find((n) => n.name === 'link')
    expect(link?.directory).toBe(true)
  })

  it('skips a dangling symlink instead of throwing', () => {
    writeFileSync(join(root, 'keep.txt'), 'x')
    symlinkSync(join(root, 'gone'), join(root, 'broken'))

    expect(listDirectory(root, '').map((n) => n.name)).toEqual(['keep.txt'])
  })

  it('refuses to list outside the root', () => {
    expect(() => listDirectory(root, '..')).toThrow(/escapes/)
  })
})

describe('readTextFile', () => {
  it('reads text with its language and mtime', () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')

    const result = readTextFile(root, 'a.ts')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.text).toBe('export const a = 1\n')
    expect(result.file.language).toBe('typescript')
    expect(result.file.mtimeMs).toBeGreaterThan(0)
  })

  /** A refusal is data, so the editor pane can explain itself. */
  it('reports a binary file rather than throwing', () => {
    writeFileSync(join(root, 'icon.png'), Buffer.from([0x89, 0x50, 0x00, 0x0d]))

    const result = readTextFile(root, 'icon.png')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('binary')
  })

  it('reports an oversized file without reading it into memory', () => {
    writeFileSync(join(root, 'huge.log'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x61))

    const result = readTextFile(root, 'huge.log')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('too-large')
    expect(result.error.size).toBe(MAX_FILE_BYTES + 1)
  })
})

describe('writeTextFile', () => {
  it('writes and reports the new mtime', () => {
    writeFileSync(join(root, 'a.txt'), 'before')

    const saved = writeTextFile(root, 'a.txt', 'after')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('after')
    expect(saved.mtimeMs).toBe(statSync(join(root, 'a.txt')).mtimeMs)
  })

  /**
   * VS Code is one button away and dev servers rewrite files, so a save that
   * silently discarded someone else's write would be a real way to lose work.
   */
  it('refuses to clobber a file that changed since it was read', () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'original')
    const staleMtime = statSync(file).mtimeMs - 5_000

    expect(() => writeTextFile(root, 'a.txt', 'mine', staleMtime)).toThrow(
      /changed on disk/
    )
    expect(readFileSync(file, 'utf8')).toBe('original')
  })

  it('accepts the write when the mtime still matches', () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'original')
    // Pin the mtime so the tolerance check is exercised, not luck.
    const when = new Date(Date.now() - 60_000)
    utimesSync(file, when, when)

    expect(() =>
      writeTextFile(root, 'a.txt', 'mine', statSync(file).mtimeMs)
    ).not.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('mine')
  })

  it('refuses to write outside the root', () => {
    expect(() => writeTextFile(root, '../escaped.txt', 'nope')).toThrow(/escapes/)
  })
})
