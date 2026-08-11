import { motion } from 'motion/react'
import { EASE_OUT } from '../../lib/motion'
import { cn } from '../../lib/cn'

/**
 * The completion control. The tick is drawn rather than faded in — `pathLength`
 * animates the stroke from nothing to full, which reads as an actual mark being
 * made instead of an icon appearing.
 */
interface CheckDrawProps {
  done: boolean
  onToggle(): void
  disabled?: boolean
  label: string
}

export function CheckDraw({ done, onToggle, disabled, label }: CheckDrawProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={done}
      aria-label={done ? `Mark "${label}" as not done` : `Complete "${label}"`}
      className={cn(
        'group relative grid size-[22px] shrink-0 place-items-center rounded-full',
        'transition-colors duration-200',
        disabled && 'cursor-not-allowed opacity-40'
      )}
      data-no-drag
    >
      <motion.svg
        viewBox="0 0 24 24"
        className="size-[22px] overflow-visible"
        initial={false}
        animate={{ scale: done ? 1 : 1 }}
        whileTap={disabled ? undefined : { scale: 0.86 }}
        transition={{ duration: 0.14 }}
      >
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          strokeWidth="1.75"
          initial={false}
          animate={{
            stroke: done ? 'var(--color-amber)' : 'var(--color-line)',
            // A faint amber wash confirms the state without a solid fill.
            fillOpacity: done ? 0.14 : 0
          }}
          style={{ fill: 'var(--color-amber)' }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
          className="group-hover:stroke-ink-faint"
        />
        <motion.path
          d="M7 12.4 L10.4 15.8 L17 8.6"
          fill="none"
          stroke="var(--color-amber)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
          transition={{
            pathLength: { duration: 0.32, ease: EASE_OUT },
            opacity: { duration: done ? 0.1 : 0.18 }
          }}
        />
      </motion.svg>
    </button>
  )
}
