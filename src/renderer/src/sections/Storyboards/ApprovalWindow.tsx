import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScenePlanProposal, StoryFrame } from '@shared/types'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'
import {
  defaultSelection,
  diffScenePlan,
  summariseChanges,
  toApplies,
  type SceneChange
} from '../../lib/storyboard-plan'

/**
 * What the planner wants to do, before it does any of it.
 *
 * This window renders a decision it does not make: the diff, the default
 * selection and the resulting writes all come from lib/storyboard-plan, which is
 * pure and tested. What is here is presentation and one guarantee — nothing has
 * been written yet, and closing this changes nothing.
 *
 * Hand-edited prompts arrive unticked. Losing your own wording to a button
 * labelled "Apply" is the one outcome this whole window exists to prevent.
 */
export function ApprovalWindow({
  proposal,
  frames,
  busy,
  onApply,
  onClose
}: {
  proposal: ScenePlanProposal | null
  frames: StoryFrame[]
  busy: boolean
  onApply(applies: ReturnType<typeof toApplies>): void
  onClose(): void
}) {
  const changes = useMemo(
    () => (proposal ? diffScenePlan(frames, proposal.scenes) : []),
    [proposal, frames]
  )

  // Keyed on the proposal so a fresh plan resets the ticks rather than inheriting
  // whatever was chosen for the last one.
  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultSelection(changes)
  )
  const [key, setKey] = useState(proposal)
  if (key !== proposal) {
    setKey(proposal)
    setSelected(defaultSelection(changes))
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

  const actionable = changes.filter((c) => c.kind !== 'unchanged').length
  const applies = toApplies(changes, selected)

  return (
    <AnimatePresence>
      {proposal && (
        <>
          <motion.div
            key="plan-backdrop"
            className="no-drag fixed inset-0 z-[420] bg-canvas/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={busy ? undefined : onClose}
          />

          <motion.div
            key="plan-panel"
            className="no-drag pointer-events-none fixed inset-0 z-[421] grid place-items-center p-8"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={SPRING.snap}
          >
            <div className="glass pointer-events-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)]">
              <header className="shrink-0 border-b border-line-soft px-5 py-3.5">
                <h2 className="text-[14px] tracking-[-0.01em]">
                  Break the brief into scenes?
                </h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                  {actionable === 0
                    ? 'The plan matches what is already on the board. Nothing to do.'
                    : `${proposal.scenes.length} scenes proposed against ${frames.length} on the board. Prompts are a separate step, asked for after you apply. Nothing is written until you do.`}
                </p>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {changes.map((change, i) => (
                  <Row
                    key={`${change.kind}-${change.index}`}
                    change={change}
                    checked={selected.has(i)}
                    onToggle={() => toggle(i)}
                  />
                ))}
              </div>

              <footer className="flex shrink-0 items-center gap-3 border-t border-line-soft px-5 py-3">
                <span className="text-[11.5px] text-ink-faint">
                  {summariseChanges(changes, selected)}
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

const KIND_LABEL: Record<SceneChange['kind'], string> = {
  add: 'New',
  rewrite: 'Rewritten',
  remove: 'Removed',
  unchanged: 'Unchanged'
}

/** Whether this change would alter the card's prompt at all. */
function promptChanged(
  change: Extract<SceneChange, { kind: 'rewrite' | 'add' }>
): boolean {
  if (change.kind === 'rewrite') {
    return change.after.prompt.trim() !== change.before.prompt.trim()
  }
  return change.after.prompt.trim() !== ''
}

function Row({
  change,
  checked,
  onToggle
}: {
  change: SceneChange
  checked: boolean
  onToggle(): void
}) {
  const [open, setOpen] = useState(false)
  const inert = change.kind === 'unchanged'

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        inert ? 'border-transparent opacity-50' : 'border-line-soft/60',
        !inert && checked && 'bg-raised/40'
      )}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={inert}
          onChange={onToggle}
          aria-label={`Apply: ${change.label}`}
          className="size-3.5 shrink-0 accent-amber disabled:opacity-30"
        />

        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
          {change.label}
        </span>

        {'handEdited' in change && change.handEdited && (
          <span
            title="This card has a prompt you wrote. Unticked by default."
            className="shrink-0 rounded-full border border-amber/40 bg-amber/10 px-1.5 py-px text-[9.5px] text-amber-soft"
          >
            hand-written
          </span>
        )}

        {'after' in change && (
          <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
            {change.after.durationSec}s
          </span>
        )}

        <span
          className={cn(
            'shrink-0 text-[9.5px] uppercase tracking-[0.12em]',
            change.kind === 'remove' ? 'text-amber-soft/70' : 'text-ink-faint'
          )}
        >
          {KIND_LABEL[change.kind]}
        </span>

        {'after' in change && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Hide the prompt' : 'Show the prompt'}
            className="shrink-0 text-[11px] text-ink-faint transition-colors hover:text-ink"
          >
            {open ? '▴' : '▾'}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && 'after' in change && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 pl-6">
              {change.after.description.trim() && (
                <p className="text-[11px] leading-relaxed text-ink-dim">
                  {change.after.description}
                </p>
              )}
              {/* The breakdown carries prompts through unchanged, so these
                  blocks only appear when a prompt genuinely differs. */}
              {promptChanged(change) && (
                <>
                  {change.kind === 'rewrite' && change.before.prompt.trim() && (
                    <Block
                      title="Now"
                      body={change.before.prompt}
                      tone="before"
                    />
                  )}
                  <Block
                    title="Proposed"
                    body={change.after.prompt}
                    tone="after"
                  />
                </>
              )}
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
