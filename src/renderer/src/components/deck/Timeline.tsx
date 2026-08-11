import { AnimatePresence, motion } from 'motion/react'
import type { Slot } from '@shared/types'
import { SlotRow } from './SlotRow'
import { EASE_OUT } from '../../lib/motion'

interface TimelineProps {
  slots: Slot[]
  freshIds: Set<string>
  onToggle(slot: Slot): void
  onDelete(slot: Slot): void
}

export function Timeline({
  slots,
  freshIds,
  onToggle,
  onDelete
}: TimelineProps) {
  // Query order is preserved inside each group, so completing something moves
  // it down the list rather than reshuffling the whole day.
  const open = slots.filter((s) => s.status === 'open')
  const done = slots.filter((s) => s.status === 'done')
  const rolled = slots.filter((s) => s.status === 'rolled')

  let freshSeen = 0

  if (slots.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="text-center text-[13px] leading-relaxed text-ink-faint"
        >
          Nothing on this day yet.
          <br />
          <span className="text-ink-faint/60">Add something below.</span>
        </motion.p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-1.5 py-2">
      <AnimatePresence initial={false} mode="popLayout">
        {open.map((slot) => {
          const isFresh = freshIds.has(slot.id)
          const freshIndex = isFresh ? freshSeen++ : 0
          return (
            <SlotRow
              key={slot.id}
              slot={slot}
              isFresh={isFresh}
              freshIndex={freshIndex}
              onToggle={() => onToggle(slot)}
              onDelete={() => onDelete(slot)}
            />
          )
        })}

        {done.length > 0 && (
          <motion.div
            key="done-divider"
            layout="position"
            className="mt-2 flex items-center gap-2 px-3 pb-1 pt-2"
          >
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint/70">
              Done · {done.length}
            </span>
            <span className="h-px flex-1 bg-line-soft" />
          </motion.div>
        )}

        {done.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            onToggle={() => onToggle(slot)}
            onDelete={() => onDelete(slot)}
          />
        ))}

        {rolled.length > 0 && (
          <motion.div
            key="rolled-divider"
            layout="position"
            className="mt-2 flex items-center gap-2 px-3 pb-1 pt-2"
          >
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint/60">
              Carried forward · {rolled.length}
            </span>
            <span className="h-px flex-1 bg-line-soft" />
          </motion.div>
        )}

        {rolled.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            onToggle={() => onToggle(slot)}
            onDelete={() => onDelete(slot)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
