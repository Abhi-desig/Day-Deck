import { useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { EASE_OUT } from '../../lib/motion'

/**
 * Crossfades between sibling panels, sliding in the direction of travel.
 *
 * Modelled on Motion-Primitives' TransitionPanel (MIT, ibelick/motion-primitives).
 *
 * The direction-aware offsets have to live in a named `variants` object:
 * Motion only threads `custom` into variants that are functions, so passing a
 * function straight to `initial`/`exit` would silently do nothing.
 */
const BLURRED: Variants = {
  enter: (d: number) => ({ opacity: 0, x: 18 * d, filter: 'blur(4px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (d: number) => ({ opacity: 0, x: -18 * d, filter: 'blur(4px)' })
}

/**
 * `MotionConfig reducedMotion="user"` drops transform and layout animations,
 * but it leaves `filter` alone — Motion does not class blur as movement. It
 * reads as movement, so the blur has to be opted out of by hand.
 */
const PLAIN: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 }
}

interface TransitionPanelProps {
  activeIndex: number
  /** Sign of travel: 1 moving forward through the list, -1 backward. */
  direction?: number
  children: ReactNode[]
  className?: string
}

export function TransitionPanel({
  activeIndex,
  direction = 1,
  children,
  className
}: TransitionPanelProps) {
  return (
    <div className={className}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <Panel key={activeIndex} direction={direction}>
          {children[activeIndex]}
        </Panel>
      </AnimatePresence>
    </div>
  )
}

/**
 * Split out so `settled` resets on its own: the panel is keyed by index inside
 * AnimatePresence, so each section change mounts a fresh one.
 *
 * `ref` is not decoration. `mode="popLayout"` takes the *outgoing* panel out of
 * the flex flow by measuring it and pinning it to `position: absolute`, and it
 * reaches the element by cloning this component with a ref. A function component
 * that quietly drops that ref never gets measured, so `PopChild` reads a zero
 * size and skips the pinning entirely — leaving two `h-full` children in one
 * flex column for the length of the transition. Flexbox shrinks both to half
 * height and the survivor snaps back when the exit finishes, which is the
 * vertical judder that looked like a stuck swipe.
 */
function Panel({
  direction,
  children,
  ref
}: {
  direction: number
  children: ReactNode
  ref?: Ref<HTMLDivElement>
}) {
  const reduced = useReducedMotion()
  const [settled, setSettled] = useState(false)

  return (
    <motion.div
      ref={ref}
      custom={direction}
      // Must be a flex column: every section root sizes itself with `flex-1`,
      // and a plain `h-full` wrapper would collapse them to zero height without
      // rendering anything visibly wrong.
      className="flex h-full w-full min-h-0 flex-col"
      variants={reduced ? PLAIN : BLURRED}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: reduced ? 0 : 0.28, ease: EASE_OUT }}
      // Only the arrival latches. This fires for the exit too, and latching
      // there would pin `filter: none` onto a panel that is in the middle of
      // blurring out — killing the exit half of the crossfade.
      onAnimationComplete={(definition) => {
        if (definition === 'center') setSettled(true)
      }}
      /*
       * `none`, not the `blur(0px)` the animation lands on. *Any* non-none
       * filter makes an element a backdrop root, and this wrapper contains
       * every glass surface in the app — leaving blur(0px) on it permanently
       * means the day cards sample this transparent wrapper instead of the
       * ambient background behind the whole window. Same trap as the deck's
       * peek blur, one level further out.
       */
      style={settled ? { filter: 'none' } : undefined}
    >
      {children}
    </motion.div>
  )
}
