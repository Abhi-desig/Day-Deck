import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Storyboard } from '@shared/types'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { useIntent } from '../../store/useShell'
import { useProjects } from '../../store/useProjects'
import { useStoryboards } from '../../store/useStoryboards'
import { Canvas, ZOOM_MAX, ZOOM_MIN, type CanvasHandle } from './Canvas'

export function Storyboards() {
  const boards = useStoryboards((s) => s.boards)
  const frames = useStoryboards((s) => s.frames)
  const activeId = useStoryboards((s) => s.activeId)
  const ready = useStoryboards((s) => s.ready)
  const loadingFrames = useStoryboards((s) => s.loadingFrames)
  const error = useStoryboards((s) => s.error)
  const load = useStoryboards((s) => s.load)
  const open = useStoryboards((s) => s.open)
  const addBoard = useStoryboards((s) => s.addBoard)
  const dismissError = useStoryboards((s) => s.dismissError)

  const projects = useProjects((s) => s.projects)
  const loadProjects = useProjects((s) => s.load)

  const [naming, setNaming] = useState(false)
  const [zoom, setZoom] = useState(1)

  // Commands, not state — see the note on CanvasHandle.
  const canvasRef = useRef<CanvasHandle | null>(null)
  const onHandle = useCallback((handle: CanvasHandle) => {
    canvasRef.current = handle
  }, [])

  useEffect(() => {
    void load()
    // Boards can belong to a project, and the picker needs the list to offer
    // one. Cheap, and the grid caches it anyway.
    void loadProjects()
  }, [load, loadProjects])

  const newBoardIntent = useIntent('newBoard')
  useEffect(() => {
    if (newBoardIntent > 0) setNaming(true)
  }, [newBoardIntent])

  const active = boards.find((b) => b.id === activeId) ?? null

  async function create(title: string, projectId: string | null): Promise<void> {
    const name = title.trim()
    if (!name) return
    await addBoard({ title: name, projectId })
    setNaming(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-7 pb-7">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-medium tracking-[-0.02em]">
            Storyboards
          </h1>
          <span className="text-[12.5px] text-ink-faint">
            {boards.length === 0
              ? 'A canvas per project, and a prompt per frame'
              : `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} on ${active?.title ?? 'this board'}`}
          </span>
        </div>

        {active && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full border border-line-soft p-0.5">
              <ZoomButton
                label="Zoom out"
                glyph="−"
                disabled={zoom <= ZOOM_MIN + 0.001}
                onClick={() => canvasRef.current?.zoomBy(1 / 1.15)}
              />
              <button
                type="button"
                onClick={() => canvasRef.current?.reset()}
                title="Reset the view"
                className="min-w-[46px] rounded-full px-1.5 py-1 text-[11px] tabular-nums text-ink-dim transition-colors hover:bg-raised hover:text-ink"
              >
                {Math.round(zoom * 100)}%
              </button>
              <ZoomButton
                label="Zoom in"
                glyph="+"
                disabled={zoom >= ZOOM_MAX - 0.001}
                onClick={() => canvasRef.current?.zoomBy(1.15)}
              />
            </div>

            <button
              type="button"
              onClick={() => canvasRef.current?.addAtCentre()}
              className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
            >
              Add frame
            </button>
          </div>
        )}
      </header>

      <SegmentStrip
        boards={boards}
        activeId={activeId}
        onSelect={(id) => void open(id)}
        onNew={() => setNaming(true)}
      />

      <AnimatePresence initial={false}>
        {naming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden"
          >
            <NewBoardForm
              projects={projects}
              onCreate={create}
              onCancel={() => setNaming(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mb-2 flex shrink-0 items-center gap-3 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2">
          <span className="flex-1 text-[12.5px] text-amber-soft">{error}</span>
          <button
            type="button"
            onClick={dismissError}
            className="text-[11px] text-amber-soft/70 hover:text-amber-soft"
          >
            Dismiss
          </button>
        </div>
      )}

      {!ready ? (
        <p className="py-8 text-[12.5px] text-ink-faint">Loading…</p>
      ) : !active ? (
        <EmptyState onNew={() => setNaming(true)} />
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity duration-150',
            loadingFrames && 'opacity-60'
          )}
        >
          {/* Keyed by board so switching segments remounts the canvas — pan,
              zoom and every frame's local geometry belong to one board and must
              not be inherited by the next. */}
          <Canvas
            key={active.id}
            boardId={active.id}
            frames={frames}
            onHandle={onHandle}
            onZoom={setZoom}
          />
        </div>
      )}
    </div>
  )
}

