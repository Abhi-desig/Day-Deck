import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  STYLE_CATEGORIES,
  STYLE_FIELDS,
  type StyleExtra,
  type VideoStyle,
  type VideoStylePatch
} from '@shared/types'
import { cn } from '../../lib/cn'
import { goalStyle } from '../../lib/goalColor'
import { SPRING } from '../../lib/motion'
import { groupStyles } from '../../lib/style-groups'
import { useStyles } from '../../store/useStyles'
import { Field } from './Field'
import { STYLE_DRAG_TYPE } from './nodes/types'

/**
 * The style library.
 *
 * Lives inside Storyboards because that is the only place a look means anything —
 * there is nothing to apply one to anywhere else in the app.
 *
 * Editing here rather than on the placed card is deliberate: a style is shared, so
 * changing one affects every board using it. Doing that from a panel labelled
 * "Styles" makes the scope obvious in a way that editing a card on one board never
 * could.
 */
export function StylePanel({ open }: { open: boolean }) {
  const styles = useStyles((s) => s.styles)
  const add = useStyles((s) => s.add)
  const [editing, setEditing] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  /**
   * Which families are folded shut.
   *
   * Local component state rather than a preference, deliberately: a collapsed
   * group is a reading position, not a setting, and it should not follow you
   * into next week.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = groupStyles(styles, filter)

  async function create(): Promise<void> {
    const style = await add({ name: 'New style' })
    if (style) setEditing(style.id)
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
              <h2 className="text-[12.5px] text-ink">Styles</h2>
              <p className="text-[11px] text-ink-faint">
                Drag one onto the canvas to attach it to the brief.
              </p>
              <button
                type="button"
                onClick={() => void create()}
                className="ml-auto rounded-md border border-line-soft px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line hover:text-ink"
              >
                + New style
              </button>
            </div>

            {styles.length === 0 ? (
              <p className="px-1 pb-1 text-[11.5px] leading-relaxed text-ink-faint">
                No styles yet. A style is how a film is shot — the lens, the grade,
                the light — kept once so every prompt on every board can say it.
              </p>
            ) : (
              <>
                {/* Families alone still leave a wall of chips. Settings'
                    ModelPicker learned this at a larger scale: a list you
                    cannot type at is a scroll bar. */}
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${styles.length} looks — name, lens, grade, stock…`}
                  className="mb-2 w-full rounded-md border border-line-soft bg-well px-2.5 py-1 text-[11.5px] text-ink-dim outline-none placeholder:text-ink-faint/45 focus:border-line"
                />

                {groups.length === 0 ? (
                  <p className="px-1 pb-1 text-[11.5px] text-ink-faint">
                    Nothing matches “{filter.trim()}”.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {groups.map((group) => {
                      // A filter that found something opens what it found —
                      // typing three letters and being shown a folded heading
                      // is the search failing.
                      const shut =
                        !filter.trim() && collapsed.has(group.id || '_none')
                      return (
                        <div key={group.id || '_none'}>
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev)
                                const key = group.id || '_none'
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                            title={group.hint}
                            className="flex w-full items-baseline gap-1.5 pb-1 text-left"
                          >
                            <span className="text-[9px] text-ink-faint">
                              {shut ? '▸' : '▾'}
                            </span>
                            <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
                              {group.label}
                            </span>
                            <span className="text-[10.5px] text-ink-faint/70">
                              {group.styles.length}
                            </span>
                          </button>
                          {!shut && (
                            <div className="flex flex-wrap gap-1.5 pl-3">
                              {group.styles.map((style) => (
                                <Chip
                                  key={style.id}
                                  style={style}
                                  editing={editing === style.id}
                                  onEdit={() =>
                                    setEditing(
                                      editing === style.id ? null : style.id
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            <AnimatePresence initial={false}>
              {editing && styles.some((s) => s.id === editing) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING.soft}
                  className="overflow-hidden"
                >
                  <Editor
                    style={styles.find((s) => s.id === editing)!}
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
 * A style in the library, and the thing you drag.
 *
 * The drag payload is a custom MIME type carrying only the id, so a stray text
 * drag from elsewhere in the app cannot be mistaken for a style, and the canvas
 * looks the style up rather than trusting anything it was handed.
 */
function Chip({
  style,
  editing,
  onEdit
}: {
  style: VideoStyle
  editing: boolean
  onEdit(): void
}) {
  const palette = goalStyle(style.color)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(STYLE_DRAG_TYPE, style.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      className={cn(
        'inline-flex cursor-grab items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors active:cursor-grabbing',
        editing
          ? cn('bg-raised text-ink', palette.border)
          : 'border-line-soft text-ink-dim hover:border-line hover:text-ink'
      )}
    >
      <span className={cn('size-1.5 rounded-full', palette.dot)} />
      {style.name}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${style.name}`}
        className="text-ink-faint transition-colors hover:text-ink"
      >
        {editing ? '▴' : '▾'}
      </button>
    </div>
  )
}

