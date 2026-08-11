import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { addDays, labelFor, todayKey } from '@shared/date'
import type { NewSticker, Sticker, StickerColor } from '@shared/types'
import { STICKER_COLORS } from '@shared/types'
import { useDeck } from '../store/useDeck'
import { useIntent } from '../store/useShell'
import { useStickers } from '../store/useStickers'
import { cn } from '../lib/cn'
import { EASE_OUT, SPRING } from '../lib/motion'
import { paperStyle } from '../lib/stickerColor'

const NOTE_W = 208
const NOTE_H = 168
/** Room to drop notes below the fold; the board scrolls. */
const BOARD_H = 1400

/** Enough tilt to look pinned by hand, never enough to be hard to read. */
const MAX_TILT = 5

export function Stickers() {
  const stickers = useStickers((s) => s.stickers)
  const ready = useStickers((s) => s.ready)
  const error = useStickers((s) => s.error)
  const load = useStickers((s) => s.load)
  const add = useStickers((s) => s.add)
  const dismissError = useStickers((s) => s.dismissError)

  const boardRef = useRef<HTMLDivElement>(null)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const newStickerIntent = useIntent('newSticker')
  useEffect(() => {
    if (newStickerIntent > 0) setComposing(true)
  }, [newStickerIntent])

  const permanent = stickers.filter((s) => s.kind === 'permanent').length
  const temp = stickers.length - permanent

  async function create(input: Omit<NewSticker, 'x' | 'y' | 'rotation'>) {
    // Drop new notes in a loose diagonal cascade rather than all at the origin,
    // so adding three in a row does not bury two of them.
    const n = stickers.length
    const created = await add({
      ...input,
      x: 40 + (n % 5) * 46,
      y: 40 + (n % 7) * 34,
      rotation: (n % 2 === 0 ? 1 : -1) * (1.5 + (n % 3))
    })
    if (created) setComposing(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-7 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">Stickers</h1>
          <span className="text-[12.5px] text-ink-faint">
            {stickers.length === 0
              ? 'Notes that do not belong on a timeline'
              : `${permanent} permanent · ${temp} temporary`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          className={cn(
            'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
            composing
              ? 'border-amber/40 bg-amber/10 text-amber-soft'
              : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
          )}
        >
          {composing ? 'Close' : 'New sticker'}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden px-7"
          >
            <Composer onCreate={create} onCancel={() => setComposing(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mx-7 mb-2 flex shrink-0 items-center gap-3 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2">
          <span className="flex-1 text-[12.5px] text-amber-soft">{error}</span>
          <button
            type="button"
            onClick={dismissError}
            className="text-[11px] text-amber-soft/70 hover:text-amber-soft"
          >
            Dismiss
          </button>
        </div>
      )}

      <SweepBanner />

      <div
        ref={boardRef}
        className="relative min-h-0 flex-1 overflow-auto px-7 pb-7"
      >
        {/* The board is a fixed-size positioned surface: notes carry absolute
            coordinates, so it cannot be a flow layout. */}
        <div className="relative" style={{ height: BOARD_H }}>
          {ready && stickers.length === 0 && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              className="pt-16 text-center text-[13px] leading-relaxed text-ink-faint"
            >
              Nothing on the wall.
              <br />
              <span className="text-ink-faint/60">
                Temporary notes clear themselves; permanent ones stay until you
                delete them.
              </span>
            </motion.p>
          )}

          <AnimatePresence>
            {stickers.map((sticker) => (
              <Note key={sticker.id} sticker={sticker} boardRef={boardRef} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/**
 * What the launch sweep cleared.
 *
 * The notes are already deleted by the time the renderer sees them, so this
 * reports rather than animates them off one by one — the wall was never on
 * screen while they were alive. Same pattern as the Today section's rollover
 * banner, and it uses the same bootstrap payload.
 */
function SweepBanner() {
  const result = useDeck((s) => s.bootstrapResult)
  const acknowledgeSweep = useDeck((s) => s.acknowledgeSweep)
  const expired = result?.expiredStickers ?? []

  if (expired.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={SPRING.soft}
        className="shrink-0 overflow-hidden px-7"
      >
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-raised/50 px-3.5 py-2">
          <span className="text-ink-faint" aria-hidden>
            ✕
          </span>
          <span className="flex-1 text-[12.5px] text-ink-dim">
            {expired.length} temporary{' '}
            {expired.length === 1 ? 'sticker' : 'stickers'} expired and{' '}
            {expired.length === 1 ? 'was' : 'were'} cleared:{' '}
            <span className="text-ink-faint">
              {expired
                .slice(0, 3)
                .map((s) => `“${s.body.slice(0, 40)}”`)
                .join(', ')}
              {expired.length > 3 && ` and ${expired.length - 3} more`}
            </span>
          </span>
          <button
            type="button"
            onClick={acknowledgeSweep}
            className="text-[11px] text-ink-faint hover:text-ink"
          >
            Got it
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function Note({
  sticker,
  boardRef
}: {
  sticker: Sticker
  boardRef: React.RefObject<HTMLDivElement | null>
}) {
  const move = useStickers((s) => s.move)
  const patch = useStickers((s) => s.patch)
  const remove = useStickers((s) => s.remove)
  const reduced = useReducedMotion()

  const style = paperStyle(sticker.color)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sticker.body)
  const draggingRef = useRef(false)

  const attached = sticker.attachedDate ? labelFor(sticker.attachedDate) : null
  const expires = sticker.expiresAt ? labelFor(sticker.expiresAt) : null

  function commitBody() {
    setEditing(false)
    const next = draft.trim()
    if (!next || next === sticker.body) {
      setDraft(sticker.body)
      return
    }
    void patch(sticker.id, { body: next })
  }

  return (
    <motion.div
      drag={!editing}
      dragMomentum
      dragConstraints={boardRef}
      dragElastic={0.12}
      whileDrag={reduced ? undefined : { scale: 1.06, rotate: 2.5, zIndex: 50 }}
      onDragStart={() => {
        draggingRef.current = true
      }}
      onDragEnd={(_e, info) => {
        draggingRef.current = false
        // Motion applies the drag as a transform offset on top of `left`/`top`,
        // so the new position is where it started plus how far it travelled.
        void move(
          sticker.id,
          sticker.x + info.offset.x,
          sticker.y + info.offset.y,
          sticker.rotation
        )
      }}
      // Settling into place is a spring, not a stop — a note dropped on a desk
      // does not arrive rigid.
      dragTransition={{ bounceStiffness: 420, bounceDamping: 30 }}
      // Blur gated by hand; the global pass does not cover filters.
      initial={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.9, filter: 'blur(5px)' }
      }
      animate={{
        opacity: 1,
        scale: 1,
        ...(reduced ? {} : { filter: 'blur(0px)' }),
        left: sticker.x,
        top: sticker.y,
        x: 0,
        y: 0
      }}
      exit={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.92, filter: 'blur(6px)' }
      }
      transition={reduced ? { duration: 0 } : SPRING.soft}
      style={{
        rotate: Math.max(-MAX_TILT, Math.min(MAX_TILT, sticker.rotation)),
        width: NOTE_W,
        minHeight: NOTE_H
      }}
      className={cn(
        'group/note absolute flex cursor-grab flex-col rounded-xl border p-3.5 backdrop-blur-sm active:cursor-grabbing',
        style.surface,
        style.border,
        style.shadow
      )}
    >
      <div className="flex items-start justify-between gap-2 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', style.dot)} />
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            {sticker.kind === 'permanent' ? 'kept' : 'temporary'}
          </span>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/note:opacity-100">
          <ColorSwitch
            current={sticker.color}
            onPick={(color) => void patch(sticker.id, { color })}
          />
          <button
            type="button"
            onClick={() => void remove(sticker.id)}
            aria-label="Delete sticker"
            className="grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-black/20 hover:text-ink"
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
        </div>
      </div>

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitBody}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(sticker.body)
              setEditing(false)
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitBody()
          }}
          className="min-h-[76px] flex-1 resize-none rounded-md bg-black/15 p-1.5 text-[13px] leading-relaxed text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          // A single click starts a drag, so editing is on double-click — and
          // the guard stops a drag that happens to end here from opening it.
          onDoubleClick={() => {
            if (!draggingRef.current) setEditing(true)
          }}
          className="flex-1 cursor-text whitespace-pre-wrap break-words text-left text-[13px] leading-relaxed text-ink"
        >
          {sticker.body}
        </button>
      )}

      {(attached || expires) && (
        <div className="mt-2 border-t border-white/10 pt-1.5 text-[10.5px] text-ink-faint">
          {attached
            ? `on ${attached.weekday.slice(0, 3)} ${attached.month} ${attached.dayNum}`
            : `clears ${expires!.month} ${expires!.dayNum}`}
        </div>
      )}
    </motion.div>
  )
}

