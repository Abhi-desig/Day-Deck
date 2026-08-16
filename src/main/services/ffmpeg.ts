import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

/**
 * Cutting the finals together.
 *
 * Two things here are worth stating up front, because both have already cost
 * this repo time in a different guise:
 *
 * 1. **An executable cannot run from inside an asar.** The packages report a
 *    path under `app.asar` in a packaged build, and spawning it fails with
 *    ENOENT. `asarUnpack` puts the real files beside the archive and this
 *    rewrites the path to match — the same fix `node-pty` needed for its
 *    `spawn-helper`.
 * 2. **The argument builders are pure and exported.** Everything that decides
 *    what ffmpeg is asked to do is a function from data to a string array, so
 *    `test/ffmpeg-args.test.ts` asserts the whole of it without ever starting a
 *    process. What is left to go wrong at runtime is the spawn itself.
 */

const require = createRequire(import.meta.url)

/**
 * Where the binary actually is.
 *
 * `app.asar` -> `app.asar.unpacked` is the entire trick, and it is a string
 * replacement rather than a path join because that is exactly what electron's
 * own packaging does to produce the two locations.
 */
export function unpacked(path: string): string {
  return path.replace(`app.asar${sep()}`, `app.asar.unpacked${sep()}`)
}

const sep = (): string => (process.platform === 'win32' ? '\\' : '/')

export function ffmpegPath(): string {
  const resolved = require('ffmpeg-static') as string | null
  if (!resolved) {
    throw new Error(
      'ffmpeg is missing from this build. Reinstall dependencies — ffmpeg-static downloads its binary in a postinstall script, and a skipped script leaves the package pointing at a file that was never fetched.'
    )
  }
  return unpacked(resolved)
}

/**
 * There is deliberately no ffprobe.
 *
 * `ffprobe-static@3.1.0` ships an **x86_64** binary inside its `darwin/arm64`
 * directory — an upstream packaging bug, not a configuration mistake. On an
 * Apple Silicon machine without Rosetta it cannot run at all, and it fails as
 * `bad CPU type in executable`, which reads like a corrupt download rather than
 * a package shipping the wrong file.
 *
 * So durations are read from `ffmpeg -i` instead. Same information, one
 * dependency instead of two, and — the part that matters — a binary that is by
 * construction the same architecture as the one doing the encoding, so this
 * class of bug cannot come back for the two of them separately.
 */

/* --------------------------------------------------------- pure builders */

/** One segment of the cut: part of one take, in cutting order. */
export interface CutSegment {
  /** Absolute path to the take's file. */
  input: string
  startSec: number
  endSec: number
}

/**
 * Encoding settings, stated once.
 *
 * Clips are re-encoded rather than stream-copied, and that is a deliberate cost.
 * A trim lands on an arbitrary timestamp; a stream copy can only cut on a
 * keyframe, so `-c copy` either moves the cut or leaves the frames before the
 * first keyframe undecodable — which plays back as a frozen or garbled opening
 * on every segment. Re-encoding is slower and correct.
 */
export const VIDEO_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p'
] as const

/** Veo output carries audio. Keeping it is the whole reason this is here. */
export const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '192k'] as const

/**
 * Cut one segment out of one take.
 *
 * `-ss` before `-i` seeks by keyframe and is fast; after `-i` it is exact and
 * slow. Both are used, in that order: seek roughly with the fast one, then trim
 * precisely with the slow one over a short window. `-accurate_seek` is what
 * makes the pairing exact rather than approximate.
 */
export function buildTrimArgs(
  segment: CutSegment,
  output: string
): string[] {
  const duration = Math.max(0, segment.endSec - segment.startSec)
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-accurate_seek',
    '-ss',
    segment.startSec.toFixed(3),
    '-i',
    segment.input,
    '-t',
    duration.toFixed(3),
    ...VIDEO_ARGS,
    ...AUDIO_ARGS,
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    output
  ]
}

/**
 * Join trimmed segments into the finished film.
 *
 * The concat *filter* rather than the concat *demuxer*. The demuxer is cheaper
 * but requires every input to share a codec, timebase and parameter set, and
 * silently produces frozen frames at the boundaries when they do not — which is
 * exactly the condition a board of separately generated clips is in. The filter
 * decodes and re-encodes, so the boundaries are real cuts.
 */
