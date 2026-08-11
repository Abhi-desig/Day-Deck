import type { ReactNode } from 'react'
import { Children } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import { EASE_OUT } from '../../lib/motion'

/**
 * Staggered entrance for a list of children.
 *
 * Modelled on Motion-Primitives' AnimatedGroup (MIT, ibelick/motion-primitives)
 * and reimplemented here against our own motion tokens so presets stay in sync
 * with the rest of the app.
 */
export type GroupPreset = 'fade' | 'blur-slide' | 'rise' | 'scale'

const PRESETS: Record<GroupPreset, Variants> = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 }
  },
  'blur-slide': {
    hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' }
  },
  rise: {
    hidden: { opacity: 0, y: 14 },
    visible: { opacity: 1, y: 0 }
  },
  scale: {
    hidden: { opacity: 0, scale: 0.94 },
    visible: { opacity: 1, scale: 1 }
  }
}

interface AnimatedGroupProps {
  children: ReactNode
  className?: string
  itemClassName?: string
  preset?: GroupPreset
  stagger?: number
  delay?: number
  duration?: number
}

export function AnimatedGroup({
  children,
  className,
  itemClassName,
  preset = 'fade',
  stagger = 0.045,
  delay = 0,
  duration = 0.38
}: AnimatedGroupProps) {
  const reduced = useReducedMotion()
  // Transforms are handled globally by MotionConfig; blur is not, so a preset
  // that carries one falls back to the plain fade.
  const item = reduced ? PRESETS.fade : PRESETS[preset]

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay }
        }
      }}
    >
      {Children.map(children, (child, i) => (
        <motion.div
          key={i}
          className={itemClassName}
          variants={item}
          transition={{ duration, ease: EASE_OUT }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  )
}
