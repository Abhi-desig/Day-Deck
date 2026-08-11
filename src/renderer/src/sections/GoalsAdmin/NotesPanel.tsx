import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { addDays, labelFor, todayKey } from '@shared/date'
import { parseNoteSchedule } from '@shared/note-text'
import type { CurriculumPlan, GoalNote } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { EASE_OUT, SPRING } from '../../lib/motion'

const EXAMPLE =
  'I learned this on Saturday, but review it on Wednesday'

/**
 * Notes and reminders for one goal.
 *
 * The composer reads dates straight out of the sentence as it is typed, so the
 * common case — writing the note the way you would say it — needs no date
 * picking at all. The resolved dates are always shown as editable fields
 * rather than applied invisibly: a parser that guesses silently is one you
 * cannot trust, and one wrong Wednesday is enough to stop trusting it.
 */
export function NotesPanel({ plan }: { plan: CurriculumPlan }) {
  const notes = useCurriculum((s) => s.notes)
  const busy = useCurriculum((s) => s.notesBusy)
  const loadNotes = useCurriculum((s) => s.loadNotes)
  const addNote = useCurriculum((s) => s.addNote)
  const patchNote = useCurriculum((s) => s.patchNote)
  const removeNote = useCurriculum((s) => s.removeNote)

  const goalId = plan.curriculum.id
  const style = goalStyle(plan.curriculum.color)
  const today = todayKey()

  useEffect(() => {
    void loadNotes(goalId)
  }, [goalId, loadNotes])

  const [body, setBody] = useState('')
  const [surfaceDate, setSurfaceDate] = useState(() => addDays(todayKey(), 1))
  const [learnedDate, setLearnedDate] = useState('')
  // Once a date has been set by hand the parser stops touching it — correcting
  // the app's guess and watching it be overwritten on the next keystroke is
  // worse than never guessing.
  const [pinned, setPinned] = useState({ surface: false, learned: false })
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(
    () => parseNoteSchedule(body, today),
    [body, today]
  )

  useEffect(() => {
    if (!pinned.surface && parsed.surfaceDate) setSurfaceDate(parsed.surfaceDate)
    if (!pinned.learned && parsed.learnedDate) setLearnedDate(parsed.learnedDate)
  }, [parsed, pinned])

  const readFromText =
    !pinned.surface && parsed.surfaceDate === surfaceDate && !!parsed.surfaceDate

  async function submit(): Promise<void> {
    if (!body.trim() || saving) return
    setSaving(true)
    const ok = await addNote({
      curriculumId: goalId,
      body: body.trim(),
      surfaceDate,
      learnedDate: learnedDate || null
    })
    setSaving(false)
    if (!ok) return

    setBody('')
    setLearnedDate('')
    setSurfaceDate(addDays(todayKey(), 1))
    setPinned({ surface: false, learned: false })
  }

  const upcoming = notes.filter(
    (n) => n.status === 'active' && n.surfaceDate >= today
  )
  const past = notes.filter(
    (n) => n.status === 'dismissed' || n.surfaceDate < today
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-xl border border-line-soft bg-surface/70 p-5">
        <h3 className="flex items-center gap-2.5 text-[15px] tracking-[-0.01em]">
          <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />
          Notes &amp; reminders
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
          These surface on the day card you choose. They are reminders, not
          tasks — nothing here counts towards a day&apos;s completion.
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={3}
          placeholder={EXAMPLE}
          aria-label="Reminder"
          className="mt-4 w-full resize-none rounded-lg border border-line-soft bg-canvas/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-ink-faint/50 focus:border-line"
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <DateField
            label="Remind me on"
            value={surfaceDate}
            min={today}
            onChange={(v) => {
              setSurfaceDate(v)
              setPinned((p) => ({ ...p, surface: true }))
            }}
          />
          <DateField
            label="Learned on"
            value={learnedDate}
            max={today}
            optional
            onChange={(v) => {
              setLearnedDate(v)
              setPinned((p) => ({ ...p, learned: true }))
            }}
          />

          <div className="flex-1" />

          <motion.button
            type="button"
            onClick={() => void submit()}
            whileTap={{ scale: 0.97 }}
            disabled={!body.trim() || saving}
            className="rounded-lg bg-amber/20 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
          >
            {saving ? 'Saving…' : 'Add reminder'}
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {readFromText && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING.soft}
              className="overflow-hidden text-[11px] text-ink-faint/80"
            >
              <span className="mt-2 inline-block">
                Read from what you wrote — {describe(surfaceDate)}
                {learnedDate && parsed.learnedDate === learnedDate
                  ? `, learned ${describe(learnedDate)}`
                  : ''}
                . Change either date if that is not what you meant.
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line-soft bg-surface/40 p-3">
        {busy && notes.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-ink-faint">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-ink-faint">
            No reminders on this goal yet. Try something like “{EXAMPLE}”.
          </p>
        ) : (
          <>
            <Group
              title="Coming up"
              notes={upcoming}
              today={today}
              onPatch={patchNote}
              onRemove={removeNote}
            />
            <Group
              title="Past and dismissed"
              notes={past}
              today={today}
              dim
              onPatch={patchNote}
              onRemove={removeNote}
            />
          </>
        )}
      </div>
    </div>
  )
}