export function buildConcatArgs(inputs: string[], output: string): string[] {
  if (inputs.length === 0) {
    throw new Error('There is nothing in the timeline to export.')
  }
  if (inputs.length === 1) {
    // One segment is not a concatenation. The filter would work, but running it
    // means a second full re-encode of something already encoded correctly.
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputs[0],
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      output
    ]
  }

  const filter =
    inputs.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('') +
    `concat=n=${inputs.length}:v=1:a=1[v][a]`

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '[a]',
    ...VIDEO_ARGS,
    ...AUDIO_ARGS,
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    output
  ]
}

/**
 * The percentage out of `-progress pipe:1`.
 *
 * ffmpeg writes `key=value` lines to stdout, of which `out_time_ms` is the one
 * that means "how far through the output we are". It is microseconds despite
 * the name — a long-standing quirk, and reading it as milliseconds would report
 * a thousandth of the real progress, which looks exactly like a hang.
 */
export function parseProgress(chunk: string): number | null {
  const match = /out_time_(?:ms|us)=(\d+)/.exec(chunk)
  if (!match) return null
  const micros = Number(match[1])
  return Number.isFinite(micros) ? micros / 1_000_000 : null
}

/* -------------------------------------------------------------- spawning */

export interface ProbeResult {
  durationSec: number
  width: number
  height: number
  hasAudio: boolean
}

/**
 * What ffmpeg says about a file it was given nothing to do with.
 *
 * Pure, and exported, for the same reason the argument builders are: this is
 * parsing, and parsing is where the bugs are. Asserted in
 * `test/ffmpeg-args.test.ts` against real ffmpeg output without spawning
 * anything.
 */
export function parseProbeOutput(stderr: string): ProbeResult {
  // `Duration: 00:00:08.05, start: ...`
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const durationSec = duration
    ? Number(duration[1]) * 3600 +
      Number(duration[2]) * 60 +
      Number(duration[3])
    : 0

  // `Stream #0:0[0x1](und): Video: h264 (avc1 / ...), yuv420p, 1920x1080 [SAR ...`
  // The dimensions are the first WxH on the video stream's line. Anchored to
  // that line rather than searched globally, or the SAR/DAR ratios that follow
  // it get picked up as a resolution.
  const videoLine = /^.*Stream #.*: Video:.*$/m.exec(stderr)?.[0] ?? ''
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine)

  return {
    durationSec,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    hasAudio: /Stream #.*: Audio:/.test(stderr)
  }
}

/**
 * Read a clip's real length and shape.
 *
 * `ffmpeg -i` with no output file prints the stream summary and then exits
 * non-zero complaining that no output was specified. That non-zero is the
 * normal, expected result here — the information wanted was already printed on
 * the way to it — so the exit code is ignored and the output is what is read.
 */
export async function probe(path: string): Promise<ProbeResult> {
  const stderr = await runForStderr(ffmpegPath(), ['-hide_banner', '-i', path])

  const result = parseProbeOutput(stderr)
  if (result.durationSec === 0) {
    throw new Error(
      `Could not read a duration out of ${path} — ffmpeg did not recognise it as a media file.`
    )
  }
  return result
}

/** Everything the process said, whatever it exited with. */
function runForStderr(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', () => resolve(err))
  })
}

/**
 * Run one ffmpeg pass, reporting how far through it is.
 *
 * `totalSec` is what turns `out_time` into a percentage — ffmpeg does not know
 * the output length in advance, but the caller does, because it is the sum of
 * the segments it asked for.
 */
export function runFfmpeg(
  args: string[],
  totalSec: number,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args)
    let err = ''

    child.stdout.on('data', (d: Buffer) => {
      const seconds = parseProgress(d.toString())
      if (seconds !== null && totalSec > 0 && onProgress) {
        onProgress(Math.min(1, seconds / totalSec))
      }
    })
    // Kept even at `-loglevel error`: when this fails, this is the only thing
    // that will say why.
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))

    child.on('error', (cause) =>
      reject(
        new Error(
          `Could not start ffmpeg (${cause.message}). In a packaged build this is almost always the asar: the binary has to be unpacked to be executable.`
        )
      )
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}
