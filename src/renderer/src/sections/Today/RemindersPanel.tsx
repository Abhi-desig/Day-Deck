import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { formatMinutes, parseMinutes } from '@shared/date'
import type { BriefPreview, NotifyPrefs } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'

interface RemindersPanelProps {
  open: boolean
  onClose(): void
}

type Preview = { morning: BriefPreview | null; evening: BriefPreview | null }

/**
 * Two native notifications a day, both off until asked for.
 *
 * Each one shows exactly what it would say *right now*, using today's real
 * slots — a reminder you cannot see before enabling is one you turn on, get
 * surprised by, and turn off again.
 */
export function RemindersPanel({ open, onClose }: RemindersPanelProps) {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [preview, setPreview] = useState<Preview>({
    morning: null,
    evening: null
  })

  const reload = useCallback(async () => {
    const [next, shown] = await Promise.all([
      api.notify.prefs(),
      api.notify.preview()
    ])
    setPrefs(next)
    setPreview(shown)
  }, [])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  // On the overlay layer, so Escape closes this panel and does not also reach
  // whatever is behind it.
  useHotkeys([{ combo: 'escape', allowInInput: true, handler: onClose }], {
    layer: LAYER.overlay,
    enabled: open
  })

  async function patch(changes: Partial<NotifyPrefs>) {
    if (!prefs) return
    const next = { ...prefs, ...changes }
    setPrefs(next) // optimistic — the toggle should not lag the click
    setPrefs(await api.notify.setPrefs(next))
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-[300] bg-canvas/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.aside
            className="glass absolute inset-y-0 right-0 z-[301] flex w-[380px] flex-col border-l border-white/10 shadow-[-24px_0_60px_-20px_rgb(0_0_0/0.7)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={SPRING.snap}
            aria-label="Reminders"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
              <div>
                <h2 className="text-[14px] tracking-[-0.01em]">Reminders</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Two notifications a day, at most.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
              >
                <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!prefs ? (
                <p className="text-[12px] text-ink-faint">Loading…</p>
              ) : (
                <div className="space-y-3">
                  <BriefRow
                    label="Morning brief"
                    caption="What today holds."
                    enabled={prefs.morningEnabled}
                    minute={prefs.morningMin}
                    preview={preview.morning}
                    emptyPreview="Nothing open today — this one would stay quiet."
                    onToggle={(v) => void patch({ morningEnabled: v })}
                    onTime={(m) => void patch({ morningMin: m })}
                  />

                  <BriefRow
                    label="Evening review"
                    caption="What didn't get done."
                    enabled={prefs.eveningEnabled}
                    minute={prefs.eveningMin}
                    preview={preview.evening}
                    emptyPreview="Everything's ticked off — this one would stay quiet."
                    onToggle={(v) => void patch({ eveningEnabled: v })}
                    onTime={(m) => void patch({ eveningMin: m })}
                  />

                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-ink-faint/70">
                    Each fires once a day. Miss the window — the app was closed,
                    the laptop was shut — and it is skipped rather than delivered
                    hours late.
                  </p>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function BriefRow({
  label,
  caption,
  enabled,
  minute,
  preview,
  emptyPreview,
  onToggle,
  onTime
}: {
  label: string
  caption: string
  enabled: boolean
  minute: number
  preview: BriefPreview | null
  emptyPreview: string
  onToggle(value: boolean): void
  onTime(minute: number): void
}) {
  const [time, setTime] = useState(formatMinutes(minute))

  useEffect(() => setTime(formatMinutes(minute)), [minute])

  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 transition-colors',
        enabled ? 'border-line bg-raised/50' : 'border-line-soft'
      )}
    >
      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={onToggle} label={label} />

        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink">{label}</div>
          <div className="text-[11px] text-ink-faint">{caption}</div>
        </div>

        <input
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => {
            const parsed = parseMinutes(time)
            if (parsed === null) {
              setTime(formatMinutes(minute))
              return
            }
            onTime(parsed)
          }}
          aria-label={`${label} time`}
          className="w-[58px] shrink-0 rounded border border-line-soft bg-canvas/60 px-1.5 py-1 text-center text-[12px] tabular-nums outline-none transition-colors focus:border-line"
        />
      </div>

      <div className="mt-2.5 rounded-lg border border-line-soft/70 bg-canvas/50 px-3 py-2">
        {preview ? (
          <>
            <div className="text-[11.5px] text-ink-dim">{preview.title}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
              {preview.body}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-ink-faint/70">{emptyPreview}</div>
        )}
      </div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange(value: boolean): void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors',
        checked ? 'bg-amber' : 'bg-line'
      )}
    >
      <motion.span
        className="absolute top-[2px] size-4 rounded-full bg-canvas"
        initial={false}
        animate={{ left: checked ? 16 : 2 }}
        transition={SPRING.snap}
      />
    </button>
  )
}
