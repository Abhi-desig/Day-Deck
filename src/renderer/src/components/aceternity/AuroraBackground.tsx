import { motion } from 'motion/react'
import { cn } from '../../lib/cn'

/**
 * Slow coloured washes drifting behind a panel.
 *
 * Modelled on Aceternity UI's AuroraBackground. Aceternity's installer expects
 * a Tailwind v3 `tailwind.config.js`, which this project does not have — so
 * this is a hand-ported version using our v4 `@theme` colours and transform-only
 * animation, which stays off the main thread.
 */
interface Blob {
  color: string
  className: string
  /** Mutable arrays on purpose — Motion's keyframe type rejects readonly. */
  drift: { x: number[]; y: number[] }
  duration: number
}

const BLOBS: Blob[] = [
  {
    color: 'var(--aurora-1)',
    className: '-top-40 left-[6%] size-[560px]',
    drift: { x: [0, 70, -30, 0], y: [0, 45, 25, 0] },
    duration: 28
  },
  {
    color: 'var(--aurora-2)',
    className: 'top-[18%] right-[2%] size-[480px]',
    drift: { x: [0, -60, 25, 0], y: [0, 35, -20, 0] },
    duration: 34
  },
  {
    color: 'var(--aurora-3)',
    className: 'bottom-[-18%] left-[32%] size-[520px]',
    drift: { x: [0, 40, -45, 0], y: [0, -30, 15, 0] },
    duration: 41
  }
]

export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
      aria-hidden
    >
      {BLOBS.map((blob, i) => (
        <motion.div
          key={i}
          className={cn('absolute rounded-full blur-[110px]', blob.className)}
          style={{
            background: `radial-gradient(circle, ${blob.color}, transparent 68%)`
          }}
          animate={blob.drift}
          transition={{
            duration: blob.duration,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      ))}
    </div>
  )
}
