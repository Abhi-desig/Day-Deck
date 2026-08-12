import { useMemo, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { DateKey } from '@shared/date'
import type { NewSlot, SlotCategory } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { slugify } from '@shared/tag-match'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { parseQuickAdd } from '../../lib/quickadd'
import { tagStyle } from '../../lib/tagColor'
import { previewTags, useTags } from '../../store/useTags'

const CATEGORIES: SlotCategory[] = ['personal_learning', 'vibe_code', 'amber']

const CATEGORY_STYLE: Record<SlotCategory, string> = {
  vibe_code: 'bg-cat-vibe',
  amber: 'bg-cat-amber',
  personal_learning: 'bg-cat-learn'
}

interface QuickAddProps {
  date: DateKey
  onAdd(input: NewSlot): Promise<void>
}

export function QuickAdd({ date, onAdd }: QuickAddProps) {
  const [value, setValue] = useState('')
  const [category, setCategory] = useState<SlotCategory>('personal_learning')
  const [busy, setBusy] = useState(false)
  const tags = useTags((s) => s.tags)

  /**
   * What this line will be filed under if submitted as it stands.
   *
   * Shown while typing rather than after the fact, because auto-filing that
   * only reveals itself once the task is on the card reads as the app moving
   * things around behind your back. The keyword matches and the `#tag` tokens
   * are merged here so both routes look identical on the way in.
   */
  const willTag = useMemo(() => {
    const { title, tagSlugs } = parseQuickAdd(value)
    const matched = previewTags(title, tags)
    const seen = new Set(matched.map((t) => t.id))

    const typed = tagSlugs
      .map((slug) => tags.find((t) => t.slug === slugify(slug)))
      .filter((t): t is (typeof tags)[number] => !!t && !seen.has(t.id))

    return [...matched, ...typed]
  }, [value, tags])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { title, startMin, durationMin, tagSlugs } = parseQuickAdd(value)
    if (!title || busy) return

    setBusy(true)
    setValue('')
    try {
      await onAdd({ date, title, startMin, durationMin, category, tagSlugs })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      data-no-drag
      className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3"
    >
      <div className="flex items-center gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            title={CATEGORY_LABEL[c]}
            aria-label={`Category: ${CATEGORY_LABEL[c]}`}
            aria-pressed={category === c}
            className="relative grid size-5 place-items-center rounded-full"
          >
            {category === c && (
              <motion.span
                layoutId="quickadd-category"
                transition={SPRING.snap}
                className="absolute inset-0 rounded-full border border-line bg-raised"
              />
            )}
            <span
              className={cn(
                'relative size-1.5 rounded-full transition-opacity',
                CATEGORY_STYLE[c],
                category === c ? 'opacity-100' : 'opacity-45'
              )}
            />
          </button>
        ))}
      </div>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add to this day…  try “09:30 Ship the deck 45m”"
        aria-label="Add a task to this day"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none',
          'placeholder:text-ink-faint/70'
        )}
      />

      <div className="flex shrink-0 items-center gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {willTag.map((tag) => (
            <motion.span
              key={tag.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              title={`Will be filed under ${tag.label}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]',
                tagStyle(tag.color).border,
                tagStyle(tag.color).text,
                tagStyle(tag.color).soft
              )}
            >
              <span className={cn('size-1 rounded-full', tagStyle(tag.color).dot)} />
              {tag.label}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <motion.button
        type="submit"
        disabled={!value.trim() || busy}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'rounded-md px-2 py-1 text-[12px] transition-colors',
          value.trim()
            ? 'bg-amber/15 text-amber-soft hover:bg-amber/25'
            : 'text-ink-faint/50'
        )}
      >
        Add
      </motion.button>
    </form>
  )
}
