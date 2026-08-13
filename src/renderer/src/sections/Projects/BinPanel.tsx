import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BIN_SOURCES,
  BIN_SOURCE_LABEL,
  type BinEntry,
  type BinSourceId,
  type Project,
  type ProjectFolder
} from '@shared/types'
import { cn } from '../../lib/cn'
import { suggestDestination } from '../../lib/bin-route'
import { SPRING } from '../../lib/motion'
import { useBin } from '../../store/useBin'
import { useProjects } from '../../store/useProjects'

/**
 * The desktop bin: what is piling up on Desktop and in Downloads, each row
 * with a suggested project folder and an Accept button.
 *
 * Nothing moves on its own. The watcher only relists; the one thing that
 * moves a file is the Accept click on its row — and the move itself is the
 * trash-safe `fileInto`, so even a cross-volume mistake is recoverable.
 */
export function BinPanel({ open }: { open: boolean }) {
  const listings = useBin((s) => s.listings)
  const folders = useBin((s) => s.folders)
  const ready = useBin((s) => s.ready)
  const filing = useBin((s) => s.filing)
  const error = useBin((s) => s.error)
  const notice = useBin((s) => s.notice)
  const load = useBin((s) => s.load)
  const subscribe = useBin((s) => s.subscribe)
  const file = useBin((s) => s.file)
  const dismiss = useBin((s) => s.dismiss)

  const projects = useProjects((s) => s.projects)

  useEffect(() => {
    if (!open) return
    void load()
    // Watching costs nothing while closed; wire it only while the panel shows.
    return subscribe()
  }, [open, load, subscribe])

  /** Where each row is currently pointed: `source:name` -> folderId. */
  const [targets, setTargets] = useState<Record<string, string>>({})

  const usableFolders = useMemo(
    () => folders.filter((f) => !f.missing),
    [folders]
  )

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  const targetFor = (source: BinSourceId, entry: BinEntry): string | null => {
    const chosen = targets[`${source}:${entry.name}`]
    if (chosen !== undefined) return chosen || null
    return suggestDestination(entry, projects, usableFolders)?.folderId ?? null
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={SPRING.soft}
          className="shrink-0 overflow-hidden"
        >
          <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-3">
            <div className="flex items-baseline gap-2 pb-2">
              <h2 className="text-[12.5px] text-ink">Desktop bin</h2>
              <p className="text-[11px] text-ink-faint">
                What is piling up, and where it should go. Nothing moves until
                you accept it; moves are Trash-safe.
              </p>
            </div>

            {(error || notice) && (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-line-soft bg-canvas/40 px-3 py-1.5">
                <span
                  className={cn(
                    'flex-1 text-[11.5px]',
                    error ? 'text-amber-soft' : 'text-ink-dim'
                  )}
                >
                  {error ?? notice}
                </span>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-[10.5px] text-ink-faint hover:text-ink"
                >
                  Dismiss
                </button>
              </div>
            )}

            {!ready ? (
              <p className="px-1 py-2 text-[11.5px] text-ink-faint">Looking…</p>
            ) : usableFolders.length === 0 ? (
              <p className="px-1 py-2 text-[11.5px] leading-relaxed text-ink-faint">
                No project folders to file into yet. Create a project, or open
                a creative project&apos;s folder panel and add one.
              </p>
            ) : (
              BIN_SOURCES.map((source) => (
                <SourceBlock
                  key={source}
                  source={source}
                  entries={listings[source]?.entries ?? []}
                  truncated={listings[source]?.truncated ?? false}
                  projects={projects}
                  folders={usableFolders}
                  projectName={projectName}
                  filing={filing}
                  targetFor={targetFor}
                  onTarget={(key, folderId) =>
                    setTargets((t) => ({ ...t, [key]: folderId }))
                  }
                  onAccept={(entry, folderId) =>
                    void file(folderId, source, [entry.name], 'move')
                  }
                  onAcceptAll={(rows) => {
                    // One call per destination folder, so a mixed set of
                    // suggestions still lands each file where its row said.
                    const byFolder = new Map<string, string[]>()
                    for (const { entry, folderId } of rows) {
                      const bucket = byFolder.get(folderId)
                      if (bucket) bucket.push(entry.name)
                      else byFolder.set(folderId, [entry.name])
                    }
                    for (const [folderId, names] of byFolder) {
                      void file(folderId, source, names, 'move')
                    }
                  }}
                />
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SourceBlock({
  source,
  entries,
  truncated,
  projects,
  folders,
  projectName,
  filing,
  targetFor,
  onTarget,
  onAccept,
  onAcceptAll
}: {
  source: BinSourceId
  entries: BinEntry[]
  truncated: boolean
  projects: Project[]
  folders: ProjectFolder[]
  projectName: Map<string, string>
  filing: Set<string>
  targetFor(source: BinSourceId, entry: BinEntry): string | null
  onTarget(key: string, folderId: string): void
  onAccept(entry: BinEntry, folderId: string): void
  onAcceptAll(rows: { entry: BinEntry; folderId: string }[]): void
}) {
  const ready = entries
    .flatMap((entry) => {
      const folderId = targetFor(source, entry)
      return folderId && !filing.has(`${source}:${entry.name}`)
        ? [{ entry, folderId }]
        : []
    })

  return (
    <div className="pb-2 last:pb-0">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {BIN_SOURCE_LABEL[source]}
        </span>
        <span className="text-[10.5px] tabular-nums text-ink-faint/70">
          {entries.length}
          {truncated ? '+' : ''}
        </span>
        {ready.length > 1 && (
          <button
            type="button"
            onClick={() => onAcceptAll(ready)}
            className="ml-auto rounded-md border border-amber/40 px-2 py-0.5 text-[10.5px] text-amber-soft transition-colors hover:bg-amber/10"
          >
            Accept all {ready.length}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-1 pb-1 text-[11px] text-ink-faint/70">
          Nothing here. As it should be.
        </p>
      ) : (
        entries.map((entry) => (
          <Row
            key={entry.name}
            entry={entry}
            projects={projects}
            folders={folders}
            projectName={projectName}
            busy={filing.has(`${source}:${entry.name}`)}
            target={targetFor(source, entry)}
            onTarget={(folderId) => onTarget(`${source}:${entry.name}`, folderId)}
            onAccept={(folderId) => onAccept(entry, folderId)}
          />
        ))
      )}
    </div>
  )
}

function Row({
  entry,
  projects,
  folders,
  projectName,
  busy,
  target,
  onTarget,
  onAccept
}: {
  entry: BinEntry
  projects: Project[]
  folders: ProjectFolder[]
  projectName: Map<string, string>
  busy: boolean
  target: string | null
  onTarget(folderId: string): void
  onAccept(folderId: string): void
}) {
  const suggestion = suggestDestination(entry, projects, folders)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-white/4',
        busy && 'opacity-50'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">
        {entry.name}
        {entry.directory && <span className="text-ink-faint">/</span>}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-ink-faint/70">
        {entry.directory ? 'folder' : formatBytes(entry.size)}
      </span>

      <select
        value={target ?? ''}
        onChange={(e) => onTarget(e.target.value)}
        disabled={busy}
        aria-label={`Where ${entry.name} should go`}
        className={cn(
          'w-[200px] shrink-0 truncate rounded border border-line-soft bg-transparent px-1 py-px text-[10.5px] outline-none transition-colors hover:border-line',
          target ? 'text-ink-dim' : 'text-ink-faint'
        )}
      >
        <option value="">
          {suggestion ? 'No — somewhere else…' : 'Choose a folder…'}
        </option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {projectName.get(folder.projectId) ?? 'Project'} · {folder.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={busy || !target}
        onClick={() => target && onAccept(target)}
        title={
          target
            ? 'Move it there — the original leaves this folder'
            : 'Pick a destination first'
        }
        className="shrink-0 rounded-md border border-amber/40 px-2 py-px text-[10.5px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
      >
        {busy ? 'Moving…' : 'Accept'}
      </button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
