import { describe, expect, it } from 'vitest'
import {
  buildConcatArgs,
  buildTrimArgs,
  parseProbeOutput,
  parseProgress,
  unpacked
} from '../src/main/services/ffmpeg'

/**
 * Everything that decides what ffmpeg is asked to do, asserted without ever
 * starting a process.
 *
 * That is the whole reason the builders are pure. A wrong argument here is not
 * a crash — it is an export that succeeds and produces a film with frozen
 * frames at every cut, which is discovered by watching the file rather than by
 * anything the app could notice. So the flags that prevent that are pinned as
 * data, with the reason attached.
 */

/** Where an argument's value sits, so a flag's meaning is asserted with it. */
const valueOf = (args: string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1]

describe('trimming one segment', () => {
  const segment = { input: '/takes/a.mp4', startSec: 1.25, endSec: 4.5 }
  const args = buildTrimArgs(segment, '/out/000.mp4')

  it('seeks before the input and trims by duration after it', () => {
    // -ss before -i is the fast keyframe seek; -t after is the exact length.
    // Reversing them makes every trim land on the nearest keyframe instead of
    // where the user put the handle.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('-i'))
    expect(valueOf(args, '-ss')).toBe('1.250')
    // Duration, not end time. `-t 4.500` would run past the end of the segment.
    expect(valueOf(args, '-t')).toBe('3.250')
    expect(args).toContain('-accurate_seek')
  })

  it('re-encodes rather than stream-copying', () => {
    // The single most consequential flag in this file. `-c copy` can only cut
    // on a keyframe, so an arbitrary trim either moves or leaves undecodable
    // frames at the head of the segment — which plays as a freeze.
    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(args).not.toContain('copy')
  })

  it('keeps the audio Veo generated', () => {
    expect(valueOf(args, '-c:a')).toBe('aac')
  })

  it('asks for machine-readable progress and overwrites its own temp file', () => {
    expect(valueOf(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-y')
    expect(args[args.length - 1]).toBe('/out/000.mp4')
  })

  it('never produces a negative duration from an inverted segment', () => {
    const inverted = buildTrimArgs(
      { input: '/takes/a.mp4', startSec: 5, endSec: 2 },
      '/out/x.mp4'
    )
    expect(valueOf(inverted, '-t')).toBe('0.000')
  })
})

describe('joining the segments', () => {
  it('uses the concat filter, not the demuxer', () => {
    const args = buildConcatArgs(['/w/0.mp4', '/w/1.mp4', '/w/2.mp4'], '/out.mp4')

    // The demuxer is cheaper and silently produces frozen frames at the
    // boundaries unless every input shares a codec, timebase and parameter set
    // — which separately generated clips do not.
    const filter = valueOf(args, '-filter_complex')
    expect(filter).toBe('[0:v:0][0:a:0][1:v:0][1:a:0][2:v:0][2:a:0]concat=n=3:v=1:a=1[v][a]')
    expect(args).not.toContain('-f')

    // Every input is passed, in order.
    expect(args.filter((a) => a === '-i')).toHaveLength(3)
    expect(args.indexOf('/w/0.mp4')).toBeLessThan(args.indexOf('/w/2.mp4'))

    // And the filter's outputs are what gets written, not input 0.
    expect(args.filter((a) => a === '-map')).toHaveLength(2)
    expect(args).toContain('[v]')
    expect(args).toContain('[a]')
  })

  it('copies a single segment instead of re-encoding it again', () => {
    // One segment is not a concatenation, and running the filter over it would
    // be a second full re-encode of something already encoded correctly.
    const args = buildConcatArgs(['/w/0.mp4'], '/out.mp4')
    expect(valueOf(args, '-c')).toBe('copy')
    expect(args).not.toContain('-filter_complex')
  })

  it('refuses an empty timeline rather than writing a zero-byte film', () => {
    expect(() => buildConcatArgs([], '/out.mp4')).toThrow(/nothing in the timeline/i)
  })
})

describe('reading progress', () => {
  it('reads out_time in microseconds, despite the field being called ms', () => {
    // A long-standing ffmpeg quirk. Read as milliseconds this reports a
    // thousandth of the real progress, which is indistinguishable from a hang.
    expect(parseProgress('frame=12\nout_time_ms=4500000\nspeed=1x')).toBe(4.5)
    expect(parseProgress('out_time_us=250000')).toBe(0.25)
  })

  it('ignores lines that carry no progress', () => {
    expect(parseProgress('frame=12\nfps=30')).toBeNull()
    expect(parseProgress('')).toBeNull()
  })
})

describe('finding the binary in a packaged build', () => {
  it('rewrites app.asar to app.asar.unpacked', () => {
    // An executable cannot be run from inside an asar — the same trap node-pty's
    // spawn-helper already cost this repo. asarUnpack puts the real file beside
    // the archive; this is what points at it.
    expect(unpacked('/A/Day Deck.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg')).toBe(
      '/A/Day Deck.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    )
  })

  it('leaves a development path alone', () => {
    expect(unpacked('/repo/node_modules/ffmpeg-static/ffmpeg')).toBe(
      '/repo/node_modules/ffmpeg-static/ffmpeg'
    )
  })
})

/**
 * Reading a clip's length out of ffmpeg's own output.
 *
 * There is no ffprobe here on purpose: `ffprobe-static@3.1.0` ships an x86_64
 * binary inside its `darwin/arm64` directory, so on Apple Silicon without
 * Rosetta it cannot run at all — and it fails as "bad CPU type in executable",
 * which reads like a corrupt download rather than a package shipping the wrong
 * file. Using `ffmpeg -i` means one binary, and one that is by construction the
 * same architecture as the one doing the encoding.
 *
 * The sample below is real ffmpeg 6.0 output, kept verbatim.
 */
const FFMPEG_OUTPUT = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/takes/a.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:00:08.05, start: 0.000000, bitrate: 2618 kb/s
  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 2485 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
At least one output file must be specified`

describe('reading a clip without ffprobe', () => {
  it('reads duration, dimensions and audio out of ffmpeg -i', () => {
    const probe = parseProbeOutput(FFMPEG_OUTPUT)
    expect(probe.durationSec).toBeCloseTo(8.05, 2)
    expect(probe.width).toBe(1920)
    expect(probe.height).toBe(1080)
    expect(probe.hasAudio).toBe(true)
  })

  it('does not mistake the SAR/DAR ratios for a resolution', () => {
    // `[SAR 1:1 DAR 16:9]` sits right after the real dimensions on the same
    // line, and a global search for a number pair finds plenty of wrong ones.
    expect(parseProbeOutput(FFMPEG_OUTPUT).width).not.toBe(1)
    expect(parseProbeOutput(FFMPEG_OUTPUT).height).not.toBe(9)
  })

  it('reads an hour-long duration, not just the seconds field', () => {
    expect(
      parseProbeOutput('  Duration: 01:02:03.50, start: 0.0').durationSec
    ).toBeCloseTo(3723.5, 2)
  })

  it('notices a clip with no audio', () => {
    const silent = FFMPEG_OUTPUT.split('\n')
      .filter((l) => !l.includes(': Audio:'))
      .join('\n')
    expect(parseProbeOutput(silent).hasAudio).toBe(false)
  })

  it('reports nothing rather than guessing when handed junk', () => {
    const probe = parseProbeOutput('No such file or directory')
    expect(probe.durationSec).toBe(0)
    expect(probe.width).toBe(0)
    expect(probe.hasAudio).toBe(false)
  })
})
