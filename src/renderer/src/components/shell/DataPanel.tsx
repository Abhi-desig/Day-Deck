import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { DbInfo } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { useDeck } from '../../store/useDeck'
import { useShell } from '../../store/useShell'
import { useStickers } from '../../store/useStickers'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { SPRING } from '../../lib/motion'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'export' | 'import' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'not created yet'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Backup, restore, and where the data actually is.
 *
 * App-level rather than a section, because none of it belongs to Today or Goals
 * — and because a local-first app that will not tell you where your file lives
 * is asking for a kind of trust it has not earned.
 */
export function DataPanel() {
  const open = useShell((s) => s.dataOpen)
  const setData = useShell((s) => s.setData)

  const [info, setInfo] = useState<DbInfo | null>(null)
  const [launchAtLogin, setLaunchAtLoginState] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const reload = useCallback(async () => {
    const [dbInfo, atLogin] = await Promise.all([
      api.system.dbInfo(),
      api.system.launchAtLogin()
    ])
    setInfo(dbInfo)
    setLaunchAtLoginState(atLogin)
  }, [])

  useEffect(() => {
    if (open) {
      setStatus({ kind: 'idle' })
      void reload()
    }
  }, [open, reload])

  useHotkeys(
    [{ combo: 'escape', allowInInput: true, handler: () => setData(false) }],
    { layer: LAYER.overlay, enabled: open }
  )

  async function runExport() {
    setStatus({ kind: 'busy', what: 'export' })
    try {
      const written = await api.backup.exportToFile()
      setStatus(
        written
          ? { kind: 'ok', message: `Wrote ${written.rows} rows to ${written.path}` }
          : { kind: 'idle' }
      )
      await reload()
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function runImport() {
    setStatus({ kind: 'busy', what: 'import' })
    try {
      const summary = await api.backup.importFromFile()
      if (!summary) {
        setStatus({ kind: 'idle' })
        return
      }

      setStatus({
        kind: 'ok',
        message: `Restored ${summary.total} rows from a v${summary.fromVersion} backup.`
      })

      // Everything in the renderer is now describing a database that no longer
      // exists. Reloading each store is cheaper and far less alarming than
      // asking the user to restart the app.
      await Promise.all([
        useDeck.getState().reloadAll(),
        useCurriculum.getState().load(),
        useStickers.getState().load()
      ])
      await reload()
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function toggleLaunch(next: boolean) {
    setLaunchAtLoginState(next) // optimistic — a switch should not lag the click
    setLaunchAtLoginState(await api.system.setLaunchAtLogin(next))
  }

  const busy = status.kind === 'busy'

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[400] bg-canvas/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setData(false)}
          />

          <motion.aside
            className="glass fixed inset-y-0 right-0 z-[401] flex w-[420px] flex-col border-l border-white/10 shadow-[-24px_0_60px_-20px_rgb(0_0_0/0.7)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={SPRING.snap}
            aria-label="Backup and database"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
              <div>
                <h2 className="text-[14px] tracking-[-0.01em]">
                  Backup &amp; database
                </h2>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Everything is on this machine. Nothing syncs anywhere.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setData(false)}
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <section className="rounded-xl border border-line-soft bg-raised/40 px-3.5 py-3">
                <h3 className="text-[12.5px] text-ink">Database file</h3>
                <p
                  data-selectable
                  className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-ink-faint"
                >
                  {info?.path ?? '…'}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-ink-faint/80">
                    {formatBytes(info?.sizeBytes ?? null)} · schema v
                    {info?.schemaVersion ?? '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void api.system.revealDb()}
                    className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
                  >
                    Show in Finder
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-line-soft bg-raised/40 px-3.5 py-3">
                <h3 className="text-[12.5px] text-ink">Backup</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                  A readable JSON dump of every table — goals, topics, tasks,
                  projects, stickers and settings.
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <motion.button
                    type="button"
                    onClick={() => void runExport()}
                    whileTap={{ scale: 0.97 }}
                    disabled={busy}
                    className="rounded-lg bg-amber/20 px-3 py-1.5 text-[12px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-40"
                  >
                    {status.kind === 'busy' && status.what === 'export'
                      ? 'Exporting…'
                      : 'Export a backup'}
                  </motion.button>

                  <motion.button
                    type="button"
                    onClick={() => void runImport()}
                    whileTap={{ scale: 0.97 }}
                    disabled={busy}
                    className="rounded-lg border border-line-soft px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-40"
                  >
                    {status.kind === 'busy' && status.what === 'import'
                      ? 'Restoring…'
                      : 'Restore…'}
                  </motion.button>
                </div>

                <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint/70">
                  Restoring replaces everything and asks first. A backup from a
                  newer version of Day Deck is refused rather than partly
                  applied.
                </p>
              </section>

              <section className="rounded-xl border border-line-soft bg-raised/40 px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={launchAtLogin}
                    aria-label="Open at login"
                    onClick={() => void toggleLaunch(!launchAtLogin)}
                    className={cn(
                      'relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors',
                      launchAtLogin ? 'bg-amber' : 'bg-line'
                    )}
                  >
                    <motion.span
                      className="absolute top-[2px] size-4 rounded-full bg-canvas"
                      initial={false}
                      animate={{ left: launchAtLogin ? 16 : 2 }}
                      transition={SPRING.snap}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-ink">Open at login</div>
                    <div className="text-[11px] text-ink-faint">
                      Starts hidden, so the day is already rolled over when you
                      look.
                    </div>
                  </div>
                </div>
              </section>

              <AnimatePresence initial={false}>
                {(status.kind === 'ok' || status.kind === 'error') && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={SPRING.soft}
                    className={cn(
                      'overflow-hidden rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed',
                      status.kind === 'ok'
                        ? 'border-cat-learn/30 bg-cat-learn/8 text-cat-learn'
                        : 'border-amber/30 bg-amber/8 text-amber-soft'
                    )}
                  >
                    <span data-selectable className="break-all">
                      {status.message}
                    </span>
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