function Editor({ style, onDone }: { style: VideoStyle; onDone(): void }) {
  const patch = useStyles((s) => s.patch)
  const remove = useStyles((s) => s.remove)
  const duplicate = useStyles((s) => s.duplicate)
  const parse = useStyles((s) => s.parse)

  /** What the sorter proposed, awaiting Apply or Discard. Never auto-applied. */
  const [pending, setPending] = useState<VideoStylePatch | null>(null)
  const [sorting, setSorting] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  function setExtra(index: number, next: Partial<StyleExtra>): void {
    const extras = style.extras.map((e, i) =>
      i === index ? { ...e, ...next } : e
    )
    void patch(style.id, { extras })
  }

  /**
   * Sort the description into the fields — as a proposal.
   *
   * Only fields the sorter actually filled, and only where the value differs
   * from what the grid already says. The description itself is never touched,
   * so the words survive any mis-sort.
   */
  async function sort(): Promise<void> {
    if (sorting) return
    setSorting(true)
    setNote(null)
    try {
      const parsed = await parse(style.id)
      if (!parsed) return
      const changed: VideoStylePatch = {}
      for (const field of STYLE_FIELDS) {
        const next = parsed[field.key]
        if (typeof next !== 'string' || !next.trim()) continue
        if (next.trim() === String(style[field.key]).trim()) continue
        changed[field.key] = next.trim()
      }
      if (Object.keys(changed).length === 0) {
        setNote('Nothing in the description changes the fields.')
        setPending(null)
      } else {
        setPending(changed)
      }
    } finally {
      setSorting(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-canvas/40 p-3">
      <div className="flex items-center gap-2 pb-2">
        <Field
          value={style.name}
          placeholder="Style name"
          onCommit={(name) => name.trim() && void patch(style.id, { name })}
          className="min-w-0 flex-1 text-[12.5px] text-ink"
        />
        <select
          value={style.category}
          onChange={(e) =>
            void patch(style.id, {
              category: e.target.value as VideoStyle['category']
            })
          }
          title="Which family this look is filed under"
          className="shrink-0 rounded border border-line-soft bg-well px-1.5 py-0.5 text-[11px] text-ink-dim"
        >
          <option value="">Uncategorised</option>
          {STYLE_CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void duplicate(style.id)}
          className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => {
            void remove(style.id)
            onDone()
          }}
          title="Removes it from your library and every board using it"
          className="rounded px-1.5 py-0.5 text-[11px] text-amber-soft/70 transition-colors hover:bg-amber/10 hover:text-amber-soft"
        >
          Delete
        </button>
      </div>

      <label className="mb-2.5 block">
        <div className="flex items-baseline gap-2 pb-1">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Describe the look
          </span>
          <span className="text-[10.5px] text-ink-faint/70">
            Plain words. The sorter files them into the fields below, adding
            nothing of its own.
          </span>
          <button
            type="button"
            onClick={() => void sort()}
            disabled={sorting || !style.sourceText.trim()}
            title={
              style.sourceText.trim()
                ? 'Sort this description into the fields — you approve the result'
                : 'Write the description first'
            }
            className="ml-auto shrink-0 rounded-md border border-amber/40 px-2 py-0.5 text-[10.5px] text-amber-soft transition-colors hover:bg-amber/10 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            {sorting ? 'Sorting…' : 'Sort into fields'}
          </button>
        </div>
        <Field
          multiline
          value={style.sourceText}
          placeholder="e.g. gritty handheld 35mm look, teal and orange grade, hard practical light, 2.39:1…"
          onCommit={(sourceText) => void patch(style.id, { sourceText })}
          className="max-h-[120px] min-h-[48px] rounded-md border border-line-soft/60 bg-well p-2 text-[11.5px] leading-relaxed text-ink-dim focus:border-line"
        />
      </label>

      {note && (
        <p className="mb-2 text-[11px] text-ink-faint">
          {note}
        </p>
      )}

      {pending && (
        <div className="mb-2.5 rounded-lg border border-amber/30 bg-amber/8 p-2.5">
          <div className="flex items-center gap-2 pb-1.5">
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-amber-soft">
              Sorted from your description
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void patch(style.id, pending)
                  setPending(null)
                }}
                className="rounded-md bg-amber/20 px-2 py-0.5 text-[10.5px] text-amber-soft transition-colors hover:bg-amber/30"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="text-[10.5px] text-ink-faint transition-colors hover:text-ink"
              >
                Discard
              </button>
            </div>
          </div>
          {STYLE_FIELDS.filter((f) => pending[f.key] !== undefined).map(
            (field) => (
              <div
                key={field.key}
                className="flex items-baseline gap-2 py-0.5 text-[11.5px]"
              >
                <span className="w-[68px] shrink-0 text-[10.5px] text-ink-faint">
                  {field.label}
                </span>
                {String(style[field.key]).trim() && (
                  <s className="text-ink-faint/60">
                    {String(style[field.key])}
                  </s>
                )}
                <span className="min-w-0 flex-1 text-ink-dim">
                  {pending[field.key]}
                </span>
              </div>
            )
          )}
        </div>
      )}

      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {STYLE_FIELDS.map((field) => (
          <label key={field.key} className="flex items-baseline gap-2">
            <span className="w-[68px] shrink-0 text-[10.5px] text-ink-faint">
              {field.label}
            </span>
            <Field
              value={String(style[field.key])}
              placeholder={field.hint}
              onCommit={(value) => void patch(style.id, { [field.key]: value })}
              className="min-w-0 flex-1 border-b border-line-soft/60 pb-0.5 text-[11.5px] text-ink-dim focus:border-line"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 border-t border-line-soft/70 pt-2">
        <div className="flex items-center gap-2 pb-1">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Other settings
          </span>
          <button
            type="button"
            onClick={() =>
              void patch(style.id, {
                extras: [...style.extras, { key: '', value: '' }]
              })
            }
            className="rounded px-1 text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
          >
            + Add
          </button>
        </div>

        {style.extras.length === 0 ? (
          <p className="text-[11px] text-ink-faint/70">
            For anything the fields above do not cover — gate weave, frame rate,
            whatever this look needs.
          </p>
        ) : (
          style.extras.map((extra, i) => (
            <div key={i} className="flex items-baseline gap-2 py-0.5">
              <Field
                value={extra.key}
                placeholder="Setting"
                onCommit={(key) => setExtra(i, { key })}
                className="w-[68px] shrink-0 border-b border-line-soft/60 pb-0.5 text-[10.5px] text-ink-faint focus:border-line"
              />
              <Field
                value={extra.value}
                placeholder="Value"
                onCommit={(value) => setExtra(i, { value })}
                className="min-w-0 flex-1 border-b border-line-soft/60 pb-0.5 text-[11.5px] text-ink-dim focus:border-line"
              />
              <button
                type="button"
                onClick={() =>
                  void patch(style.id, {
                    extras: style.extras.filter((_, j) => j !== i)
                  })
                }
                aria-label="Remove this setting"
                className="text-[11px] text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
