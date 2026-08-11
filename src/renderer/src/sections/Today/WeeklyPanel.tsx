import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { formatMinutes, parseMinutes } from '@shared/date'
import type { SlotCategory, WeeklyTemplate } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'
import { AnimatedGroup } from '../../components/motion-primitives/AnimatedGroup'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CATEGORY_CYCLE: SlotCategory[] = ['amber', 'vibe_code', 'personal_learning']
const CATEGORY_DOT: Record<SlotCategory, string> = {
  vibe_code: 'bg-cat-vibe',
  amber: 'bg-cat-amber',
  personal_learning: 'bg-cat-learn'
}

interface WeeklyPanelProps {
  open: boolean
  onClose(): void
}

/**
 * Editor for the recurring tasks that get planted into each new week. Seeding
 * only ever runs once per week, so edits here take effect from the *next*
 * unseeded week onward — which the footer says out loud.
 */
export function WeeklyPanel({ open, onClose }: WeeklyPanelProps) {
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)

  async function reload() {
    setTemplates(await api.weekly.list())
    setLoading(false)
  }

  useEffect(() => {
    if (open) void reload()
  }, [open])

  useHotkeys([{ combo: 'escape', allowInInput: true, handler: onClose }], {
    layer: LAYER.overlay,
    enabled: open
  })

  async function patch(t: WeeklyTemplate, changes: Partial<WeeklyTemplate>) {
    await api.weekly.upsert({ ...t, ...changes })
    await reload()
  }

  async function add() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await api.weekly.upsert({
      title,
      weekday: 1,
      startMin: null,
      durationMin: 30,
      category: 'amber',
      active: true,
      sortIndex: templates.length
    })
    await reload()
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
            aria-label="Weekly amber tasks"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
              <div>
                <h2 className="text-[14px] tracking-[-0.01em]">
                  Repeating weekly tasks
                </h2>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Write it once, it shows up every week.
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

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 rounded-lg border border-line-soft bg-raised/40 px-3 py-2.5">
                <p className="text-[11.5px] leading-[1.55] text-ink-dim">
                  Every Monday, each task below is dropped onto its weekday as a
                  normal task on that day&apos;s card.
                </p>
                <p className="mt-1.5 text-[11.5px] leading-[1.55] text-ink-faint">
                  From there it behaves like anything else you typed yourself —
                  tick it off, or leave it and it rolls forward. Next week a
                  fresh copy appears.
                </p>
              </div>

              {loading ? (
                <p className="px-2 py-4 text-[12px] text-ink-faint">Loading…</p>
              ) : templates.length === 0 ? (
                <p className="px-2 py-4 text-[12px] leading-relaxed text-ink-faint">
                  Nothing repeating yet — add one below.
                </p>
              ) : (
                <AnimatedGroup preset="blur-slide" stagger={0.035}>
                  {templates.map((t) => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      onPatch={(changes) => void patch(t, changes)}
                      onDelete={async () => {
                        await api.weekly.remove(t.id)
                        await reload()
                      }}
                    />
                  ))}
                </AnimatedGroup>
              )}
            </div>

            <div className="border-t border-line-soft p-3">
              <div className="flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void add()
                  }}
                  placeholder="New weekly task…"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint/60"
                />
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={!draft.trim()}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11.5px]',
                    draft.trim()
                      ? 'bg-amber/15 text-amber-soft hover:bg-amber/25'
                      : 'text-ink-faint/50'
                  )}
                >
                  Add
                </button>
              </div>
              <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-ink-faint/70">
                A week is only ever planted once, so edits here take effect from
                next Monday.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function TemplateRow({
  template,
  onPatch,
  onDelete
}: {
  template: WeeklyTemplate
  onPatch(changes: Partial<WeeklyTemplate>): void
  onDelete(): void
}) {
  const [time, setTime] = useState(
    template.startMin === null ? '' : formatMinutes(template.startMin)
  )

  return (
    <motion.div
      layout
      transition={SPRING.soft}
      className={cn(
        'group/row rounded-lg px-2.5 py-2 transition-colors hover:bg-raised/60',
        !template.active && 'opacity-45'
      )}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onPatch({ active: !template.active })}
          aria-label={template.active ? 'Disable' : 'Enable'}
          className={cn(
            'size-2 shrink-0 rounded-full transition-colors',
            template.active ? CATEGORY_DOT[template.category] : 'bg-line'
          )}
        />
        <input
          value={template.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus:text-ink"
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${template.title}`}
          className="opacity-0 transition-opacity group-hover/row:opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3 text-ink-faint hover:text-ink"
            aria-hidden
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[18px]">
        {WEEKDAYS.map((label, day) => (
          <button
            key={label}
            type="button"
            onClick={() => onPatch({ weekday: day })}
            className={cn(
              'relative rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
              template.weekday === day
                ? 'text-canvas'
                : 'text-ink-faint hover:text-ink-dim'
            )}
          >
            {template.weekday === day && (
              <motion.span
                layoutId={`weekday-${template.id}`}
                transition={SPRING.snap}
                className="absolute inset-0 rounded bg-amber"
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}

        <input
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => {
            const parsed = time.trim() === '' ? null : parseMinutes(time)
            if (parsed === null && time.trim() !== '') {
              setTime(
                template.startMin === null ? '' : formatMinutes(template.startMin)
              )
              return
            }
            onPatch({ startMin: parsed })
          }}
          placeholder="--:--"
          aria-label="Start time"
          className="w-[46px] rounded border border-line-soft bg-transparent px-1 py-0.5 text-center text-[10.5px] tabular-nums outline-none focus:border-line"
        />

        <button
          type="button"
          onClick={() =>
            onPatch({
              category:
                CATEGORY_CYCLE[
                  (CATEGORY_CYCLE.indexOf(template.category) + 1) %
                    CATEGORY_CYCLE.length
                ]
            })
          }
          className="rounded border border-line-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint transition-colors hover:text-ink-dim"
        >
          {template.category.replace('_', ' ')}
        </button>
      </div>
    </motion.div>
  )
}
