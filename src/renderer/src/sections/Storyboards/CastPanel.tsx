import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { StorySheet } from '@shared/types'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { useStoryboards } from '../../store/useStoryboards'
import { Field } from './Field'

/**
 * The cast.
 *
 * A style locks how the film is shot; this locks who is in it. The two are the
 * halves of the same problem — a generator writing shot 9 has never seen shot 2,
 * so anything that must stay the same across shots has to be restated in full
 * inside every prompt, and that means it has to be written down once somewhere.
 *
 * Board-scoped, unlike the style library, so this panel is deliberately not a
 * sibling of that one in behaviour: there is nothing to drag onto the canvas and
 * nothing shared with another board. A character exists, or the film does not
 * have them.
 */
export function CastPanel({ open, boardId }: { open: boolean; boardId: string }) {
  const sheets = useStoryboards((s) => s.sheets)
  const addSheet = useStoryboards((s) => s.addSheet)
  const [editing, setEditing] = useState<string | null>(null)

  async function create(): Promise<void> {
    const sheet = await addSheet({ boardId, name: 'New character' })
    if (sheet) setEditing(sheet.id)
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={SPRING.soft}
          className="shrink-0 overflow-hidden"
        >
          <div className="mb-3 rounded-xl border border-line-soft bg-surface/70 p-3">
            <div className="flex items-center gap-2 pb-2.5">
              <h2 className="text-[12.5px] text-ink">Cast</h2>
              <p className="text-[11px] text-ink-faint">
                Described once, repeated word for word in every prompt that shows
                them.
              </p>
              <button
                type="button"
                onClick={() => void create()}
                className="ml-auto rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
              >
                + New character
              </button>
            </div>

            {sheets.length === 0 ? (
              <p className="px-1 pb-1 text-[11.5px] leading-relaxed text-ink-faint">
                Nobody yet. Add a character and the prompt writer will restate
                their description in full every time a shot shows them, instead of
                writing “the same woman as before” — which means nothing to a
                generator that never saw the previous shot.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sheets.map((sheet) => (
                  <Chip
                    key={sheet.id}
                    sheet={sheet}
                    editing={editing === sheet.id}
                    onEdit={() =>
                      setEditing(editing === sheet.id ? null : sheet.id)
                    }
                  />
                ))}
              </div>
            )}

            <AnimatePresence initial={false}>
              {editing && sheets.some((s) => s.id === editing) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING.soft}
                  className="overflow-hidden"
                >
                  <Editor
                    sheet={sheets.find((s) => s.id === editing)!}
                    onDone={() => setEditing(null)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * One character in the cast.
 *
 * The dot is hollow until there is a description, because a named character with
 * nothing said about them is dropped before the prompt is built — it would have
 * the model invent the description, which is the drift this exists to prevent.
 * Showing that state here is cheaper than explaining it after the fact.
 */
function Chip({
  sheet,
  editing,
  onEdit
}: {
  sheet: StorySheet
  editing: boolean
  onEdit(): void
}) {
  const described = sheet.description.trim() !== ''

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
        editing
          ? 'border-amber/50 bg-raised text-ink'
          : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full border',
          described ? 'border-amber bg-amber' : 'border-ink-faint bg-transparent'
        )}
        title={described ? undefined : 'No description yet — not sent to prompts'}
      />
      {sheet.name || 'Unnamed'}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${sheet.name || 'character'}`}
        className="text-ink-faint transition-colors hover:text-ink"
      >
        {editing ? '▴' : '▾'}
      </button>
    </div>
  )
}

function Editor({ sheet, onDone }: { sheet: StorySheet; onDone(): void }) {
  const patchSheet = useStoryboards((s) => s.patchSheet)
  const removeSheet = useStoryboards((s) => s.removeSheet)

  return (
    <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
      <label className="block">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
          Name
        </span>
        <Field
          value={sheet.name}
          placeholder="Maya"
          onCommit={(name) => void patchSheet(sheet.id, { name })}
          className="mt-1 rounded-lg border border-line-soft bg-well px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <label className="block">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
          Description
        </span>
        <Field
          multiline
          value={sheet.description}
          placeholder="24, South Asian, shoulder-length black hair, oversized grey hoodie, silver nose stud, worn white sneakers"
          onCommit={(description) => void patchSheet(sheet.id, { description })}
          className="mt-1 min-h-[76px] rounded-lg border border-line-soft bg-well px-2.5 py-1.5 text-[12.5px] leading-relaxed text-ink-dim"
        />
        <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">
          Write what a camera would see — age, build, hair, wardrobe, anything
          that must not change between shots. This exact wording goes into every
          prompt they appear in, so keep it tight.
        </span>
      </label>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => {
            void removeSheet(sheet.id)
            onDone()
          }}
          className="rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-amber/40 hover:text-amber-soft"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
        >
          Done
        </button>
      </div>
    </div>
  )
}
