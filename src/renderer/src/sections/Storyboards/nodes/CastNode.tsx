import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { StorySheet } from '@shared/types'
import { cn } from '../../../lib/cn'
import { shotUrl } from '../../../lib/media'
import { useCast } from '../../../store/useCast'

export const CAST_W = 190

export type CastData = { sheet: StorySheet; placementId: string }
export type CastNodeType = Node<CastData, 'cast'>

/**
 * A character, placed on the board.
 *
 * The style node says how the film is shot; this says who is in it — and unlike
 * the style node it means something mechanical rather than only descriptive.
 * Every character's *words* already reach every prompt whether they are on the
 * canvas or not. Placing them here is what attaches their approved portrait to
 * the generation request, which is the difference between a person who matches
 * the description and the same person shot to shot.
 *
 * Read-only, like `StyleNode`, and for the same reason: editing a character
 * affects every prompt on the board, and that consequence should be visible
 * from the panel where the cast is managed rather than hidden in a card.
 */
export function CastNode({ data }: NodeProps<CastNodeType>) {
  const { sheet, placementId } = data
  const unplace = useCast((s) => s.unplace)

  return (
    <>
      {/* Source only, and not connectable by hand: a placed character attaches
          to the brief automatically, because there is one brief to attach to. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-2 !border-line !bg-raised"
      />

      <div
        data-node
        style={{ width: CAST_W }}
        className="group/cast select-none rounded-xl border border-amber/40 bg-surface/85 p-2.5 card-shadow-soft backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 pb-2">
          <span className="size-1.5 shrink-0 rounded-full bg-amber" />
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
            Cast
          </span>
          <button
            type="button"
            onClick={() => void unplace(placementId)}
            aria-label={`Take ${sheet.name || 'this character'} off this board`}
            title="Take off this board — the character and their portrait stay in the cast"
            className="nodrag ml-auto grid size-4 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/cast:opacity-100 hover:bg-line hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="size-2.5" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex gap-2.5">
          {sheet.portraitId ? (
            <img
              src={shotUrl(sheet.portraitId)}
              alt=""
              draggable={false}
              className={cn(
                'size-14 shrink-0 rounded-lg border border-line-soft object-cover'
              )}
            />
          ) : (
            <div className="grid size-14 shrink-0 place-items-center rounded-lg border border-line-soft bg-well text-[9px] text-ink-faint">
              no image
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-ink">
              {sheet.name || 'Unnamed'}
            </p>
            <p className="mt-0.5 line-clamp-3 text-[10px] leading-snug text-ink-faint">
              {sheet.description || 'No description'}
            </p>
          </div>
        </div>

        <p className="mt-2 border-t border-line-soft/70 pt-1.5 text-[9.5px] leading-snug text-ink-faint">
          Locked by image — this portrait is sent with every generation on this
          board.
        </p>
      </div>
    </>
  )
}
