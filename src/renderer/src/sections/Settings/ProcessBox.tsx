import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LIMIT_BOUNDS, type ResolvedProcess } from '@shared/processes'
import { KEY_SLOT_LABEL } from '@shared/types'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'

/**
 * One process, behind a compact toggle.
 *
 * Collapsed it says what it is, where it runs, which key slot pays for it, and
 * whether it has been edited. That last badge is not decoration: a customised
 * prompt that quietly underperforms is otherwise indistinguishable from a model
 * getting worse, and that is a debugging session nobody should have to have.
 *
 * Expanded it edits only the prose. The schema, the data blocks and the parser
 * are shown but not editable — they are the contract between the prompt and the
 * app, and editing *"Return each prompt with its scene number"* out of the rules
 * while `parsePrompts` still keys on the scene number is a feature that breaks
 * the app from Settings.
 */
export function ProcessBox({
  process,
  onSave,
  onReset
}: {
  process: ResolvedProcess
  onSave(override: {
    role?: string
    rules?: string[]
    limits?: Record<string, number>
  }): void
  onReset(): void
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(process.role)
  const [rules, setRules] = useState(process.rules.map((r) => r.text))
  const [limits, setLimits] = useState(process.limits)
  const [showSchema, setShowSchema] = useState(false)

  // The resolved spec is authoritative between edits: what comes back has been
  // clamped, and a field still showing the number the user typed while the app
  // uses a different one would be the worst of both.
  useEffect(() => {
    setRole(process.role)
    setRules(process.rules.map((r) => r.text))
    setLimits(process.limits)
  }, [process])

  const dirty =
    role !== process.role ||
    rules.join(' | ') !== process.rules.map((r) => r.text).join(' | ') ||
    JSON.stringify(limits) !== JSON.stringify(process.limits)

  return (
    <div className="rounded-lg border border-line-soft bg-canvas/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        <span className="text-[9px] text-ink-faint">{open ? '▾' : '▸'}</span>
        <span className="text-[12.5px] text-ink">{process.label}</span>
        <span className="truncate text-[11px] text-ink-faint">
          {process.where}
        </span>
        <span className="ml-auto shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[10px] text-ink-faint">
          {KEY_SLOT_LABEL[process.slot].label}
        </span>
        {process.modified && (
          <span className="shrink-0 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber-soft">
            modified
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-line-soft px-3 py-3">
              <label className="block">
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                  Role — who the model is and what it is doing
                </span>
                <textarea
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-md border border-line-soft bg-well p-2 text-[11.5px] leading-relaxed text-ink-dim outline-none focus:border-line"
                />
                <span className="mt-1 block text-[10px] text-ink-faint">
                  Leave it empty to fall back to the default — an empty
                  instruction is not a customisation, it is a broken call.
                </span>
              </label>

              <div>
                <div className="flex items-baseline gap-2 pb-1">
                  <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                    Rules
                  </span>
                  {process.vars && process.vars.length > 0 && (
                    <span className="text-[10px] text-ink-faint">
                      placeholders:{' '}
                      {process.vars.map((v) => `{${v}}`).join(', ')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRules([...rules, ''])}
                    className="ml-auto rounded border border-line-soft px-1.5 py-0.5 text-[10.5px] text-ink-faint transition-colors hover:border-line hover:text-ink"
                  >
                    + Rule
                  </button>
                </div>

                <div className="space-y-1">
                  {rules.map((text, i) => {
                    const pinned = process.rules[i]?.pinned === true
                    return (
                      <div key={i} className="flex items-start gap-1.5">
                        <span
                          title={
                            pinned
                              ? 'The parser depends on this rule. Reword it freely; it cannot be removed.'
                              : undefined
                          }
                          className={cn(
                            'mt-2 size-1.5 shrink-0 rounded-full',
                            pinned ? 'bg-amber' : 'bg-line'
                          )}
                        />
                        <textarea
                          value={text}
                          onChange={(e) =>
                            setRules(
                              rules.map((r, j) => (j === i ? e.target.value : r))
                            )
                          }
                          rows={1}
                          className="min-h-[26px] w-full resize-y rounded border border-line-soft bg-well px-2 py-1 text-[11px] leading-relaxed text-ink-dim outline-none focus:border-line"
                        />
                        <button
                          type="button"
                          disabled={pinned}
                          onClick={() =>
                            setRules(rules.filter((_, j) => j !== i))
                          }
                          title={
                            pinned
                              ? 'Pinned — the parser depends on it'
                              : 'Remove this rule'
                          }
                          className="mt-0.5 shrink-0 rounded px-1 text-[11px] text-ink-faint transition-colors hover:text-ink disabled:opacity-25"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                  Limits — what this call costs
                </span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(
                    [
                      ['timeoutMs', 'Timeout (ms)'],
                      ['output', 'Output ceiling'],
                      ['minOutput', 'Output floor'],
                      ['thinking', 'Thinking'],
                      ['batch', 'Batch']
                    ] as const
                  ).map(([key, label]) => {
                    const value = limits[key]
                    if (value === undefined) return null
                    const bounds = LIMIT_BOUNDS[key]
                    return (
                      <label key={key} className="block">
                        <span className="block text-[10px] text-ink-faint">
                          {label}
                        </span>
                        <input
                          type="number"
                          value={value}
                          min={bounds.min}
                          max={bounds.max}
                          onChange={(e) =>
                            setLimits({
                              ...limits,
                              [key]: Number(e.target.value)
                            })
                          }
                          className="w-[104px] rounded border border-line-soft bg-well px-1.5 py-0.5 text-[11px] text-ink-dim outline-none focus:border-line"
                        />
                        <span className="mt-0.5 block text-[9.5px] text-ink-faint/80">
                          {bounds.min.toLocaleString()}–
                          {bounds.max.toLocaleString()}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                  Every number here is clamped on save, and the ceiling caps
                  thinking and answer together. A credit-metered provider
                  reserves the whole ceiling before it runs anything, so raising
                  the batch without raising the ceiling is how a run gets refused
                  on a balance that could have paid for it four times over.
                </p>
              </div>

              <div>
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                  Not editable here
                </span>
                <ul className="mt-1 space-y-0.5">
                  {process.fixed.map((line) => (
                    <li key={line} className="text-[10.5px] text-ink-faint">
                      • {line}
                    </li>
                  ))}
                </ul>
                {process.schema && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowSchema(!showSchema)}
                      className="mt-1 text-[10.5px] text-ink-faint transition-colors hover:text-ink"
                    >
                      {showSchema ? '▾' : '▸'} The answer’s shape (read-only)
                    </button>
                    {showSchema && (
                      <pre className="mt-1 max-h-[220px] overflow-auto rounded border border-line-soft bg-well p-2 font-mono text-[10px] leading-relaxed text-ink-faint">
                        {process.schema}
                      </pre>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-line-soft pt-2.5">
                <button
                  type="button"
                  onClick={onReset}
                  disabled={!process.modified && !dirty}
                  className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-line hover:text-ink disabled:opacity-35"
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={() =>
                    onSave({
                      role,
                      rules,
                      limits: limits as unknown as Record<string, number>
                    })
                  }
                  className="ml-auto rounded-md border border-amber/50 bg-amber/10 px-2.5 py-1 text-[11.5px] text-amber-soft transition-colors hover:bg-amber/15 disabled:opacity-35 disabled:hover:bg-amber/10"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
