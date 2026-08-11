import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '../../lib/cn'

/**
 * A highlight that sweeps across text while something is in flight.
 *
 * Modelled on Magic UI's AnimatedShinyText (MIT, magicuidesign/magicui). Theirs
 * drives a CSS keyframe; this drives `background-position` through Motion so
 * the whole app has exactly one animation system and reduced-motion is handled
 * by the global MotionConfig.
 */
export function AnimatedShinyText({
  children,
  className,
  duration = 2.4
}: {
  children: ReactNode
  className?: string
  duration?: number
}) {
  const reduced = useReducedMotion()

  return (
    <motion.span
      className={cn(
        'bg-clip-text text-transparent',
        'bg-[linear-gradient(110deg,var(--color-ink-faint)_38%,var(--color-amber)_50%,var(--color-ink-faint)_62%)]',
        'bg-[length:250%_100%]',
        className
      )}
      // `backgroundPosition` is not a transform, so MotionConfig's reduced-motion
      // pass does not stop it — an endlessly sweeping highlight is exactly the
      // kind of thing the setting exists to switch off, so it is gated here.
      animate={reduced ? undefined : { backgroundPosition: ['180% 0', '-80% 0'] }}
      transition={{ duration, repeat: Infinity, ease: 'linear' }}
    >
      {children}
    </motion.span>
  )
}
