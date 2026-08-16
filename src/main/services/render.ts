import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CutSegmentInput, StoryCutSegment, VideoJobProgress } from '@shared/types'
import type { Db } from '../db'
import { cutDuration, listSegments, replaceSegments } from '../db/cut'
import { chosenTake, getTake, listTakes } from '../db/takes'
import { listFrames } from '../db/storyboards'
import { buildConcatArgs, buildTrimArgs, probe, runFfmpeg } from './ffmpeg'
import { takePath } from './takes'

/**
 * Turning a timeline into a file.
 *
 * Two passes rather than one: each segment is trimmed to its own temporary
 * file, then the temporaries are joined. A single filter graph could do both,
 * but it makes progress unreportable — ffmpeg would emit one `out_time` for the
 * whole job and the user would watch a bar that moves once, at the end, on work
 * that takes minutes.
 */

export type Send = (progress: VideoJobProgress) => void

/**
 * Fill the timeline from the scenes marked final.
 *
 * One segment per final scene's chosen take, full length. This is the
 * "populate" button and it is deliberately not clever: it produces the obvious
 * assembly in board order, which is the thing you then trim. Guessing at cut
 * points is Phase 4's job and it asks first.
 */
export function populateFromFinals(db: Db, boardId: string): StoryCutSegment[] {
  const finals = listFrames(db, boardId).filter((f) => f.isFinal)

  const segments: CutSegmentInput[] = finals.flatMap((frame) => {
    const take = chosenTake(db, frame.id)
    if (!take) return []
    // The stored duration is what was *asked* for. A take whose real length
    // differs — Veo rounding, mostly — would otherwise be trimmed to the wrong
    // place, so the file is the authority and the row is the fallback.
    return [{ takeId: take.id, startSec: 0, endSec: take.durationSec || 0 }]
  })

  return replaceSegments(db, boardId, segments)
}

/**
 * The real length of every take on a board, read off the files.
 *
 * Called when the timeline opens so the trim handles are against the actual
 * clip rather than the requested duration. Failures are silent per take: a
 * clip that cannot be probed keeps its stored length, which is very nearly
 * right, and refusing to show a timeline over it would be worse.
 */
export async function measureTakes(
  db: Db,
  boardId: string
): Promise<Record<string, number>> {
  const frames = listFrames(db, boardId)
  const lengths: Record<string, number> = {}

  for (const frame of frames) {
    for (const take of listTakes(db, frame.id)) {
      try {
        const info = await probe(takePath(take.id))
        if (info.durationSec > 0) lengths[take.id] = info.durationSec
      } catch {
        /* keep the stored length */
      }
    }
  }

  return lengths
}

/**
 * Render the cut to a file the user chose.
 *
 * The temporary directory is removed in a `finally`, including on failure — a
 * cancelled export must not leave several hundred megabytes of trimmed
 * segments in the system temp directory with a name nobody will recognise.
 */
export async function renderCut(
  db: Db,
  boardId: string,
  output: string,
  send: Send
): Promise<string> {
  const segments = listSegments(db, boardId)
  if (segments.length === 0) {
    throw new Error('There is nothing in the timeline to export.')
  }

  const work = mkdtempSync(join(tmpdir(), 'day-deck-cut-'))

  try {
    const trimmed: string[] = []

    for (const [index, segment] of segments.entries()) {
      const take = getTake(db, segment.takeId)
      if (!take) continue

      const target = join(work, `${String(index).padStart(3, '0')}.mp4`)
      const length = Math.max(0, segment.endSec - segment.startSec)

      await runFfmpeg(
        buildTrimArgs(
          {
            input: takePath(take.id),
            startSec: segment.startSec,
            endSec: segment.endSec
          },
          target
        ),
        length,
        (fraction) =>
          send({
            phase: 'trimming',
            index,
            total: segments.length,
            fraction
          })
      )

      trimmed.push(target)
    }

    if (trimmed.length === 0) {
      throw new Error(
        'Every segment in the timeline points at a take that no longer exists.'
      )
    }

    await runFfmpeg(
      buildConcatArgs(trimmed, output),
      cutDuration(segments),
      (fraction) => send({ phase: 'joining', fraction })
    )

    send({ phase: 'exported', path: output })
    return output
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
