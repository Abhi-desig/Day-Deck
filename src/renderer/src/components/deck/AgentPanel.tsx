import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { DateKey } from '@shared/date'
import type { AgentMessage, Slot } from '@shared/types'
import { useAgent } from '../../store/useAgent'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'

/**
 * The questions worth one tap. They are the three from the brief, phrased the
 * way someone actually looking at a card would ask them.
 */
const OPENERS = [
  'What is this task?',
  'What exactly should I learn?',
  'What should I do for this topic?'
] as const

interface AgentPanelProps {
  date: DateKey
  slots: Slot[]
}

/**
 * Ask about this day.
 *
 * The panel answers from the goal and its generated learning points and nothing
 * else — that constraint lives in main/services/agent.ts, where the context is
 * assembled, rather than being something this component asks for politely.
 *
 * What this side owes the user is honesty about that: it says which goals the
 * answers are grounded in, so an answer that stays inside the plan is visibly a
 * feature rather than the model being unhelpful.
 */
export function AgentPanel({ date, slots }: AgentPanelProps) {
  const thread = useAgent((s) => s.threads[date]) ?? []
  const pending = useAgent((s) => s.pending) === date
  const error = useAgent((s) => s.errors[date]) ?? null
  const ask = useAgent((s) => s.ask)
  const clear = useAgent((s) => s.clear)

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Follow the conversation down as it grows, including while an answer is
  // still pending — the typing indicator is the thing worth seeing.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.length, pending, error])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const goals = [
    ...new Set(
      slots
        .filter((s) => s.source === 'curriculum' && s.sourceLabel)
        .map((s) => s.sourceLabel as string)
    )
  ]

  function submit(text: string): void {
    if (!text.trim() || pending) return
    setDraft('')
    void ask(date, text)
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
      >
        {thread.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="pt-1"
          >
            <p className="text-[12.5px] leading-relaxed text-ink-faint">
              {goals.length > 0 ? (
                <>
                  Ask about today&apos;s work. Answers come from{' '}
                  <span className="text-ink-dim">{goals.join(' and ')}</span> and
                  the learning points set up in Goals Admin — nothing else.
                </>
              ) : (
                <>
                  Ask about today&apos;s work. Answers stay inside the goals you
                  set up in Goals Admin.
                </>
              )}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {OPENERS.map((opener) => (
                <motion.button
                  key={opener}
                  type="button"
                  data-no-drag
                  whileTap={{ scale: 0.97 }}
                  onClick={() => submit(opener)}
                  className="rounded-full border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:bg-raised hover:text-ink"
                >
                  {opener}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {thread.map((entry, i) => (
            <Bubble key={`${i}-${entry.role}`} entry={entry} />
          ))}
        </AnimatePresence>

        {pending && <Thinking />}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.snap}
            className="rounded-lg border border-amber/30 bg-amber/8 px-3 py-2 text-[11.5px] leading-relaxed text-amber-soft"
          >
            {error}
          </motion.div>
        )}
      </div>

      <div className="shrink-0 border-t border-line-soft px-3 py-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={pending ? 'Thinking…' : 'Ask about this day…'}
            disabled={pending}
            aria-label="Ask about this day"
            className="min-w-0 flex-1 rounded-lg border border-line-soft bg-canvas/60 px-3 py-1.5 text-[13px] outline-none transition-colors placeholder:text-ink-faint/60 focus:border-line disabled:opacity-60"
          />

          {thread.length > 0 && (
            <button
              type="button"
              data-no-drag
              onClick={() => clear(date)}
              title="Clear this conversation"
              className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-faint transition-colors hover:bg-raised hover:text-ink"
            >
              Clear
            </button>
          )}

          <motion.button
            type="submit"
            data-no-drag
            whileTap={{ scale: 0.94 }}
            disabled={pending || !draft.trim()}
            aria-label="Send"
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber/18 text-amber-soft transition-colors hover:bg-amber/28 disabled:opacity-35"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <path
                d="M3 8h9M8.5 4.5L12 8l-3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.button>
        </form>
      </div>
    </>
  )
}

function Bubble({ entry }: { entry: AgentMessage }) {
  const mine = entry.role === 'user'

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.soft}
      className={cn('flex', mine ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[86%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed',
          mine
            ? 'bg-amber/15 text-amber-soft'
            : 'border border-line-soft bg-raised/60 text-ink-dim'
        )}
      >
        {/* Answers arrive as plain prose with the odd short list, so newlines
            are the only formatting worth honouring. */}
        {entry.text.split('\n').map((line, i) => (
          <p key={i} className={i > 0 ? 'mt-1' : undefined}>
            {line}
          </p>
        ))}
      </div>
    </motion.div>
  )
}

function Thinking() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-1 rounded-xl border border-line-soft bg-raised/60 px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-ink-faint"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.16
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}
