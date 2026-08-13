import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Project, ProjectKind } from '@shared/types'
import { AnimatedShinyText } from '../../components/magicui/AnimatedShinyText'
import { TextEffect } from '../../components/motion-primitives/TextEffect'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { useDeck } from '../../store/useDeck'
import { useOpenProject, useProjects } from '../../store/useProjects'
import { BinPanel } from './BinPanel'
import { FolderPanel } from './FolderPanel'
import { ProjectGrid } from './ProjectGrid'
import { Workspace } from './Workspace'

export function Projects() {
  const ready = useProjects((s) => s.ready)
  const error = useProjects((s) => s.error)
  const notice = useProjects((s) => s.notice)
  const busy = useProjects((s) => s.busy)
  const projects = useProjects((s) => s.projects)
  const load = useProjects((s) => s.load)
  const add = useProjects((s) => s.add)
  const open = useProjects((s) => s.open)
  const remove = useProjects((s) => s.remove)
  const togglePin = useProjects((s) => s.togglePin)
  const reorder = useProjects((s) => s.reorder)
  const openInEditor = useProjects((s) => s.openInEditor)
  const addCreative = useProjects((s) => s.addCreative)
  const openExternal = useProjects((s) => s.openExternal)
  const setNotice = useProjects((s) => s.setNotice)
  const homes = useProjects((s) => s.homes)
  const loadHomes = useProjects((s) => s.loadHomes)
  const pickHome = useProjects((s) => s.pickHome)
  const createNew = useProjects((s) => s.createNew)

  const openProject = useOpenProject()

  const [kind, setKind] = useState<ProjectKind>('code')
  /** Which creative project's folders are showing. Only one at a time. */
  const [folderFor, setFolderFor] = useState<string | null>(null)
  /** The new-project name form, and the desktop bin. */
  const [creating, setCreating] = useState(false)
  const [binOpen, setBinOpen] = useState(false)

  const shown = projects.filter((p) => p.kind === kind)
  const counts = {
    code: projects.filter((p) => p.kind === 'code').length,
    creative: projects.filter((p) => p.kind === 'creative').length
  }
  const folderProject = shown.find((p) => p.id === folderFor) ?? null

  const today = useDeck((s) => s.today)
  const addSlot = useDeck((s) => s.addSlot)

  useEffect(() => {
    void load()
    // Warm the editor chunk while the user is still looking at the grid, so
    // opening a workspace does not wait on a 9MB parse. Failure here is fine —
    // the Suspense boundary in the workspace covers it.
    void import('./EditorPane').catch(() => undefined)
  }, [load])

  /** Puts an hour of work on today's card, linked back to this project. */
  const addToToday = async (project: Project): Promise<void> => {
    await addSlot({
      date: today,
      title: project.name,
      durationMin: 60,
      source: 'project',
      sourceRef: project.id,
      category: 'vibe_code'
    })
    setNotice(`Added ${project.name} to today.`)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The workspace covers the whole section rather than living beside the
          grid, so the card has somewhere to expand *into*. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {openProject ? (
          <Workspace key={openProject.id} project={openProject} />
        ) : (
          <motion.div
            key="grid"
            className="flex min-h-0 flex-1 flex-col px-7 pb-7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <header className="flex shrink-0 items-center justify-between gap-4 pb-4">
              <div className="flex items-center gap-3">
                <h1 className="text-[19px] font-medium tracking-[-0.02em]">
                  Projects
                </h1>

                {/* Two divisions, mutually exclusive. A code project opens the
                    embedded workspace; a creative one opens in its own app. They
                    do different things, so they are not one list with badges. */}
                <div className="flex items-center gap-0.5 rounded-full border border-line-soft p-0.5">
                  <Tab
                    label="Code"
                    count={counts.code}
                    on={kind === 'code'}
                    onClick={() => setKind('code')}
                  />
                  <Tab
                    label="Creative"
                    count={counts.creative}
                    on={kind === 'creative'}
                    onClick={() => setKind('creative')}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBinOpen(!binOpen)}
                  aria-expanded={binOpen}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                    binOpen
                      ? 'border-line bg-raised text-ink'
                      : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
                  )}
                >
                  Desktop bin
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCreating(!creating)
                    if (!creating) void loadHomes()
                  }}
                  aria-expanded={creating}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                    creating
                      ? 'border-line bg-raised text-ink'
                      : 'border-amber/40 text-amber-soft hover:bg-amber/10'
                  )}
                >
                  New project
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void (kind === 'creative' ? addCreative() : add())
                  }
                  disabled={busy}
                  className={cn(
                    'rounded-md border border-line-soft px-2.5 py-1 text-[11.5px]',
                    'text-ink-dim transition-colors hover:border-line hover:text-ink',
                    'disabled:opacity-50'
                  )}
                >
                  {kind === 'creative' ? 'Add existing file…' : 'Add existing folder…'}
                </button>
              </div>
            </header>

            <AnimatePresence initial={false}>
              {creating && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING.soft}
                  className="shrink-0 overflow-hidden"
                >
                  <NewProjectForm
                    kind={kind}
                    home={homes?.[kind] ?? null}
                    busy={busy}
                    onPickHome={() => void pickHome(kind)}
                    onCreate={async (name) => {
                      if (await createNew(kind, name)) setCreating(false)
                    }}
                    onCancel={() => setCreating(false)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <BinPanel open={binOpen} />

            <AnimatePresence initial={false}>
              {(error || notice) && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING.soft}
                  className={cn(
                    'shrink-0 overflow-hidden text-[12px]',
                    error ? 'text-goal-rose' : 'text-ink-faint'
                  )}
                >
                  <span data-selectable className="block pb-3">
                    {error ?? notice}
                  </span>
                </motion.p>
              )}
            </AnimatePresence>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {!ready ? (
                <p className="py-8 text-[12.5px] text-ink-faint">Loading…</p>
              ) : shown.length === 0 ? (
                <EmptyState
                  kind={kind}
                  onAdd={() => void (kind === 'creative' ? addCreative() : add())}
                />
              ) : (
                <>
                  <ProjectGrid
                    projects={shown}
                    onOpen={(id) => {
                      // The card's primary action is whatever that kind of project
                      // means by "open": a workspace, or the app that owns the file.
                      const project = shown.find((p) => p.id === id)
                      if (project?.kind === 'creative') void openExternal(id)
                      else open(id)
                    }}
                    onTogglePin={(id) => void togglePin(id)}
                    onRemove={(id) => void remove(id)}
                    onOpenInEditor={(id) => void openInEditor(id)}
                    onAddToToday={(project) => void addToToday(project)}
                    onReorder={(ids) => void reorder(ids)}
                    onShowFolders={(id) =>
                      setFolderFor(folderFor === id ? null : id)
                    }
                    foldersFor={folderFor}
                  />

                  {folderProject && <FolderPanel project={folderProject} />}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Tab({
  label,
  count,
  on,
  onClick
}: {
  label: string
  count: number
  on: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors',
        on ? 'bg-raised text-ink' : 'text-ink-faint hover:text-ink-dim'
      )}
    >
      {label}
      {count > 0 && (
        <span className="ml-1.5 text-[10px] tabular-nums text-ink-faint">
          {count}
        </span>
      )}
    </button>
  )
}

