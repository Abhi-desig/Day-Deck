import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseGitDirPointer,
  parseHeadRef,
  projectNameFromPath,
  readBranch
} from '../src/main/services/git'

/**
 * Branch detection reads `.git` directly rather than shelling out to `git`,
 * which is not guaranteed to be on PATH. These cover the shapes HEAD actually
 * takes in the wild.
 */

const temps: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'day-deck-git-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true })
})

describe('parseHeadRef', () => {
  it('reads an ordinary branch', () => {
    expect(parseHeadRef('ref: refs/heads/main\n')).toBe('main')
  })

  it('keeps the slashes inside a branch name', () => {
    expect(parseHeadRef('ref: refs/heads/feature/day-deck/phase-3\n')).toBe(
      'feature/day-deck/phase-3'
    )
  })

  it('shortens a detached HEAD to what git itself shows', () => {
    expect(parseHeadRef('9f2c1ab8e4d5f60718293a4b5c6d7e8f90123456')).toBe('9f2c1ab')
  })

  it('passes through a ref that is not under refs/heads', () => {
    expect(parseHeadRef('ref: refs/tags/v1.2.0')).toBe('refs/tags/v1.2.0')
  })

  it('returns null rather than guessing at nonsense', () => {
    expect(parseHeadRef('')).toBeNull()
    expect(parseHeadRef('   \n')).toBeNull()
    expect(parseHeadRef('ref:')).toBeNull()
    expect(parseHeadRef('not a ref at all')).toBeNull()
    // Too short to be an object id, so it is not a detached head either.
    expect(parseHeadRef('9f2c1ab')).toBeNull()
  })
})

describe('parseGitDirPointer', () => {
  it('resolves an absolute pointer', () => {
    expect(parseGitDirPointer('gitdir: /repos/app/.git/worktrees/x', '/anywhere')).toBe(
      '/repos/app/.git/worktrees/x'
    )
  })

  it('resolves a relative pointer against the folder holding it', () => {
    // A submodule at /repos/app/lib points up one level to the parent repo's
    // .git, not to the parent *directory's* parent.
    expect(parseGitDirPointer('gitdir: ../.git/modules/lib', '/repos/app/lib')).toBe(
      '/repos/app/.git/modules/lib'
    )
  })

  it('returns null for anything that is not a pointer', () => {
    expect(parseGitDirPointer('ref: refs/heads/main', '/repos/app')).toBeNull()
    expect(parseGitDirPointer('gitdir:', '/repos/app')).toBeNull()
  })
})

describe('readBranch', () => {
  it('reads a normal repository', () => {
    const dir = makeDir()
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/phase-3\n')

    expect(readBranch(dir)).toBe('phase-3')
  })

  /** A linked worktree has a `.git` *file*, not a directory. */
  it('follows a worktree pointer to the real gitdir', () => {
    const dir = makeDir()
    const gitDir = join(dir, 'real-git')
    mkdirSync(gitDir)
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/experiment\n')
    writeFileSync(join(dir, '.git'), `gitdir: ${gitDir}\n`)

    expect(readBranch(dir)).toBe('experiment')
  })

  it('is null for a folder that is not a repository', () => {
    expect(readBranch(makeDir())).toBeNull()
  })

  it('is null rather than throwing for a folder that does not exist', () => {
    expect(readBranch('/definitely/not/here/at/all')).toBeNull()
  })
})

describe('projectNameFromPath', () => {
  it('uses the last segment', () => {
    expect(projectNameFromPath('/Users/me/code/day-deck')).toBe('day-deck')
  })

  it('ignores trailing separators', () => {
    expect(projectNameFromPath('/Users/me/code/day-deck/')).toBe('day-deck')
    expect(projectNameFromPath('/Users/me/code/day-deck///')).toBe('day-deck')
  })

  it('falls back to the path itself at the filesystem root', () => {
    expect(projectNameFromPath('/')).toBe('/')
  })

  it('keeps a name with spaces intact', () => {
    expect(projectNameFromPath('/Users/me/code/Daily calander')).toBe(
      'Daily calander'
    )
  })
})
