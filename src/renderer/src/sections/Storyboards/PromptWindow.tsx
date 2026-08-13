import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { PromptPlanProposal, StoryFrame } from '@shared/types'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'
import {
  defaultPromptSelection,
  diffPromptPlan,
  summarisePrompts,
  toPromptApplies,
  type PromptChange
} from '../../lib/storyboard-plan'

/**
 * Stage two's approval: the prompts, one per scene, before any is written.
 *
 * Same contract as the scene window — the diff, the default ticks and the
 * writes all come from lib/storyboard-plan, nothing is written until Apply,
 * and a card that already has a prompt arrives unticked so your own wording
 * cannot be lost to a default.
 */
export function PromptWindow({
  proposal,
  frames,
  busy,
  onApply,
  onClose
}: {
  proposal: PromptPlanProposal | null
  frames: StoryFrame[]
  busy: boolean
  onApply(applies: ReturnType<typeof toPromptApplies>): void
  onClose(): void
}) {
  const changes = useMemo(
    () => (proposal ? diffPromptPlan(frames, proposal.prompts) : []),
    [proposal, frames]
  )

  // Keyed on the proposal so a fresh plan resets the ticks rather than
  // inheriting whatever was chosen for the last one.
  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultPromptSelection(changes)
  )
  const [key, setKey] = useState(proposal)
  if (key !== proposal) {
    setKey(proposal)
    setSelected(defaultPromptSelection(changes))
  }

  useHotkeys([{ combo: 'escape', allowInInput: true, handler: onClose }], {
    layer: LAYER.overlay,
    enabled: proposal != null && !busy
  })

  const toggle = (index: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const applies = toPromptApplies(changes, selected)

  return (
    <AnimatePresence>
      {proposal && (
        <>
          <motion.div
            key="prompt-backdrop"
            className="no-drag fixed inset-0 z-[420] bg-canvas/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={busy ? undefined : onClose}
          />

          <motion.div
            key="prompt-panel"
            className="no-drag pointer-events-none fixed inset-0 z-[421] grid place-items-center p-8"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={SPRING.snap}
          >
            <div className="glass pointer-events-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)]">
              <header className="shrink-0 border-b border-line-soft px-5 py-3.5">
                <h2 className="text-[14px] tracking-[-0.01em]">
                  {proposal.styleName
                    ? `Write these prompts, in “${proposal.styleName}”?`
                    : 'Write these prompts?'}
                </h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                  One prompt per scene, written against the whole board so the
                  shots cut together. Nothing is written until you apply.
                </p>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {changes.map((change, i) => (
                  <Row
                    key={change.frameId}
                    change={change}
                    checked={selected.has(i)}
                    onToggle={() => toggle(i)}
                  />
                ))}
              </div>

              <footer className="flex shrink-0 items-center gap-3 border-t border-line-soft px-5 py-3">
                <span className="text-[11.5px] text-ink-faint">
                  {summarisePrompts(changes, selected)}
                  <span className="text-ink-faint/60"> · {proposal.model}</span>
                </span>

                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <motion.button
                    type="button"
                    onClick={() => onApply(applies)}
                    whileTap={{ scale: 0.97 }}
                    disabled={busy || applies.length === 0}
                    className="rounded-lg bg-amber/20 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
                  >
                    {busy
                      ? 'Applying…'
                      : `Apply ${applies.length || ''}`.trim()}
                  </motion.button>
                </div>
              </footer>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Row({
  change,
  checked,
  onToggle
}: {
  change: PromptChange
  checked: boolean
  onToggle(): void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        change.unchanged
          ? 'border-transparent opacity-50'
          : 'border-line-soft/60',
        !change.unchanged && checked && 'bg-raised/40'
      )}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={change.unchanged}
          onChange={onToggle}
          aria-label={`Write the prompt for ${change.label}`}
          className="size-3.5 shrink-0 accent-amber disabled:opacity-30"
        />

        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
          {change.label}
        </span>

        {change.handEdited && !change.unchanged && (
          <span
            title="This card already has a prompt. Unticked by default."
            className="shrink-0 rounded-full border border-amber/40 bg-amber/10 px-1.5 py-px text-[9.5px] text-amber-soft"
          >
            has a prompt
          </span>
        )}

        <span className="shrink-0 text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
          {change.unchanged ? 'Unchanged' : change.handEdited ? 'Rewrite' : 'New'}
        </span>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Hide the prompt' : 'Show the prompt'}
          className="shrink-0 text-[11px] text-ink-faint transition-colors hover:text-ink"
        >
          {open ? '▴' : '▾'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 pl-6">
              {change.handEdited && !change.unchanged && (
                <Block title="Now" body={change.before} tone="before" />
              )}
              <Block title="Proposed" body={change.after} tone="after" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Block({
  title,
  body,
  tone
}: {
  title: string
  body: string
  tone: 'before' | 'after'
}) {
  return (
    <div>
      <span className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">
        {title}
      </span>
      <p
        className={cn(
          'mt-0.5 whitespace-pre-wrap rounded-md border p-2 font-mono text-[11px] leading-relaxed',
          tone === 'before'
            ? 'border-line-soft/50 bg-black/10 text-ink-faint line-through decoration-ink-faint/40'
            : 'border-line-soft bg-black/20 text-ink-dim'
        )}
      >
        {body || '(empty)'}
      </p>
    </div>
  )
}