function ColorSwitch({
  current,
  onPick
}: {
  current: StickerColor
  onPick(color: StickerColor): void
}) {
  const next =
    STICKER_COLORS[(STICKER_COLORS.indexOf(current) + 1) % STICKER_COLORS.length]

  return (
    <button
      type="button"
      onClick={() => onPick(next)}
      aria-label="Change colour"
      title="Change colour"
      className="grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-black/20 hover:text-ink"
    >
      <span className={cn('size-2.5 rounded-full', paperStyle(next).dot)} />
    </button>
  )
}

function Composer({
  onCreate,
  onCancel
}: {
  onCreate(input: Omit<NewSticker, 'x' | 'y' | 'rotation'>): void
  onCancel(): void
}) {
  const [body, setBody] = useState('')
  const [color, setColor] = useState<StickerColor>('butter')
  const [kind, setKind] = useState<Sticker['kind']>('permanent')
  const [mode, setMode] = useState<'expires' | 'attached'>('expires')
  const [date, setDate] = useState(() => addDays(todayKey(), 7))

  function submit() {
    if (!body.trim()) return
    onCreate({
      body: body.trim(),
      color,
      kind,
      expiresAt: kind === 'temp' && mode === 'expires' ? date : null,
      attachedDate: kind === 'temp' && mode === 'attached' ? date : null
    })
    setBody('')
  }

  return (
    <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') onCancel()
        }}
        rows={2}
        autoFocus
        placeholder="Write the note…"
        className="w-full resize-none rounded-lg border border-line-soft bg-canvas/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-ink-faint/50 focus:border-line"
      />

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
            Paper
          </span>
          <div className="flex items-center gap-1.5">
            {STICKER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={c === color}
                className={cn(
                  'grid size-6 place-items-center rounded-md border transition-colors',
                  c === color ? 'border-line bg-raised' : 'border-transparent'
                )}
              >
                <span className={cn('size-3 rounded-full', paperStyle(c).dot)} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
            Keeps
          </span>
          <div className="flex items-center gap-1">
            <Pill on={kind === 'permanent'} onClick={() => setKind('permanent')}>
              Until deleted
            </Pill>
            <Pill on={kind === 'temp'} onClick={() => setKind('temp')}>
              Temporary
            </Pill>
          </div>
        </div>

        {kind === 'temp' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                Which
              </span>
              <div className="flex items-center gap-1">
                <Pill on={mode === 'expires'} onClick={() => setMode('expires')}>
                  Clears on
                </Pill>
                <Pill
                  on={mode === 'attached'}
                  onClick={() => setMode('attached')}
                >
                  Pin to a day
                </Pill>
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                Date
              </span>
              <input
                type="date"
                value={date}
                min={todayKey()}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1.5 text-[12.5px] tabular-nums outline-none transition-colors focus:border-line"
              />
            </label>
          </>
        )}

        <div className="flex-1" />

        <motion.button
          type="button"
          onClick={submit}
          whileTap={{ scale: 0.97 }}
          disabled={!body.trim()}
          className="rounded-lg bg-amber/20 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
        >
          Add to wall
        </motion.button>
      </div>

      {kind === 'temp' && mode === 'attached' && (
        <p className="mt-2.5 text-[11px] text-ink-faint/80">
          Pinned notes also show on that day&apos;s card in Today, and clear
          themselves once the day has passed.
        </p>
      )}
    </div>
  )
}

function Pill({
  on,
  onClick,
  children
}: {
  on: boolean
  onClick(): void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11.5px] transition-colors',
        on ? 'bg-raised text-ink' : 'text-ink-faint hover:text-ink-dim'
      )}
    >
      {children}
    </button>
  )
}

