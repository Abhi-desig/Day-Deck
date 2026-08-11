import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type PanInfo
} from 'motion/react'
import type { DateKey } from '@shared/date'
import { addDays, diffDays } from '@shared/date'
import { useDeck } from '../../store/useDeck'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { DECK, SPRING } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { DayCard } from './DayCard'

const CARD_W = 560
/** Centre-to-centre distance between adjacent cards. */
const SPREAD = 624
const OFFSETS = [-2, -1, 0, 1, 2] as const

/** Drags that begin on these never move the deck. */
const INTERACTIVE = 'input, textarea, button, a, select, [data-no-drag]'

// Depth ramps, read off the single peek table rather than restated here. Widened
// to number[] because DECK is `as const`, and the literal element types it
// infers do not satisfy useTransform's MotionValue<number> output.
const DEPTHS: number[] = [0, 1, 2]
const PEEK_SCALE: number[] = DECK.peek.map((p) => p.scale)
const PEEK_Y: number[] = DECK.peek.map((p) => p.y)
const PEEK_BLUR: number[] = DECK.peek.map((p) => p.blur)
// The extra stop fades the outermost card out entirely as it leaves, so cards
// do not pop out of existence at the edge of the mounted window.
const FADE_DEPTHS: number[] = [...DEPTHS, 2.5]
const PEEK_OPACITY: number[] = [...DECK.peek.map((p) => p.opacity), 0]

