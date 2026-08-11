import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { labelFor } from '@shared/date'
import { useDeck } from '../../store/useDeck'
import { useIntent } from '../../store/useShell'
import { DayDeck } from '../../components/deck/DayDeck'
import { TextEffect } from '../../components/motion-primitives/TextEffect'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { WeeklyPanel } from './WeeklyPanel'
import { RemindersPanel } from './RemindersPanel'

export function Today() {
  const [weeklyOpen, setWeeklyOpen] = useState(false)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const result = useDeck((s) => s.bootstrapResult)
  const focused = useDeck((s) => s.focused)
  const today = useDeck((s) => s.today)

  // Nonces from the command palette. They only ever increase, so an effect keyed
  // on one fires exactly once per request and needs nothing cleared afterwards.
  const weeklyIntent = useIntent('weekly')
  const remindersIntent = useIntent('reminders')

  useEffect(() => {
    if (weeklyIntent > 0) setWeeklyOpen(true)
  }, [weeklyIntent])

  useEffect(() => {
    if (remindersIntent > 0) setRemindersOpen(true)
  }, [remindersIntent])

  const rolledCount = result?.rolled.length ?? 0
  const seededCount = result?.seededSlotIds.length ?? 0
  const showBanner = !bannerDismissed && (rolledCount > 0 || seededCount > 0)

  const label = labelFor(focused, today)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-7 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">Today</h1>
          <motion.span
            key={focused}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="text-[12.5px] text-ink-faint tabular-nums"
          >
            viewing {label.weekday}, {label.month} {label.dayNum}
          </motion.span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setRemindersOpen(true)}
            className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
          >
            Reminders
          </button>
          <button
            type="button"
            onClick={() => setWeeklyOpen(true)}
            className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
          >
            Weekly tasks
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden px-7"
          >
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-amber/25 bg-amber/8 px-3.5 py-2">
              <span className="text-amber" aria-hidden>
                ↷
              </span>
              <span className="flex-1 text-[12.5px] text-amber-soft">
                <TextEffect by="word" stagger={0.025} delay={0.15}>
                  {summarise(rolledCount, seededCount)}
                </TextEffect>
              </span>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="text-[11px] text-amber-soft/70 transition-colors hover:text-amber-soft"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DayDeck />

      <WeeklyPanel open={weeklyOpen} onClose={() => setWeeklyOpen(false)} />
      <RemindersPanel
        open={remindersOpen}
        onClose={() => setRemindersOpen(false)}
      />
    </div>
  )
}

function summarise(rolled: number, seeded: number): string {
  const parts: string[] = []
  if (rolled > 0) {
    parts.push(
      `${rolled} unfinished ${rolled === 1 ? 'task' : 'tasks'} carried forward to today`
    )
  }
  if (seeded > 0) {
    parts.push(
      `${seeded} repeating ${seeded === 1 ? 'task' : 'tasks'} planted for this week`
    )
  }
  return `${parts.join(' · ')}.`
}
