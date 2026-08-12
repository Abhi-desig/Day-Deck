import { useRef } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue
} from 'motion/react'
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
  storyboards: {
    label: 'Storyboards',
    hint: 'A canvas per project',
    path: 'M3 4.5h6v5H3zM11 4.5h6v11h-6zM3 11.5h6v4H3z'
  },
  stickers: {
    label: 'Stickers',
    hint: 'Notes wall',
    path: 'M4 3.5h12v9l-3.5 4H4zM16 12.5h-3.5V16'
  }
}

/** Resting icon-button size, and the most a hovered one grows to. */
const SIZE = 40
const MAX_SCALE = 1.5
/**
 * How far up and down the dock the magnification reaches, in px.
 *
 * Roughly two neighbours either side. Much wider and the whole dock swells as
 * one object instead of the cursor picking out an icon; much narrower and the
 * effect only appears once you are already on top of the thing you wanted.
 */
const REACH = 88

interface DockProps {
  active: SectionId
  onSelect(id: SectionId): void
}

/**
 * The left rail, as a floating dock.
 *
 * It hovers over the content rather than reserving a column: the deck is the
 * widest thing in the app and every pixel spent on permanent chrome is a pixel
 * the cards do not get. `main` carries the matching left padding so nothing
 * ever renders underneath it.
 *
 * Magnification is driven by one shared motion value — the cursor's y position
 * within the dock — that every item reads and turns into its own scale. Doing
 * it that way means a mouse move animates transforms only, and never triggers a
 * React render.
 */
export function Dock({ active, onSelect }: DockProps) {
  const reduced = useReducedMotion()
  const railRef = useRef<HTMLDivElement>(null)

  // Infinity, not 0: an unset pointer has to be *outside* the reach of every
  // item, and 0 is a real position at the top of the dock.
  const pointerY = useMotionValue(Number.POSITIVE_INFINITY)

  return (
    <>
      {/* Clearance for the macOS traffic lights, and the strip that drags the
          window. Separate from the dock so the dock itself stays clickable. */}
      <div className="drag-region pointer-events-none absolute inset-x-0 top-0 z-10 h-[52px]" />

      <nav
        aria-label="Sections"
        className="pointer-events-none absolute inset-y-0 left-0 z-[120] flex w-[92px] items-center justify-center"
      >
        <motion.div
          ref={railRef}
          onPointerMove={(e) => {
            if (reduced) return
            const rect = railRef.current?.getBoundingClientRect()
            pointerY.set(e.clientY - (rect?.top ?? 0))
          }}
          onPointerLeave={() => pointerY.set(Number.POSITIVE_INFINITY)}
          className={cn(
            'pointer-events-auto flex flex-col items-center gap-1.5 p-2',
            // The curved edges: a large radius on a narrow rail reads as a
            // lozenge rather than a rounded rectangle, which is the difference
            // between a dock and a sidebar.
            'rounded-[26px] border border-white/10 glass',
            'shadow-[0_20px_50px_-16px_rgb(0_0_0/0.75)]'
          )}
        >
          {SECTIONS.map((id) => (
            <DockItem
              key={id}
              id={id}
              active={id === active}
              pointerY={pointerY}
              reduced={!!reduced}
              onSelect={onSelect}
            />
          ))}

          <span className="my-0.5 h-px w-6 bg-white/10" aria-hidden />

          <DockButton
            label="Backup & database"
            hint="Local · offline"
            pointerY={pointerY}
            reduced={!!reduced}
            onClick={() => useShell.getState().setData(true)}
            path="M4 6c0-1.4 2.7-2.5 6-2.5S16 4.6 16 6v8c0 1.4-2.7 2.5-6 2.5S4 15.4 4 14zM4 6c0 1.4 2.7 2.5 6 2.5S16 7.4 16 6M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"
          />
        </motion.div>
      </nav>
    </>
  )
}

/**
 * The magnification curve.
 *
 * Distance from the cursor maps to scale through a plain three-stop ramp:
 * biggest under the cursor, untouched at the edge of REACH. A spring on top so
 * the growth trails the pointer slightly instead of tracking it rigidly — the
 * lag is most of what makes the macOS dock feel physical rather than
 * mechanical.
 */
