import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PACK_VIEWS, type SheetShot, type StorySheet } from '@shared/types'
import { cn } from '../../lib/cn'
import { shotUrl } from '../../lib/media'
import { SPRING } from '../../lib/motion'
import { useCast } from '../../store/useCast'
import { useStoryboards } from '../../store/useStoryboards'
import { CAST_DRAG_TYPE } from './nodes/types'
import { Field } from './Field'

/**
 * The cast.
 *
 * A style locks how the film is shot; this locks who is in it. The two are the
 * halves of the same problem — a generator writing shot 9 has never seen shot 2,
 * so anything that must stay the same across shots has to be restated in full
 * inside every prompt.
 *
 * Words alone do not settle a face, though: two generations from identical
 * words are two different people. So a character here can go further than being
 * described. Generate a portrait, approve one, and the character becomes
 * *locked* — draggable onto the canvas, where their approved image is attached
 * to every generation on that board. That is the whole difference between a
 * person who matches the description and the same person, shot to shot.
 *
 * Board-scoped, unlike the style library: a look is a house style worth reusing
 * across films, a cast belongs to one film.
 */
export function CastPanel({ open, boardId }: { open: boolean; boardId: string }) {
  const sheets = useStoryboards((s) => s.sheets)
  const addSheet = useStoryboards((s) => s.addSheet)
  const [editing, setEditing] = useState<string | null>(null)

  async function create(): Promise<void> {
    const sheet = await addSheet({ boardId, name: 'New character' })
    if (sheet) setEditing(sheet.id)
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={SPRING.soft}
          className="shrink-0 overflow-hidden"
        >
          <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-3">
            <div className="flex items-center gap-2 pb-2.5">
              <h2 className="text-[12.5px] text-ink">Cast</h2>
              <p className="text-[11px] text-ink-faint">
                Described once and repeated word for word. Approve a portrait to
                lock the face as well as the words.
              </p>
              <button
                type="button"
                onClick={() => void create()}
                className="ml-auto rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
              >
                + New character
              </button>
            </div>

            {sheets.length === 0 ? (
              <p className="px-1 pb-1 text-[11.5px] leading-relaxed text-ink-faint">
                Nobody yet. Add a character and the prompt writer will restate
                their description in full every time a shot shows them, instead of
                writing “the same woman as before” — which means nothing to a
                generator that never saw the previous shot.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sheets.map((sheet) => (
                  <Chip
                    key={sheet.id}
                    sheet={sheet}
                    editing={editing === sheet.id}
                    onEdit={() =>
                      setEditing(editing === sheet.id ? null : sheet.id)
                    }
                  />
                ))}
              </div>
            )}

            <AnimatePresence initial={false}>
              {editing && sheets.some((s) => s.id === editing) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING.soft}
                  className="overflow-hidden"
                >
                  <Editor
                    sheet={sheets.find((s) => s.id === editing)!}
                    boardId={boardId}
                    onDone={() => setEditing(null)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * One character, and — once locked — the thing you drag.
 *
 * Three states in one dot, extending the vocabulary the hollow dot already
 * established rather than inventing a second one. Hollow: described only, or
 * not even that. Amber ring: a candidate is waiting to be approved. Filled with
 * the portrait: locked, and draggable.
 *
 * Not draggable until locked, deliberately. A described-only character on the
 * canvas would draw a lock with no image behind it, which is the one way this
 * feature can look like it is working while doing nothing.
 */
function Chip({
  sheet,
  editing,
  onEdit
}: {
  sheet: StorySheet
  editing: boolean
  onEdit(): void
}) {
  const described = sheet.description.trim() !== ''
  const locked = sheet.status === 'locked' && !!sheet.portraitId

  const title = locked
    ? 'Drag onto the canvas to lock this board to their face'
    : sheet.status === 'proposed'
      ? 'A portrait is waiting to be approved'
      : described
        ? 'Described — their words go into every prompt. Approve a portrait to lock the face too.'
        : 'No description yet — not sent to prompts'

  return (
    <div
      draggable={locked}
      onDragStart={(event) => {
        if (!locked) return
        event.dataTransfer.setData(CAST_DRAG_TYPE, sheet.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-[11.5px] transition-colors',
        locked && 'cursor-grab active:cursor-grabbing',
        editing
          ? 'border-amber/50 bg-raised text-ink'
          : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
      )}
      title={title}
    >
      {locked && sheet.portraitId ? (
        <img
          src={shotUrl(sheet.portraitId)}
          alt=""
          draggable={false}
          className="size-4 rounded-full border border-amber/50 object-cover"
        />
      ) : (
        <span
          className={cn(
            'ml-1 size-1.5 rounded-full border',
            sheet.status === 'proposed'
              ? 'border-amber bg-transparent'
              : described
                ? 'border-amber bg-amber'
                : 'border-ink-faint bg-transparent'
          )}
        />
      )}
      {sheet.name || 'Unnamed'}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${sheet.name || 'character'}`}
        className="text-ink-faint transition-colors hover:text-ink"
      >
        {editing ? '▴' : '▾'}
      </button>
    </div>
  )
}

function Editor({
  sheet,
  boardId,
  onDone
}: {
  sheet: StorySheet
  boardId: string
  onDone(): void
}) {
  const patchSheet = useStoryboards((s) => s.patchSheet)
  const removeSheet = useStoryboards((s) => s.removeSheet)
  const replaceSheet = useStoryboards((s) => s.replaceSheet)

  const shots = useCast((s) => s.shots[sheet.id])
  const pack = useCast((s) => s.packs[sheet.id])
  const generating = useCast((s) => s.generating === sheet.id)
  const loadShots = useCast((s) => s.loadShots)
  const propose = useCast((s) => s.propose)
  const approve = useCast((s) => s.approve)
  const discard = useCast((s) => s.discard)
  const unlockSheet = useCast((s) => s.unlockSheet)
  const place = useCast((s) => s.place)

  const [direction, setDirection] = useState('')
  const [showOthers, setShowOthers] = useState(false)

  useEffect(() => {
    if (shots === undefined) void loadShots(sheet.id)
  }, [sheet.id, shots, loadShots])

  const all = shots ?? []
  const candidates = all.filter((x) => x.kind === 'candidate')
  const packShots = all.filter((x) => x.kind === 'pack')
  const locked = sheet.status === 'locked' && !!sheet.portraitId

  // The newest candidate is the one being judged. Everything else is kept —
  // a paid generation is not thrown away by the next click — but collapsed,
  // because a second face beside the approved one is the drift this exists
  // to stop.
  const latest = candidates[candidates.length - 1] ?? null
  const others = candidates.filter((x) => x.id !== latest?.id)

  return (
    <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
      <label className="block">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
          Name
        </span>
        <Field
          value={sheet.name}
          placeholder="Maya"
          onCommit={(name) => void patchSheet(sheet.id, { name })}
          className="mt-1 rounded-lg border border-line-soft bg-well px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <label className="block">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
          Description
        </span>
        <Field
          multiline
          value={sheet.description}
          placeholder="24, South Asian, shoulder-length black hair, oversized grey hoodie, silver nose stud, worn white sneakers"
          onCommit={(description) => void patchSheet(sheet.id, { description })}
          className="mt-1 min-h-[76px] rounded-lg border border-line-soft bg-well px-2.5 py-1.5 text-[12.5px] leading-relaxed text-ink-dim"
        />
        <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">
          Write what a camera would see — age, build, hair, wardrobe, anything
          that must not change between shots. This exact wording goes into every
          prompt they appear in, so keep it tight.
        </span>
      </label>

      {/* ------------------------------------------------------- the face */}

      <div className="rounded-lg border border-line-soft bg-well/60 p-2.5">
        <div className="flex items-baseline gap-2 pb-2">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
            Portrait
          </span>
          <span className="text-[10.5px] leading-relaxed text-ink-faint">
            {locked
              ? 'Locked. Drag the chip above onto the canvas to lock this board to them.'
              : 'The words alone cannot settle a face — two generations from the same description are two different people.'}
          </span>
        </div>

        {locked ? (
          <div className="flex gap-2.5">
            <img
              src={shotUrl(sheet.portraitId!)}
              alt=""
              className="size-24 shrink-0 rounded-lg border border-amber/40 object-cover"
            />
            <div className="min-w-0 flex-1">
              <PackLine pack={pack} count={packShots.length} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {packShots.map((shot) => (
                  <img
                    key={shot.id}
                    src={shotUrl(shot.id)}
                    alt={shot.view}
                    title={shot.view}
                    className="size-9 rounded border border-line-soft object-cover"
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void place({ boardId, sheetId: sheet.id })
                  }}
                  className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
                >
                  Add to this board
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void unlockSheet(sheet.id).then((s) => s && replaceSheet(s))
                  }}
                  className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-line hover:text-ink"
                  title="Keeps every image. Takes the character off every board they were on, because a placement with no approved portrait locks nothing."
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {latest ? (
              <div className="flex gap-2.5">
                <img
                  src={shotUrl(latest.id)}
                  alt=""
                  className="size-32 shrink-0 rounded-lg border border-line-soft object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    Is this them? Approving builds{' '}
                    {PACK_VIEWS.length} more angles from this exact image, in the
                    background — five metered image calls.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void approve(sheet.id, latest.id).then(
                          (s) => s && replaceSheet(s)
                        )
                      }}
                      className="rounded-md border border-amber/50 bg-amber/10 px-2.5 py-1 text-[11.5px] text-amber-soft transition-colors hover:bg-amber/15"
                    >
                      Approve — then build {PACK_VIEWS.length} reference angles in
                      the background
                    </button>
                    <button
                      type="button"
                      disabled={generating}
                      onClick={() => void propose(sheet.id, direction)}
                      className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-50"
                    >
                      {generating ? 'Generating…' : 'Try again'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void discard(latest.id, sheet.id)}
                      className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-line hover:text-ink"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Field
                  value={direction}
                  placeholder="Optional: background, light, framing — portrait only, never sent to scene prompts"
                  onCommit={setDirection}
                  className="rounded-lg border border-line-soft bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-dim"
                />
                <button
                  type="button"
                  disabled={generating || !sheet.description.trim()}
                  onClick={() => void propose(sheet.id, direction)}
                  className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-50"
                  title={
                    sheet.description.trim()
                      ? 'One metered image'
                      : 'Describe them first'
                  }
                >
                  {generating ? 'Generating…' : 'Generate portrait — 1 image'}
                </button>
              </div>
            )}

            {others.length > 0 && (
              <div className="mt-2.5 border-t border-line-soft/70 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOthers(!showOthers)}
                  className="text-[10.5px] text-ink-faint transition-colors hover:text-ink"
                >
                  {showOthers ? '▴' : '▾'} {others.length} other candidate
                  {others.length === 1 ? '' : 's'}
                </button>
                {showOthers && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {others.map((shot) => (
                      <Candidate
                        key={shot.id}
                        shot={shot}
                        onApprove={() => {
                          void approve(sheet.id, shot.id).then(
                            (s) => s && replaceSheet(s)
                          )
                        }}
                        onDiscard={() => void discard(shot.id, sheet.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => {
            void removeSheet(sheet.id)
            onDone()
          }}
          className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-amber/40 hover:text-amber-soft"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
        >
          Done
        </button>
      </div>
    </div>
  )
}

/** Quiet, and never a modal — the pack is background work by design. */
function PackLine({
  pack,
  count
}: {
  pack: { done: number; total: number } | undefined
  count: number
}) {
  const done = pack?.done ?? count
  const total = pack?.total ?? PACK_VIEWS.length

  return (
    <p className="text-[11px] leading-relaxed text-ink-faint">
      {done >= total
        ? `Reference angles ready — ${total} of ${total}.`
        : `Building reference angles — ${done} of ${total}. Every one is generated from the approved portrait, so they are the same person rather than five people who match the description.`}
    </p>
  )
}

function Candidate({
  shot,
  onApprove,
  onDiscard
}: {
  shot: SheetShot
  onApprove(): void
  onDiscard(): void
}) {
  return (
    <div className="group/cand relative">
      <img
        src={shotUrl(shot.id)}
        alt=""
        className="size-16 rounded border border-line-soft object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 rounded-b bg-surface/85 py-0.5 opacity-0 transition-opacity group-hover/cand:opacity-100">
        <button
          type="button"
          onClick={onApprove}
          className="text-[9.5px] text-amber-soft"
        >
          Use
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="text-[9.5px] text-ink-faint hover:text-ink"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
