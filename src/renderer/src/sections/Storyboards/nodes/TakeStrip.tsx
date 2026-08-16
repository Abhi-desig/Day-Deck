import { useState } from 'react'
import type { StoryTake, VideoJobProgress } from '@shared/types'
import { cn } from '../../../lib/cn'
import { takeUrl } from '../../../lib/media'

/**
 * The clips generated for one scene.
 *
 * Every take is kept and every take is shown, because "regenerate" must never
 * read as "throw the last one away" — the previous take often *was* the better
 * one, and there is no undo for something that has to be paid for again.
 *
 * Clicking a take chooses it: that is the one that flows into the cut. The
 * chosen state is a ring rather than a checkbox because the strip is already a
 * row of pictures, and a row of pictures with checkboxes under it is a form.
 */
export function TakeStrip({
  takes,
  progress,
  busy,
  onChoose,
  onDelete
}: {
  takes: StoryTake[]
  /** The job in flight for *this* scene, if any. */
  progress: VideoJobProgress | null
  busy: boolean
  onChoose(takeId: string): void
  onDelete(takeId: string): void
}) {
  const [playing, setPlaying] = useState<string | null>(null)

  if (takes.length === 0 && !busy) return null

  return (
    <div className="nowheel nodrag flex shrink-0 items-stretch gap-1.5 overflow-x-auto pb-0.5">
      {busy && <Working progress={progress} />}

      {takes.map((take) => (
        <div
          key={take.id}
          className={cn(
            'group/take relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-md border bg-well-deep transition-colors',
            take.chosen
              ? 'border-amber/70 ring-1 ring-amber/40'
              : 'border-line-soft hover:border-line'
          )}
        >
          {playing === take.id ? (
            // Only the take being watched gets a live element. A strip of
            // autoplaying <video>s is four decoders running behind a card
            // nobody is looking at.
            <video
              src={takeUrl(take.id)}
              controls
              autoPlay
              onEnded={() => setPlaying(null)}
              className="size-full object-cover"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(take.id)}
              title={take.prompt || 'Play this take'}
              className="grid size-full place-items-center"
            >
              {take.poster ? (
                <img
                  src={take.poster}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
              <span className="relative grid size-7 place-items-center rounded-full border border-line bg-surface/80 text-[10px] text-ink-dim backdrop-blur-sm">
                ▶
              </span>
            </button>
          )}

          <span className="pointer-events-none absolute left-1 top-1 rounded bg-surface/80 px-1 text-[9px] tabular-nums text-ink-faint backdrop-blur-sm">
            {take.durationSec ? `${take.durationSec}s` : 'clip'}
          </span>

          <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover/take:opacity-100">
            {!take.chosen && (
              <button
                type="button"
                onClick={() => onChoose(take.id)}
                title="Use this take in the cut"
                className="rounded bg-surface/90 px-1.5 py-px text-[9.5px] text-ink-dim backdrop-blur-sm hover:text-ink"
              >
                Use
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(take.id)}
              title="Delete this take and its file"
              className="rounded bg-surface/90 px-1.5 py-px text-[9.5px] text-ink-faint backdrop-blur-sm hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The placeholder while a clip is being made.
 *
 * It says which phase and how long, because a Veo job is minutes of nothing and
 * an undifferentiated spinner over that length reads as a hang. "Queued at the
 * provider for 90s" is a thing you wait through; a spinner for 90s is a thing
 * you force-quit.
 */
function Working({ progress }: { progress: VideoJobProgress | null }) {
  return (
    <div className="grid h-[72px] w-[128px] shrink-0 place-items-center rounded-md border border-dashed border-amber/40 bg-amber/5 px-2 text-center">
      <span className="text-[9.5px] leading-tight text-amber-soft/90">
        {label(progress)}
      </span>
    </div>
  )
}

function label(progress: VideoJobProgress | null): string {
  if (!progress) return 'Starting…'
  switch (progress.phase) {
    case 'submitting':
      return 'Submitting…'
    case 'polling':
      return `Generating… ${progress.elapsedSec}s`
    case 'downloading':
      return `Downloading take ${progress.index + 1}…`
    case 'done':
      return 'Done'
    case 'error':
      return 'Failed'
    default:
      // The export phases share this channel and are reported on the timeline
      // node, not here. A clip strip showing "joining — 40%" would be reporting
      // work that has nothing to do with this scene.
      return 'Working…'
  }
}
