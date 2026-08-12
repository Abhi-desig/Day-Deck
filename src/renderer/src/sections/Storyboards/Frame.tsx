import { useEffect, useRef, useState } from 'react'
import { motion, type MotionValue } from 'motion/react'
import type { StoryFrame } from '@shared/types'
import { cn } from '../../lib/cn'
import { copyText } from '../../lib/clipboard'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'
import { useStoryboards } from '../../store/useStoryboards'

const MIN_W = 220
const MIN_H = 160

/**
 * One frame on the canvas.
 *
 * Dragging and resizing are raw pointer maths rather than Motion's `drag`
 * gesture, for one reason: the frame lives inside a scaled world. A drag
 * gesture applies the pointer delta to the element's own transform, which the
 * parent's scale then multiplies — so at 50% zoom the card travels half as far
 * as the cursor, and at 200% it runs away from it. Dividing the delta by the
 * live zoom before applying it is what keeps the card glued to the pointer at
 * every scale.
 */
export function Frame({
  frame,
  zoom
}: {
  frame: StoryFrame
  zoom: MotionValue<number>
}) {
  const placeFrame = useStoryboards((s) => s.placeFrame)
  const patchFrame = useStoryboards((s) => s.patchFrame)
  const removeFrame = useStoryboards((s) => s.removeFrame)

  const [rect, setRect] = useState({
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h
  })
  const [busy, setBusy] = useState<'drag' | 'resize' | null>(null)

  /**
   * The live geometry, mirrored outside React.
   *
   * The pointer-up handler needs the final rect to persist it, and reading it
   * out of a `setRect` updater would be a side effect inside a function React
   * is allowed to call twice — under StrictMode that is two writes per drop.
   */
  const rectRef = useRef(rect)
  const apply = (next: typeof rect): void => {
    rectRef.current = next
    setRect(next)
  }

  // Follow the store unless the pointer currently owns the geometry.
  useEffect(() => {
    if (busy) return
    apply({ x: frame.x, y: frame.y, w: frame.w, h: frame.h })
    // `apply` is stable in practice (it only closes over setRect and the ref)
    // and including it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.x, frame.y, frame.w, frame.h, busy])

  const style = goalStyle(frame.color)

  function startDrag(e: React.PointerEvent): void {
    // Text fields and controls own their own clicks; a card that drags when you
    // try to place a cursor in its prompt is unusable.
    if ((e.target as HTMLElement).closest('input, textarea, button, [data-handle]')) {
      return
    }
    if (e.button !== 0) return
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const origin = { x: rectRef.current.x, y: rectRef.current.y }
    setBusy('drag')

    const move = (event: PointerEvent): void => {
      const scale = zoom.get()
      apply({
        ...rectRef.current,
        x: origin.x + (event.clientX - startX) / scale,
        y: origin.y + (event.clientY - startY) / scale
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setBusy(null)
      // Exactly the geometry that is on screen, not a recomputation of it.
      void placeFrame(frame.id, rectRef.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function startResize(e: React.PointerEvent): void {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const origin = { w: rectRef.current.w, h: rectRef.current.h }
    setBusy('resize')

    const move = (event: PointerEvent): void => {
      const scale = zoom.get()
      apply({
        ...rectRef.current,
        w: Math.max(MIN_W, origin.w + (event.clientX - startX) / scale),
        h: Math.max(MIN_H, origin.h + (event.clientY - startY) / scale)
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setBusy(null)
      void placeFrame(frame.id, rectRef.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <motion.div
      data-frame
      onPointerDown={startDrag}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={SPRING.soft}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h
      }}
      className={cn(
        'group/frame absolute flex select-none flex-col overflow-hidden rounded-xl border',
        'glass-flat card-shadow-soft',
        busy === 'drag' ? 'cursor-grabbing' : 'cursor-grab',
        style.border
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line-soft/70 px-2.5 py-1.5">
        <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
        <Field
          value={frame.title}
          placeholder="Untitled frame"
          onCommit={(title) => void patchFrame(frame.id, { title })}
          className="min-w-0 flex-1 text-[12.5px] text-ink"
        />
        <button
          type="button"
          onClick={() => void removeFrame(frame.id)}
          aria-label="Delete frame"
          className="grid size-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-all group-hover/frame:opacity-100 hover:bg-line hover:text-ink"
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
          className="min-h-[38px] flex-1 text-[12px] leading-relaxed text-ink-dim"
        />

        <PromptBlock frame={frame} />
      </div>

      {/* Resize grip. `data-handle` keeps the drag handler off it. */}
      <span
        data-handle
        onPointerDown={startResize}
        role="presentation"
        className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize opacity-0 transition-opacity group-hover/frame:opacity-100"
      >
        <svg viewBox="0 0 14 14" className="size-full text-ink-faint" aria-hidden>
          <path
            d="M13 5L5 13M13 9l-4 4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </motion.div>
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
function PromptBlock({ frame }: { frame: StoryFrame }) {
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
    <div className="shrink-0 rounded-lg border border-line-soft bg-black/20 p-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
          Prompt
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!frame.prompt.trim()}
          className={cn(
            'rounded px-1.5 py-px text-[10px] transition-colors',
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
        className="max-h-[92px] min-h-[34px] font-mono text-[11px] leading-relaxed text-ink-dim"
      />
    </div>
  )
}

/**
 * A field that commits on blur rather than on every keystroke.
 *
 * Every write here is an IPC round trip and a SQLite UPDATE. Writing through on
 * change would make typing a paragraph into a prompt several hundred of them.
 */
function Field({
  value,
  placeholder,
  onCommit,
  className,
  multiline = false
}: {
  value: string
  placeholder: string
  onCommit(next: string): void
  className?: string
  multiline?: boolean
}) {
  const [draft, setDraft] = useState(value)

  // The store is authoritative between edits — an optimistic patch that the
  // server trimmed differently has to win.
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    if (draft === value) return
    onCommit(draft)
  }

  const shared = cn(
    'w-full resize-none bg-transparent outline-none',
    'placeholder:text-ink-faint/45',
    className
  )

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value)
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        // Text selection is off app-wide; these opt back in, as inputs do.
        className={cn(shared, 'overflow-y-auto')}
      />
    )
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
      placeholder={placeholder}
      className={cn(shared, 'truncate')}
    />
  )
}
