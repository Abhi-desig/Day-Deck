import { describe, expect, it } from 'vitest'
import type { BinEntry, Project, ProjectFolder } from '../src/shared/types'
import { suggestDestination } from '../src/renderer/src/lib/bin-route'

/**
 * The routing rule the bin's suggestions come from: extension picks the folder
 * name, recency picks the project, and anything unplaceable gets no suggestion
 * rather than a surprising one.
 */

const entry = (name: string, over: Partial<BinEntry> = {}): BinEntry => ({
  path: name,
  name,
  directory: false,
  size: 1024,
  modifiedMs: 0,
  ...over
})

const project = (over: Partial<Project> & Pick<Project, 'id'>): Project => ({
  name: over.id,
  path: `/projects/${over.id}`,
  kind: 'creative',
  entryPath: null,
  color: 'amber',
  branch: null,
  lastOpenedAt: null,
  pinned: false,
  sortIndex: 0,
  createdAt: '2026-08-01T00:00:00Z',
  missing: false,
  ...over
})

const folder = (
  id: string,
  projectId: string,
  name: string,
  missing = false
): ProjectFolder => ({
  id,
  projectId,
  parentId: null,
  name,
  relPath: name,
  sortIndex: 0,
  createdAt: '2026-08-01T00:00:00Z',
  missing,
  fileCount: 0
})

describe('suggesting a destination', () => {
  const reel = project({ id: 'reel', kind: 'creative', lastOpenedAt: '2026-08-12T10:00:00Z' })
  const older = project({ id: 'older', kind: 'creative', lastOpenedAt: '2026-08-01T10:00:00Z' })
  const app = project({ id: 'app', kind: 'code', lastOpenedAt: '2026-08-13T09:00:00Z' })

  const folders = [
    folder('f1', 'reel', 'Footage'),
    folder('f2', 'reel', 'References'),
    folder('f3', 'older', 'Footage'),
    folder('f4', 'app', 'assets'),
    folder('f5', 'app', 'docs')
  ]

  it('sends video to the most recent creative project’s Footage', () => {
    const got = suggestDestination(entry('clip.MP4'), [older, reel, app], folders)
    expect(got).toMatchObject({ projectId: 'reel', folderName: 'Footage' })
  })

  it('sends a screenshot to References or assets by project recency', () => {
    // The code project was opened most recently, and pngs fit its assets.
    const got = suggestDestination(entry('shot.png'), [older, reel, app], folders)
    expect(got).toMatchObject({ projectId: 'app', folderName: 'assets' })
  })

  it('falls back to an older project when the recent one lacks the folder', () => {
    const noFootage = folders.filter((f) => f.id !== 'f1')
    const got = suggestDestination(entry('clip.mov'), [older, reel], noFootage)
    expect(got).toMatchObject({ projectId: 'older', folderName: 'Footage' })
  })

  it('skips folders whose directory is missing', () => {
    const gone = [folder('f1', 'reel', 'Footage', true), folder('f3', 'older', 'Footage')]
    const got = suggestDestination(entry('clip.mp4'), [reel, older], gone)
    expect(got).toMatchObject({ projectId: 'older' })
  })

  it('suggests nothing for a directory', () => {
    expect(
      suggestDestination(entry('stuff', { directory: true }), [reel], folders)
    ).toBeNull()
  })

  it('suggests nothing for an extension it does not know', () => {
    expect(suggestDestination(entry('weird.xyz'), [reel], folders)).toBeNull()
    expect(suggestDestination(entry('no-extension'), [reel], folders)).toBeNull()
  })

  it('suggests nothing when no project has the right folder', () => {
    expect(suggestDestination(entry('clip.mp4'), [app], folders)).toBeNull()
  })
})
