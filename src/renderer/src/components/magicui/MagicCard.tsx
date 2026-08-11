import type { PointerEvent, ReactNode } from 'react'
import { useCallback, useRef } from 'react'
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring
} from 'motion/react'
import { cn } from '../../lib/cn'
import { SPRING, WORKSPACE } from '../../lib/motion'

/**
 * A card that lights up under the pointer and leans towards it.
 *
 * Two effects from two sources, combined because each fixes the other's
 * weakness: Magic UI's MagicCard (MIT, magicuidesign/magicui) is a radial
 * spotlight that tracks the cursor, and Aceternity's 3D card is a perspective
 * tilt. Spotlight alone is flat; tilt alone has no focal point and reads as a
 * wobble. Together the highlight sits where the surface is turning towards you,
 * which is what makes it look like a lit object rather than an overlay.
 *
 * Everything animates through motion values, so a mouse move never triggers a
 * React render — only a compositor-side transform update.
 */
interface MagicCardProps {
  children: ReactNode
  className?: string
  /** Tint of the spotlight and the border light. Any CSS colour. */
  glow?: string
  /**
   * Mouse convenience only. The card is deliberately *not* a `role="button"`:
   * cards like these hold their own buttons, and an interactive element nested
   * inside another is both invalid and unusable with a screen reader. Callers
   * put the keyboard-accessible action on a real control inside instead.
   */
  onClick?(): void
  /** Forwarded to the tilting inner element for shared-layout transitions. */
  layoutId?: string
}

export function MagicCard({
  children,
  className,
  glow = 'rgb(255 176 32 / 0.5)',
  onClick,
  layoutId
}: MagicCardProps) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  // Pointer position within the card, in px. Drives the spotlight directly.
  const px = useMotionValue(-9999)
  const py = useMotionValue(-9999)
  const lit = useMotionValue(0)

  // Tilt is sprung rather than set directly: the raw pointer delta is jittery
  // at the pixel level, and a stiff spring smooths it without adding lag you
  // can feel.
  const rotateX = useSpring(0, SPRING.snap)
  const rotateY = useSpring(0, SPRING.snap)

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const node = ref.current
      if (!node) return

      const rect = node.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      px.set(x)
      py.set(y)
      lit.set(1)

      if (reduced) return
      // -1..1 from the centre, so the card leans *towards* the cursor.
      const nx = (x / rect.width) * 2 - 1
      const ny = (y / rect.height) * 2 - 1
      rotateY.set(nx * WORKSPACE.maxTilt)
      rotateX.set(-ny * WORKSPACE.maxTilt)
    },
    [lit, px, py, reduced, rotateX, rotateY]
  )

  const onPointerLeave = useCallback(() => {
    lit.set(0)
    rotateX.set(0)
    rotateY.set(0)
  }, [lit, rotateX, rotateY])

  const spotlight = useMotionTemplate`radial-gradient(${WORKSPACE.spotlight}px circle at ${px}px ${py}px, ${glow}, transparent 72%)`

  return (
    // The perspective lives on the wrapper, not the tilting element: a
    // `perspective` on the element itself is applied after its own transform
    // and the lean comes out flat.
    <div
      className="[perspective:1100px]"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <motion.div
        ref={ref}
        layoutId={layoutId}
        transition={SPRING.expand}
        onClick={onClick}
        style={{ rotateX, rotateY }}
        // `z` reads as the card lifting towards you because the wrapper above
        // supplies the perspective. Note there is no `preserve-3d` here: this
        // card clips its content, and any non-visible overflow flattens a 3D
        // context, so depth on the children would silently do nothing.
        whileHover={reduced ? undefined : { z: 24 }}
        whileTap={reduced ? undefined : { scale: 0.985 }}
        className={cn(
          'group/card relative overflow-hidden rounded-card',
          'border border-line-soft glass-flat card-shadow-soft',
          'outline-none focus-within:border-amber/40',
          onClick && 'cursor-pointer',
          className
        )}
      >
        {/* The lit surface. Sits under the content so text stays readable. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          style={{ background: spotlight }}
        />

        {/* A brighter version of the same gradient, masked to the border ring —
            the edge nearest the cursor catches the light. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          style={{
            background: spotlight,
            padding: 1,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude'
          }}
        />

        <div className="relative">{children}</div>
      </motion.div>
    </div>
  )
}