export function DayDeck() {
  const focused = useDeck((s) => s.focused)
  const step = useDeck((s) => s.step)
  const focus = useDeck((s) => s.focus)
  const today = useDeck((s) => s.today)
  const acknowledgeRolls = useDeck((s) => s.acknowledgeRolls)

  const dragX = useMotionValue(0)
  /**
   * 1 whenever the deck is in motion — dragging *or* springing back.
   *
   * It used to only cover the drag, which meant every wheel swipe and every
   * post-release settle animated four blurred layers. Blur is the one property
   * here that costs a full-surface repaint per frame, so the cheap phase of the
   * gesture was fast and the visible phase was not.
   */
  const moving = useMotionValue(0)
  const controls = useDragControls()
  const reduced = useReducedMotion()
  const movedRef = useRef(false)
  const settleRef = useRef<AnimationPlaybackControls | null>(null)

  // Memoised so `commit` keeps a stable identity — otherwise the key handler
  // below tears itself down and rebuilds on every single render.
  const settle = useMemo(
    () => (reduced ? { duration: 0 } : SPRING.deck),
    [reduced]
  )

  /**
   * Spring `dragX` home, holding the deck in its "moving" state until it
   * actually arrives. Any in-flight settle is stopped first so a fast second
   * swipe cannot have the previous animation's completion clear the flag out
   * from under it.
   */
  const settleHome = useCallback(() => {
    settleRef.current?.stop()
    moving.set(1)
    settleRef.current = animate(dragX, 0, {
      ...settle,
      onComplete: () => moving.set(0)
    })
  }, [dragX, moving, settle])

  useEffect(() => () => settleRef.current?.stop(), [])

  /**
   * Advancing the deck is a two-part move: shift `dragX` by exactly one card
   * width *before* the focus changes, then let it spring back to zero. The
   * cards' static `x` jumps by a card width when the offsets shift, and this
   * pre-offset cancels that jump — so a keypress, a flick and a trackpad swipe
   * all produce the identical continuous motion.
   */
  const commit = useCallback(
    (delta: number) => {
      if (delta === 0) return
      dragX.set(dragX.get() + SPREAD * delta)
      step(delta)
      settleHome()
    },
    [dragX, step, settleHome]
  )

  const goto = useCallback(
    (date: DateKey) => {
      const delta = diffDays(focused, date)
      // Anything further than a few days is a jump, not a swipe — sliding
      // through 200 intermediate cards would just be a blur.
      if (Math.abs(delta) <= 3) commit(delta)
      else focus(date)
    },
    [commit, focus, focused]
  )

  // The typing guard used to be a hand-rolled `closest('input')` check here;
  // it now lives in lib/keyboard so every binding in the app shares one
  // definition of "the user is writing something".
  useHotkeys(
    [
      { combo: 'arrowleft', handler: () => commit(-1) },
      { combo: 'arrowright', handler: () => commit(1) },
      { combo: 'mod+t', handler: () => goto(today) }
    ],
    { layer: LAYER.section }
  )

  // The rollover "arrival" animation plays once; after that these are just
  // ordinary carried tasks.
  useEffect(() => {
    const timer = window.setTimeout(() => acknowledgeRolls(), 2600)
    return () => window.clearTimeout(timer)
  }, [acknowledgeRolls])

  const wheelAccum = useRef(0)
  const wheelSpent = useRef(false)
  const wheelIdle = useRef(0)
  const wheelPrev = useRef(0)
  const wheelFalling = useRef(false)

  useEffect(() => () => window.clearTimeout(wheelIdle.current), [])

  /**
   * One physical swipe must move exactly one day.
   *
   * A macOS trackpad keeps firing momentum `deltaX` for a second or more after
   * the fingers lift, so a fixed unlock timer expires *inside* the same flick
   * and the leftover momentum commits a second day. The latch is therefore tied
   * to the gesture, not the clock: once a swipe has been spent, every further
   * event is swallowed until the wheel has been quiet long enough for the
   * momentum tail to have ended.
   *
   * That alone makes deliberate consecutive swipes feel broken — the second one
   * lands inside the first one's tail and vanishes. So the latch also watches
   * the delta's shape.
   *
   * The discriminator is the falling edge, not raw magnitude. We commit as soon
   * as the threshold is crossed, which is usually while the fingers are still
   * accelerating, so deltas keep *rising* for a few frames afterwards — reading
   * any jump as a new gesture would double-advance on a single hard flick.
   * Momentum, by contrast, only ever decays. So a new swipe is only recognised
   * once the tail has actually started falling and a delta then jumps back up.
   */
  function onWheel(e: React.WheelEvent) {
    // Vertical intent belongs to the timeline's own scroller.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return

    const magnitude = Math.abs(e.deltaX)

    window.clearTimeout(wheelIdle.current)
    wheelIdle.current = window.setTimeout(() => {
      wheelSpent.current = false
      wheelFalling.current = false
      wheelAccum.current = 0
      wheelPrev.current = 0
    }, DECK.wheelIdleMs)

    if (wheelSpent.current) {
      const previous = wheelPrev.current
      wheelPrev.current = magnitude
      if (magnitude < previous) wheelFalling.current = true

      const restarted =
        wheelFalling.current &&
        magnitude > previous * DECK.wheelRestartRatio &&
        magnitude > DECK.wheelFloor
      if (!restarted) return

      wheelSpent.current = false
      wheelFalling.current = false
      wheelAccum.current = 0
    }

    wheelPrev.current = magnitude
    wheelAccum.current += e.deltaX
    if (Math.abs(wheelAccum.current) < DECK.wheelThreshold) return

    commit(wheelAccum.current > 0 ? 1 : -1)
    wheelAccum.current = 0
    wheelSpent.current = true
    wheelFalling.current = false
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = e.target as HTMLElement | null
    if (el?.closest(INTERACTIVE)) return
    movedRef.current = false
    // Stop any settle still running so the card is glued to the finger from the
    // first frame instead of finishing the previous swipe underneath it.
    settleRef.current?.stop()
    moving.set(1)
    controls.start(e)

    // A press that never became a drag has no `onDragEnd` to clear the flag,
    // and the deck would sit un-blurred forever. Listening on the window rather
    // than the card covers a release that happens off the element.
    const release = (): void => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      if (!movedRef.current) moving.set(0)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  }

  function onDragEnd(_e: unknown, info: PanInfo) {
    const far = Math.abs(info.offset.x) > SPREAD * DECK.commitRatio
    const flick = Math.abs(info.velocity.x) > DECK.commitVelocity

    if (far || flick) commit(info.offset.x < 0 ? 1 : -1)
    else settleHome()
  }

  return (
    <div
      className="relative flex-1 overflow-hidden"
      onWheel={onWheel}
      role="region"
      aria-label="Day deck"
    >
      <motion.div
        className="absolute inset-0"
        drag="x"
        dragListener={false}
        dragControls={controls}
        dragMomentum={false}
        dragElastic={1}
        style={{ x: dragX }}
        onPointerDown={onPointerDown}
        onDragStart={() => {
          movedRef.current = true
        }}
        onDragEnd={onDragEnd}
      >
        {OFFSETS.map((offset) => {
          const date = addDays(focused, offset)
          return (
            <DeckSlot
              key={date}
              date={date}
              offset={offset}
              dragX={dragX}
              moving={moving}
              onSelect={() => {
                if (!movedRef.current) goto(date)
              }}
            />
          )
        })}
      </motion.div>

      <DeckControls
        onPrev={() => commit(-1)}
        onNext={() => commit(1)}
        onToday={() => goto(today)}
        isToday={focused === today}
      />
    </div>
  )
}

