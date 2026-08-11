import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Project } from '@shared/types'
import { cn } from '../../lib/cn'
import { SPRING, STAGGER } from '../../lib/motion'
import { ProjectCard } from './ProjectCard'

/**
 * The grid, with drag-to-reorder.
 *
 * Reordering works by hit-testing the pointer against the card it is over and
 * swapping positions in a local copy of the list; Motion's `layout` animates
 * everything into its new place. The dragged card is not detached from the flow
 * — the neighbours sliding out of the way is the feedback, and keeping every
 * card in the grid means the layout animation and the card→workspace `layoutId`
 * transition never fight over the same element's transform.
 *
 * The pointer listeners go on `window` rather than the handle: the dragged card
 * turns off pointer events so the hit test can see what is underneath it, and a
 * captured element with `pointer-events: none` is not somewhere to be receiving
 * moves from.
 */
interface ProjectGridProps {
  projects: Project[]
  onOpen(id: string): void
  onTogglePin(id: string): void
  onRemove(id: string): void
  onOpenInEditor(id: string): void
  onAddToToday(project: Project): void
  onReorder(orderedIds: string[]): void
}

export function ProjectGrid({
  projects,
  onOpen,
  onTogglePin,
  onRemove,
  onOpenInEditor,
  onAddToToday,
  onReorder
}: ProjectGridProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)

  // Read inside window listeners that are bound once per drag.
  const draftRef = useRef<string[] | null>(null)
  draftRef.current = draft
  /** Detaches the in-flight drag's listeners. Set for the duration of a drag. */
  const detachRef = useRef<(() => void) | null>(null)

  const ordered = draft
    ? (draft
        .map((id) => projects.find((p) => p.id === id))
        .filter((p): p is Project => p !== undefined))
    : projects

  const startDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()

      setDragId(id)
      const initial = projects.map((p) => p.id)
      setDraft(initial)
      draftRef.current = initial

      const move = (e: PointerEvent): void => {
        const current = draftRef.current
        if (!current) return

        const overId = projectUnderPointer(e.clientX, e.clientY)
        if (!overId || overId === id) return

        const from = current.indexOf(id)
        const to = current.indexOf(overId)
        if (from === -1 || to === -1 || from === to) return

        const next = [...current]
        next.splice(to, 0, ...next.splice(from, 1))
        draftRef.current = next
        setDraft(next)
      }

      const detach = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        detachRef.current = null
      }

      const end = (): void => {
        detach()

        const final = draftRef.current
        setDragId(null)
        setDraft(null)
        draftRef.current = null

        // Only write when something actually moved.
        if (final && final.join() !== projects.map((p) => p.id).join()) {
          onReorder(final)
        }
      }

      detachRef.current = detach
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [onReorder, projects]
  )

  // A drag in flight when this unmounts — opening a workspace mid-drag, say —
  // would otherwise leave its listeners bound to window for good.
  useEffect(
    () => () => {
      detachRef.current?.()
      draftRef.current = null
    },
    []
  )

  return (
    <div
      className={cn(
        'grid gap-4 pb-2',
        'grid-cols-[repeat(auto-fill,minmax(272px,1fr))]',
        dragId && 'select-none'
      )}
    >
      {ordered.map((project, index) => {
        const isDragging = project.id === dragId

        return (
          <motion.div
            key={project.id}
            data-project-id={project.id}
            layout
            transition={SPRING.soft}
            initial={{ opacity: 0, y: 10 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: isDragging ? 1.03 : 1,
              // Entrance stagger only; once the grid is up, a reorder should be
              // immediate rather than rippling.
              transition: {
                ...SPRING.soft,
                delay: dragId ? 0 : index * STAGGER.grid
              }
            }}
            style={{ zIndex: isDragging ? 30 : 1 }}
            className={cn(isDragging && 'drop-shadow-[0_18px_36px_rgba(0,0,0,0.55)]')}
          >
            <ProjectCard
              project={project}
              dragging={isDragging}
              onOpen={() => onOpen(project.id)}
              onTogglePin={() => onTogglePin(project.id)}
              onRemove={() => onRemove(project.id)}
              onOpenInEditor={() => onOpenInEditor(project.id)}
              onAddToToday={() => onAddToToday(project)}
              onDragStart={(event) => startDrag(project.id, event)}
            />
          </motion.div>
        )
      })}
    </div>
  )
}

function projectUnderPointer(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)
  return element?.closest<HTMLElement>('[data-project-id]')?.dataset.projectId ?? null
}
