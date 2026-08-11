import { motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '../../lib/motion'
import { cn } from '../../lib/cn'

/**
 * Per-word or per-character reveal.
 *
 * Modelled on Motion-Primitives' TextEffect (MIT, ibelick/motion-primitives).
 * Splitting on words rather than characters by default — character reveals on a
 * long string produce hundreds of animated nodes for very little extra effect.
 */
interface TextEffectProps {
  children: string
  by?: 'word' | 'char'
  className?: string
  stagger?: number
  delay?: number
  /** Re-runs the reveal whenever this changes. */
  replayKey?: string | number
}

export function TextEffect({
  children,
  by = 'word',
  className,
  stagger = 0.03,
  delay = 0,
  replayKey
}: TextEffectProps) {
  const pieces =
    by === 'word' ? children.split(/(\s+)/) : Array.from(children)
  const reduced = useReducedMotion()

  return (
    <motion.span
      key={replayKey}
      className={cn('inline-block', className)}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay }
        }
      }}
      aria-label={children}
    >
      {pieces.map((piece, i) =>
        /^\s+$/.test(piece) ? (
          <span key={i}>{piece}</span>
        ) : (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block"
            // Blur is opted out of by hand: MotionConfig's reduced-motion pass
            // drops transforms and layout, but not filters.
            variants={
              reduced
                ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
                : {
                    hidden: { opacity: 0, y: 6, filter: 'blur(3px)' },
                    visible: { opacity: 1, y: 0, filter: 'blur(0px)' }
                  }
            }
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            {piece}
          </motion.span>
        )
      )}
    </motion.span>
  )
}
