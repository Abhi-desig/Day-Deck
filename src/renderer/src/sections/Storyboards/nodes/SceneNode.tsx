import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { cn } from '../../../lib/cn'
import { goalStyle } from '../../../lib/goalColor'
import { isAutoNamed, sceneLabel } from '../../../lib/scene'
import { usePrefs } from '../../../store/usePrefs'
import { useStoryboards } from '../../../store/useStoryboards'
import { Field } from '../Field'
import {
  DurationPicker,
  PromptBlock,
  RefStrip,
  TakeControls
} from './SceneRow'
import { HANDLE, type SceneNodeType } from './types'

export const SCENE_MIN_W = 220
export const SCENE_MIN_H = 180

/**
 * One scene on the board, as a card you position yourself.
 *
 * All of the pointer maths this used to carry — dragging, resizing, and dividing
 * every delta by the live zoom so the card stayed glued to the cursor inside a
 * scaled world — now belongs to React Flow. What is left is the card itself and
 * the one rule that matters: writes happen when a gesture ends or a field blurs,
 * never per frame and never per keystroke, because each one is an IPC round trip.
 *
 * The contents come from `SceneRow`, which the container node also draws — this
 * is the free-canvas *arrangement* of a scene, not a second definition of one.
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
            onCommit={(description) =>
              void patchFrame(frame.id, { description })
            }
            className="nodrag nowheel min-h-[34px] flex-1 text-[12px] leading-relaxed text-ink-dim"
          />

          <RefStrip frameId={frame.id} refs={refs} />

          <PromptBlock frame={frame} nodeId={id} />

          <TakeControls frame={frame} />
        </div>
      </div>
    </>
  )
}