function ZoomButton({
  label,
  glyph,
  disabled,
  onClick
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick(): void
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      aria-label={label}
      className="grid size-6 place-items-center rounded-full text-[13px] text-ink-dim transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {glyph}
    </motion.button>
  )
}

/**
 * The segmentation itself.
 *
 * Each board is one segment and they are mutually exclusive — this is a set of
 * spaces, not a filter over one. That is why selecting swaps the canvas whole
 * rather than hiding frames: two projects' storyboards sharing a surface is
 * exactly the thing the segmentation exists to prevent.
 */
function SegmentStrip({
  boards,
  activeId,
  onSelect,
  onNew
}: {
  boards: Storyboard[]
  activeId: string | null
  onSelect(id: string): void
  onNew(): void
}) {
  const projects = useProjects((s) => s.projects)
  const removeBoard = useStoryboards((s) => s.removeBoard)

  if (boards.length === 0) return null

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-3">
      {boards.map((board) => {
        const style = goalStyle(board.color)
        const on = board.id === activeId
        const project = projects.find((p) => p.id === board.projectId)

        return (
          <button
            key={board.id}
            type="button"
            onClick={() => onSelect(board.id)}
            aria-pressed={on}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
              on
                ? cn('bg-raised text-ink', style.border)
                : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
            )}
          >
            <span className={cn('size-1.5 rounded-full', style.dot)} />
            {board.title}
            {project && (
              <span className="text-ink-faint/60">· {project.name}</span>
            )}
            {on && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${board.title}`}
                title="Delete this board and its frames"
                onClick={(e) => {
                  e.stopPropagation()
                  void removeBoard(board.id)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.stopPropagation()
                  void removeBoard(board.id)
                }}
                className="ml-0.5 text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </span>
            )}
          </button>
        )
      })}

      <button
        type="button"
        onClick={onNew}
        className="rounded-full border border-dashed border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-line hover:text-ink-dim"
      >
        + Board
      </button>
    </div>
  )
}

function NewBoardForm({
  projects,
  onCreate,
  onCancel
}: {
  projects: ReturnType<typeof useProjects.getState>['projects']
  onCreate(title: string, projectId: string | null): void
  onCancel(): void
}) {
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)

  return (
    <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreate(title, projectId)
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="Board name…"
          className="min-w-[180px] flex-1 rounded-lg border border-line-soft bg-canvas/60 px-3 py-1.5 text-[13px] outline-none transition-colors placeholder:text-ink-faint/50 focus:border-line"
        />

        <label className="flex items-center gap-2 text-[11.5px] text-ink-faint">
          Project
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="rounded-lg border border-line-soft bg-canvas/60 px-2 py-1.5 text-[12px] text-ink outline-none transition-colors focus:border-line"
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <motion.button
          type="button"
          onClick={() => onCreate(title, projectId)}
          whileTap={{ scale: 0.97 }}
          disabled={!title.trim()}
          className="rounded-lg bg-amber/20 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
        >
          Create
        </motion.button>
      </div>

      <p className="mt-2 text-[11px] text-ink-faint/70">
        Linking a board to a project only labels it — removing the folder from
        the Projects grid leaves the board and its frames alone.
      </p>
    </div>
  )
}

function EmptyState({ onNew }: { onNew(): void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="grid min-h-[320px] flex-1 place-items-center"
    >
      <div className="max-w-sm text-center">
        <p className="text-[15px] text-ink-dim">
          A canvas per project, and a prompt per frame.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">
          Each board is its own space. Drop frames anywhere on it, write what
          the shot is, and keep the prompt that generates it right there on the
          card.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="mt-6 rounded-lg border border-amber/40 px-3.5 py-1.5 text-[12.5px] text-amber-soft transition-colors hover:bg-amber/10"
        >
          Start a board
        </button>
      </div>
    </motion.div>
  )
}
