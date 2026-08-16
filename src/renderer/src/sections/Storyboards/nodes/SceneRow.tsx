import { useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { OMNI_DURATIONS, type StoryFrame } from '@shared/types'
import { cn } from '../../../lib/cn'
import { copyText } from '../../../lib/clipboard'
import { goalStyle } from '../../../lib/goalColor'
import { isAutoNamed, sceneLabel } from '../../../lib/scene'
import { usePrefs } from '../../../store/usePrefs'
import { useStoryboards } from '../../../store/useStoryboards'
import { useTakes } from '../../../store/useTakes'
import { Field } from '../Field'
import { RefThumb } from './RefThumb'
import { TakeStrip } from './TakeStrip'
import type { SceneData } from './types'

/**
 * The parts of a scene, once — and the row the container draws them in.
 *
 * A scene is the same thing whether it is a card on open canvas or a row inside
 * the container: a title, a length, the references wired to it, and the prompt
 * it produces. That was written twice for about ten minutes, which is how long
 * it takes for two copies of a text field to disagree about when they commit.
 * `SceneNode` imports the pieces from here; `SceneRow` is the container's
 * arrangement of the same pieces.
 */

/* ------------------------------------------------------------ the pieces */

/**
 * How long this shot runs.
 *
 * The options are the model's supported generation lengths and nothing else — a
 * free number field here would let you plan a seven-second shot that cannot be
 * rendered. "—" is a real option, not a placeholder: a scene with no duration
 * decided yet is a different state from one the planner has costed.
 */
export function DurationPicker({ frame }: { frame: StoryFrame }) {
  const patchFrame = useStoryboards((s) => s.patchFrame)

  return (
    <select
      value={frame.durationSec ?? ''}
      onChange={(e) =>
        void patchFrame(frame.id, {
          durationSec: e.target.value === '' ? null : Number(e.target.value)
        })
      }
      aria-label="Scene duration"
      title="Generation length"
      className={cn(
        'nodrag shrink-0 rounded border border-line-soft bg-transparent px-1 py-px text-[10px] tabular-nums outline-none transition-colors hover:border-line',
        frame.durationSec == null ? 'text-ink-faint' : 'text-ink-dim'
      )}
    >
      <option value="">—</option>
      {OMNI_DURATIONS.map((seconds) => (
        <option key={seconds} value={seconds}>
          {seconds}s
        </option>
      ))}
    </select>
  )
}

/** The references wired into one scene, with their detach affordance. */
export function RefStrip({
  frameId,
  refs,
  size = 30
}: {
  frameId: string
  refs: SceneData['refs']
  size?: number
}) {
  const disconnectRef = useStoryboards((s) => s.disconnectRef)
  if (refs.length === 0) return null

  return (
    <div className="nowheel flex shrink-0 gap-1 overflow-x-auto pb-0.5">
      {refs.map((item) => (
        <RefThumb
          key={item.id}
          item={item}
          size={size}
          onDetach={() => void disconnectRef(frameId, item.id)}
        />
      ))}
    </div>
  )
}

/**
 * The prompt allocated to this frame.
 *
 * Separated from the description with its own copy action because it is the
 * thing that leaves the app — a prompt you have to select by hand out of a
 * paragraph is a prompt you will paste with half a sentence of context stuck to
 * the front of it.
 */
export function PromptBlock({
  frame,
  nodeId
}: {
  frame: StoryFrame
  nodeId: string
}) {
  const patchFrame = useStoryboards((s) => s.patchFrame)
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy(): Promise<void> {
    if (!frame.prompt.trim()) return
    const ok = await copyText(frame.prompt)
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div
      className="shrink-0 rounded-lg border border-line-soft bg-well p-1.5"
      data-prompt-for={nodeId}
    >
      <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
          Prompt
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!frame.prompt.trim()}
          className={cn(
            'nodrag rounded px-1.5 py-px text-[10px] transition-colors',
            copied
              ? 'text-cat-learn'
              : 'text-ink-faint hover:bg-line hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent'
          )}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <Field
        multiline
        value={frame.prompt}
        placeholder="The prompt for this frame…"
        onCommit={(prompt) => void patchFrame(frame.id, { prompt })}
        className="nodrag nowheel max-h-[92px] min-h-[30px] font-mono text-[11px] leading-relaxed text-ink-dim"
      />
    </div>
  )
}

/* --------------------------------------------------------------- the row */

/**
 * One scene as a row inside the container.
 *
 * The row is `relative` and carries its own target handle, so a reference wire
 * lands on the scene it belongs to rather than on the box — the mirror image of
 * what `ListNode`'s rows do on the source side. The handle id is the frame id,
 * which is the whole mechanism: `onConnect` reads it back to know which scene
 * was wired.
 */
