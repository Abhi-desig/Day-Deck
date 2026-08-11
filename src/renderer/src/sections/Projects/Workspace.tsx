import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Project } from '@shared/types'
import { BorderBeam } from '../../components/magicui/BorderBeam'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { EASE_OUT, SPRING, WORKSPACE } from '../../lib/motion'
import { shortenPath } from '../../lib/path'
import { useProjects } from '../../store/useProjects'
import { useDirtyPaths, useWorkspace } from '../../store/useWorkspace'
import { FileTree } from './FileTree'
import { TerminalPane } from './TerminalPane'

/**
 * Monaco is ~9MB of parsed JavaScript — more than the rest of the app put
 * together — and nothing outside a workspace needs it. Splitting it out keeps
 * launch fast; the Projects grid warms the chunk on mount (see the section
 * index), so by the time a card is clicked it is almost always already there.
 *
 * The split is *inside* the workspace rather than around it on purpose: the
 * shell has to mount immediately for the card's `layoutId` to have something
 * to expand into, and a Suspense boundary around the whole thing would leave
 * the transition with no target.
 */
const EditorPane = lazy(() =>
  import('./EditorPane').then((m) => ({ default: m.EditorPane }))
)

/**
 * The full workspace: files, editor, terminals.
 *
 * The root carries the same `layoutId` as the grid card, which is what makes
 * the card appear to grow into this pane rather than being replaced by it.
 *
 * Layout settling is tracked explicitly. `settleToken` increments only when an
 * animation *reports* it has finished, and both the editor and every terminal
 * re-measure off that token — xterm's FitAddon reflows the pty, so calling it
 * during the expand or mid-drag on the resizer makes the terminal thrash.
 */
