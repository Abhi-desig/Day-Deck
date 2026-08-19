import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '../../../lib/cn'
import { goalStyle } from '../../../lib/goalColor'
import { useStoryboards } from '../../../store/useStoryboards'
import { Field } from '../Field'
import { RefThumb } from './RefThumb'
import { HANDLE, type BriefNodeType } from './types'

export const BRIEF_W = 340

/**
 * The brief, at the centre of the board.
 *
 * It is not a row in a nodes table — it is the board's own `brief` and
 * `visual_style` columns drawn as a card. That is what makes "always present,
 * exactly one, cannot be deleted" true by construction rather than by a rule
 * somewhere in the UI: there is nothing here to delete.
 *
 * Pinned at the origin and not draggable, so every other node on the board has a
 * fixed thing to be positioned relative to.
 */
export function BriefNode({ data }: NodeProps<BriefNodeType>) {
  const { board, refs } = data
  const patchBoard = useStoryboards((s) => s.patchBoard)
  const disconnectBriefRef = useStoryboards((s) => s.disconnectBriefRef)
  const style = goalStyle(board.color)

  return (
    <>
      {/* Styles attach on the left, scenes flow out to the right, and film-wide
          references arrive at the bottom — three kinds of wire, three points. */}
      <Handle
        type="target"
        id={HANDLE.briefStyleIn}
        position={Position.Left}
        className="!size-2.5 !border-line !bg-surface"
      />
      <Handle
        type="target"
        id={HANDLE.briefRefIn}
        position={Position.Bottom}
        title="Drag a reference row here to make it film-wide"
        className="!size-2.5 !border-line !bg-surface"
      />
      {/* The cast lands on top — a third kind of inbound wire, and a third
          side, because two of them arriving at one point is where a graph
          stops being readable. Not connectable by hand: a character is
          attached by being placed, not by being wired. */}
      <Handle
        type="target"
        id={HANDLE.briefCastIn}
        position={Position.Top}
        isConnectable={false}
        className="!size-2.5 !border-amber/50 !bg-surface"
      />
      <Handle
        type="source"
        id={HANDLE.briefOut}
        position={Position.Right}
        isConnectable={false}
        className="!size-2 !border-line !bg-raised"
      />

      <div
        data-node
        style={{ width: BRIEF_W }}
        className={cn(
          'select-none rounded-xl border-2 bg-surface/90 p-3 card-shadow-soft backdrop-blur-sm',
          style.border
        )}
      >
        <div className="flex items-center gap-2 pb-2">
          <span className={cn('size-2 rounded-full', style.dot)} />
          <span className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Brief
          </span>
          <span className="ml-auto truncate text-[11px] text-ink-faint/70">
            {board.title}
          </span>
        </div>

        <label className="block">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Creative brief
          </span>
          <Field
            multiline
            value={board.brief}
            placeholder="What is this film, who is it for, what has to land…"
            onCommit={(brief) => void patchBoard(board.id, { brief })}
            className="nodrag nowheel mt-1 max-h-[160px] min-h-[72px] rounded-md bg-well p-2 text-[12px] leading-relaxed text-ink-dim"
          />
        </label>

        <label className="mt-2 block">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Visual style
          </span>
          <Field
            multiline
            value={board.visualStyle}
            placeholder="Look, grade, references, the feel of it…"
            onCommit={(visualStyle) => void patchBoard(board.id, { visualStyle })}
            className="nodrag nowheel mt-1 max-h-[120px] min-h-[48px] rounded-md bg-well p-2 text-[12px] leading-relaxed text-ink-dim"
          />
        </label>

        {refs.length > 0 && (
          <div className="mt-2">
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
              Film-wide references
            </span>
            <div className="nowheel mt-1 flex gap-1 overflow-x-auto pb-0.5">
              {refs.map((item) => (
                <RefThumb
                  key={item.id}
                  item={item}
                  size={30}
                  onDetach={() => void disconnectBriefRef(item.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
