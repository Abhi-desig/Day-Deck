import { AnimatePresence, motion } from 'motion/react'
import { labelFor } from '@shared/date'
import { useCurriculum } from '../../store/useCurriculum'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'
import { AnimatedGroup } from '../../components/motion-primitives/AnimatedGroup'

const short = (date: string | null): string => {
  if (!date) return 'unscheduled'
  const l = labelFor(date)
  return `${l.month} ${l.dayNum}`
}

/**
 * Reflow rewrites the dates of every remaining topic. That is a big, quiet
 * change to make on one click, so it is always previewed and confirmed — the
 * preview runs locally and costs nothing.
 */
export function ReflowDialog() {
  const reflow = useCurriculum((s) => s.reflow)
  const busy = useCurriculum((s) => s.reflowBusy)
  const close = useCurriculum((s) => s.closeReflow)
  const commit = useCurriculum((s) => s.commitReflow)

  useHotkeys([{ combo: 'escape', allowInInput: true, handler: close }], {
    layer: LAYER.overlay,
    enabled: !!reflow
  })

  return (
    <AnimatePresence>
      {reflow && (
        <>
          <motion.div
            className="absolute inset-0 z-[400] bg-canvas/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
          />

          <motion.div
            role="dialog"
            aria-label="Reflow preview"
            className="absolute inset-x-0 top-[8%] z-[401] mx-auto flex max-h-[78%] w-[min(620px,90%)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={SPRING.snap}
          >
            <header className="border-b border-line-soft px-5 py-4">
              <h2 className="text-[15px] tracking-[-0.01em]">Reflow the plan</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                {reflow.changes.length === 0
                  ? 'Everything remaining is already where it should be. Nothing to change.'
                  : `Redistributes ${reflow.changes.length} remaining ${
                      reflow.changes.length === 1 ? 'topic' : 'topics'
                    } across the days you have left. ${reflow.unchanged} stay put.`}
              </p>
            </header>

            {reflow.changes.length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <AnimatedGroup preset="blur-slide" stagger={0.015}>
                  {reflow.changes.map((change) => (
                    <div
                      key={change.topicId}
                      className="flex items-baseline gap-3 rounded-lg px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                        {change.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint line-through">
                        {short(change.from)}
                      </span>
                      <span className="shrink-0 text-ink-faint/50" aria-hidden>
                        →
                      </span>
                      <span className="w-[52px] shrink-0 text-right text-[11.5px] tabular-nums text-amber-soft">
                        {short(change.to)}
                      </span>
                    </div>
                  ))}
                </AnimatedGroup>
              </div>
            )}

            <footer className="border-t border-line-soft px-5 py-4">
              {reflow.summary.overCapacity && (
                <p className="mb-3 rounded-lg border border-amber/30 bg-amber/8 px-3 py-2 text-[12px] leading-relaxed text-amber-soft">
                  The remaining work needs about {reflow.summary.requiredPerDay}{' '}
                  minutes a day to still hit the deadline.
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] text-ink-faint">
                  {reflow.summary.lastDate
                    ? `Finishes ${short(reflow.summary.lastDate)}`
                    : 'No study days left before the deadline'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink"
                  >
                    Cancel
                  </button>
                  <motion.button
                    type="button"
                    onClick={() => void commit()}
                    whileTap={{ scale: 0.97 }}
                    disabled={busy || reflow.changes.length === 0}
                    className={cn(
                      'rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors',
                      reflow.changes.length > 0
                        ? 'bg-amber text-on-accent hover:bg-amber-soft'
                        : 'border border-line-soft text-ink-faint/60'
                    )}
                  >
                    {busy ? 'Applying…' : 'Apply reflow'}
                  </motion.button>
                </div>
              </div>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