/**
 * Creating a project from nothing: a name, under a home you chose once.
 *
 * The home prompt is inline rather than a separate settings trip — the first
 * project you ever create is exactly the moment you have to answer "where do
 * these live", and the form is the only place that question blocks anything.
 */
function NewProjectForm({
  kind,
  home,
  busy,
  onPickHome,
  onCreate,
  onCancel
}: {
  kind: ProjectKind
  home: string | null
  busy: boolean
  onPickHome(): void
  onCreate(name: string): void
  onCancel(): void
}) {
  const [name, setName] = useState('')

  return (
    <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-3">
      {!home ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-[200px] flex-1 text-[12px] leading-relaxed text-ink-dim">
            Choose where new {kind} projects should live — each one becomes a
            folder there.
          </p>
          <button
            type="button"
            onClick={onPickHome}
            className="rounded-lg border border-amber/40 px-3 py-1.5 text-[12px] text-amber-soft transition-colors hover:bg-amber/10"
          >
            Choose a folder…
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) onCreate(name)
                if (e.key === 'Escape') onCancel()
              }}
              placeholder={
                kind === 'creative'
                  ? 'Project name — e.g. Spring launch film'
                  : 'Project name — e.g. day-deck'
              }
              className="min-w-[180px] flex-1 rounded-lg border border-line-soft bg-canvas/60 px-3 py-1.5 text-[13px] outline-none transition-colors placeholder:text-ink-faint/50 focus:border-line"
            />
            <motion.button
              type="button"
              onClick={() => onCreate(name)}
              whileTap={{ scale: 0.97 }}
              disabled={busy || !name.trim()}
              className="rounded-lg bg-amber/20 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
            >
              Create
            </motion.button>
          </div>
          <p className="mt-2 text-[11px] text-ink-faint/70">
            Creates {home}/{name.trim() || '…'} with{' '}
            {kind === 'creative'
              ? 'Footage, References, Exports and Project files'
              : 'src, assets and docs'}{' '}
            folders.{' '}
            <button
              type="button"
              onClick={onPickHome}
              className="text-ink-faint underline decoration-line-soft underline-offset-2 transition-colors hover:text-ink"
            >
              Change where projects live
            </button>
          </p>
        </>
      )}
    </div>
  )
}

function EmptyState({
  kind,
  onAdd
}: {
  kind: ProjectKind
  onAdd(): void
}) {
  const creative = kind === 'creative'

  return (
    <div className="grid min-h-[320px] place-items-center">
      <div className="max-w-sm text-center">
        <TextEffect
          by="word"
          stagger={0.05}
          className="text-[15px] text-ink-dim"
        >
          {creative
            ? 'Point Day Deck at a project file and it opens where it belongs.'
            : 'Point Day Deck at a folder and it becomes a workspace.'}
        </TextEffect>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">
          {creative ? (
            <>
              A Premiere or After Effects project opens in its own application on
              click. Its folders live here, so the footage stops living on your
              desktop.
            </>
          ) : (
            <>
              An editor, a real terminal rooted at the project, and the branch
              you&rsquo;re on — without leaving the app.
            </>
          )}
        </p>

        <button
          type="button"
          onClick={onAdd}
          className="mt-6 rounded-lg border border-amber/40 px-3.5 py-1.5 transition-colors hover:bg-amber/10"
        >
          {/* No text colour here on purpose — the shine *is* the fill. */}
          <AnimatedShinyText className="text-[12.5px]">
            {creative ? 'Add a creative project' : 'Add your first project'}
          </AnimatedShinyText>
        </button>
      </div>
    </div>
  )
}