interface DeckSlotProps {
  date: DateKey
  offset: number
  dragX: MotionValue<number>
  moving: MotionValue<number>
  onSelect(): void
}

function DeckSlot({ date, offset, dragX, moving, onSelect }: DeckSlotProps) {
  const active = offset === 0

  // Continuous distance from centre, in card widths. Everything the peek
  // treatment does is a function of this one number, so the whole stack stays
  // glued to the finger instead of animating in discrete steps.
  const signed = useTransform(dragX, (v) => offset + v / SPREAD)
  const depth = useTransform(signed, Math.abs)

  const scale = useTransform(depth, DEPTHS, PEEK_SCALE)
  const y = useTransform(depth, DEPTHS, PEEK_Y)
  const opacity = useTransform(depth, FADE_DEPTHS, PEEK_OPACITY)
  const rotate = useTransform(signed, [-1.6, 0, 1.6], [-6, 0, 6])
  const zIndex = useTransform(depth, (d) => Math.round(100 - d * 10))

  const blur = useTransform(depth, DEPTHS, PEEK_BLUR)

  // Blur is the one expensive property here — a full-surface repaint per frame,
  // times four peek cards — so it is switched off for the entire time the deck
  // is in motion, not just while a finger is down. It is driven by a motion
  // value so toggling it never triggers a React render mid-gesture.
  //
  // `none`, not `blur(0px)`: any non-none filter makes the element a *backdrop
  // root*, and the focused card's glass would then have nothing behind it to
  // sample. That is also why the focused card opts out of this entirely.
  const filter = useTransform([blur, moving], (input) => {
    const [px, inMotion] = input as [number, number]
    if (inMotion || px < 0.05) return 'none'
    return `blur(${px.toFixed(2)}px)`
  })

  return (
    // Centring is done with flex rather than a -50% translate, because `y`
    // already owns the translateY channel for the peek offset.
    <motion.div
      className={cn(
        'absolute inset-y-0 left-1/2 flex items-center',
        !active && 'cursor-pointer'
      )}
      style={{
        width: CARD_W,
        marginLeft: -CARD_W / 2,
        x: offset * SPREAD,
        y,
        scale,
        rotate,
        opacity,
        filter: active ? 'none' : filter,
        zIndex
      }}
      onClick={active ? undefined : onSelect}
    >
      <div className="h-[min(620px,calc(100%-2.5rem))] w-full">
        <DayCard date={date} active={active} />
      </div>
    </motion.div>
  )
}

function DeckControls({
  onPrev,
  onNext,
  onToday,
  isToday
}: {
  onPrev(): void
  onNext(): void
  onToday(): void
  isToday: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-[200] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-surface/55 p-1 shadow-lg shadow-black/40 backdrop-blur-xl">
        <ArrowButton direction="prev" onClick={onPrev} />
        <motion.button
          type="button"
          onClick={onToday}
          whileTap={{ scale: 0.95 }}
          disabled={isToday}
          data-no-drag
          className={cn(
            'rounded-full px-3 py-1 text-[11.5px] transition-colors',
            isToday
              ? 'text-ink-faint/60'
              : 'text-amber-soft hover:bg-amber/12'
          )}
        >
          Today
        </motion.button>
        <ArrowButton direction="next" onClick={onNext} />
      </div>
    </div>
  )
}

function ArrowButton({
  direction,
  onClick
}: {
  direction: 'prev' | 'next'
  onClick(): void
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      data-no-drag
      aria-label={direction === 'prev' ? 'Previous day' : 'Next day'}
      className="grid size-7 place-items-center rounded-full text-ink-dim transition-colors hover:bg-raised hover:text-ink"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <path
          d={direction === 'prev' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  )
}
