import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type {
  PromptApply,
  PromptPlanProposal,
  SceneApply,
  ScenePlanProposal,
  Storyboard,
  StoryFrame
} from '@shared/types'
import { cn } from '../../lib/cn'
import { errorMessage } from '../../lib/error'
import { goalStyle } from '../../lib/goalColor'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { api } from '../../lib/api'
import { boardDuration, formatDuration } from '../../lib/scene'
import { useIntent } from '../../store/useShell'
import { usePrefs } from '../../store/usePrefs'
import { useProjects } from '../../store/useProjects'
import { useStoryboards } from '../../store/useStoryboards'
import { useStyles } from '../../store/useStyles'
import { ApprovalWindow } from './ApprovalWindow'
import { Canvas, ZOOM_MAX, ZOOM_MIN, type CanvasHandle } from './Canvas'
import { FocusMode } from './FocusMode'
import { PromptWindow } from './PromptWindow'
import { CastPanel } from './CastPanel'
import { StylePanel } from './StylePanel'

export function Storyboards() {
  const boards = useStoryboards((s) => s.boards)
  const frames = useStoryboards((s) => s.frames)
  const lists = useStoryboards((s) => s.lists)
  const items = useStoryboards((s) => s.items)
  const refs = useStoryboards((s) => s.refs)
  const briefRefs = useStoryboards((s) => s.briefRefs)
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

  const styleLibrary = useStyles((s) => s.styles)
  const loadStyles = useStyles((s) => s.load)
  const loadPlaced = useStyles((s) => s.loadPlaced)
  const styleError = useStyles((s) => s.error)
  const dismissStyleError = useStyles((s) => s.dismissError)

  const [naming, setNaming] = useState(false)
  const [zoom, setZoom] = useState(1)
  /** -1 is closed. An index rather than an id, because focus mode walks in order. */
  const [focus, setFocus] = useState(-1)
  const [stylesOpen, setStylesOpen] = useState(false)
  const [castOpen, setCastOpen] = useState(false)
  const sceneNumbers = usePrefs((s) => s.sceneNumbers)
  const setSceneNumbers = usePrefs((s) => s.setSceneNumbers)
  const [proposal, setProposal] = useState<ScenePlanProposal | null>(null)
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  /** A style was just dropped; offer a plan run rather than firing one. */
  const [offerStyleId, setOfferStyleId] = useState<string | null>(null)
  /** Scenes were just applied; ask permission to write their prompts. */
  const [offerPrompts, setOfferPrompts] = useState(false)
  const [promptProposal, setPromptProposal] =
    useState<PromptPlanProposal | null>(null)
  const [planningPrompts, setPlanningPrompts] = useState(false)
  const [applyingPrompts, setApplyingPrompts] = useState(false)

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
    // The library is board-independent, so it loads once with the section.
    void loadStyles()
  }, [load, loadProjects, loadStyles])

  // Placements belong to one board, so they follow the open board. Pending
  // offers belong to the board they were raised on and go with it.
  useEffect(() => {
    if (activeId) void loadPlaced(activeId)
    setOfferStyleId(null)
    setOfferPrompts(false)
    setPromptProposal(null)
  }, [activeId, loadPlaced])

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

  /**
   * Ask for a plan. Writes nothing — the proposal comes back for approval, and
   * `applyScenePlan` is the only call that touches a row.
   */
  async function plan(): Promise<void> {
    if (!activeId || planning) return
    setPlanning(true)
    setPlanError(null)
    try {
      setProposal(await api.storyboards.planScenes(activeId))
    } catch (err) {
      setPlanError(errorMessage(err))
    } finally {
      setPlanning(false)
    }
  }

  async function applyPlan(applies: SceneApply[]): Promise<void> {
    if (!activeId || applies.length === 0) return
    setApplying(true)
    try {
      await api.storyboards.applyScenePlan(activeId, applies)
      // Re-open rather than patching in place: applying can create, rewrite and
      // delete in one go, and the board that comes back is the truth about all
      // three at once.
      await open(activeId)
      setProposal(null)
      // Scenes are on the board; prompts are stage two, and stage two starts
      // by asking. Only when something survived — a plan applied as all
      // deletions has nothing to write prompts for.
      setOfferPrompts(applies.some((a) => a.kind !== 'delete'))
    } catch (err) {
      setPlanError(errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  /** Stage two. Writes nothing — the prompts come back for approval. */
  async function planPrompts(): Promise<void> {
    if (!activeId || planningPrompts) return
    setOfferPrompts(false)
    setPlanningPrompts(true)
    setPlanError(null)
    try {
      setPromptProposal(await api.storyboards.planPrompts(activeId))
    } catch (err) {
      setPlanError(errorMessage(err))
    } finally {
      setPlanningPrompts(false)
    }
  }

  async function applyPrompts(applies: PromptApply[]): Promise<void> {
    if (!activeId || applies.length === 0) return
    setApplyingPrompts(true)
    try {
      await api.storyboards.applyPromptPlan(activeId, applies)
      await open(activeId)
      setPromptProposal(null)
    } catch (err) {
      setPlanError(errorMessage(err))
    } finally {
      setApplyingPrompts(false)
    }
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
              : summarise(frames, active?.title)}
          </span>
        </div>

        {active && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStylesOpen(!stylesOpen)}
              aria-expanded={stylesOpen}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                stylesOpen
                  ? 'border-line bg-raised text-ink'
                  : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
              )}
            >
              Styles
            </button>

            <button
              type="button"
              onClick={() => setCastOpen(!castOpen)}
              aria-expanded={castOpen}
              title="Who is in this film, described once and repeated in every prompt"
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                castOpen
                  ? 'border-line bg-raised text-ink'
                  : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
              )}
            >
              Cast
            </button>

            <button
              type="button"
              onClick={() => void setSceneNumbers(!sceneNumbers)}
              aria-pressed={sceneNumbers}
              title={
                sceneNumbers
                  ? 'Hide the scene numbers on the cards'
                  : 'Number every card by its place in the cut'
              }
              className={cn(
                'rounded-md border px-2 py-1 text-[11.5px] tabular-nums transition-colors',
                sceneNumbers
                  ? 'border-line bg-raised text-ink'
                  : 'border-line-soft text-ink-faint hover:border-line hover:text-ink-dim'
              )}
            >
              1·2·3
            </button>

            <button
              type="button"
              onClick={() => void plan()}
              // The same gate the service applies: brief or visual style is
              // enough to plan from. Requiring the brief specifically left this
              // disabled on boards the planner would happily accept.
              disabled={
                planning || !(active.brief.trim() || active.visualStyle.trim())
              }
              title={
                active.brief.trim() || active.visualStyle.trim()
                  ? 'Read the brief and propose a scene breakdown'
                  : 'Write the brief or visual style on the canvas first'
              }
              className="rounded-md border border-amber/40 px-2.5 py-1 text-[11.5px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              {planning ? 'Planning…' : 'Plan scenes'}
            </button>

            <button
              type="button"
              onClick={() => void planPrompts()}
              disabled={planningPrompts || frames.length === 0}
              title={
                frames.length === 0
                  ? 'Plan or add scenes first'
                  : 'Write a prompt for every scene, consistent with the style and the board'
              }
              className="rounded-md border border-amber/40 px-2.5 py-1 text-[11.5px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              {planningPrompts ? 'Writing…' : 'Write prompts'}
            </button>

            <button
              type="button"
              onClick={() => setFocus(0)}
              disabled={frames.length === 0}
              title="Walk the board one scene at a time"
              className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35 disabled:hover:border-line-soft"
            >
              Scene by scene
            </button>

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

      <StylePanel open={stylesOpen} />
      {active && <CastPanel open={castOpen} boardId={active.id} />}

      <AnimatePresence initial={false}>
        {offerPrompts && active && frames.length > 0 && (
          <motion.div
            key="prompt-offer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-line-soft bg-surface/70 px-3.5 py-2">
              <span className="flex-1 text-[12.5px] text-ink-dim">
                Scenes are on the board. Write a prompt for each one,
                consistent with the style and the whole board?
              </span>
              <button
                type="button"
                disabled={planningPrompts}
                onClick={() => void planPrompts()}
                className="rounded-md border border-amber/40 px-2.5 py-1 text-[11px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35"
              >
                {planningPrompts ? 'Writing…' : 'Write prompts'}
              </button>
              <button
                type="button"
                onClick={() => setOfferPrompts(false)}
                className="text-[11px] text-ink-faint hover:text-ink"
              >
                Not now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {offerStyleId && active && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="shrink-0 overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-line-soft bg-surface/70 px-3.5 py-2">
              <span className="flex-1 text-[12.5px] text-ink-dim">
                {offerName(styleLibrary, offerStyleId)} is on the board.
                {active.brief.trim() || active.visualStyle.trim()
                  ? ' Plan scenes with it now?'
                  : ' Write the brief, then plan scenes with it.'}
              </span>
              {(active.brief.trim() || active.visualStyle.trim()) && (
                <button
                  type="button"
                  disabled={planning}
                  onClick={() => {
                    setOfferStyleId(null)
                    void plan()
                  }}
                  className="rounded-md border border-amber/40 px-2.5 py-1 text-[11px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35"
                >
                  Plan scenes
                </button>
              )}
              <button
                type="button"
                onClick={() => setOfferStyleId(null)}
                className="text-[11px] text-ink-faint hover:text-ink"
              >
                Not now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {[
        { text: error, dismiss: dismissError },
        { text: styleError, dismiss: dismissStyleError },
        { text: planError, dismiss: () => setPlanError(null) }
      ].map(
        ({ text, dismiss }) =>
          text && (
            <div
              key={text}
              className="mb-2 flex shrink-0 items-center gap-3 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2"
            >
              <span className="flex-1 text-[12.5px] text-amber-soft">{text}</span>
              <button
                type="button"
                onClick={dismiss}
                className="text-[11px] text-amber-soft/70 hover:text-amber-soft"
              >
                Dismiss
              </button>
            </div>
          )
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
          {/* Keyed by board so switching segments remounts the canvas — the
              viewport, selection and node store belong to one board and must not
              be inherited by the next. */}
          <Canvas
            key={active.id}
            board={active}
            frames={frames}
            lists={lists}
            items={items}
            refs={refs}
            briefRefs={briefRefs}
            onHandle={onHandle}
            onZoom={setZoom}
            onFocusScene={(frameId) =>
              setFocus(frames.findIndex((f) => f.id === frameId))
            }
            // An offer, not a trigger. Auto-firing meant every style drop cost
            // a plan call the user never asked for — and could not take back.
            onStyleDropped={setOfferStyleId}
          />
        </div>
      )}

      <ApprovalWindow
        proposal={proposal}
        frames={frames}
        busy={applying}
        onApply={(applies) => void applyPlan(applies)}
        onClose={() => setProposal(null)}
      />

      <PromptWindow
        proposal={promptProposal}
        frames={frames}
        busy={applyingPrompts}
        onApply={(applies) => void applyPrompts(applies)}
        onClose={() => setPromptProposal(null)}
      />

      <FocusMode
        frames={frames}
        refsFor={(frameId) => {
          const wired = new Set(
            refs.filter((r) => r.frameId === frameId).map((r) => r.itemId)
          )
          return items.filter((i) => wired.has(i.id))
        }}
        index={focus}
        onIndex={setFocus}
        onClose={() => setFocus(-1)}
      />
    </div>
  )
}

/**
 * The header's one line about the board.
 *
 * Run time is reported with its own caveat rather than as a bare total: "45s" on a
 * board where four scenes have no duration yet is a number that reads as complete
 * and is not.
 */
/** The dropped style's name for the offer line, if the library still has it. */
function offerName(
  styles: ReturnType<typeof useStyles.getState>['styles'],
  styleId: string
): string {
  const name = styles.find((s) => s.id === styleId)?.name
  return name ? `“${name}”` : 'The style'
}

function summarise(frames: StoryFrame[], title: string | undefined): string {
  const where = title ?? 'this board'
  if (frames.length === 0) return `Nothing on ${where} yet`

  const count = `${frames.length} ${frames.length === 1 ? 'scene' : 'scenes'}`
  const { seconds, undecided } = boardDuration(frames)
  if (seconds === 0) return `${count} on ${where}`

  const run = formatDuration(seconds)
  return undecided > 0
    ? `${count} on ${where} · ${run} so far, ${undecided} undecided`
    : `${count} on ${where} · ${run}`
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
