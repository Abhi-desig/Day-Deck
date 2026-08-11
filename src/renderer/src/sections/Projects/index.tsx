import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Project } from '@shared/types'
import { AnimatedShinyText } from '../../components/magicui/AnimatedShinyText'
import { TextEffect } from '../../components/motion-primitives/TextEffect'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { useDeck } from '../../store/useDeck'
import { useOpenProject, useProjects } from '../../store/useProjects'
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
  const setNotice = useProjects((s) => s.setNotice)

  const openProject = useOpenProject()

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
              <div className="flex items-baseline gap-3">
                <h1 className="text-[19px] font-medium tracking-[-0.02em]">
                  Projects
                </h1>
                {projects.length > 0 && (
                  <span className="text-[12.5px] text-ink-faint">
                    {projects.length} {projects.length === 1 ? 'folder' : 'folders'}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void add()}
                disabled={busy}
                className={cn(
                  'rounded-md border border-line-soft px-2.5 py-1 text-[11.5px]',
                  'text-ink-dim transition-colors hover:border-line hover:text-ink',
                  'disabled:opacity-50'
                )}
              >
                Add folder…
              </button>
            </header>

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
              ) : projects.length === 0 ? (
                <EmptyState onAdd={() => void add()} />
              ) : (
                <ProjectGrid
                  projects={projects}
                  onOpen={open}
                  onTogglePin={(id) => void togglePin(id)}
                  onRemove={(id) => void remove(id)}
                  onOpenInEditor={(id) => void openInEditor(id)}
                  onAddToToday={(project) => void addToToday(project)}
                  onReorder={(ids) => void reorder(ids)}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd(): void }) {
  return (
    <div className="grid min-h-[320px] place-items-center">
      <div className="max-w-sm text-center">
        <TextEffect
          by="word"
          stagger={0.05}
          className="text-[15px] text-ink-dim"
        >
          Point Day Deck at a folder and it becomes a workspace.
        </TextEffect>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">
          An editor, a real terminal rooted at the project, and the branch
          you&rsquo;re on — without leaving the app.
        </p>

        <button
          type="button"
          onClick={onAdd}
          className="mt-6 rounded-lg border border-amber/40 px-3.5 py-1.5 transition-colors hover:bg-amber/10"
        >
          {/* No text colour here on purpose — the shine *is* the fill. */}
          <AnimatedShinyText className="text-[12.5px]">
            Add your first project
          </AnimatedShinyText>
        </button>
      </div>
    </div>
  )
}
