import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion
} from 'motion/react'
import { addDays, labelFor, todayKey } from '@shared/date'
import type {
  NewSticker,
  Sticker,
  StickerColor,
  StickerFolder
} from '@shared/types'
import { STICKER_COLORS } from '@shared/types'
import { useDeck } from '../store/useDeck'
import { useIntent } from '../store/useShell'
import { useStickers } from '../store/useStickers'
import { cn } from '../lib/cn'
import { clampToBoard, findFreeSpot, type Rect } from '../lib/board'
import { EASE_OUT, SPRING } from '../lib/motion'
import { paperStyle } from '../lib/stickerColor'

const NOTE_W = 208
const NOTE_H = 168
/** Room to drop notes below the fold; the board scrolls. */
const BOARD_H = 1400
/** Breathing room at the edges, and between two freshly-placed notes. */
const PAD = 16

/** Enough tilt to look pinned by hand, never enough to be hard to read. */
const MAX_TILT = 5

/** The pseudo-folders on the filter strip. Neither is a row in the database. */
const ALL = '__all'
const LOOSE = '__loose'

export function Stickers() {
  const stickers = useStickers((s) => s.stickers)
  const folders = useStickers((s) => s.folders)
  const ready = useStickers((s) => s.ready)
  const error = useStickers((s) => s.error)
  const load = useStickers((s) => s.load)
  const add = useStickers((s) => s.add)
  const dismissError = useStickers((s) => s.dismissError)

  const [composing, setComposing] = useState(false)
  const [filter, setFilter] = useState<string>(ALL)

  /**
   * The board's own width, measured.
   *
   * Drag constraints are a rectangle in board coordinates, so the right-hand
   * edge has to be a real number rather than "100%". This is also why the notes
   * are positioned by transform rather than by `left`/`top`: with the element's
   * layout origin pinned at the board's origin, its transform *is* its board
   * coordinate, and one clamp covers both the drop and the constraint.
   */
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [boardW, setBoardW] = useState(0)

  useLayoutEffect(() => {
    const element = surfaceRef.current
    if (!element) return

    const measure = (): void => setBoardW(element.clientWidth)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const newStickerIntent = useIntent('newSticker')
  useEffect(() => {
    if (newStickerIntent > 0) setComposing(true)
  }, [newStickerIntent])

  // A folder that has just been deleted must not leave the board filtered to
  // nothing with no way back — the strip it was selected from is gone too.
  useEffect(() => {
    if (filter === ALL || filter === LOOSE) return
    if (!folders.some((f) => f.id === filter)) setFilter(ALL)
  }, [folders, filter])

  const visible = stickers.filter((s) => {
    if (filter === ALL) return true
    if (filter === LOOSE) return s.folderId === null
    return s.folderId === filter
  })

  const permanent = visible.filter((s) => s.kind === 'permanent').length
  const temp = visible.length - permanent

  async function create(
    input: Omit<NewSticker, 'x' | 'y' | 'rotation' | 'folderId'>
  ): Promise<void> {
    // Placed against what is *visible*, not against the whole wall: two notes
    // in different folders never share a screen, so treating a hidden one as an
    // obstacle would push new notes into empty space for no reason.
    const taken: Rect[] = visible.map((s) => ({
      x: s.x,
      y: s.y,
      w: NOTE_W,
      h: NOTE_H
    }))

    const spot = findFreeSpot(
      taken,
      { w: NOTE_W, h: NOTE_H },
      { w: Math.max(boardW, NOTE_W + PAD * 2), h: BOARD_H },
      PAD,
      PAD
    )

    const n = stickers.length
    const created = await add({
      ...input,
      ...spot,
      rotation: (n % 2 === 0 ? 1 : -1) * (1.5 + (n % 3)),
      // A note added while a folder is being viewed belongs to that folder.
      // Anything else means adding to a folder silently files it elsewhere.
      folderId: filter === ALL || filter === LOOSE ? null : filter
    })
    if (created) setComposing(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-7 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">Stickers</h1>
          <span className="text-[12.5px] text-ink-faint">
            {visible.length === 0
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

      <FolderStrip active={filter} onSelect={setFilter} />

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

      <div className="relative min-h-0 flex-1 overflow-auto px-7 pb-7">
        {/* The board is a fixed-size positioned surface: notes carry absolute
            coordinates, so it cannot be a flow layout. */}
        <div ref={surfaceRef} className="relative" style={{ height: BOARD_H }}>
          {ready && visible.length === 0 && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              className="pt-16 text-center text-[13px] leading-relaxed text-ink-faint"
            >
              {filter === ALL
                ? 'Nothing on the wall.'
                : 'Nothing filed here yet.'}
              <br />
              <span className="text-ink-faint/60">
                Temporary notes clear themselves; permanent ones stay until you
                delete them.
              </span>
            </motion.p>
          )}

          <AnimatePresence>
            {visible.map((sticker) => (
              <Note key={sticker.id} sticker={sticker} boardW={boardW} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/**
 * The folder filter.
 *
 * Grouping is optional and stays that way: "All" is the default and a note
 * never has to declare a folder to exist. The strip hides itself entirely until
 * there is at least one folder, so a wall nobody wanted to organise looks
 * exactly as it did before folders existed.
 */
function FolderStrip({
  active,
  onSelect
}: {
  active: string
  onSelect(id: string): void
}) {
  const folders = useStickers((s) => s.folders)
  const stickers = useStickers((s) => s.stickers)
  const addFolder = useStickers((s) => s.addFolder)
  const removeFolder = useStickers((s) => s.removeFolder)

  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')

  const loose = stickers.filter((s) => s.folderId === null).length

  async function create(): Promise<void> {
    const name = draft.trim()
    if (!name) return
    const folder = await addFolder({
      name,
      color: STICKER_COLORS[folders.length % STICKER_COLORS.length]
    })
    setDraft('')
    setNaming(false)
    if (folder) onSelect(folder.id)
  }

  if (folders.length === 0 && !naming) {
    return (
      <div className="shrink-0 px-7 pb-3">
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="text-[11.5px] text-ink-faint/70 transition-colors hover:text-ink-dim"
        >
          + Group these into folders
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-7 pb-3">
      <Chip on={active === ALL} onClick={() => onSelect(ALL)}>
        All
        <Count n={stickers.length} />
      </Chip>

      {loose > 0 && (
        <Chip on={active === LOOSE} onClick={() => onSelect(LOOSE)}>
          Unfiled
          <Count n={loose} />
        </Chip>
      )}

      {folders.map((folder) => {
        const n = stickers.filter((s) => s.folderId === folder.id).length
        return (
          <Chip
            key={folder.id}
            on={active === folder.id}
            onClick={() => onSelect(folder.id)}
          >
            <span
              className={cn('size-1.5 rounded-full', paperStyle(folder.color).dot)}
            />
            {folder.name}
            <Count n={n} />
            {active === folder.id && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${folder.name}`}
                title="Delete this folder — its notes stay on the wall"
                onClick={(e) => {
                  e.stopPropagation()
                  void removeFolder(folder.id)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.stopPropagation()
                  void removeFolder(folder.id)
                }}
                className="ml-0.5 text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </span>
            )}
          </Chip>
        )
      })}

      {naming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) void create()
            else setNaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
            if (e.key === 'Escape') {
              setDraft('')
              setNaming(false)
            }
          }}
          placeholder="Folder name…"
          className="w-[132px] rounded-full border border-line bg-canvas/60 px-2.5 py-1 text-[11.5px] outline-none placeholder:text-ink-faint/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          aria-label="New folder"
          className="rounded-full border border-dashed border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-line hover:text-ink-dim"
        >
          + Folder
        </button>
      )}
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums text-ink-faint/60">{n}</span>
}

function Chip({
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
        on
          ? 'border-line bg-raised text-ink'
          : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
      )}
    >
      {children}
    </button>
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

function Note({ sticker, boardW }: { sticker: Sticker; boardW: number }) {
  const move = useStickers((s) => s.move)
  const patch = useStickers((s) => s.patch)
  const remove = useStickers((s) => s.remove)
  const reduced = useReducedMotion()

  const style = paperStyle(sticker.color)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sticker.body)
  const draggingRef = useRef(false)

  /**
   * Position is a transform, not `left`/`top`.
   *
   * Animating `left`/`top` puts a layout pass and a paint on every frame of
   * every drop, for every note on the wall — the settle was the jerky part, not
   * the drag. `x`/`y` composite on the GPU and are the same values Motion
   * writes to while dragging, so there is no handover between "being dragged"
   * and "settling" at all.
   */
  const x = useMotionValue(sticker.x)
  const y = useMotionValue(sticker.y)

  // Follow the store when it changes underneath us — an import, an undo, or the
  // clamp below landing somewhere other than where the finger let go. Skipped
  // mid-drag, where the finger is the authority.
  useEffect(() => {
    if (draggingRef.current) return
    x.set(sticker.x)
    y.set(sticker.y)
  }, [sticker.x, sticker.y, x, y])

  // The right and bottom edges are real numbers rather than a ref to the board,
  // because a ref constrains to the *scroll viewport* — which is why notes
  // could be dropped into the strip of board that was scrolled out of view and
  // then appear to be off-screen.
  const bounds = {
    left: 0,
    top: 0,
    right: Math.max(0, boardW - NOTE_W),
    bottom: Math.max(0, BOARD_H - NOTE_H)
  }

  function commitBody(): void {
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
      dragConstraints={bounds}
      // Low, not zero: a little give at the edge tells you the board has one.
      // The drop clamps regardless, so the elastic overshoot can never persist.
      dragElastic={0.06}
      whileDrag={reduced ? undefined : { scale: 1.05, zIndex: 50 }}
      onDragStart={() => {
        draggingRef.current = true
      }}
      onDragEnd={() => {
        draggingRef.current = false
        // Motion has already written the final transform, so the position is
        // read off the motion values rather than reconstructed from the drag
        // offset — which is what used to let a note escape when it started a
        // drag from a stale `sticker.x`.
        const landed = clampToBoard(
          { x: x.get(), y: y.get() },
          { w: NOTE_W, h: NOTE_H },
          { w: Math.max(boardW, NOTE_W), h: BOARD_H }
        )
        void move(sticker.id, landed.x, landed.y, sticker.rotation)
      }}
      // Settling into place is a spring, not a stop — a note dropped on a desk
      // does not arrive rigid.
      dragTransition={{ bounceStiffness: 420, bounceDamping: 34 }}
      // Blur gated by hand; the global pass does not cover filters.
      initial={
        reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: 'blur(5px)' }
      }
      animate={{
        opacity: 1,
        scale: 1,
        ...(reduced ? {} : { filter: 'blur(0px)' })
      }}
      exit={
        reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, filter: 'blur(6px)' }
      }
      transition={reduced ? { duration: 0 } : SPRING.soft}
      style={{
        x,
        y,
        rotate: Math.max(-MAX_TILT, Math.min(MAX_TILT, sticker.rotation)),
        width: NOTE_W,
        minHeight: NOTE_H
      }}
      className={cn(
        // `left-0 top-0` so the transform above is the note's board coordinate
        // outright, with nothing to add to it.
        'group/note absolute left-0 top-0 flex cursor-grab flex-col rounded-xl border p-3.5 backdrop-blur-sm active:cursor-grabbing',
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
          <FolderSwitch sticker={sticker} />
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

      <NoteFooter sticker={sticker} />
    </motion.div>
  )
}

function NoteFooter({ sticker }: { sticker: Sticker }) {
  const folders = useStickers((s) => s.folders)
  const folder = folders.find((f) => f.id === sticker.folderId) ?? null

  const attached = sticker.attachedDate ? labelFor(sticker.attachedDate) : null
  const expires = sticker.expiresAt ? labelFor(sticker.expiresAt) : null

  if (!attached && !expires && !folder) return null

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-1.5 text-[10.5px] text-ink-faint">
      {folder && (
        <span className="inline-flex items-center gap-1">
          <span className={cn('size-1 rounded-full', paperStyle(folder.color).dot)} />
          {folder.name}
        </span>
      )}
      {(attached || expires) && (
        <span className="ml-auto">
          {attached
            ? `on ${attached.weekday.slice(0, 3)} ${attached.month} ${attached.dayNum}`
            : `clears ${expires!.month} ${expires!.dayNum}`}
        </span>
      )}
    </div>
  )
}

/** Files a note, or takes it back out. Hidden until a folder exists. */
function FolderSwitch({ sticker }: { sticker: Sticker }) {
  const folders = useStickers((s) => s.folders)
  const file = useStickers((s) => s.file)
  const [open, setOpen] = useState(false)

  if (folders.length === 0) return null

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Move to a folder"
        title="Move to a folder"
        className="grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-black/20 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
          <path
            d="M2 4.5h4l1 1.5h7v6H2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.14, ease: EASE_OUT }}
            className="absolute right-0 top-6 z-[60] flex min-w-[140px] flex-col gap-0.5 rounded-lg border border-line-soft bg-surface p-1 shadow-lg shadow-black/50"
          >
            {folders.map((folder: StickerFolder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  void file(sticker.id, folder.id)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] transition-colors hover:bg-raised',
                  sticker.folderId === folder.id ? 'text-ink' : 'text-ink-dim'
                )}
              >
                <span
                  className={cn('size-1.5 rounded-full', paperStyle(folder.color).dot)}
                />
                {folder.name}
              </button>
            ))}

            {sticker.folderId && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  void file(sticker.id, null)
                }}
                className="mt-0.5 border-t border-line-soft px-1.5 pt-1.5 text-left text-[11.5px] text-ink-faint transition-colors hover:text-ink"
              >
                Take out of folder
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
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
  onCreate(input: Omit<NewSticker, 'x' | 'y' | 'rotation' | 'folderId'>): void
  onCancel(): void
}) {
  const [body, setBody] = useState('')
  const [color, setColor] = useState<StickerColor>('butter')
  const [kind, setKind] = useState<Sticker['kind']>('permanent')
  const [mode, setMode] = useState<'expires' | 'attached'>('expires')
  const [date, setDate] = useState(() => addDays(todayKey(), 7))

  function submit(): void {
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
