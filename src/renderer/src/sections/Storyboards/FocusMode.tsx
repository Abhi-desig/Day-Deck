import { AnimatePresence, motion } from 'motion/react'
import { OMNI_DURATIONS, type StoryFrame, type StoryListItem } from '@shared/types'
import { cn } from '../../lib/cn'
import { copyText } from '../../lib/clipboard'
import { goalStyle } from '../../lib/goalColor'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { mediaUrl } from '../../lib/media'
import { sceneLabel } from '../../lib/scene'
import { SPRING } from '../../lib/motion'
import { useStoryboards } from '../../store/useStoryboards'
import { Field } from './Field'

/**
 * The board, one scene at a time.
 *
 * The canvas answers "how do these shots relate"; this answers "is this shot
 * right". Different question, so it gets its own surface rather than a bigger
 * card — full-size references, the whole prompt without a scroll box, and the
 * arrow keys walking the edit in order.
 */
export function FocusMode({
  frames,
  refsFor,
  index,
  onIndex,
  onClose
}: {
  frames: StoryFrame[]
  refsFor(frameId: string): StoryListItem[]
  index: number
  onIndex(next: number): void
  onClose(): void
}) {
  const open = index >= 0 && index < frames.length
  const frame = open ? frames[index] : null

  const step = (delta: number): void => {
    if (frames.length === 0) return
    // Wraps, so walking off either end continues rather than dead-ends.
    onIndex((index + delta + frames.length) % frames.length)
  }

  useHotkeys(
    [
      { combo: 'escape', allowInInput: true, handler: onClose },
      // Not allowInInput: the arrows have to move the caret inside the prompt
      // field, and walking the board out from under a half-typed line would be
      // worse than needing to click out of it first.
      { combo: 'arrowright', handler: () => step(1) },
      { combo: 'arrowleft', handler: () => step(-1) }
    ],
    { layer: LAYER.overlay, enabled: open }
  )

  return (
    <AnimatePresence>
      {frame && (
        <>
          <motion.div
            key="focus-backdrop"
            className="no-drag fixed inset-0 z-[300] bg-canvas/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          <motion.div
            key="focus-panel"
            className="no-drag pointer-events-none fixed inset-0 z-[301] grid place-items-center p-8"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={SPRING.snap}
          >
            <SceneSheet
              frame={frame}
              refs={refsFor(frame.id)}
              position={index + 1}
              total={frames.length}
              onStep={step}
              onClose={onClose}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function SceneSheet({
  frame,
  refs,
  position,
  total,
  onStep,
  onClose
}: {
  frame: StoryFrame
  refs: StoryListItem[]
  position: number
  total: number
  onStep(delta: number): void
  onClose(): void
}) {
  const patchFrame = useStoryboards((s) => s.patchFrame)
  const style = goalStyle(frame.color)

  return (
    <div className="glass pointer-events-auto flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-hairline modal-shadow">
      <header className="flex shrink-0 items-center gap-3 border-b border-line-soft px-5 py-3">
        <span className={cn('size-2 rounded-full', style.dot)} />
        <h2 className="text-[14px] tracking-[-0.01em]">
          {sceneLabel(frame, position - 1)}
        </h2>
        <span className="text-[11.5px] tabular-nums text-ink-faint">
          {position} of {total}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Step label="Previous scene" glyph="‹" onClick={() => onStep(-1)} />
          <Step label="Next scene" glyph="›" onClick={() => onStep(1)} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-1 grid size-6 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {refs.length > 0 && (
          <div className="mb-4 grid grid-cols-3 gap-2">
            {refs.map((item) => (
              <Reference key={item.id} item={item} />
            ))}
          </div>
        )}

        <Labelled title="What happens">
          <Field
            multiline
            value={frame.description}
            placeholder="What happens in this shot…"
            onCommit={(description) => void patchFrame(frame.id, { description })}
            className="min-h-[68px] rounded-lg border border-line-soft bg-well p-2.5 text-[13px] leading-relaxed text-ink-dim"
          />
        </Labelled>

        <Labelled title="Prompt" action={<CopyPrompt frame={frame} />}>
          <Field
            multiline
            value={frame.prompt}
            placeholder="The prompt for this scene…"
            onCommit={(prompt) => void patchFrame(frame.id, { prompt })}
            className="min-h-[140px] rounded-lg border border-line-soft bg-well p-2.5 font-mono text-[12px] leading-relaxed text-ink-dim"
          />
        </Labelled>

        <Labelled title="Duration">
          <div className="flex flex-wrap items-center gap-1.5">
            {OMNI_DURATIONS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => void patchFrame(frame.id, { durationSec: seconds })}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] tabular-nums transition-colors',
                  frame.durationSec === seconds
                    ? 'border-amber/50 bg-amber/15 text-amber-soft'
                    : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
                )}
              >
                {seconds}s
              </button>
            ))}
            <button
              type="button"
              onClick={() => void patchFrame(frame.id, { durationSec: null })}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] transition-colors',
                frame.durationSec == null
                  ? 'border-line bg-raised text-ink-dim'
                  : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
              )}
            >
              Undecided
            </button>
            <span className="ml-1 text-[11px] text-ink-faint/70">
              What the Omni model can generate
            </span>
          </div>
        </Labelled>
      </div>
    </div>
  )
}

/**
 * A reference at a size you can actually judge.
 *
 * Video gets real controls here rather than a poster frame — the point of focus
 * mode is being able to look at the thing properly.
 */
function Reference({ item }: { item: StoryListItem }) {
  if (item.missing || !item.mediaPath) {
    return (
      <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-amber/40 bg-amber/8 px-3 text-center">
        <span className="text-[11px] leading-relaxed text-amber-soft/80">
          {item.missing ? 'File has moved' : 'No media'}
          <br />
          <span className="text-ink-faint">{item.label}</span>
        </span>
      </div>
    )
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-line-soft bg-well-deep">
      {item.mediaKind === 'video' ? (
        <video
          src={mediaUrl(item.id)}
          controls
          muted
          loop
          playsInline
          className="aspect-video w-full object-cover"
        />
      ) : (
        <img
          src={mediaUrl(item.id)}
          alt={item.label}
          className="aspect-video w-full object-cover"
        />
      )}
      <figcaption className="truncate px-2 py-1 text-[10.5px] text-ink-faint">
        {item.label}
      </figcaption>
    </figure>
  )
}

function CopyPrompt({ frame }: { frame: StoryFrame }) {
  return (
    <button
      type="button"
      onClick={() => void copyText(frame.prompt)}
      disabled={!frame.prompt.trim()}
      className="rounded px-1.5 py-px text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      Copy
    </button>
  )
}

function Labelled({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <h3 className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Step({
  label,
  glyph,
  onClick
}: {
  label: string
  glyph: string
  onClick(): void
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      className="grid size-6 place-items-center rounded-md text-[15px] text-ink-dim transition-colors hover:bg-raised hover:text-ink"
    >
      {glyph}
    </motion.button>
  )
}