export function Workspace({ project }: { project: Project }) {
  const close = useProjects((s) => s.close)
  const openInEditor = useProjects((s) => s.openInEditor)

  const enter = useWorkspace((s) => s.enter)
  const leave = useWorkspace((s) => s.leave)
  const openFile = useWorkspace((s) => s.openFile)
  const save = useWorkspace((s) => s.save)
  const saveAll = useWorkspace((s) => s.saveAll)
  const activePath = useWorkspace((s) => s.activePath)
  const error = useWorkspace((s) => s.error)
  const setError = useWorkspace((s) => s.setError)
  const dirtyPaths = useDirtyPaths()

  const [split, setSplit] = useState<number>(WORKSPACE.defaultSplit)
  const [dragging, setDragging] = useState(false)
  const [settleToken, setSettleToken] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)

  const columnRef = useRef<HTMLDivElement>(null)
  /** Detaches an in-flight resize drag, so unmounting mid-drag cleans up. */
  const detachResizeRef = useRef<(() => void) | null>(null)
  const settle = useCallback(() => setSettleToken((n) => n + 1), [])

  useEffect(() => {
    enter(project.id)
  }, [enter, project.id])

  useEffect(
    () => () => {
      // Belt and braces. Each TerminalView kills its own session on unmount;
      // this catches anything that was still starting when we left.
      api.terminal.killProject(project.id)
      leave(project.id)
    },
    [leave, project.id]
  )

  /**
   * ⌘S from anywhere in the workspace, not just inside the editor.
   *
   * `allowInInput` is essential rather than incidental: the caret is *inside*
   * Monaco almost every time this fires, and the guard that stops ⌘K eating a
   * keystroke would stop ⌘S saving the file. Monaco has its own ⌘S binding, but
   * ours runs first and calls `preventDefault`, so the file is saved once.
   */
  useHotkeys(
    [
      {
        combo: 'mod+s',
        allowInInput: true,
        handler: () => void save()
      },
      {
        combo: 'mod+shift+s',
        allowInInput: true,
        handler: () => void saveAll()
      }
    ],
    { layer: LAYER.section }
  )

  /* --------------------------------------------------------- the resizer */

  const onResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    setDragging(true)

    const move = (e: PointerEvent): void => {
      const box = columnRef.current?.getBoundingClientRect()
      if (!box || box.height === 0) return
      const ratio = (e.clientY - box.top) / box.height
      setSplit(
        Math.min(WORKSPACE.maxSplit, Math.max(WORKSPACE.minSplit, ratio))
      )
    }
    const detach = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      detachResizeRef.current = null
    }

    const end = (): void => {
      detach()
      setDragging(false)
      // The drag itself is unanimated, so nothing will report a settle — say so
      // here instead, once, on release.
      setSettleToken((n) => n + 1)
    }

    detachResizeRef.current = detach
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])

  useEffect(() => () => detachResizeRef.current?.(), [])

  const requestClose = (): void => {
    if (dirtyPaths.length > 0 && !confirmClose) {
      setConfirmClose(true)
      return
    }
    close()
  }

  const style = goalStyle(project.color)

  return (
    <motion.div
      layoutId={`project-${project.id}`}
      transition={SPRING.expand}
      onLayoutAnimationComplete={settle}
      className={cn(
        'absolute inset-0 mx-7 mb-7 flex flex-col overflow-hidden',
        'rounded-card border border-line-soft glass-flat card-shadow'
      )}
    >
      <BorderBeam duration={9} thickness={1} />

      {/* ------------------------------------------------------- header */}
      <header className="relative z-20 flex shrink-0 items-center gap-3 border-b border-line-soft/70 px-3 py-2">
        <button
          type="button"
          onClick={requestClose}
          aria-label="Back to projects"
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-line hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path
              d="M10 3.5L5.5 8l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <span className={cn('size-2 shrink-0 rounded-full', style.dot)} aria-hidden />

        <div className="flex min-w-0 items-baseline gap-2.5">
          <motion.h2
            layoutId={`project-name-${project.id}`}
            transition={SPRING.expand}
            className="truncate text-[15px] font-medium tracking-[-0.01em]"
          >
            {project.name}
          </motion.h2>
          <span
            className="truncate text-[11px] text-ink-faint"
            title={project.path}
          >
            {shortenPath(project.path)}
          </span>
          {project.branch && (
            <span
              className={cn(
                'shrink-0 rounded-full border px-1.5 py-px text-[10px]',
                style.border,
                style.text
              )}
            >
              {project.branch}
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <AnimatePresence>
            {dirtyPaths.length > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={SPRING.snap}
                onClick={() => void saveAll()}
                className="rounded-md border border-amber/40 px-2 py-1 text-[11px] text-amber-soft transition-colors hover:bg-amber/10"
              >
                Save {dirtyPaths.length}
                <span className="text-amber-soft/60"> · ⇧⌘S</span>
              </motion.button>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => void openInEditor(project.id)}
            className="rounded-md border border-line-soft px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink"
          >
            Open in VS Code
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- notices */}
      <AnimatePresence initial={false}>
        {(error || confirmClose) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING.soft}
            className="relative z-20 shrink-0 overflow-hidden"
          >
            {confirmClose ? (
              <div className="flex items-center gap-3 border-b border-amber/25 bg-amber/10 px-3 py-2 text-[12px]">
                <span className="text-amber-soft">
                  {dirtyPaths.length} unsaved{' '}
                  {dirtyPaths.length === 1 ? 'file' : 'files'}:{' '}
                  {dirtyPaths.join(', ')}
                </span>
                <div className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      void saveAll().then(() => close())
                    }}
                    className="rounded-md border border-amber/40 px-2 py-0.5 text-[11px] text-amber-soft hover:bg-amber/15"
                  >
                    Save and close
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-line-soft px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClose(false)}
                    className="rounded-md px-2 py-0.5 text-[11px] text-ink-faint hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 border-b border-goal-rose/25 bg-goal-rose/10 px-3 py-2 text-[12px]">
                <span data-selectable className="text-goal-rose">
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-auto text-[11px] text-ink-faint hover:text-ink"
                >
                  Dismiss
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --------------------------------------------------------- body */}
      <div className="relative z-10 flex min-h-0 flex-1">
        <aside className="flex w-[228px] shrink-0 flex-col border-r border-line-soft/70">
          <div className="shrink-0 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.16em] text-ink-faint/70">
            Files
          </div>
          <FileTree
            projectId={project.id}
            activePath={activePath}
            dirtyPaths={dirtyPaths}
            onOpen={(path) => void openFile(path)}
          />
        </aside>

        <div ref={columnRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <motion.div
            className="flex min-h-0 flex-col overflow-hidden"
            animate={{ flexBasis: `${split * 100}%` }}
            // While dragging, the value must land on the frame it was computed
            // for. A spring here would trail the pointer by a visible amount.
            transition={dragging ? { duration: 0 } : SPRING.soft}
            onAnimationComplete={() => {
              if (!dragging) settle()
            }}
            style={{ flexGrow: 0, flexShrink: 1 }}
          >
            <Suspense
              fallback={
                <div className="grid min-h-0 flex-1 place-items-center text-[12px] text-ink-faint">
                  Loading the editor…
                </div>
              }
            >
              <EditorPane settleToken={settleToken} />
            </Suspense>
          </motion.div>

          <Resizer dragging={dragging} onPointerDown={onResizeStart} />

          <div className="flex min-h-0 flex-1 flex-col">
            <TerminalPane projectId={project.id} settleToken={settleToken} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function Resizer({
  dragging,
  onPointerDown
}: {
  dragging: boolean
  onPointerDown(event: React.PointerEvent): void
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize editor and terminal"
      onPointerDown={onPointerDown}
      className="group/resizer relative h-1 shrink-0 cursor-row-resize"
    >
      {/* A 1px target is unhittable; the grab area is 9px and invisible. */}
      <span className="absolute inset-x-0 -top-1 h-[9px]" aria-hidden />
      <motion.span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px origin-center bg-amber"
        initial={false}
        animate={{ opacity: dragging ? 1 : 0, scaleY: dragging ? 2 : 1 }}
        transition={{ duration: 0.15, ease: EASE_OUT }}
      />
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-line-soft/60 opacity-0 transition-opacity duration-150 group-hover/resizer:opacity-100"
      />
    </div>
  )
}
