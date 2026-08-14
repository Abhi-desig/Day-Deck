import { AnimatePresence, motion } from 'motion/react'
import type { DateKey } from '@shared/date'
import { labelFor } from '@shared/date'
import type { GoalNote, NewSlot, Slot, Sticker } from '@shared/types'
import { useAgent } from '../../store/useAgent'
import { useCard, useDeck } from '../../store/useDeck'
import { stickersForDate, useStickers } from '../../store/useStickers'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { paperStyle } from '../../lib/stickerColor'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { BorderBeam } from '../magicui/BorderBeam'
import { AgentPanel } from './AgentPanel'
import { NoteBand } from './NoteBand'
import { Timeline } from './Timeline'
import { QuickAdd } from './QuickAdd'

interface DayCardProps {
  date: DateKey
  /** Only the focused card is interactive; peeks render a cheap preview. */
  active: boolean
}

export function DayCard({ date, active }: DayCardProps) {
  const card = useCard(date)
  const today = useDeck((s) => s.today)
  const freshRollIds = useDeck((s) => s.freshRollIds)
  const addSlot = useDeck((s) => s.addSlot)
  const toggleDone = useDeck((s) => s.toggleDone)
  const removeSlot = useDeck((s) => s.removeSlot)
  const dismissNote = useDeck((s) => s.dismissNote)

  const agentOpen = useAgent((s) => s.open[date]) ?? false
  const toggleAgent = useAgent((s) => s.toggle)

  const allStickers = useStickers((s) => s.stickers)
  const pinned = stickersForDate(allStickers, date)

  const label = labelFor(date, today)
  // Reminders are not in `slots` at all, so the ring counts work and only work.
  // The separation is structural — see the goal_notes migration.
  const live = card.slots.filter((s) => s.status !== 'rolled')
  const doneCount = live.filter((s) => s.status === 'done').length
  const progress = live.length === 0 ? 0 : doneCount / live.length

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-card border',
        // Only the focused card samples the backdrop. Peeks sit under a `filter`
        // for their depth blur, which would make backdrop-filter a no-op — and
        // five live blurs behind a dragging deck is not a budget worth spending.
        active ? 'glass card-shadow' : 'glass-flat card-shadow-soft',
        // Today gets no amber border of its own — the beam is the marker, and
        // stacking a static amber outline under it turns the card into a
        // highlighted box instead of a card with a light running round it.
        'border-hairline',
        label.isPast && !label.isToday && 'opacity-90'
      )}
    >
      {/* The one persistent "you are here" marker in the app. */}
      {label.isToday && active && <BorderBeam duration={7} />}

      <header className="relative shrink-0 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[11px] uppercase tracking-[0.16em]',
                  label.isToday ? 'text-amber' : 'text-ink-faint'
                )}
              >
                {label.weekday}
              </span>
              {label.isWeekend && (
                <span className="rounded-full border border-line-soft px-1.5 text-[9.5px] uppercase tracking-wide text-ink-faint/70">
                  weekend
                </span>
              )}
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[38px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {label.dayNum}
              </span>
              <span className="text-[15px] text-ink-dim">
                {label.month} {label.year}
              </span>
            </div>

            <span
              className={cn(
                'mt-1.5 inline-block text-[12px]',
                label.isToday ? 'text-amber-soft' : 'text-ink-faint'
              )}
            >
              {label.relative}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {active && (
              <AgentToggle on={agentOpen} onClick={() => toggleAgent(date)} />
            )}
            <ProgressRing value={progress} done={doneCount} total={live.length} />
          </div>
        </div>
      </header>

      {active ? (
        // Keyed so the two bodies cross-fade as one swap rather than the
        // timeline unmounting a frame before the panel arrives.
        <AnimatePresence mode="wait" initial={false}>
          {agentOpen ? (
            <motion.div
              key="agent"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <AgentPanel date={date} slots={card.slots} />
            </motion.div>
          ) : (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <NoteBand
                notes={card.notes}
                onDismiss={(note: GoalNote) => void dismissNote(note.id, date)}
              />
              <PinnedStickers stickers={pinned} />
              <Timeline
                slots={card.slots}
                freshIds={freshRollIds}
                onToggle={(slot: Slot) => void toggleDone(slot)}
                onDelete={(slot: Slot) => void removeSlot(slot.id, slot.date)}
              />
              <QuickAdd date={date} onAdd={(input: NewSlot) => addSlot(input)} />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <PeekPreview slots={card.slots} notes={card.notes} />
      )}
    </div>
  )
}

/**
 * Stickers pinned to this day.
 *
 * Rendered flat and inline rather than as scattered paper: the wall is where a
 * sticker is an object you drag, and the day card is where it is a thing you
 * read. Like reminders, they are not tasks and carry no checkbox — a pinned
 * note that could be ticked off would be a slot, and slots already exist.
 */
function PinnedStickers({ stickers }: { stickers: Sticker[] }) {
  if (stickers.length === 0) return null

  return (
    <div className="shrink-0 px-4 pb-1 pt-0.5">
      <div className="flex flex-wrap gap-1.5">
        {stickers.map((sticker) => {
          const style = paperStyle(sticker.color)
          return (
            <motion.div
              key={sticker.id}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING.soft}
              className={cn(
                'flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5',
                style.surface,
                style.border
              )}
            >
              <span
                className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', style.dot)}
                aria-hidden
              />
              <span className="whitespace-pre-wrap break-words text-[12px] leading-snug text-ink-dim">
                {sticker.body}
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The per-card assistant switch.
 *
 * On the card rather than in the app chrome because the thing being asked about
 * is this day — a global toggle would have to guess which day the question is
 * about, and would be wrong every time the deck moved.
 */
function AgentToggle({ on, onClick }: { on: boolean; onClick(): void }) {
  return (
    <motion.button
      type="button"
      data-no-drag
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      role="switch"
      aria-checked={on}
      aria-label="Ask about this day"
      title={on ? 'Back to the day' : 'Ask about this day'}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        on
          ? 'border-amber/45 bg-amber/15 text-amber-soft'
          : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full transition-colors',
          on ? 'bg-amber' : 'bg-line'
        )}
      />
      Agent
    </motion.button>
  )
}

/** Non-interactive stand-in for cards behind the focused one. */
function PeekPreview({ slots, notes }: { slots: Slot[]; notes: GoalNote[] }) {
  const shown = slots.filter((s) => s.status !== 'rolled').slice(0, 7)

  return (
    <div className="flex-1 space-y-2 px-5 py-2" aria-hidden>
      {notes.length > 0 && (
        // Counted, not listed. A reminder waiting two days out is worth seeing
        // from here; its wording is not, or the peek stops being a peek.
        <div className="pb-0.5 text-[11px] text-ink-faint/70">
          ✦ {notes.length} {notes.length === 1 ? 'reminder' : 'reminders'}
        </div>
      )}

      {shown.length === 0 && notes.length === 0 && (
        <div className="pt-6 text-[13px] text-ink-faint/50">Nothing planned</div>
      )}
      {shown.map((s) => (
        <div key={s.id} className="flex items-center gap-2.5">
          <span
            className={cn(
              'size-[18px] shrink-0 rounded-full border',
              s.status === 'done'
                ? 'border-amber/50 bg-amber/15'
                : s.sourceColor
                  ? goalStyle(s.sourceColor).border
                  : 'border-line'
            )}
          />
          <span
            className={cn(
              'truncate text-[13.5px]',
              s.status === 'done' ? 'text-ink-faint' : 'text-ink-dim'
            )}
          >
            {s.title}
          </span>
        </div>
      ))}
    </div>
  )
}

function ProgressRing({
  value,
  done,
  total
}: {
  value: number
  done: number
  total: number
}) {
  const r = 17
  const c = 2 * Math.PI * r

  return (
    <div className="relative grid size-[46px] shrink-0 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute size-[46px] -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--color-line-soft)"
          strokeWidth="2.5"
        />
        <motion.circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--color-amber)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - value) }}
          transition={{ ...SPRING.soft }}
        />
      </svg>
      <motion.span
        key={`${done}/${total}`}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        className="relative text-[11px] tabular-nums text-ink-dim"
      >
        {done}/{total}
      </motion.span>
    </div>
  )
}
