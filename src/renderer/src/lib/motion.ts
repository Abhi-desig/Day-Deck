import type { Transition } from 'motion/react'

/**
 * Every duration and spring in Day Deck resolves here. If a component hardcodes
 * a number, the reduced-motion pass and the feel of the whole app drift apart.
 */
export const SPRING = {
  /**
   * Card settling after a swipe.
   *
   * Tuned to sit just on the critically-damped line (ζ ≈ 1.0) at a high natural
   * frequency: no overshoot, and the card is visually at rest in roughly half
   * the time the earlier softer spring took. The deck is the one surface where
   * settle time reads directly as lag, because the next swipe usually starts
   * before the eye has stopped tracking the last one.
   */
  deck: { type: 'spring', stiffness: 620, damping: 42, mass: 0.7 },
  /** Snap-back and drop gestures — quick and decisive. */
  snap: { type: 'spring', stiffness: 520, damping: 34 },
  /** Layout and size changes — softer, reads as "settling". */
  soft: { type: 'spring', stiffness: 220, damping: 26 },
  /**
   * The card→workspace expand. Slower and heavier than `soft` on purpose: it
   * is the largest movement in the app and the one the eye is meant to follow,
   * so it needs time to read as one object growing rather than a cut.
   */
  expand: { type: 'spring', stiffness: 180, damping: 28, mass: 1.05 }
} satisfies Record<string, Transition>

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const DECK = {
  /**
   * Fraction of card width past which a release commits the swipe.
   *
   * Low on purpose. Past about a fifth of a card the user has unambiguously
   * decided which way they are going, and making them drag a third of the way
   * across is what made the deck feel heavy — the gesture was already over
   * before the app agreed it had happened.
   */
  commitRatio: 0.16,
  /** px/s flick speed that commits regardless of distance. */
  commitVelocity: 260,
  maxRotate: 9,
  /** How many cards either side of the focused one stay mounted. */
  visibleRadius: 2,
  /** Per-depth peek treatment: index 0 is the focused card. */
  peek: [
    { scale: 1, y: 0, blur: 0, opacity: 1 },
    { scale: 0.945, y: 16, blur: 1, opacity: 0.72 },
    { scale: 0.89, y: 30, blur: 1.6, opacity: 0.4 }
  ],
  /**
   * Trackpad swipe detection.
   *
   * `wheelThreshold` is the horizontal distance that counts as intent — small,
   * because a trackpad flick delivers it within a frame or two and anything
   * larger shows up as a delay before the card moves at all.
   *
   * `wheelIdleMs` is how long the wheel must be quiet before another swipe is
   * allowed, which exists only to swallow macOS's momentum tail.
   *
   * `wheelRestartRatio` is the escape hatch from that latch: momentum only ever
   * decays, so a delta that jumps back up by this factor is fingers back on the
   * glass, and the latch releases immediately rather than eating the swipe.
   */
  wheelThreshold: 26,
  wheelIdleMs: 120,
  wheelRestartRatio: 2,
  /** Below this a delta is jitter, never the start of a gesture. */
  wheelFloor: 18
} as const

export const STAGGER = {
  timeline: 0.045,
  nav: 0.03,
  grid: 0.04
} as const

export const WORKSPACE = {
  /** Editor's share of the split, and the range the resizer allows. */
  defaultSplit: 0.62,
  minSplit: 0.15,
  maxSplit: 0.9,
  /** Degrees of tilt at the far corner of a project card. */
  maxTilt: 7,
  /** Radius of the pointer spotlight on a card, in px. */
  spotlight: 260
} as const