function describe(key: string): string {
  const label = labelFor(key)
  return `${label.weekday}, ${label.month} ${label.dayNum}`
}

function DateField({
  label,
  value,
  min,
  max,
  optional,
  onChange
}: {
  label: string
  value: string
  min?: string
  max?: string
  optional?: boolean
  onChange(value: string): void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
        {optional && <span className="normal-case tracking-normal"> · optional</span>}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1.5 text-[12.5px] tabular-nums outline-none transition-colors focus:border-line"
      />
    </label>
  )
}

function Group({
  title,
  notes,
  today,
  dim,
  onPatch,
  onRemove
}: {
  title: string
  notes: GoalNote[]
  today: string
  dim?: boolean
  onPatch(id: string, patch: { status?: GoalNote['status']; surfaceDate?: string }): void
  onRemove(id: string): void
}) {
  if (notes.length === 0) return null

  return (
    <div className={cn('mb-3', dim && 'opacity-70')}>
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint/70">
          {title} · {notes.length}
        </span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            today={today}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

function NoteRow({
  note,
  today,
  onPatch,
  onRemove
}: {
  note: GoalNote
  today: string
  onPatch(id: string, patch: { status?: GoalNote['status']; surfaceDate?: string }): void
  onRemove(id: string): void
}) {
  const surface = labelFor(note.surfaceDate, today)
  const dismissed = note.status === 'dismissed'

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      className="group/note mb-1 flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-raised/50"
    >
      <div className="w-[86px] shrink-0 pt-0.5">
        <div
          className={cn(
            'text-[12px] tabular-nums',
            surface.isToday ? 'text-amber' : 'text-ink-dim'
          )}
        >
          {surface.month} {surface.dayNum}
        </div>
        <div className="text-[10.5px] text-ink-faint/70">
          {surface.weekday.slice(0, 3)}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[13px] leading-snug',
            dismissed ? 'text-ink-faint line-through' : 'text-ink-dim'
          )}
        >
          {note.body}
        </p>
        {note.learnedDate && (
          <p className="mt-0.5 text-[10.5px] text-ink-faint/70">
            learned {describe(note.learnedDate)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/note:opacity-100">
        <button
          type="button"
          onClick={() =>
            onPatch(note.id, { status: dismissed ? 'active' : 'dismissed' })
          }
          className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
        >
          {dismissed ? 'Restore' : 'Dismiss'}
        </button>
        <button
          type="button"
          onClick={() => onRemove(note.id)}
          aria-label="Delete reminder"
          className="grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-line hover:text-ink"
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
    </motion.div>
  )
}
