import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useCurriculum, useSelectedPlan } from '../../store/useCurriculum'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { KeyVault } from './KeyVault'
import { GoalList } from './GoalList'
import { LoadMeter } from './LoadMeter'
import { NotesPanel } from './NotesPanel'
import { PlanComposer } from './PlanComposer'
import { PlanSummary } from './PlanSummary'
import { ReflowDialog } from './ReflowDialog'

/** The two things you do to a goal once it exists. */
const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'notes', label: 'Notes & reminders' }
] as const

type TabId = (typeof TABS)[number]['id']

export function GoalsAdmin() {
  const ready = useCurriculum((s) => s.ready)
  const overview = useCurriculum((s) => s.overview)
  const selectedId = useCurriculum((s) => s.selectedId)
  const composing = useCurriculum((s) => s.composing)
  const keyStatus = useCurriculum((s) => s.keyStatus)
  const load = useCurriculum((s) => s.load)
  const select = useCurriculum((s) => s.select)
  const startComposing = useCurriculum((s) => s.startComposing)
  const cancelComposing = useCurriculum((s) => s.cancelComposing)
  const setDailyCap = useCurriculum((s) => s.setDailyCap)
  const setProgress = useCurriculum((s) => s.setProgress)

  const plan = useSelectedPlan()

  // Open the key panel unprompted when there is no key — it is the one thing
  // blocking everything else on this screen.
  const [keyOpen, setKeyOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [tab, setTab] = useState<TabId>('plan')

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => api.curriculum.onProgress(setProgress), [setProgress])

  useEffect(() => {
    if (!ready || touched) return
    setTouched(true)
    if (!keyStatus?.present) setKeyOpen(true)
  }, [ready, touched, keyStatus])

  const goalCount = overview.plans.length
  // Nothing to select yet means the composer is the only sensible view.
  const showComposer = composing || (ready && goalCount === 0)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-7 pb-7">
      <header className="flex shrink-0 items-center justify-between gap-4 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">
            Goals Admin
          </h1>
          {goalCount > 0 && (
            <span className="text-[12.5px] text-ink-faint">
              {goalCount} active {goalCount === 1 ? 'goal' : 'goals'}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setKeyOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
            keyStatus?.present
              ? 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
              : 'border-amber/40 text-amber-soft hover:bg-amber/10'
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              keyStatus?.present ? 'bg-cat-learn' : 'bg-amber'
            )}
          />
          {keyStatus?.present ? 'API key' : 'Add API key'}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {keyOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden"
          >
            <div className="pb-4">
              <KeyVault onDone={() => setKeyOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!ready ? (
        <p className="py-8 text-[12.5px] text-ink-faint">Loading…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {goalCount > 0 && (
            <div className="shrink-0">
              <LoadMeter
                overview={overview}
                onSetCap={(minutes) => void setDailyCap(minutes)}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 gap-5">
            {goalCount > 0 && (
              <GoalList
                plans={overview.plans}
                selectedId={selectedId}
                composing={composing}
                onSelect={select}
                onNew={startComposing}
              />
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showComposer ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <PlanComposer
                    onCancel={goalCount > 0 ? cancelComposing : undefined}
                  />
                </div>
              ) : plan ? (
                <>
                  <div className="flex shrink-0 items-center gap-1 pb-3">
                    {TABS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={cn(
                          'relative rounded-md px-2.5 py-1 text-[12px] transition-colors',
                          tab === t.id
                            ? 'text-ink'
                            : 'text-ink-faint hover:text-ink-dim'
                        )}
                      >
                        {tab === t.id && (
                          <motion.span
                            layoutId="goal-tab"
                            transition={SPRING.snap}
                            className="absolute inset-0 rounded-md bg-raised"
                          />
                        )}
                        <span className="relative">{t.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {tab === 'plan' ? (
                      <PlanSummary plan={plan} />
                    ) : (
                      <NotesPanel plan={plan} />
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <ReflowDialog />
    </div>
  )
}
