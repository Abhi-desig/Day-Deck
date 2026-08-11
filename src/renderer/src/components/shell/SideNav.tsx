import { motion } from 'motion/react'
import type { SectionId } from '@shared/types'
import { SECTIONS } from '@shared/types'
import { useShell } from '../../store/useShell'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'

const META: Record<SectionId, { label: string; hint: string; path: string }> = {
  today: {
    label: 'Today',
    hint: 'Your deck of day cards',
    path: 'M3 5.5h14v11H3zM3 9h14M6.5 3v3M13.5 3v3'
  },
  projects: {
    label: 'Projects',
    hint: 'Vibe-code workspaces',
    path: 'M7.5 7L5 10l2.5 3M12.5 7L15 10l-2.5 3M3 4.5h14v11H3z'
  },
  goals: {
    label: 'Goals Admin',
    hint: 'Curriculum → daily topics',
    path: 'M10 3.5v13M3.5 10h13M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z'
  },
  tracker: {
    label: 'Tracker',
    hint: 'Where your time went',
    path: 'M4 16V9M8 16V5M12 16v-4M16 16v-8'
  },
  stickers: {
    label: 'Stickers',
    hint: 'Notes wall',
    path: 'M4 3.5h12v9l-3.5 4H4zM16 12.5h-3.5V16'
  }
}

interface SideNavProps {
  active: SectionId
  onSelect(id: SectionId): void
}

export function SideNav({ active, onSelect }: SideNavProps) {
  return (
    <nav
      className={cn(
        'drag-region flex w-[212px] shrink-0 flex-col border-r border-white/8',
        // Static surface, so the blur is paid for once at paint rather than
        // per frame the way the deck's would be.
        'bg-canvas/55 backdrop-blur-2xl'
      )}
      aria-label="Sections"
    >
      {/* Clearance for the macOS traffic lights, which sit over this rail. */}
      <div className="h-[52px] shrink-0" />

      <div className="px-3 pb-2">
        <span className="px-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint/70">
          Day Deck
        </span>
      </div>

      <div className="no-drag flex flex-col gap-0.5 px-2.5 py-2">
        {SECTIONS.map((id) => {
          const meta = META[id]
          const isActive = id === active

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={isActive ? 'page' : undefined}
              title={meta.hint}
              className={cn(
                'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                'transition-colors duration-150',
                isActive ? 'text-ink' : 'text-ink-dim hover:text-ink'
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  transition={SPRING.snap}
                  className="absolute inset-0 rounded-lg border border-line-soft bg-raised"
                />
              )}

              <svg
                viewBox="0 0 20 20"
                className="relative size-[17px] shrink-0"
                aria-hidden
              >
                <path
                  d={meta.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span className="relative text-[13.5px] tracking-[-0.005em]">
                {meta.label}
              </span>

              {isActive && (
                <motion.span
                  layoutId="nav-dot"
                  transition={SPRING.snap}
                  className="relative ml-auto size-1.5 rounded-full bg-amber"
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="no-drag mt-auto px-4 pb-4">
        <button
          type="button"
          onClick={() => useShell.getState().setData(true)}
          className="text-[10.5px] leading-relaxed text-ink-faint/50 transition-colors hover:text-ink-dim"
        >
          Local · offline
          <br />
          <span className="underline decoration-dotted underline-offset-2">
            Backup &amp; database
          </span>
        </button>
        <div className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint/35">
          ⌘K commands · ⌘1–5 sections · ← → to swipe
        </div>
      </div>
    </nav>
  )
}
