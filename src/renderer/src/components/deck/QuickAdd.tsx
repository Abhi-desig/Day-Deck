import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import type { DateKey } from '@shared/date'
import type { NewSlot, SlotCategory } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { parseQuickAdd } from '../../lib/quickadd'

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

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { title, startMin, durationMin } = parseQuickAdd(value)
    if (!title || busy) return

    setBusy(true)
    setValue('')
    try {
      await onAdd({ date, title, startMin, durationMin, category })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      data-no-drag
      className="flex items-center gap-2 border-t border-line-soft px-4 py-3"
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
