import { motion } from 'motion/react'
import { basename } from '../../lib/path'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { useWorkspace } from '../../store/useWorkspace'
import { TerminalView } from './TerminalView'

/**
 * The terminal half of the workspace: a tab strip over a stack of live shells.
 *
 * Every tab stays mounted. A background tab is hidden, not unmounted, because
 * unmounting kills its pty — and the whole point of a second tab is to leave a
 * dev server running in the first one.
 */
interface TerminalPaneProps {
  projectId: string
  settleToken: number
}

export function TerminalPane({ projectId, settleToken }: TerminalPaneProps) {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const addTerminal = useWorkspace((s) => s.addTerminal)
  const closeTerminal = useWorkspace((s) => s.closeTerminal)
  const selectTerminal = useWorkspace((s) => s.selectTerminal)
  const markTerminal = useWorkspace((s) => s.markTerminal)
  const setError = useWorkspace((s) => s.setError)

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line-soft/70">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {/* Select and close are siblings, not nested — a button inside a
              button is invalid and unreachable with a keyboard. */}
          {tabs.map((tab, index) => (
            <div
              key={tab.key}
              className={cn(
                'group/tt relative flex shrink-0 items-center gap-1 rounded-md px-2 py-1',
                'text-[11.5px] transition-colors duration-150',
                tab.key === activeTab ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
              )}
            >
              {tab.key === activeTab && (
                <motion.span
                  layoutId="terminal-tab"
                  transition={SPRING.snap}
                  className="absolute inset-0 rounded-md border border-line-soft bg-raised"
                />
              )}

              <button
                type="button"
                onClick={() => selectTerminal(tab.key)}
                className="relative flex items-center gap-1.5"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    tab.exited ? 'bg-ink-faint/40' : 'bg-cat-learn'
                  )}
                  aria-hidden
                />
                <span>
                  {tab.label}
                  {tabs.length > 1 && ` ${index + 1}`}
                </span>
              </button>

              <button
                type="button"
                aria-label={`Close terminal ${index + 1}`}
                onClick={() => closeTerminal(tab.key)}
                className="relative grid size-4 place-items-center rounded opacity-0 transition-opacity hover:bg-line group-hover/tt:opacity-100"
              >
                <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                  <path
                    d="M3 3l6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addTerminal}
          title="New terminal"
          aria-label="New terminal"
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-line hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path
              d="M8 3.5v9M3.5 8h9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1 px-2 pb-2">
        {tabs.length === 0 ? (
          <div className="grid h-full place-items-center">
            <button
              type="button"
              onClick={addTerminal}
              className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
            >
              Open a terminal
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <div key={tab.key} className="absolute inset-x-2 bottom-2 top-0">
              <TerminalView
                projectId={projectId}
                active={tab.key === activeTab}
                settleToken={settleToken}
                onReady={(shell) => markTerminal(tab.key, { label: basename(shell) })}
                onExit={() => markTerminal(tab.key, { exited: true })}
                onError={setError}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
