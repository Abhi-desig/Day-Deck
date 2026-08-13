import type { ReactNode, Ref } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { EASE_OUT } from '../../lib/motion'

/**
 * Crossfades between sibling panels, sliding in the direction of travel.
 *
 * Modelled on Motion-Primitives' TransitionPanel (MIT, ibelick/motion-primitives).
 *
 * The direction-aware offsets have to live in a named `variants` object:
 * Motion only threads `custom` into variants that are functions, so passing a
 * function straight to `initial`/`exit` would silently do nothing.
 *
 * Slide and fade only — deliberately no blur. An earlier version blurred the
 * panels through the crossfade and tried to strip the filter once the arrival
 * settled, because *any* non-none filter makes an element a backdrop root and
 * this wrapper contains every glass surface in a section. That strip could not
 * work: Motion re-applies its own animated values over the React `style` prop
 * on each render, so the wrapper kept `filter: blur(0px)` for the lifetime of
 * the section and the Today slide-overs' `backdrop-filter` sampled an empty
 * root. Not animating `filter` at all is the only version of this that keeps
 * `.glass` working — see the note on `.glass` in styles/globals.css.
 */
const SLIDE: Variants = {
  enter: (d: number) => ({ opacity: 0, x: 18 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -18 * d })
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
  return (
    <motion.div
      ref={ref}
      custom={direction}
      // Must be a flex column: every section root sizes itself with `flex-1`,
      // and a plain `h-full` wrapper would collapse them to zero height without
      // rendering anything visibly wrong.
      className="flex h-full w-full min-h-0 flex-col"
      variants={SLIDE}
      initial="enter"
      animate="center"
      exit="exit"
      // `reducedMotion="user"` on the app's MotionConfig drops the x offset by
      // itself when the OS asks, leaving the plain crossfade.
      transition={{ duration: 0.28, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}
