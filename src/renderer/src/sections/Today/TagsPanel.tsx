import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Tag, TagColor } from '@shared/types'
import { TAG_COLORS } from '@shared/types'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { tagStyle, weekdayName } from '../../lib/tagColor'
import { useTags } from '../../store/useTags'
import { AnimatedGroup } from '../../components/motion-primitives/AnimatedGroup'

/** Friday, because that is what a week is usually measured against. */
const DEFAULT_DUE = 5

interface TagsPanelProps {
  open: boolean
  onClose(): void
}

export function TagsPanel({ open, onClose }: TagsPanelProps) {
  const tags = useTags((s) => s.tags)
  const ready = useTags((s) => s.ready)
  const error = useTags((s) => s.error)
  const load = useTags((s) => s.load)
  const add = useTags((s) => s.add)
  const dismissError = useTags((s) => s.dismissError)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && !ready) void load()
  }, [open, ready, load])

  async function create(): Promise<void> {
    const label = draft.trim()
    if (!label || busy) return
    setBusy(true)
    try {
      // The colour rotates so a new tag is distinguishable from its neighbours
      // without being asked to pick one first; it is editable straight after.
      const created = await add({
        label,
        color: TAG_COLORS[tags.length % TAG_COLORS.length],
        keywords: [],
        dueWeekday: DEFAULT_DUE
      })
      if (created) setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-[300] bg-canvas/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.aside
            className="glass absolute inset-y-0 right-0 z-[301] flex w-[420px] flex-col border-l border-white/10 shadow-[-24px_0_60px_-20px_rgb(0_0_0/0.7)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={SPRING.snap}
            aria-label="Tags"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
              <div>
                <h2 className="text-[14px] tracking-[-0.01em]">Tags</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Segments that file themselves.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
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
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 rounded-lg border border-line-soft bg-raised/40 px-3 py-2.5">
                <p className="text-[11.5px] leading-[1.55] text-ink-dim">
                  A tag&apos;s own name is already a match, so anything you type
                  containing the word <em>amber</em> lands in Amber on its own.
                </p>
                <p className="mt-1.5 text-[11.5px] leading-[1.55] text-ink-faint">
                  Keywords are for the words that are <em>not</em> the name. You
                  can also type <span className="text-ink-dim">#amber</span> in
                  the quick-add bar, or add one by hand from any task row — both
                  outrank the keyword rules and survive a rename.
                </p>
              </div>

              {error && (
                <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/8 px-3 py-2">
                  <span className="flex-1 text-[12px] text-amber-soft">{error}</span>
                  <button
                    type="button"
                    onClick={dismissError}
                    className="text-[11px] text-amber-soft/70 hover:text-amber-soft"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {!ready ? (
                <p className="px-2 py-4 text-[12px] text-ink-faint">Loading…</p>
              ) : tags.length === 0 ? (
                <p className="px-2 py-4 text-[12px] leading-relaxed text-ink-faint">
                  No tags yet. Add one below and everything already on your deck
                  gets re-checked against it.
                </p>
              ) : (
                <AnimatedGroup preset="blur-slide" stagger={0.035}>
                  {tags.map((tag) => (
                    <TagRow key={tag.id} tag={tag} />
                  ))}
                </AnimatedGroup>
              )}
            </div>

            <div className="border-t border-line-soft p-3">
              <div className="flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                  }}
                  placeholder="New tag…"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint/60"
                />
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={!draft.trim() || busy}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11.5px]',
                    draft.trim() && !busy
                      ? 'bg-amber/15 text-amber-soft hover:bg-amber/25'
                      : 'text-ink-faint/50'
                  )}
                >
                  Add
                </button>
              </div>
              <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-ink-faint/70">
                Editing a name or a keyword re-files every task in the database.
                Tags you attached by hand are never disturbed by it.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function TagRow({ tag }: { tag: Tag }) {
  const patch = useTags((s) => s.patch)
  const remove = useTags((s) => s.remove)

  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState(tag.keywords.join(', '))
  const [label, setLabel] = useState(tag.label)

  /**
   * Both text fields are local until blur.
   *
   * Not a style choice: a tag's name *is* one of its match terms, so writing it
   * through on every keystroke would re-file every slot in the database once
   * per character and reload the whole deck behind it. Typing "Amber" would be
   * five full passes, four of them against nonsense prefixes.
   */
  function commitLabel(): void {
    const next = label.trim()
    if (!next || next === tag.label) {
      setLabel(tag.label)
      return
    }
    void patch(tag.id, { label: next })
  }

  // The keyword list is a comma-separated line rather than a chip editor,
  // because keywords are edited in bursts — "add three, remove one" is one edit
  // to a sentence and four interactions with chips.
  function commitKeywords(): void {
    const next = keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    if (next.join(',') === tag.keywords.join(',')) return
    void patch(tag.id, { keywords: next })
  }

  const style = tagStyle(tag.color)

  return (
    <div className="mb-1.5 rounded-lg border border-line-soft bg-raised/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />

        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setLabel(tag.label)
              e.currentTarget.blur()
            }
          }}
          aria-label="Tag name"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
        />

        <span className="shrink-0 font-mono text-[10.5px] text-ink-faint/70">
          #{tag.slug}
        </span>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Tag settings"
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-raised hover:text-ink',
            open && 'text-ink'
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path
              d="M3 4.5L6 7.5l3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-1 pl-4 text-[10.5px] text-ink-faint/80">
        {tag.dueWeekday === null
          ? 'no weekly cutoff'
          : `due ${weekdayName(tag.dueWeekday)} EOD`}
        {tag.keywords.length > 0 && ` · ${tag.keywords.length} extra keyword${tag.keywords.length === 1 ? '' : 's'}`}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="overflow-hidden"
          >
            <div className="mt-2.5 space-y-3 border-t border-line-soft pt-2.5">
              <label className="block">
                <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                  Extra keywords
                </span>
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  onBlur={commitKeywords}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  placeholder="comma, separated, terms"
                  className="mt-1 w-full rounded-md border border-line-soft bg-canvas/60 px-2 py-1.5 text-[12px] outline-none transition-colors focus:border-line"
                />
                <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint/70">
                  Whole words only — “amber” matches “amber automation” but not
                  “chamber”.
                </span>
              </label>

              <div>
                <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                  Weekly cutoff
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => void patch(tag.id, { dueWeekday: day })}
                      aria-pressed={tag.dueWeekday === day}
                      className={cn(
                        'rounded px-1.5 py-1 text-[11px] transition-colors',
                        tag.dueWeekday === day
                          ? 'bg-raised text-ink'
                          : 'text-ink-faint hover:text-ink-dim'
                      )}
                    >
                      {weekdayName(day).slice(0, 3)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void patch(tag.id, { dueWeekday: null })}
                    aria-pressed={tag.dueWeekday === null}
                    className={cn(
                      'rounded px-1.5 py-1 text-[11px] transition-colors',
                      tag.dueWeekday === null
                        ? 'bg-raised text-ink'
                        : 'text-ink-faint hover:text-ink-dim'
                    )}
                  >
                    None
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                  Colour
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  {TAG_COLORS.map((c: TagColor) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void patch(tag.id, { color: c })}
                      aria-label={c}
                      aria-pressed={c === tag.color}
                      className={cn(
                        'grid size-5 place-items-center rounded-md border transition-colors',
                        c === tag.color ? 'border-line bg-raised' : 'border-transparent'
                      )}
                    >
                      <span className={cn('size-2.5 rounded-full', tagStyle(c).dot)} />
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void remove(tag.id)}
                className="text-[11px] text-goal-rose/80 transition-colors hover:text-goal-rose"
              >
                Delete this tag
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
