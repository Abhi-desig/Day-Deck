import { useCallback, useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../../lib/cn'
import { EASE_OUT, SPRING } from '../../lib/motion'
import { DAY_DECK_THEME, EDITOR_OPTIONS, monaco } from '../../lib/monaco'
import { useWorkspace } from '../../store/useWorkspace'

/**
 * The embedded editor.
 *
 * Monaco is given the buffer's text as a controlled value, but the model is
 * keyed by path so switching files keeps each one's undo history and cursor —
 * remounting the editor per file would throw both away.
 */
export function EditorPane({ settleToken }: { settleToken: number }) {
  const buffers = useWorkspace((s) => s.buffers)
  const openOrder = useWorkspace((s) => s.openOrder)
  const activePath = useWorkspace((s) => s.activePath)
  const loadingPath = useWorkspace((s) => s.loadingPath)
  const rejection = useWorkspace((s) => s.rejection)
  const saving = useWorkspace((s) => s.saving)
  const edit = useWorkspace((s) => s.edit)
  const save = useWorkspace((s) => s.save)
  const openFile = useWorkspace((s) => s.openFile)
  const closeFile = useWorkspace((s) => s.closeFile)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const buffer = activePath ? buffers[activePath] : undefined

  const onMount = useCallback<OnMount>(
    (editor) => {
      editorRef.current = editor
      // Monaco owns its keybindings inside the editor, so ⌘S has to be
      // registered here as well as on the window — a keydown that starts inside
      // the editor never reaches the document handler.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void save()
      })
    },
    [save]
  )

  // The split resizer and the workspace expand both change the editor's box.
  // Monaco is on automaticLayout, but that samples on a timer; a layout call
  // when the animation reports it has settled removes the visible catch-up.
  useEffect(() => {
    editorRef.current?.layout()
  }, [settleToken])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {openOrder.length > 0 && (
        <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-line-soft/70">
          {openOrder.map((path) => (
            <FileTab
              key={path}
              path={path}
              active={path === activePath}
              dirty={
                !!buffers[path] && buffers[path].text !== buffers[path].saved
              }
              onSelect={() => void openFile(path)}
              onClose={() => closeFile(path)}
            />
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {rejection ? (
            <Centered key="rejected">
              <p className="text-[13px] text-ink-dim">
                {rejection.reason === 'binary'
                  ? 'That looks like a binary file.'
                  : 'That file is too big to open here.'}
              </p>
              <p className="mt-1.5 text-[12px] text-ink-faint">
                {rejection.path} · {formatBytes(rejection.size)}
              </p>
              <p className="mt-3 text-[12px] text-ink-faint">
                Open the project in VS Code if you need it.
              </p>
            </Centered>
          ) : loadingPath ? (
            <Centered key="loading">
              <p className="text-[12.5px] text-ink-faint">
                Opening {loadingPath}…
              </p>
            </Centered>
          ) : !buffer ? (
            <Centered key="empty">
              <p className="text-[13px] text-ink-dim">Pick a file to edit.</p>
              <p className="mt-1.5 text-[12px] text-ink-faint">
                ⌘S saves. Syntax highlighting only — the language server lives in
                VS Code.
              </p>
            </Centered>
          ) : (
            <motion.div
              key="editor"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: EASE_OUT }}
            >
              <Editor
                // Keyed by path so each file gets its own model, and with it
                // its own undo stack.
                path={buffer.path}
                language={buffer.language}
                value={buffer.text}
                theme={DAY_DECK_THEME}
                options={EDITOR_OPTIONS}
                onMount={onMount}
                onChange={(value) => edit(buffer.path, value ?? '')}
                loading={
                  <span className="text-[12px] text-ink-faint">
                    Starting the editor…
                  </span>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {saving && (
            <motion.span
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={SPRING.snap}
              className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-raised/90 px-2 py-0.5 text-[10.5px] text-ink-faint"
            >
              saving…
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

interface FileTabProps {
  path: string
  active: boolean
  dirty: boolean
  onSelect(): void
  onClose(): void
}

function FileTab({ path, active, dirty, onSelect, onClose }: FileTabProps) {
  const name = path.split('/').pop() ?? path

  return (
    <div
      className={cn(
        'group/tab relative flex shrink-0 items-center gap-1.5 px-3 py-1.5',
        'text-[12px] transition-colors duration-150',
        active ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
      )}
    >
      {active && (
        <motion.span
          layoutId="editor-tab"
          transition={SPRING.snap}
          className="absolute inset-x-0 bottom-0 h-px bg-amber"
        />
      )}

      <button type="button" onClick={onSelect} title={path} className="max-w-[180px] truncate">
        {name}
      </button>

      {/* The dot becomes the close button on hover — one slot, so the tab does
          not change width when you point at it. */}
      <span className="relative grid size-4 shrink-0 place-items-center">
        <span
          className={cn(
            'absolute size-1.5 rounded-full bg-amber transition-opacity',
            dirty ? 'opacity-100 group-hover/tab:opacity-0' : 'opacity-0'
          )}
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${name}`}
          className="absolute grid size-4 place-items-center rounded opacity-0 transition-opacity hover:bg-line group-hover/tab:opacity-100"
        >
          <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </span>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 grid place-items-center px-8 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14, ease: EASE_OUT }}
    >
      <div data-selectable>{children}</div>
    </motion.div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
