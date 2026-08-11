import { AnimatePresence, motion } from 'motion/react'
import { labelFor } from '@shared/date'
import type { GoalNote } from '@shared/types'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'

interface NoteBandProps {
  notes: GoalNote[]
  onDismiss(note: GoalNote): void
}

/**
 * Reminders on a day card.
 *
 * Everything here is doing one job: making it obvious at a glance that these
 * are *not* tasks. No checkbox, a dashed edge rather than a solid one, its own
 * labelled band above the timeline, and dismissal reads "Got it" instead of
 * anything that sounds like completion. They are excluded from the progress
 * ring in DayCard, and this is the visual half of that same promise.
 */
export function NoteBand({ notes, onDismiss }: NoteBandProps) {
  if (notes.length === 0) return null

  return (
    <div className="shrink-0 px-4 pb-1 pt-0.5">
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint/70">
          Reminders · {notes.length}
        </span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>

      <div className="space-y-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onDismiss={onDismiss} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function NoteRow({ note, onDismiss }: { note: GoalNote; onDismiss(n: GoalNote): void }) {
  const style = goalStyle(note.goalColor)
  const learned = note.learnedDate ? labelFor(note.learnedDate) : null

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8, height: 0, marginTop: 0 }}
      transition={SPRING.soft}
      className={cn(
        'group/note flex items-start gap-2.5 rounded-slot border border-dashed px-3 py-2',
        note.goalColor ? style.border : 'border-line',
        note.goalColor ? style.soft : 'bg-raised/40'
      )}
    >
      <span
        aria-hidden
        className={cn('mt-[3px] shrink-0 text-[11px]', style.text)}
        title="Reminder"
      >
        ✦
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-ink-dim">{note.body}</p>

        {(note.goalTitle || learned) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-faint">
            {note.goalTitle && (
              <span className={cn('max-w-[170px] truncate', style.text)}>
                {note.goalTitle}
              </span>
            )}
            {note.goalTitle && learned && <span className="text-line">·</span>}
            {learned && (
              <span>
                learned {learned.weekday}, {learned.month} {learned.dayNum}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        data-no-drag
        onClick={() => onDismiss(note)}
        title="Stop showing this reminder"
        className={cn(
          'mt-px shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-ink-faint',
          'opacity-0 transition-all duration-150 group-hover/note:opacity-100',
          'hover:bg-line hover:text-ink'
        )}
      >
        Got it
      </button>
    </motion.div>
  )
}
