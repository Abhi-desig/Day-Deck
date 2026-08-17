import { useCallback, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FRAME_H, FRAME_W } from '@shared/types'
import { cn } from '../../../lib/cn'
import { boardDuration, formatDuration } from '../../../lib/scene'
import { useStoryboards } from '../../../store/useStoryboards'
import { SceneRow } from './SceneRow'
import { HANDLE, type SceneGroupNodeType } from './types'

/**
 * Every scene on the board, in one container.
 *
 * A board of twelve scenes was twelve rectangles to arrange, and arranging them
 * was never the work — reading them in order was. So the scenes become rows in
 * a scrolling box wired to the brief once, and the spine collapses from N edges
 * to one.
 *
 * The first version of that got the wiring right and the reading wrong: every
 * row was a full editor about 250 pixels tall, so the list you were meant to
 * read top to bottom showed two of its twelve entries. Rows now open and shut.
 * Shut, a row is a title, a line of description and what the shot still needs;
 * open, it is the same editor it always was. The box is sized on shut rows,
 * which is what it opens as.
 *
 * Two things this must keep getting right, both of which the free canvas got
 * for free: the body is `nowheel`, or scrolling the list pans the canvas out
 * from under the cursor; and each row carries its own target handle — open or
 * shut — or every reference wire on the board lands on the same point and the
 * graph stops being readable.
 */
export function SceneGroupNode({ data }: NodeProps<SceneGroupNodeType>) {
  const { board, scenes } = data
  const addFrame = useStoryboards((s) => s.addFrame)

  /**
   * Which rows are open.
   *
   * Component state rather than a preference. Which scene you are working on is
   * a fact about the next ten minutes, not about you — and the canvas is keyed
   * by board, so switching boards discards this along with everything else that
   * belonged to the old one.
   */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  const toggle = useCallback((frameId: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(frameId)) next.add(frameId)
      return next
    })
  }, [])

  const { seconds, undecided } = boardDuration(scenes.map((s) => s.frame))

  /**
   * What the board still needs, as one clause.
   *
   * Counted here rather than in a row because it is a fact about the board:
   * "four still need prompts" is the sentence that tells you whether to press
   * Write prompts, and no individual row can say it.
   */
  const needsPrompt = useMemo(
    () => scenes.filter((s) => !s.frame.prompt.trim()).length,
    [scenes]
  )

  const allOpen = scenes.length > 0 && open.size === scenes.length

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

      {/* Sized by the wrapper React Flow already laid out — see `groupHeight`,
          which follows the scene count so a short board is not a mostly-empty
          box and a long one is not a porthole. */}
      <div
        data-node
        className="flex size-full select-none flex-col overflow-hidden rounded-xl border border-line-soft glass-flat card-shadow-soft"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-3 py-2">
          <span className="min-w-0 shrink truncate text-[12.5px] text-ink">
            {board.title || 'Scenes'}
          </span>

          <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-ink-faint">
            {scenes.length === 0
              ? 'no scenes'
              : `${scenes.length} · ${formatDuration(seconds)}${
                  undecided > 0 ? ` +${undecided}?` : ''
                }`}
            {needsPrompt > 0 && (
              <span className="text-ink-faint/70">
                {` · ${needsPrompt} without ${
                  needsPrompt === 1 ? 'a prompt' : 'prompts'
                }`}
              </span>
            )}
          </span>

          {scenes.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setOpen(
                  allOpen ? new Set() : new Set(scenes.map((s) => s.frame.id))
                )
              }
              title={
                allOpen
                  ? 'Shut every scene back to one line'
                  : 'Open every scene for editing'
              }
              className={cn(
                'nodrag shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors',
                allOpen
                  ? 'border-line bg-raised text-ink-dim hover:text-ink'
                  : 'border-line-soft text-ink-faint hover:border-line hover:text-ink'
              )}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}

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
              <SceneRow
                key={scene.frame.id}
                {...scene}
                expanded={open.has(scene.frame.id)}
                onToggle={() => toggle(scene.frame.id)}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