function useMagnify(
  pointerY: MotionValue<number>,
  centre: number,
  reduced: boolean
): MotionValue<number> {
  const distance = useTransform(pointerY, (y) => Math.abs(y - centre))
  const target = useTransform(distance, [0, REACH], [MAX_SCALE, 1], {
    clamp: true
  })
  const springy = useSpring(target, {
    stiffness: 520,
    damping: 30,
    mass: 0.45
  })

  // Every hook runs on every path — the reduced-motion case picks a different
  // value to return, it does not skip building the other one.
  const flat = useMotionValue(1)
  return reduced ? flat : springy
}

/** Where an item's centre sits inside the rail, given its position in the list. */
const centreOf = (index: number): number =>
  // 8px of padding (`p-2`), then each item plus the 6px gap (`gap-1.5`).
  8 + index * (SIZE + 6) + SIZE / 2

/**
 * Extra offset past the last section, for the divider.
 *
 * Its own 1px plus 2px of margin either side, and the flex gap lands on both
 * sides of it rather than the one `centreOf` already counts.
 */
const DIVIDER_OFFSET = 1 + 2 + 2 + 6

function DockItem({
  id,
  active,
  pointerY,
  reduced,
  onSelect
}: {
  id: SectionId
  active: boolean
  pointerY: MotionValue<number>
  reduced: boolean
  onSelect(id: SectionId): void
}) {
  const meta = META[id]
  const index = SECTIONS.indexOf(id)
  const scale = useMagnify(pointerY, centreOf(index), reduced)

  return (
    <Slot
      label={meta.label}
      hint={meta.hint}
      path={meta.path}
      scale={scale}
      active={active}
      onClick={() => onSelect(id)}
      layoutId="dock-active"
    />
  )
}

function DockButton({
  label,
  hint,
  path,
  pointerY,
  reduced,
  onClick
}: {
  label: string
  hint: string
  path: string
  pointerY: MotionValue<number>
  reduced: boolean
  onClick(): void
}) {
  // Sits after the sections and the divider, so its centre is one slot further
  // down plus the divider's own height.
  const scale = useMagnify(
    pointerY,
    centreOf(SECTIONS.length) + DIVIDER_OFFSET,
    reduced
  )

  return (
    <Slot
      label={label}
      hint={hint}
      path={path}
      scale={scale}
      active={false}
      onClick={onClick}
    />
  )
}

function Slot({
  label,
  hint,
  path,
  scale,
  active,
  onClick,
  layoutId
}: {
  label: string
  hint: string
  path: string
  scale: MotionValue<number>
  active: boolean
  onClick(): void
  layoutId?: string
}) {
  // Scale lives on the button, so the tooltip inherits it. Undoing it keeps the
  // label the same size no matter how far the icon has grown.
  const counterScale = useTransform(scale, (s) => 1 / s)

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      // `group` on the button so the tooltip can key off its hover without a
      // second piece of state per icon.
      className="group relative grid shrink-0 place-items-center"
      style={{
        width: SIZE,
        height: SIZE,
        scale,
        // Grows from the middle of the rail outward, so magnifying an icon
        // never shoves its neighbours sideways.
        transformOrigin: 'center'
      }}
      whileTap={{ scale: 0.94 }}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={SPRING.snap}
          className="absolute inset-0 rounded-[14px] border border-white/12 bg-white/10"
        />
      )}

      <svg
        viewBox="0 0 20 20"
        className={cn(
          'relative size-[19px] transition-colors',
          active ? 'text-ink' : 'text-ink-dim group-hover:text-ink'
        )}
        aria-hidden
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* The label, as a tooltip beside the icon rather than under it — a dock
          is vertical, so a label below would collide with the next item. */}
      <motion.span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-10 -translate-y-1/2',
          'whitespace-nowrap rounded-lg border border-white/10 bg-surface/95 px-2 py-1',
          'text-left opacity-0 shadow-lg shadow-black/50 backdrop-blur-xl',
          'transition-opacity duration-150 group-hover:opacity-100'
        )}
        style={{ scale: counterScale, originX: 0 }}
      >
        <span className="block text-[12px] leading-tight text-ink">{label}</span>
        <span className="block text-[10.5px] leading-tight text-ink-faint">
          {hint}
        </span>
      </motion.span>

      {/* The running dot every macOS dock has, borrowed for "you are here". */}
      {active && (
        <motion.span
          layoutId={layoutId ? `${layoutId}-dot` : undefined}
          transition={SPRING.snap}
          className="absolute -left-[3px] top-1/2 size-1 -translate-y-1/2 rounded-full bg-amber"
        />
      )}
    </motion.button>
  )
}
