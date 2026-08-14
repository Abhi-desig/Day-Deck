import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { OMNI_DURATIONS, type StoryFrame } from '@shared/types'
import { cn } from '../../../lib/cn'
import { copyText } from '../../../lib/clipboard'
import { goalStyle } from '../../../lib/goalColor'
import { isAutoNamed, sceneLabel } from '../../../lib/scene'
import { usePrefs } from '../../../store/usePrefs'
import { useStoryboards } from '../../../store/useStoryboards'
import { Field } from '../Field'
import { RefThumb } from './RefThumb'
import { HANDLE, type SceneNodeType } from './types'

export const SCENE_MIN_W = 220
export const SCENE_MIN_H = 180

/**
 * One scene on the board.
 *
 * All of the pointer maths this used to carry — dragging, resizing, and dividing
 * every delta by the live zoom so the card stayed glued to the cursor inside a
 * scaled world — now belongs to React Flow. What is left is the card itself and
 * the one rule that matters: writes happen when a gesture ends or a field blurs,
 * never per frame and never per keystroke, because each one is an IPC round trip.
 */
export function SceneNode({ id, data, selected }: NodeProps<SceneNodeType>) {
  const { frame, index, refs } = data
  const patchFrame = useStoryboards((s) => s.patchFrame)
  const removeFrame = useStoryboards((s) => s.removeFrame)
  const placeFrame = useStoryboards((s) => s.placeFrame)
  const sceneNumbers = usePrefs((s) => s.sceneNumbers)

  const style = goalStyle(frame.color)
  const label = sceneLabel(frame, index)

  return (
    <>
      <NodeResizer
        minWidth={SCENE_MIN_W}
        minHeight={SCENE_MIN_H}
        isVisible={selected}
        // On end, not on change: resizing writes one row when the pointer lifts.
        onResizeEnd={(_e, params) =>
          void placeFrame(frame.id, {
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height
          })
        }
      />

      {/* The spine comes in at the top, references at the left, so the two
          kinds of wire never land on the same point. */}
      <Handle
        type="target"
        id={HANDLE.sceneBriefIn}
        position={Position.Top}
        className="!size-2 !border-line !bg-raised"
      />
      <Handle
        type="target"
        id={HANDLE.sceneRefIn}
        position={Position.Left}
        className="!size-2.5 !border-line !bg-surface"
      />

      <div
        data-node
        data-scene-id={frame.id}
        className={cn(
          'group/frame flex size-full select-none flex-col overflow-hidden rounded-xl border',
          'glass-flat card-shadow-soft',
          selected ? 'border-amber/50' : style.border
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-2.5 py-1.5">
          {sceneNumbers ? (
            <span
              // The number is the card's position on the board, and until now it
              // was only ever visible as the placeholder of an empty title — so
              // naming a scene, or letting the planner name it, erased it. This
              // renders regardless of the title, which is the whole point.
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
              // Auto-named cards show their number in the placeholder rather than
              // as text, so the field stays empty and clearing a name puts the
              // number straight back.
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
            className="nodrag grid size-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/frame:opacity-100 hover:bg-line hover:text-ink"
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

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2.5">
          <Field
            multiline
            value={frame.description}
            placeholder="What happens in this shot…"
            onCommit={(description) => void patchFrame(frame.id, { description })}
            className="nodrag nowheel min-h-[34px] flex-1 text-[12px] leading-relaxed text-ink-dim"
          />

          {refs.length > 0 && (
            <div className="nowheel flex shrink-0 gap-1 overflow-x-auto pb-0.5">
              {refs.map((item) => (
                <RefThumb
                  key={item.id}
                  item={item}
                  size={30}
                  onDetach={() => void detach(frame.id, item.id)}
                />
              ))}
            </div>
          )}

          <PromptBlock frame={frame} nodeId={id} />
        </div>
      </div>
    </>
  )
}

function detach(frameId: string, itemId: string): Promise<void> {
  return useStoryboards.getState().disconnectRef(frameId, itemId)
}

/**
 * How long this shot runs.
 *
 * The options are the model's supported generation lengths and nothing else — a
 * free number field here would let you plan a seven-second shot that cannot be
 * rendered. "—" is a real option, not a placeholder: a scene with no duration
 * decided yet is a different state from one the planner has costed.
 */
function DurationPicker({ frame }: { frame: StoryFrame }) {
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

/**
 * The prompt allocated to this frame.
 *
 * Separated from the description with its own copy action because it is the
 * thing that leaves the app — a prompt you have to select by hand out of a
 * paragraph is a prompt you will paste with half a sentence of context stuck to
 * the front of it.
 */
function PromptBlock({ frame, nodeId }: { frame: StoryFrame; nodeId: string }) {
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
