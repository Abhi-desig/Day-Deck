import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { addDays, labelFor, todayKey } from '@shared/date'
import type { CurriculumInput, CurriculumProgress } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { AuroraBackground } from '../../components/aceternity/AuroraBackground'
import { AnimatedShinyText } from '../../components/magicui/AnimatedShinyText'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PREFERRED_MODEL = 'gemini-3.5-flash'

const PROGRESS_COPY: Record<CurriculumProgress['phase'], string> = {
  contacting: 'Reaching Gemini…',
  decomposing: 'Breaking the curriculum into single-sitting topics…',
  scheduling: 'Assigning every topic a real date…',
  materialising: 'Placing topics onto your day cards…',
  subdividing: 'Breaking each topic into learning points…',
  done: 'Done.',
  error: 'Something went wrong.'
}

interface PlanComposerProps {
  /** Absent when this is the first goal — there is nothing to go back to. */
  onCancel?: () => void
}

export function PlanComposer({ onCancel }: PlanComposerProps) {
  const models = useCurriculum((s) => s.models)
  const modelsError = useCurriculum((s) => s.modelsError)
  const generating = useCurriculum((s) => s.generating)
  const progress = useCurriculum((s) => s.progress)
  const error = useCurriculum((s) => s.error)
  const generate = useCurriculum((s) => s.generate)
  const keyStatus = useCurriculum((s) => s.keyStatus)
  const overview = useCurriculum((s) => s.overview)

  const [title, setTitle] = useState('')
  const [rawText, setRawText] = useState('')
  const [deadline, setDeadline] = useState(() => addDays(todayKey(), 180))
  const [minutesPerDay, setMinutesPerDay] = useState(90)
  const [restDays, setRestDays] = useState<number[]>([0])
  const [model, setModel] = useState(PREFERRED_MODEL)

  // Snap to a model that actually exists once the live list arrives.
  useEffect(() => {
    if (models.length === 0) return
    if (models.some((m) => m.id === model)) return
    const preferred =
      models.find((m) => m.id === PREFERRED_MODEL) ??
      models.find((m) => m.id.includes('flash')) ??
      models[0]
    setModel(preferred.id)
  }, [models, model])

  const deadlineLabel = useMemo(() => {
    const label = labelFor(deadline)
    return `${label.weekday}, ${label.month} ${label.dayNum} ${label.year} · ${label.relative}`
  }, [deadline])

  /*
   * This goal's slice of the day, not the whole day. Saying so here is what
   * stops a second goal being created on the quiet assumption that it has all
   * the hours to itself.
   */
  const budgetHint = useMemo(() => {
    const free = overview.dailyCapMinutes - overview.committedMinutes
    if (overview.plans.length === 0) return 'This goal’s share of your day'
    if (free <= 0) {
      return `Your other goals already claim your whole ${overview.dailyCapMinutes}m/day`
    }
    return `${free}m/day still free across your other goals`
  }, [overview])

  const canSubmit =
    Boolean(keyStatus?.present) &&
    title.trim().length > 0 &&
    rawText.trim().length >= 20 &&
    restDays.length < 7 &&
    !generating

  async function submit() {
    if (!canSubmit) return
    const input: CurriculumInput = {
      title: title.trim(),
      rawText: rawText.trim(),
      deadline,
      minutesPerDay,
      restDays,
      model
    }
    const ok = await generate(input)
    if (ok) {
      setTitle('')
      setRawText('')
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-line-soft bg-surface/60">
      <AuroraBackground />

      <div className="relative p-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Become a Creative Technologist"
          aria-label="Goal"
          className={cn(
            'w-full bg-transparent text-[22px] font-medium tracking-[-0.02em] outline-none',
            'placeholder:text-ink-faint/50'
          )}
        />

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            'Paste the whole curriculum here — modules, topics, whatever structure you have.\n\nGemini breaks it into single-sitting topics. Day Deck does the dates.'
          }
          rows={10}
          aria-label="Curriculum"
          data-selectable
          className={cn(
            'mt-4 w-full resize-none rounded-lg border border-line-soft bg-canvas/70 p-3.5',
            'text-[13.5px] leading-relaxed outline-none transition-colors',
            'placeholder:text-ink-faint/55 focus:border-line'
          )}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Deadline" hint={deadlineLabel}>
            <input
              type="date"
              value={deadline}
              min={todayKey()}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-lg border border-line-soft bg-canvas px-3 py-2 text-[13px] tabular-nums outline-none transition-colors [color-scheme:dark] focus:border-line"
            />
          </Field>

          <Field label="Minutes per day" hint={budgetHint}>
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={minutesPerDay}
              onChange={(e) =>
                setMinutesPerDay(
                  Math.min(1440, Math.max(5, Number(e.target.value) || 5))
                )
              }
              className="w-full rounded-lg border border-line-soft bg-canvas px-3 py-2 text-[13px] tabular-nums outline-none transition-colors focus:border-line"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Rest days"
            hint={
              restDays.length >= 7
                ? 'At least one day has to be a study day'
                : 'No topics land on these'
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, day) => {
                const isRest = restDays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setRestDays((current) =>
                        current.includes(day)
                          ? current.filter((d) => d !== day)
                          : [...current, day]
                      )
                    }
                    aria-pressed={isRest}
                    className={cn(
                      'relative rounded-md px-2.5 py-1.5 text-[11.5px] transition-colors',
                      isRest ? 'text-ink-faint' : 'text-ink'
                    )}
                  >
                    {isRest && (
                      <motion.span
                        layoutId={`rest-${day}`}
                        transition={SPRING.snap}
                        className="absolute inset-0 rounded-md border border-line-soft bg-canvas"
                      />
                    )}
                    {!isRest && (
                      <span className="absolute inset-0 rounded-md border border-line-soft bg-raised" />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                )
              })}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <Field
            label="Model"
            hint={
              modelsError
                ? 'Could not load the live list — the saved model still works'
                : `${models.length || '…'} available`
            }
          >
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="min-w-[220px] rounded-lg border border-line-soft bg-canvas px-3 py-2 text-[13px] outline-none transition-colors focus:border-line"
            >
              {models.length === 0 && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={generating}
                className="rounded-lg px-3 py-2.5 text-[13px] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
            )}

            <motion.button
              type="button"
              onClick={() => void submit()}
              whileTap={canSubmit ? { scale: 0.97 } : undefined}
              disabled={!canSubmit}
              className={cn(
                'rounded-lg px-4 py-2.5 text-[13px] transition-colors',
                canSubmit
                  ? 'bg-amber text-canvas hover:bg-amber-soft'
                  : 'border border-line-soft text-ink-faint/60'
              )}
            >
              {generating ? 'Generating…' : 'Generate plan'}
            </motion.button>
          </div>
        </div>

        <AnimatePresence>
          {generating && progress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING.soft}
              className="overflow-hidden"
            >
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-line-soft bg-canvas/60 px-3.5 py-2.5">
                <motion.span
                  className="size-1.5 shrink-0 rounded-full bg-amber"
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
                <AnimatedShinyText className="text-[12.5px]">
                  {PROGRESS_COPY[progress.phase]}
                </AnimatedShinyText>
              </div>
            </motion.div>
          )}

          {error && !generating && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: EASE_OUT }}
              className="mt-4 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-soft"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {!keyStatus?.present && (
          <p className="mt-4 text-[12px] text-ink-faint">
            Add a Gemini API key above to enable plan generation.
          </p>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-[11px] text-ink-faint/70">{hint}</span>
      )}
    </label>
  )
}
