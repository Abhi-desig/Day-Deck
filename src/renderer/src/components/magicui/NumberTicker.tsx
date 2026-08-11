import { useEffect, useRef } from 'react'
import { useMotionValue, useSpring } from 'motion/react'
import { cn } from '../../lib/cn'

/**
 * Counts up to a value instead of snapping to it.
 *
 * Modelled on Magic UI's NumberTicker (MIT, magicuidesign/magicui). The spring
 * writes straight into `textContent` rather than through React state — a
 * 60fps counter that re-rendered a component tree every frame would be a real
 * cost for a purely decorative effect.
 */
export function NumberTicker({
  value,
  className,
  suffix = ''
}: {
  value: number
  className?: string
  suffix?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const target = useMotionValue(0)
  const spring = useSpring(target, { stiffness: 110, damping: 26, mass: 0.7 })

  useEffect(() => {
    target.set(value)
  }, [value, target])

  useEffect(
    () =>
      spring.on('change', (latest) => {
        if (ref.current) {
          ref.current.textContent = `${Math.round(latest).toLocaleString()}${suffix}`
        }
      }),
    [spring, suffix]
  )

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {`0${suffix}`}
    </span>
  )
}
