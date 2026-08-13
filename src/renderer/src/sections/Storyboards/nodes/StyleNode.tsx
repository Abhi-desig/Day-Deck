import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { STYLE_FIELDS, type VideoStyle } from '@shared/types'
import { cn } from '../../../lib/cn'
import { goalStyle } from '../../../lib/goalColor'
import { useStyles } from '../../../store/useStyles'

export const STYLE_W = 250

export type StyleData = { style: VideoStyle; placementId: string }
export type StyleNodeType = Node<StyleData, 'style'>

/**
 * A style, placed on the board.
 *
 * Read-only here on purpose. This card shows what the look currently says so you
 * can see it next to the brief it is attached to; editing happens in the library
 * panel, where a change is understood to affect every board using it. Editing in
 * place would make that consequence invisible.
 */
export function StyleNode({ data }: NodeProps<StyleNodeType>) {
  const { style, placementId } = data
  const unplace = useStyles((s) => s.unplace)
  const palette = goalStyle(style.color)

  const stated = STYLE_FIELDS.filter((field) => style[field.key].toString().trim())

  return (
    <>
      {/* Source only, and not connectable by hand: a placed style is attached to
          the brief automatically, because there is exactly one brief to attach to. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-2 !border-line !bg-raised"
      />

      <div
        data-node
        style={{ width: STYLE_W }}
        className={cn(
          'group/style select-none rounded-xl border bg-surface/85 p-2.5 card-shadow-soft backdrop-blur-sm',
          palette.border
        )}
      >
        <div className="flex items-center gap-2 pb-1.5">
          <span className={cn('size-1.5 shrink-0 rounded-full', palette.dot)} />
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
            Style
          </span>
          <span className="ml-auto truncate text-[12px] text-ink">
            {style.name}
          </span>
          <button
            type="button"
            onClick={() => void unplace(placementId)}
            aria-label={`Take ${style.name} off this board`}
            title="Take off this board — the style stays in your library"
            className="nodrag grid size-4 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/style:opacity-100 hover:bg-line hover:text-ink"
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

        <dl className="space-y-0.5 border-t border-line-soft/70 pt-1.5">
          {stated.length === 0 && (
            <p className="text-[11px] text-ink-faint">
              Nothing set yet — fill this style in from the Styles panel.
            </p>
          )}
          {stated.map((field) => (
            <div key={field.key} className="flex gap-2 text-[10.5px] leading-snug">
              <dt className="w-[62px] shrink-0 text-ink-faint">{field.label}</dt>
              <dd className="min-w-0 flex-1 truncate text-ink-dim">
                {String(style[field.key])}
              </dd>
            </div>
          ))}
          {style.extras
            .filter((e) => e.key.trim() && e.value.trim())
            .map((extra) => (
              <div
                key={extra.key}
                className="flex gap-2 text-[10.5px] leading-snug"
              >
                <dt className="w-[62px] shrink-0 truncate text-ink-faint">
                  {extra.key}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-ink-dim">
                  {extra.value}
                </dd>
              </div>
            ))}
        </dl>
      </div>
    </>
  )
}
