import { useCallback, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CutProposal, CutSegmentInput, StoryTake } from '@shared/types'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../lib/scene'
import { takeUrl } from '../../../lib/media'
import { takeLength, useCut } from '../../../store/useCut'
import { HANDLE, TIMELINE_W, type TimelineNodeType } from './types'

/**
 * The cut, as a strip you can trim.
 *
 * Every interactive area in here carries `nodrag nowheel`. That is not
 * decoration — without it a scrub gesture pans the canvas out from under the
 * cursor and a wheel over the strip zooms the world instead of scrolling the
 * clips, which is the established failure mode this codebase already documents
 * on `SceneNode`.
 *
 * The other rule is the store's: dragging a handle updates local state every
 * frame and writes exactly once, when the pointer lifts.
 */
export function TimelineNode({ data }: NodeProps<TimelineNodeType>) {
  const { board, takes } = data

  const segments = useCut((s) => s.segments)
  const lengths = useCut((s) => s.lengths)
  const commit = useCut((s) => s.commit)
  const populate = useCut((s) => s.populate)
  const exportCut = useCut((s) => s.exportCut)
  const exporting = useCut((s) => s.exporting)
  const render = useCut((s) => s.render)
  const propose = useCut((s) => s.propose)
  const proposing = useCut((s) => s.proposing)
  const proposal = useCut((s) => s.proposal)
  const accept = useCut((s) => s.acceptProposal)
  const discard = useCut((s) => s.discardProposal)

  const takeById = useMemo(
    () => new Map(takes.map((t) => [t.id, t])),
    [takes]
  )

  /** Local while a handle is being dragged; null the rest of the time. */
  const [draft, setDraft] = useState<CutSegmentInput[] | null>(null)
  const live = draft ?? segments.map(toInput)

  const total = live.reduce(
    (n, s) => n + Math.max(0, s.endSec - s.startSec),
    0
  )

  const write = useCallback(
    (next: CutSegmentInput[]) => {
      setDraft(null)
      void commit(board.id, next)
    },
    [commit, board.id]
  )

  return (
    <>
      <Handle
        type="target"
        id={HANDLE.timelineIn}
        position={Position.Left}
        className="!size-2 !border-line !bg-raised"
      />

      <div
        data-node
        style={{ width: TIMELINE_W }}
        className="flex select-none flex-col overflow-hidden rounded-xl border border-line-soft glass-flat card-shadow-soft"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
            The cut
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
            {live.length === 0
              ? 'empty'
              : `${live.length} · ${formatDuration(Math.round(total))}`}
          </span>
          <button
            type="button"
            onClick={() => void populate(board.id)}
            title="One segment per final scene's chosen take, at full length"
            className="nodrag shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:border-line hover:text-ink"
          >
            Populate
          </button>
          <button
            type="button"
            onClick={() =>
              void propose(
                board.id,
                // Only what is already in the timeline. Every clip named here
                // is uploaded in full, so "the whole board" is a cost nobody
                // asked for.
                [...new Set(live.map((s) => s.takeId))]
              )
            }
            disabled={proposing || live.length === 0}
            title="Let the model watch these clips and suggest where to cut them"
            className="nodrag shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
          >
            {proposing ? 'Watching…' : 'AI trim'}
          </button>
          <button
            type="button"
            onClick={() => void exportCut(board.id)}
            disabled={exporting || live.length === 0}
            className="nodrag shrink-0 rounded border border-amber/40 px-1.5 py-0.5 text-[11px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </header>

        {proposal && (
          <Proposal
            proposal={proposal}
            onAccept={() => void accept(board.id)}
            onDiscard={discard}
          />
        )}

        {render && (
          <p className="shrink-0 border-b border-line-soft/70 bg-amber/5 px-3 py-1 text-[10.5px] text-amber-soft/90">
            {renderLabel(render)}
          </p>
        )}

        <div className="nowheel nodrag min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 py-2">
          {live.length === 0 ? (
            <p className="px-1 py-3 text-[11.5px] leading-relaxed text-ink-faint">
              Nothing in the cut yet. Mark the shots you are happy with as Final,
              then Populate.
            </p>
          ) : (
            <div className="flex items-stretch gap-1.5">
              {live.map((segment, index) => (
                <Clip
                  key={`${segment.takeId}-${index}`}
                  segment={segment}
                  take={takeById.get(segment.takeId) ?? null}
                  full={takeLength(
                    lengths,
                    segment.takeId,
                    takeById.get(segment.takeId)?.durationSec ?? 0
                  )}
                  first={index === 0}
                  last={index === live.length - 1}
                  onDraft={(next) =>
                    setDraft(live.map((s, i) => (i === index ? next : s)))
                  }
                  onCommit={(next) =>
                    write(live.map((s, i) => (i === index ? next : s)))
                  }
                  onRemove={() => write(live.filter((_, i) => i !== index))}
                  onMove={(by) => write(reorder(live, index, index + by))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const toInput = (s: {
  takeId: string
  startSec: number
  endSec: number
}): CutSegmentInput => ({
  takeId: s.takeId,
  startSec: s.startSec,
  endSec: s.endSec
})

/** Move one item, clamped — dragging past either end is a no-op, not a wrap. */
function reorder(
  list: CutSegmentInput[],
  from: number,
  to: number
): CutSegmentInput[] {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * One clip in the strip, with its in and out handles.
 *
 * The handles are pointer-captured, which is what makes a drag survive the
 * cursor leaving the 8px grab area — without it a quick trim stops the moment
 * the pointer outruns the handle, which feels like the app dropping the
 * gesture.
 */
function Clip({
  segment,
  take,
  full,
  first,
  last,
  onDraft,
  onCommit,
  onRemove,
  onMove
}: {
  segment: CutSegmentInput
  take: StoryTake | null
  full: number
  first: boolean
  last: boolean
  onDraft(next: CutSegmentInput): void
  onCommit(next: CutSegmentInput): void
  onRemove(): void
  onMove(by: number): void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const length = Math.max(0, segment.endSec - segment.startSec)

  /**
   * Pixels of drag to seconds of clip.
   *
   * Against the element's own width rather than a constant, so the mapping
   * stays right at any zoom — the canvas scales this element, and a fixed
   * pixels-per-second would make trimming twice as coarse when zoomed out.
   */
  function drag(edge: 'start' | 'end', event: React.PointerEvent): void {
    event.stopPropagation()
    event.preventDefault()
    const box = boxRef.current
    if (!box || full <= 0) return

    const width = box.getBoundingClientRect().width || 1
    const perPixel = full / width
    const originX = event.clientX
    const origin = { ...segment }
    let latest = origin

    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent): void => {
      const delta = (e.clientX - originX) * perPixel
      latest =
        edge === 'start'
          ? {
              ...origin,
              // Never past the out point, never before the clip starts.
              startSec: clamp(origin.startSec + delta, 0, origin.endSec - 0.1)
            }
          : {
              ...origin,
              endSec: clamp(origin.endSec + delta, origin.startSec + 0.1, full)
            }
      onDraft(latest)
    }

    const up = (): void => {
      target.releasePointerCapture(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // One write, when the gesture ends. Never per frame.
      onCommit(latest)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={boxRef}
      className="group/clip relative h-[78px] w-[120px] shrink-0 overflow-hidden rounded-md border border-line-soft bg-well-deep"
    >
      {take ? (
        <video
          src={takeUrl(take.id)}
          muted
          preload="metadata"
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-70"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-[10px] text-amber-soft/80">
          missing
        </span>
      )}

      <span className="pointer-events-none absolute left-1 top-1 rounded bg-surface/85 px-1 text-[9px] tabular-nums text-ink-dim backdrop-blur-sm">
        {length.toFixed(1)}s
      </span>

      {/* The in and out handles. `nodrag` on each, or grabbing one drags the
          node it lives in instead of trimming the clip. */}
      <button
        type="button"
        aria-label="Trim the start"
        onPointerDown={(e) => drag('start', e)}
        className="nodrag absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-amber/40 opacity-0 transition-opacity group-hover/clip:opacity-100"
      />
      <button
        type="button"
        aria-label="Trim the end"
        onPointerDown={(e) => drag('end', e)}
        className="nodrag absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-amber/40 opacity-0 transition-opacity group-hover/clip:opacity-100"
      />

      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between opacity-0 transition-opacity group-hover/clip:opacity-100">
        <span className="flex gap-0.5">
          <Step label="Move left" glyph="‹" disabled={first} onClick={() => onMove(-1)} />
          <Step label="Move right" glyph="›" disabled={last} onClick={() => onMove(1)} />
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove from the cut"
          className="nodrag rounded bg-surface/90 px-1 text-[9.5px] text-ink-faint backdrop-blur-sm hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/**
 * The AI's suggestion, shown but not applied.
 *
 * Every segment carries the reason it was chosen, because that is what the
 * approval is actually made against — a list of timecodes with no argument
 * behind them is not something anyone can agree or disagree with. Nothing is
 * written until Use this cut, consistent with every other AI surface here.
 */
function Proposal({
  proposal,
  onAccept,
  onDiscard
}: {
  proposal: CutProposal
  onAccept(): void
  onDiscard(): void
}) {
  const total = proposal.segments.reduce(
    (n, s) => n + Math.max(0, s.endSec - s.startSec),
    0
  )

  return (
    <div className="nowheel nodrag max-h-[180px] shrink-0 overflow-y-auto border-b border-line-soft/70 bg-amber/5 px-3 py-2">
      <div className="flex items-center gap-2 pb-1">
        <span className="flex-1 text-[10.5px] text-amber-soft/90">
          {proposal.segments.length} segments · {total.toFixed(1)}s · nothing is
          changed until you accept
        </span>
        <button
          type="button"
          onClick={onAccept}
          className="rounded border border-amber/40 px-1.5 py-0.5 text-[10.5px] text-amber-soft hover:bg-amber/10"
        >
          Use this cut
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-faint hover:text-ink"
        >
          Discard
        </button>
      </div>

      <ol className="space-y-0.5">
        {proposal.segments.map((segment, i) => (
          <li
            key={`${segment.takeId}-${i}`}
            className="flex gap-2 text-[10.5px] leading-relaxed text-ink-dim"
          >
            <span className="shrink-0 tabular-nums text-ink-faint">
              {segment.startSec.toFixed(1)}–{segment.endSec.toFixed(1)}s
            </span>
            <span className="min-w-0 flex-1">{segment.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Step({
  label,
  glyph,
  disabled,
  onClick
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'nodrag rounded bg-surface/90 px-1 text-[9.5px] backdrop-blur-sm',
        disabled ? 'text-ink-faint/40' : 'text-ink-faint hover:text-ink'
      )}
    >
      {glyph}
    </button>
  )
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n))

function renderLabel(progress: {
  phase: string
  index?: number
  total?: number
  fraction?: number
  path?: string
  message?: string
}): string {
  const pct = Math.round((progress.fraction ?? 0) * 100)
  switch (progress.phase) {
    case 'trimming':
      return `Trimming clip ${(progress.index ?? 0) + 1} of ${progress.total} — ${pct}%`
    case 'joining':
      return `Joining — ${pct}%`
    case 'exported':
      return `Exported to ${progress.path}`
    case 'renderError':
      return progress.message ?? 'The export failed.'
    default:
      return ''
  }
}
