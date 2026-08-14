import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { StoryListItem } from '@shared/types'
import { cn } from '../../../lib/cn'
import { goalStyle } from '../../../lib/goalColor'
import { useStoryboards } from '../../../store/useStoryboards'
import { Field } from '../Field'
import { RefThumb } from './RefThumb'
import { type ListNodeType } from './types'

export const LIST_MIN_W = 220
export const LIST_MIN_H = 160

/**
 * A list of reference material.
 *
 * Every row carries its own source handle, and that is the whole design: the unit
 * you wire to a scene is one reference, not the list it happens to live in. Drag
 * from a row's dot to a scene card and the board now records that this plate
 * belongs to that shot.
 */
export function ListNode({ data, selected }: NodeProps<ListNodeType>) {
  const { list, items } = data
  const patchList = useStoryboards((s) => s.patchList)
  const placeList = useStoryboards((s) => s.placeList)
  const removeList = useStoryboards((s) => s.removeList)
  const attachMedia = useStoryboards((s) => s.attachMedia)
  const addItem = useStoryboards((s) => s.addItem)

  const style = goalStyle(list.color)

  return (
    <>
      <NodeResizer
        minWidth={LIST_MIN_W}
        minHeight={LIST_MIN_H}
        isVisible={selected}
        onResizeEnd={(_e, params) =>
          void placeList(list.id, {
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height
          })
        }
      />

      <div
        data-node
        // The drop target marker: files dropped on this card join this list
        // rather than spawning a new one. See Canvas's onDrop.
        data-list-id={list.id}
        className={cn(
          'group/list flex size-full select-none flex-col overflow-hidden rounded-xl border',
          'glass-flat card-shadow-soft',
          selected ? 'border-amber/50' : style.border
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-2.5 py-1.5">
          <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
          <Field
            value={list.title}
            placeholder="References"
            onCommit={(title) => void patchList(list.id, { title })}
            className="nodrag min-w-0 flex-1 text-[12.5px] text-ink"
          />
          <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
            {items.length}
          </span>
          <button
            type="button"
            onClick={() => void removeList(list.id)}
            aria-label="Delete this list"
            className="nodrag grid size-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/list:opacity-100 hover:bg-line hover:text-ink"
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

        <div className="nowheel min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {items.length === 0 && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-ink-faint">
              Nothing yet. Add images or clips, then drag a row's dot onto a scene.
            </p>
          )}

          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </div>

        <footer className="flex shrink-0 gap-1 border-t border-line-soft/70 px-1.5 py-1">
          <button
            type="button"
            onClick={() => void attachMedia(list.id)}
            className="nodrag flex-1 rounded px-1.5 py-1 text-left text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
          >
            + Media…
          </button>
          <button
            type="button"
            onClick={() => void addItem({ listId: list.id, label: '' })}
            title="A row with no file, for a note or a placeholder"
            className="nodrag rounded px-1.5 py-1 text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
          >
            + Row
          </button>
        </footer>
      </div>
    </>
  )
}

/**
 * One reference.
 *
 * The handle sits at the right edge of the row rather than the edge of the card,
 * so which row a wire leaves from is readable at a glance. It works because the
 * row is `relative`: React Flow's own `top: 50%` then centres the handle within
 * the row instead of the card.
 */
function Row({ item }: { item: StoryListItem }) {
  const patchItem = useStoryboards((s) => s.patchItem)
  const removeItem = useStoryboards((s) => s.removeItem)

  return (
    <div className="group/row relative flex items-center gap-1.5 rounded px-1 py-0.5 pr-3 hover:bg-hover">
      <RefThumb item={item} size={26} />

      <Field
        value={item.label}
        placeholder="Untitled reference"
        onCommit={(label) => void patchItem(item.id, { label })}
        className={cn(
          'nodrag min-w-0 flex-1 text-[11.5px]',
          item.missing ? 'text-amber-soft/80' : 'text-ink-dim'
        )}
      />

      <button
        type="button"
        onClick={() => void removeItem(item.id)}
        aria-label={`Remove ${item.label || 'reference'}`}
        className="nodrag grid size-4 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/row:opacity-100 hover:bg-line hover:text-ink"
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

      {/* The handle id is the item id — that is what onConnect reads to know
          which reference is being wired. */}
      <Handle
        type="source"
        id={item.id}
        position={Position.Right}
        title="Drag onto a scene"
        className="!right-0 !size-2 !border-line !bg-raised hover:!bg-amber"
      />
    </div>
  )
}
