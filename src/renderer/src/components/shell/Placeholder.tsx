import { motion } from 'motion/react'
import { AnimatedGroup } from '../motion-primitives/AnimatedGroup'
import { EASE_OUT } from '../../lib/motion'

interface PlaceholderProps {
  title: string
  phase: number
  summary: string
  bullets: string[]
}

/**
 * Honest stub for a section that has not been built yet. It states which phase
 * lands it and what it will do — rather than showing mock UI that looks
 * functional and isn't.
 */
export function Placeholder({
  title,
  phase,
  summary,
  bullets
}: PlaceholderProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-7 pb-8">
      <h1 className="text-[19px] font-medium tracking-[-0.02em]">{title}</h1>

      <div className="mt-8 max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="inline-flex items-center gap-2 rounded-full border border-line-soft px-2.5 py-1"
        >
          <span className="size-1.5 rounded-full bg-amber/60" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Phase {phase}
          </span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06, ease: EASE_OUT }}
          className="mt-4 text-[14px] leading-relaxed text-ink-dim"
        >
          {summary}
        </motion.p>

        <AnimatedGroup
          preset="blur-slide"
          stagger={0.05}
          delay={0.14}
          className="mt-5 space-y-2.5"
        >
          {bullets.map((b) => (
            <div key={b} className="flex gap-2.5">
              <span
                className="mt-[7px] size-1 shrink-0 rounded-full bg-line"
                aria-hidden
              />
              <span className="text-[13px] leading-relaxed text-ink-faint">
                {b}
              </span>
            </div>
          ))}
        </AnimatedGroup>
      </div>
    </div>
  )
}