export function SceneRow({ frame, index, refs }: SceneData) {
  const patchFrame = useStoryboards((s) => s.patchFrame)
  const removeFrame = useStoryboards((s) => s.removeFrame)
  const sceneNumbers = usePrefs((s) => s.sceneNumbers)

  const style = goalStyle(frame.color)
  const label = sceneLabel(frame, index)

  return (
    <div
      // Read by the canvas's double-click handler to open focus mode on the
      // right scene — the container is one node, so the event cannot say which
      // row it came from any other way.
      data-scene-id={frame.id}
      className="group/row relative border-b border-line-soft/50 px-2.5 py-2 last:border-b-0 hover:bg-hover/40"
    >
      <Handle
        type="target"
        id={frame.id}
        position={Position.Left}
        title={`References for ${label}`}
        className="!left-0 !size-2.5 !border-line !bg-surface"
      />

      <header className="flex items-center gap-2 pb-1">
        {sceneNumbers ? (
          <span
            title={`Scene ${index + 1}`}
            className={cn(
              'grid size-[18px] shrink-0 place-items-center rounded-md border text-[10px] tabular-nums',
              style.border,
              style.text
            )}
          >
            {index + 1}
          </span>
        ) : (
          <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
        )}

        <Field
          value={frame.title}
          placeholder={label}
          onCommit={(title) => void patchFrame(frame.id, { title })}
          className={cn(
            'nodrag min-w-0 flex-1 text-[12.5px]',
            isAutoNamed(frame)
              ? 'text-ink placeholder:!text-ink placeholder:!opacity-100'
              : 'text-ink'
          )}
        />
        <DurationPicker frame={frame} />
        <button
          type="button"
          onClick={() => void removeFrame(frame.id)}
          aria-label={`Delete ${label}`}
          className="nodrag grid size-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/row:opacity-100 hover:bg-line hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-1.5 pl-[26px]">
        <Field
          multiline
          value={frame.description}
          placeholder="What happens in this shot…"
          onCommit={(description) => void patchFrame(frame.id, { description })}
          className="nodrag nowheel max-h-[92px] min-h-[30px] text-[12px] leading-relaxed text-ink-dim"
        />

        <RefStrip frameId={frame.id} refs={refs} size={28} />

        <PromptBlock frame={frame} nodeId={`scene:${frame.id}`} />

        <TakeControls frame={frame} />
      </div>
    </div>
  )
}

/**
 * Generate, revise, choose, finalise — everything about the clips for one shot.
 *
 * Kept in the row rather than in a panel because all four are about *this*
 * scene, and a scene you have to select before you can generate it is a scene
 * you will generate the wrong one of.
 */
export function TakeControls({ frame }: { frame: StoryFrame }) {
  const takes = useTakes((s) => s.byFrame[frame.id])
  const loadTakes = useTakes((s) => s.load)
  const generate = useTakes((s) => s.generate)
  const choose = useTakes((s) => s.choose)
  const removeTake = useTakes((s) => s.remove)
  const busyFrameId = useTakes((s) => s.busyFrameId)
  const progress = useTakes((s) => s.progress)
  const patchFrame = useStoryboards((s) => s.patchFrame)

  const [note, setNote] = useState(frame.revisionNote)
  const [revising, setRevising] = useState(false)

  // `undefined` means never loaded, which is a different thing from "none" —
  // so a scene with no takes is asked about once and never again.
  useEffect(() => {
    if (takes === undefined) void loadTakes(frame.id)
  }, [takes, loadTakes, frame.id])

  const mine = busyFrameId === frame.id
  const blocked = busyFrameId !== null && !mine
  const hasPrompt = frame.prompt.trim() !== ''

  async function revise(): Promise<void> {
    const text = note.trim()
    if (!text || revising) return
    setRevising(true)
    try {
      // The note is remembered before the ask, so the field still says what you
      // typed whether the revision lands, is refused, or is never approved.
      await patchFrame(frame.id, { revisionNote: text })
      window.dispatchEvent(
        new CustomEvent(REVISE_EVENT, {
          detail: { frameId: frame.id, note: text }
        })
      )
    } finally {
      setRevising(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <TakeStrip
        takes={takes ?? []}
        progress={mine ? progress : null}
        busy={mine}
        onChoose={(id) => void choose(id, frame.id)}
        onDelete={(id) => void removeTake(id, frame.id)}
      />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void generate(frame.id, { takes: 1 })}
          disabled={mine || blocked || !hasPrompt}
          title={
            !hasPrompt
              ? 'Write a prompt for this shot first'
              : blocked
                ? 'Another clip is generating — video runs one at a time'
                : 'Generate a clip from this prompt'
          }
          className="nodrag rounded border border-amber/40 px-1.5 py-0.5 text-[10.5px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
        >
          {mine ? 'Generating…' : 'Generate'}
        </button>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void revise()
          }}
          placeholder="Make it slower and colder…"
          className="nodrag min-w-0 flex-1 rounded border border-line-soft bg-transparent px-1.5 py-0.5 text-[10.5px] text-ink-dim outline-none transition-colors placeholder:text-ink-faint hover:border-line focus:border-amber/40"
        />

        <button
          type="button"
          onClick={() => void revise()}
          disabled={!note.trim() || revising}
          title="Rewrite this prompt to that note — nothing changes until you approve it"
          className="nodrag rounded border border-line-soft px-1.5 py-0.5 text-[10.5px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
        >
          {revising ? '…' : 'Revise'}
        </button>

        <button
          type="button"
          onClick={() => void patchFrame(frame.id, { isFinal: !frame.isFinal })}
          aria-pressed={frame.isFinal}
          title={
            frame.isFinal
              ? 'Settled — this shot flows into the cut'
              : 'Mark this shot settled, so it flows into the cut'
          }
          className={cn(
            'nodrag shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors',
            frame.isFinal
              ? 'border-cat-learn/50 bg-cat-learn/10 text-cat-learn'
              : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
          )}
        >
          {frame.isFinal ? '✓ Final' : 'Final'}
        </button>
      </div>
    </div>
  )
}

/**
 * How a row asks the section to open the approval window.
 *
 * A DOM event rather than a prop, and the reason is React Flow: node data comes
 * from a pure builder that is memoised on the store's rows, so threading a
 * callback through it would either break that memoisation or need a context
 * provider wrapped around the canvas for one button. The section listens for
 * this and runs the same propose/approve/apply path the toolbar's prompt pass
 * uses — the approval still happens in one place.
 */
export const REVISE_EVENT = 'day-deck:revise-scene'

export interface ReviseDetail {
  frameId: string
  note: string
}
