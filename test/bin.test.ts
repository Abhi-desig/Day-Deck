import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bin only ever reads Desktop and Downloads, and the one rule it enforces
 * is the gate: a filing operation can name things from those two places and
 * nowhere else. These run against real temp directories standing in for both.
 */

let desktop: string
let downloads: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'desktop') return desktop
      if (name === 'downloads') return downloads
      return '/tmp/day-deck-test'
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const bin = await import('../src/main/services/bin')

beforeEach(() => {
  desktop = mkdtempSync(join(tmpdir(), 'deck-desktop-'))
  downloads = mkdtempSync(join(tmpdir(), 'deck-downloads-'))
})

afterEach(() => {
  rmSync(desktop, { recursive: true, force: true })
  rmSync(downloads, { recursive: true, force: true })
})

describe('listing a bin', () => {
  it('lists files and folders, newest first, hiding dotfiles', () => {
    writeFileSync(join(desktop, 'old.png'), 'x')
    utimesSync(join(desktop, 'old.png'), new Date('2026-08-01'), new Date('2026-08-01'))
    writeFileSync(join(desktop, 'new.mp4'), 'xx')
    utimesSync(join(desktop, 'new.mp4'), new Date('2026-08-12'), new Date('2026-08-12'))
    mkdirSync(join(desktop, 'a-folder'))
    utimesSync(join(desktop, 'a-folder'), new Date('2026-08-05'), new Date('2026-08-05'))
    writeFileSync(join(desktop, '.DS_Store'), 'noise')

    const listing = bin.listBin('desktop')

    expect(listing.entries.map((e) => e.name)).toEqual([
      'new.mp4',
      'a-folder',
      'old.png'
    ])
    expect(listing.entries[0]).toMatchObject({ directory: false, size: 2 })
    expect(listing.entries[1]).toMatchObject({ directory: true, size: 0 })
    expect(listing.truncated).toBe(false)
  })

  it('reports a missing source as empty rather than crashing', () => {
    rmSync(downloads, { recursive: true, force: true })
    const listing = bin.listBin('downloads')
    expect(listing.entries).toEqual([])
  })
})

describe('the gate in front of filing', () => {
  it('resolves listed names inside the source root', () => {
    writeFileSync(join(desktop, 'clip.mp4'), 'x')
    const [path] = bin.resolveBinPaths('desktop', ['clip.mp4'])
    expect(path).toBe(join(desktop, 'clip.mp4'))
  })

  it('refuses separators, dot-walks, hidden names and NUL', () => {
    for (const name of [
      '../outside.txt',
      'sub/inside.txt',
      'sub\\inside.txt',
      '..',
      '.',
      '.ssh',
      'nul\0l',
      ''
    ]) {
      expect(() => bin.resolveBinPaths('desktop', [name])).toThrow()
    }
  })

  it('refuses a source that is not a bin', () => {
    expect(() =>
      bin.resolveBinPaths('documents' as never, ['x.txt'])
    ).toThrow(/not a bin source/i)
  })
})
