import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { SectionId } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { useDeck } from '../../store/useDeck'
import { useShell } from '../../store/useShell'
import { cn } from '../../lib/cn'
import { LAYER, useHotkeys } from '../../lib/keyboard'
import { EASE_OUT, SPRING } from '../../lib/motion'

interface Command {
  id: string
  label: string
  group: string
  /** Shown right-aligned; purely informational. */
  hint?: string
  /** Extra words to match on that are not in the label. */
  keywords?: string
  run(): void
}

const SECTION_ORDER: Array<{ id: SectionId; label: string; key: string }> = [
  { id: 'today', label: 'Today', key: '1' },
  { id: 'projects', label: 'Projects', key: '2' },
  { id: 'goals', label: 'Goals Admin', key: '3' },
  { id: 'tracker', label: 'Tracker', key: '4' },
  { id: 'storyboards', label: 'Storyboards', key: '5' },
  { id: 'stickers', label: 'Stickers', key: '6' },
  { id: 'settings', label: 'Settings', key: '7' }
]

/**
 * ⌘K.
 *
 * Everything it can do is something a button elsewhere already does — the
 * palette is a faster route to the app, not a second way to reach features that
 * have no home. That is also why each command names its own shortcut where one
 * exists: the palette should teach its way out of being needed.
 */
export function CommandPalette() {
  const open = useShell((s) => s.paletteOpen)
  const setPalette = useShell((s) => s.setPalette)
  const go = useShell((s) => s.go)
  const request = useShell((s) => s.request)
  const setData = useShell((s) => s.setData)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = SECTION_ORDER.map((section) => ({
      id: `go-${section.id}`,
      label: `Go to ${section.label}`,
      group: 'Navigate',
      hint: `⌘${section.key}`,
      run: () => go(section.id)
    }))

    list.push(
      {
        id: 'today-jump',
        label: 'Jump to today',
        group: 'Today',
        hint: '⌘T',
        keywords: 'now current date',
        run: () => {
          go('today')
          useDeck.getState().goToday()
        }
      },
      {
        id: 'today-prev',
        label: 'Previous day',
        group: 'Today',
        hint: '←',
        run: () => {
          go('today')
          useDeck.getState().step(-1)
        }
      },
      {
        id: 'today-next',
        label: 'Next day',
        group: 'Today',
        hint: '→',
        run: () => {
          go('today')
          useDeck.getState().step(1)
        }
      },
      {
        id: 'today-weekly',
        label: 'Weekly tasks',
        group: 'Today',
        keywords: 'repeating amber template',
        run: () => request('weekly', 'today')
      },
      {
        id: 'today-reminders',
        label: 'Reminder notifications',
        group: 'Today',
        keywords: 'notify morning evening brief',
        run: () => request('reminders', 'today')
      },
      {
        id: 'today-tags',
        label: 'Tags and keyword rules',
        group: 'Today',
        keywords: 'tag segment amber keyword cutoff friday label filing',
        run: () => request('tags', 'today')
      },
      {
        id: 'goal-new',
        label: 'New goal from a curriculum',
        group: 'Goals',
        keywords: 'plan generate gemini curriculum',
        run: () => {
          request('newGoal', 'goals')
          useCurriculum.getState().startComposing()
        }
      },
      {
        id: 'board-new',
        label: 'New storyboard',
        group: 'Storyboards',
        keywords: 'board canvas frame prompt segment project',
        run: () => request('newBoard', 'storyboards')
      },
      {
        id: 'sticker-new',
        label: 'New sticker',
        group: 'Stickers',
        keywords: 'note wall paper',
        run: () => request('newSticker', 'stickers')
      },
      {
        id: 'data-panel',
        label: 'Backup and database',
        group: 'Data',
        keywords: 'export import json restore backup file path where launch login',
        run: () => setData(true)
      }
    )

    return list
  }, [go, request, setData])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    // Substring, not fuzzy. The list is short enough that fuzzy matching would
    // only make the ordering harder to predict.
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // The palette mounts and focuses in the same frame the overlay animates
      // in, so typing immediately after ⌘K is never dropped.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // The opener is the one binding that must work while a text field has focus —
  // otherwise ⌘K does nothing whenever the quick-add box happens to be focused,
  // which is most of the time on the Today card.
  useHotkeys(
    [
      {
        combo: 'mod+k',
        allowInInput: true,
        handler: () => setPalette(!useShell.getState().paletteOpen)
      },
      ...SECTION_ORDER.map((section) => ({
        combo: `mod+${section.key}`,
        allowInInput: true,
        handler: () => go(section.id)
      }))
    ],
    { layer: LAYER.app }
  )

  function runActive(): void {
    const command = results[active]
    if (command) command.run()
  }

  useHotkeys(
    [
      { combo: 'escape', allowInInput: true, handler: () => setPalette(false) },
      {
        combo: 'arrowdown',
        allowInInput: true,
        handler: () => setActive((i) => Math.min(i + 1, results.length - 1))
      },
      {
        combo: 'arrowup',
        allowInInput: true,
        handler: () => setActive((i) => Math.max(i - 1, 0))
      },
      { combo: 'enter', allowInInput: true, handler: runActive }
    ],
    { layer: LAYER.palette, enabled: open }
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[500] bg-canvas/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setPalette(false)}
          />

          <motion.div
            className="fixed inset-x-0 top-[18vh] z-[501] mx-auto w-[min(560px,calc(100vw-4rem))]"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={SPRING.snap}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="glass overflow-hidden rounded-2xl border border-white/12 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.8)]">
              <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
                <svg
                  viewBox="0 0 16 16"
                  className="size-4 shrink-0 text-ink-faint"
                  aria-hidden
                >
                  <path
                    d="M7 12a5 5 0 100-10 5 5 0 000 10zM10.5 10.5L14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search commands…"
                  aria-label="Search commands"
                  className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint/60"
                />
                <kbd className="shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                  esc
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
                {results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12.5px] text-ink-faint">
                    Nothing matches “{query}”.
                  </p>
                ) : (
                  results.map((command, i) => {
                    const first =
                      i === 0 || results[i - 1].group !== command.group
                    return (
                      <div key={command.id}>
                        {first && (
                          <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint/60">
                            {command.group}
                          </div>
                        )}
                        <button
                          type="button"
                          data-active={i === active}
                          onMouseMove={() => setActive(i)}
                          onClick={() => command.run()}
                          className={cn(
                            'relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                            i === active ? 'text-ink' : 'text-ink-dim'
                          )}
                        >
                          {i === active && (
                            <motion.span
                              layoutId="palette-active"
                              transition={{ duration: 0.12, ease: EASE_OUT }}
                              className="absolute inset-0 rounded-lg bg-raised"
                            />
                          )}
                          <span className="relative flex-1 text-[13.5px]">
                            {command.label}
                          </span>
                          {command.hint && (
                            <kbd className="relative shrink-0 rounded border border-line-soft px-1.5 py-0.5 text-[10.5px] tabular-nums text-ink-faint">
                              {command.hint}
                            </kbd>
                          )}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
