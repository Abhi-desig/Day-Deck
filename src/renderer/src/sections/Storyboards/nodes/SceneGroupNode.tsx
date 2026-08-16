import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FRAME_H, FRAME_W } from '@shared/types'
import { boardDuration, formatDuration } from '../../../lib/scene'
import { useStoryboards } from '../../../store/useStoryboards'
import { SceneRow } from './SceneRow'
import { GROUP_H, GROUP_W, HANDLE, type SceneGroupNodeType } from './types'

/**
 * Every scene on the board, in one container.
 *
 * A board of twelve scenes was twelve rectangles to arrange, and arranging them
 * was never the work — reading them in order was. So the scenes become rows in
 * a scrolling box wired to the brief once, and the spine collapses from N edges
 * to one.
 *
 * Two things this must get right, both of which the free canvas got for free:
 * the body is `nowheel`, or scrolling the list pans the canvas out from under
 * the cursor; and each row carries its own target handle, or every reference
 * wire on the board lands on the same point and the graph stops being readable.
 */
export function SceneGroupNode({ data }: NodeProps<SceneGroupNodeType>) {
  const { board, scenes } = data
  const addFrame = useStoryboards((s) => s.addFrame)

  const { seconds, undecided } = boardDuration(scenes.map((s) => s.frame))

  return (
    <>
      {/* One inbound wire for the whole container: the spine. */}
      <Handle
        type="target"
        id={HANDLE.groupBriefIn}
        position={Position.Top}
        className="!size-2 !border-line !bg-raised"
      />
      {/* Out to the cut. Derived, like the spine — nothing is drawn by hand. */}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-line !bg-raised"
      />

      <div
        data-node
        style={{ width: GROUP_W, height: GROUP_H }}
        className="flex select-none flex-col overflow-hidden rounded-xl border border-line-soft glass-flat card-shadow-soft"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
            {board.title || 'Scenes'}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
            {scenes.length === 0
              ? 'no scenes'
              : `${scenes.length} · ${formatDuration(seconds)}${
                  undecided > 0 ? ` +${undecided}?` : ''
                }`}
          </span>
          <button
            type="button"
            onClick={() =>
              void addFrame({
                boardId: board.id,
                // Unused while stacked, but a frame with a sane rect is a frame
                // that is still where you left it if you flip back to canvas.
                x: 0,
                y: 0,
                w: FRAME_W,
                h: FRAME_H
              })
            }
            className="nodrag shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:border-line hover:text-ink"
          >
            + Scene
          </button>
        </header>

        {/* nowheel: this is the scroll surface, so React Flow must not treat a
            wheel event here as a zoom or a pan. */}
        <div className="nowheel nodrag min-h-0 flex-1 overflow-y-auto">
          {scenes.length === 0 ? (
            <p className="px-3 py-4 text-[11.5px] leading-relaxed text-ink-faint">
              No scenes yet. Write the brief on the left, then Plan scenes — or
              add one by hand.
            </p>
          ) : (
            scenes.map((scene) => (
              <SceneRow key={scene.frame.id} {...scene} />
            ))
          )}
        </div>
      </div>
    </>
  )
}
