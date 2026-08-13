import type { PointerEvent } from 'react'
import { motion } from 'motion/react'
import type { Project } from '@shared/types'
import { MagicCard } from '../../components/magicui/MagicCard'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'

/** The spotlight tint per palette colour, matching --color-goal-* in globals.css. */
const GLOW: Record<Project['color'], string> = {
  amber: 'rgb(255 176 32 / 0.42)',
  violet: 'rgb(167 139 250 / 0.42)',
  sky: 'rgb(124 156 255 / 0.42)',
  mint: 'rgb(94 234 212 / 0.4)',
  rose: 'rgb(251 113 133 / 0.4)'
}

interface ProjectCardProps {
  project: Project
  /** Suppresses the tilt while a sibling is being dragged past this one. */
  dragging: boolean
  onOpen(): void
  onTogglePin(): void
  onRemove(): void
  onOpenInEditor(): void
  onAddToToday(): void
  onShowFolders(): void
  /** This card's folder panel is the one currently open below the grid. */
  foldersOpen: boolean
  onDragStart(event: PointerEvent<HTMLElement>): void
}

export function ProjectCard({
  project,
  dragging,
  onOpen,
  onTogglePin,
  onRemove,
  onOpenInEditor,
  onAddToToday,
  onShowFolders,
  foldersOpen,
  onDragStart
}: ProjectCardProps) {
  const style = goalStyle(project.color)
  const creative = project.kind === 'creative'
  /** The extension of the file this opens — the fastest read of what app owns it. */
  const fileType = project.entryPath
    ? (project.entryPath.split('.').pop() ?? '').toLowerCase()
    : null

  return (
    <MagicCard
      // The id the workspace expands *from*. Motion matches this against the
      // workspace root, and the card growing into the full pane is the one
      // transition this app is built around.
      layoutId={`project-${project.id}`}
      glow={GLOW[project.color]}
      onClick={onOpen}
      className={cn('h-[136px]', dragging && 'pointer-events-none')}
    >
      <div className="flex h-[136px] flex-col justify-between p-4">
        <div className="flex items-start gap-2.5">
          <span
            className={cn('mt-[7px] size-2 shrink-0 rounded-full', style.dot)}
            aria-hidden
          />

          <div className="min-w-0 flex-1">
            {/* The card as a whole is clickable for the mouse, but this is the
                real control — so tabbing through the grid reaches every project
                and Enter opens it. */}
            <button
              type="button"
              onClick={onOpen}
              title={`Open ${project.name}`}
              className="block max-w-full truncate text-left outline-none"
            >
              <motion.h3
                layoutId={`project-name-${project.id}`}
                transition={SPRING.expand}
                className="truncate text-[15px] font-medium tracking-[-0.01em]"
              >
                {project.name}
              </motion.h3>
            </button>
            <p
              className="mt-0.5 truncate text-[11px] text-ink-faint"
              title={project.path}
            >
              {project.path}
            </p>
          </div>

          {/* Grab handle. Reordering has to be opt-in, or every attempt to open
              a project would start a drag instead. */}
          <button
            type="button"
            aria-label={`Reorder ${project.name}`}
            onPointerDown={onDragStart}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'grid size-6 shrink-0 cursor-grab place-items-center rounded-md',
              'text-ink-faint opacity-0 transition-opacity duration-150',
              'group-hover/card:opacity-100 hover:bg-line hover:text-ink',
              'active:cursor-grabbing'
            )}
          >
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <path
                d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {project.missing ? (
              <Tag className="border-goal-rose/45 text-goal-rose">
                folder not found
              </Tag>
            ) : creative ? (
              /* A creative project is not a repository, so the branch chip has
                 nothing to say. What matters is which application owns it. */
              fileType ? (
                <Tag className={cn(style.border, style.text)}>.{fileType}</Tag>
              ) : (
                <Tag className="border-line-soft text-ink-faint">
                  no project file
                </Tag>
              )
            ) : project.branch ? (
              <Tag className={cn(style.border, style.text)}>
                <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
                  <path
                    d="M5 3.5v9M5 3.5a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8zM5 12.5a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM11 5.5a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM11 5.5v1.6c0 1.4-1.1 2.5-2.5 2.5H5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="max-w-[128px] truncate">{project.branch}</span>
              </Tag>
            ) : (
              <Tag className="border-line-soft text-ink-faint">no repo</Tag>
            )}

            {project.pinned && (
              <Tag className="border-amber/40 text-amber-soft">pinned</Tag>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100">
            <Action
              label={project.pinned ? 'Unpin' : 'Pin to front'}
              onClick={onTogglePin}
              active={project.pinned}
              path="M8 2.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9L8 11l-3.4 2 .8-3.9L2.5 6.5l3.9-.4z"
            />
            <Action
              label="Add to today"
              onClick={onAddToToday}
              path="M8 3.5v9M3.5 8h9"
            />
            <Action
              label={foldersOpen ? 'Hide folders' : 'Show folders'}
              onClick={onShowFolders}
              active={foldersOpen}
              path="M2.5 5A1 1 0 013.5 4h2.2l1 1.5h5.8a1 1 0 011 1V12a1 1 0 01-1 1h-9a1 1 0 01-1-1V5z"
            />
            {!creative && (
              <Action
                label="Open in VS Code"
                onClick={onOpenInEditor}
                path="M6 5.5L3 8l3 2.5M10 5.5L13 8l-3 2.5"
              />
            )}
            <Action
              label={`Remove ${project.name} from the grid`}
              onClick={onRemove}
              danger
              path="M4 4l8 8M12 4l-8 8"
            />
          </div>
        </div>
      </div>
    </MagicCard>
  )
}

function Tag({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]',
        className
      )}
    >
      {children}
    </span>
  )
}

interface ActionProps {
  label: string
  path: string
  onClick(): void
  active?: boolean
  danger?: boolean
}

function Action({ label, path, onClick, active, danger }: ActionProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        // The whole card is the "open" button; these are not.
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid size-6 place-items-center rounded-md transition-colors duration-150',
        active ? 'text-amber' : 'text-ink-faint',
        danger ? 'hover:bg-goal-rose/20 hover:text-goal-rose' : 'hover:bg-line hover:text-ink'
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
