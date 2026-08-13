import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'

/**
 * A field that commits on blur rather than on every keystroke.
 *
 * Every write here is an IPC round trip and a SQLite UPDATE. Writing through on
 * change would make typing a paragraph into a prompt several hundred of them.
 *
 * Shared by the brief, list and scene nodes: they are three different cards but
 * one editing behaviour, and the behaviour is the part that is easy to get subtly
 * different in three places.
 */
export function Field({
  value,
  placeholder,
  onCommit,
  className,
  multiline = false
}: {
  value: string
  placeholder: string
  onCommit(next: string): void
  className?: string
  multiline?: boolean
}) {
  const [draft, setDraft] = useState(value)

  // The store is authoritative between edits — an optimistic patch that the
  // server trimmed differently has to win.
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    if (draft === value) return
    onCommit(draft)
  }

  const shared = cn(
    'w-full resize-none bg-transparent outline-none',
    'placeholder:text-ink-faint/45',
    className
  )

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value)
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        // Text selection is off app-wide; globals.css opts textareas back in.
        className={cn(shared, 'overflow-y-auto')}
      />
    )
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
      placeholder={placeholder}
      className={cn(shared, 'truncate')}
    />
  )
}
