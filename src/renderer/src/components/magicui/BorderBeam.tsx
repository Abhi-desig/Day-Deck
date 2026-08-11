import { motion, useReducedMotion } from 'motion/react'
import { cn } from '../../lib/cn'

/**
 * The light that travels around today's card — the app's one persistent
 * "you are here".
 *
 * Descended from Magic UI's BorderBeam (MIT, magicuidesign/magicui), but not
 * its implementation. That one walks a small square along an `offset-path`
 * rect, which on a large card reads as a glowing blob sliding around rather
 * than a beam, and clips awkwardly at the corners.
 *
 * Instead: a conic gradient the size of the card's diagonal spins behind a
 * border-shaped mask. Only the ring survives the mask, so the visible result is
 * a hairline whose brightness sweeps around the perimeter — even thickness the
 * whole way, corners included. The animation is a plain `rotate`, so it runs on
 * the compositor and never touches the main thread mid-drag.
 *
 * The parent must be `relative` with a border radius.
 */
interface BorderBeamProps {
  /** Seconds for one full lap. */
  duration?: number
  delay?: number
  /** Ring thickness in px. Above ~2 it stops reading as a hairline. */
  thickness?: number
  className?: string
}

/*
 * Most of the sweep is empty. The light is a long, faint tail that ramps into a
 * short hot head — that asymmetry is what makes it read as something moving
 * rather than a border that pulses.
 */
const SWEEP = `conic-gradient(
  from 0deg,
  transparent 0deg 200deg,
  rgb(255 176 32 / 0.18) 268deg,
  rgb(255 201 95 / 0.62) 322deg,
  #ffe9b8 348deg,
  #fffaf0 355deg,
  transparent 360deg
)`

export function BorderBeam({
  duration = 6,
  delay = 0,
  thickness = 1.25,
  className
}: BorderBeamProps) {
  const reduced = useReducedMotion()

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
      aria-hidden
    >
      {/* Just enough warmth to tell today's card apart when the beam is on the
          far side. Any stronger and it stops being a beam and starts being a
          highlighted rectangle. */}
      <div className="absolute inset-0 rounded-[inherit] border border-amber/14" />

      {!reduced && (
        <div
          className="absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{
            padding: thickness,
            // XOR the content box out of the border box: what is left is the
            // ring, and border-radius rounds both boxes, so the thickness stays
            // constant around the corners.
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude'
          }}
        >
          <motion.div
            className={cn(
              'absolute left-1/2 top-1/2 aspect-square w-[165%]',
              '-translate-x-1/2 -translate-y-1/2',
              className
            )}
            style={{ background: SWEEP }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, ease: 'linear', duration, delay }}
          />
        </div>
      )}
    </div>
  )
}
