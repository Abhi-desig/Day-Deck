import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { addDays, formatMinutes, labelFor } from '@shared/date'
import type { Slot, SlotCategory } from '@shared/types'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { derivation, tagStyle } from '../../lib/tagColor'
import { useTags } from '../../store/useTags'
// Jumping to a workspace is app-level navigation, not something the day card
// knows about — so it goes to the store directly rather than being threaded up
// through DayDeck as a callback that every other slot type would ignore.
import { useProjects } from '../../store/useProjects'
import { CheckDraw } from './CheckDraw'
import { TextEffect } from '../motion-primitives/TextEffect'

const CATEGORY_DOT: Record<SlotCategory, string> = {
  vibe_code: 'bg-cat-vibe',
  amber: 'bg-cat-amber',
  personal_learning: 'bg-cat-learn'
}

const SOURCE_TAG: Partial<Record<Slot['source'], string>> = {
  curriculum: 'curriculum',
  amber_weekly: 'weekly',
  project: 'project'
}

interface SlotRowProps {
  slot: Slot
  /** Arrived on this card via rollover during this launch. */
  isFresh?: boolean
  freshIndex?: number
  onToggle(): void
  onDelete(): void
}

export function SlotRow({
  slot,
  isFresh = false,
  freshIndex = 0,
  onToggle,
  onDelete
}: SlotRowProps) {
  const reduced = useReducedMotion()
  const done = slot.status === 'done'
  const tombstoned = slot.status === 'rolled'
  const tag = SOURCE_TAG[slot.source]
  const points = slot.sourcePoints

  // Collapsed by default: the card's job is to show a whole day at a glance,
  // and five tasks each listing five points is a scrollbar, not a day. The
  // count is on the row itself so the breakdown announces that it exists
  // without being opened.
  const [showPoints, setShowPoints] = useState(false)
  // A project slot whose project has since been removed loses its ref, so the
  // row degrades to plain work rather than offering a link to nowhere.
  const isProject = slot.source === 'project' && !!slot.sourceRef

  // Rolled-in work drops in from above, staggered, so the user can see that
  // something was carried rather than finding it silently already in the list.
  const enterTransition = isFresh
    ? { ...SPRING.soft, delay: 0.12 + freshIndex * 0.06 }
    : SPRING.soft

  const originWeekday = labelFor(
    addDays(slot.date, -Math.max(1, slot.rollCount))
  ).weekday.slice(0, 3)

  return (
    <motion.div
      layout="position"
      // Blur is gated by hand — the global reduced-motion pass covers the y
      // offset but not the filter.
      initial={
        isFresh
          ? reduced
            ? { opacity: 0 }
            : { opacity: 0, y: -20, filter: 'blur(6px)' }
          : false
      }
      animate={
        reduced
          ? { opacity: 1 }
          : { opacity: 1, y: 0, filter: 'blur(0px)' }
      }
      exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
      transition={enterTransition}
      className={cn(
        'group/slot relative flex items-start gap-3 rounded-slot px-3 py-2.5',
        'transition-colors duration-200',
        !tombstoned && 'hover:bg-raised/70',
        tombstoned && 'opacity-40'
      )}
    >
      <div className="pt-px">
        <CheckDraw
          done={done}
          onToggle={onToggle}
          disabled={tombstoned}
          label={slot.title}
        />
      </div>

      <div className="min-w-0 flex-1">
        <span className="relative inline-block max-w-full">
          <span
            className={cn(
              'text-[14.5px] leading-6 tracking-[-0.01em]',
              done || tombstoned ? 'text-ink-faint' : 'text-ink'
            )}
          >
            {slot.title}
          </span>
          {/* Struck through by drawing a line across, not by toggling a style. */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-0 top-1/2 h-px w-full origin-left bg-ink-faint"
            initial={false}
            animate={{ scaleX: done || tombstoned ? 1 : 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
          />
        </span>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-faint">
          <span
            className={cn(
              'size-1.5 rounded-full',
              // Curriculum work wears its goal's colour, so a day holding three
              // plans can be read at a glance.
              slot.sourceLabel
                ? goalStyle(slot.sourceColor).dot
                : CATEGORY_DOT[slot.category]
            )}
          />
          <span className="tabular-nums">
            {slot.startMin === null ? 'anytime' : formatMinutes(slot.startMin)}
          </span>
          <span className="text-line">·</span>
          <span className="tabular-nums">{slot.durationMin}m</span>

          {/* The goal's or project's own name beats a generic tag. For a
              project it is also the way in: one click opens the workspace. */}
          {slot.sourceLabel ? (
            isProject ? (
              <button
                type="button"
                data-no-drag
                onClick={() => useProjects.getState().open(slot.sourceRef as string)}
                title={`Open ${slot.sourceLabel} workspace`}
                className={cn(
                  'inline-flex max-w-[170px] items-center gap-1 rounded-full border px-1.5 py-px text-[10px]',
                  'transition-colors hover:bg-white/5',
                  goalStyle(slot.sourceColor).border,
                  goalStyle(slot.sourceColor).text
                )}
              >
                <span className="truncate">{slot.sourceLabel}</span>
                <svg viewBox="0 0 12 12" className="size-2.5 shrink-0" aria-hidden>
                  <path
                    d="M4.5 3L7.5 6l-3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : (
              <span
                className={cn(
                  'max-w-[150px] truncate rounded-full border px-1.5 py-px text-[10px]',
                  goalStyle(slot.sourceColor).border,
                  goalStyle(slot.sourceColor).text
                )}
                title={slot.sourceLabel}
              >
                {slot.sourceLabel}
              </span>
            )
          ) : (
            tag && (
              <span className="rounded-full border border-line-soft px-1.5 py-px text-[10px] uppercase tracking-wide">
                {tag}
              </span>
            )
          )}

          {slot.rollCount > 0 && !tombstoned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-1.5 py-px text-[10.5px] text-amber-soft">
              <span aria-hidden>↷</span>
              {isFresh ? (
                <TextEffect
                  by="word"
                  stagger={0.04}
                  delay={0.35 + freshIndex * 0.06}
                  replayKey={slot.id}
                >
                  {`carried from ${originWeekday}`}
                </TextEffect>
              ) : (
                <span>carried ×{slot.rollCount}</span>
              )}
            </span>
          )}

          {tombstoned && <span className="italic">moved forward</span>}

          {!tombstoned && <TagChips slot={slot} />}

          {points.length > 0 && (
            <button
              type="button"
              data-no-drag
              onClick={() => setShowPoints((v) => !v)}
              aria-expanded={showPoints}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px]',
                'transition-colors hover:bg-raised hover:text-ink-dim',
                showPoints && 'text-ink-dim'
              )}
            >
              <motion.svg
                viewBox="0 0 12 12"
                className="size-2.5"
                aria-hidden
                initial={false}
                animate={{ rotate: showPoints ? 90 : 0 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
              >
                <path
                  d="M4.5 3L7.5 6l-3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </motion.svg>
              {points.length} learning {points.length === 1 ? 'point' : 'points'}
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {showPoints && points.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING.soft}
              className="overflow-hidden"
            >
              <div className="mt-1.5 space-y-1 border-l border-line-soft pl-2.5">
                {points.map((point, i) => (
                  <motion.li
                    // Index-qualified: nothing stops a model returning the same
                    // phrase twice, and a duplicate key drops the second one.
                    key={`${i}-${point}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.22,
                      ease: EASE_OUT,
                      delay: i * 0.035
                    }}
                    className={cn(
                      'flex items-start gap-2 text-[12px] leading-snug',
                      done || tombstoned ? 'text-ink-faint/70' : 'text-ink-dim'
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-[6px] size-1 shrink-0 rounded-full',
                        slot.sourceColor
                          ? goalStyle(slot.sourceColor).dot
                          : 'bg-line'
                      )}
                    />
                    {point}
                  </motion.li>
                ))}
              </div>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {!tombstoned && (
        <button
          type="button"
          onClick={onDelete}
          data-no-drag
          aria-label={`Delete "${slot.title}"`}
          className={cn(
            'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-ink-faint',
            'opacity-0 transition-all duration-150 group-hover/slot:opacity-100',
            'hover:bg-line hover:text-ink'
          )}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </motion.div>
  )
}

/**
 * The tags on a row, plus the way to change them.
 *
 * Each chip states its own derivation on hover — "matched 'amber'" versus
 * "added by hand" — because a tag that appeared without being asked for needs
 * to be able to explain itself, or automatic filing reads as the app guessing.
 * Clicking a chip removes that tag outright, including one the keyword rules
 * put there: the rules are a default, not a verdict.
 */
function TagChips({ slot }: { slot: Slot }) {
  const all = useTags((s) => s.tags)
  const attach = useTags((s) => s.attach)
  const detach = useTags((s) => s.detach)
  const [picking, setPicking] = useState(false)

  const attached = new Set(slot.tags.map((t) => t.id))
  const available = all.filter((t) => !attached.has(t.id))

  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {slot.tags.map((tag) => (
          <motion.button
            key={tag.id}
            layout
            type="button"
            data-no-drag
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
            onClick={() => void detach(slot.id, tag.id, slot.date)}
            title={`${tag.label} — ${derivation(tag.origin, tag.matched)}. Click to remove.`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]',
              'transition-colors hover:bg-white/8',
              tagStyle(tag.color).border,
              tagStyle(tag.color).text
            )}
          >
            <span className={cn('size-1 rounded-full', tagStyle(tag.color).dot)} />
            {tag.label}
          </motion.button>
        ))}
      </AnimatePresence>

      {available.length > 0 && (
        <span className="relative inline-flex">
          <button
            type="button"
            data-no-drag
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            aria-label="Add a tag"
            className={cn(
              'grid size-4 place-items-center rounded-full border border-line-soft text-[10px]',
              'opacity-0 transition-all duration-150 group-hover/slot:opacity-100',
              'hover:border-line hover:text-ink',
              picking && 'opacity-100 text-ink'
            )}
          >
            +
          </button>

          <AnimatePresence>
            {picking && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={{ duration: 0.14, ease: EASE_OUT }}
                // Above the card's own stacking, or the menu opens behind the
                // next row down.
                className={cn(
                  'absolute left-0 top-5 z-50 flex min-w-[130px] flex-col gap-0.5',
                  'rounded-lg border border-line-soft bg-surface p-1 shadow-lg shadow-black/50'
                )}
              >
                {available.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    data-no-drag
                    onClick={() => {
                      setPicking(false)
                      void attach(slot.id, tag.id, slot.date)
                    }}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] text-ink-dim transition-colors hover:bg-raised hover:text-ink"
                  >
                    <span
                      className={cn('size-1.5 rounded-full', tagStyle(tag.color).dot)}
                    />
                    {tag.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </span>
      )}
    </>
  )
}
