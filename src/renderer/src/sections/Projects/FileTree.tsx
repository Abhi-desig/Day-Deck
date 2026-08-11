import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FileNode } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { EASE_OUT } from '../../lib/motion'

/**
 * The project's files, one directory at a time.
 *
 * Nothing is walked up front. A folder's children are fetched the first time it
 * is expanded and then cached, which is the difference between opening a repo
 * instantly and waiting while `node_modules` is enumerated.
 */
interface FileTreeProps {
  projectId: string
  activePath: string | null
  dirtyPaths: string[]
  onOpen(path: string): void
}

const ROOT = ''

export function FileTree({
  projectId,
  activePath,
  dirtyPaths,
  onOpen
}: FileTreeProps) {
  const [children, setChildren] = useState<Record<string, FileNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const fetchDir = useCallback(
    async (dir: string): Promise<void> => {
      setLoading((s) => new Set(s).add(dir))
      try {
        const nodes = await api.files.tree(projectId, dir)
        setChildren((s) => ({ ...s, [dir]: nodes }))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading((s) => {
          const next = new Set(s)
          next.delete(dir)
          return next
        })
      }
    },
    [projectId]
  )

  // A different project is a different tree; nothing here transfers.
  useEffect(() => {
    setChildren({})
    setExpanded(new Set([ROOT]))
    setError(null)
    void fetchDir(ROOT)
  }, [fetchDir])

  const toggle = (node: FileNode): void => {
    const open = expanded.has(node.path)
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.delete(node.path)
      else next.add(node.path)
      return next
    })
    if (!open && !children[node.path]) void fetchDir(node.path)
  }

  const dirty = new Set(dirtyPaths)

  const rows = (dir: string, depth: number): React.ReactNode => {
    const nodes = children[dir]
    if (!nodes) return null

    return nodes.map((node) => {
      const isOpen = node.directory && expanded.has(node.path)

      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => (node.directory ? toggle(node) : onOpen(node.path))}
            title={node.path}
            className={cn(
              'group/row flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left',
              'transition-colors duration-100',
              activePath === node.path
                ? 'bg-raised text-ink'
                : 'text-ink-dim hover:bg-raised/60 hover:text-ink'
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <span className="grid size-3.5 shrink-0 place-items-center text-ink-faint">
              {node.directory ? (
                <motion.svg
                  viewBox="0 0 12 12"
                  className="size-3"
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  aria-hidden
                >
                  <path
                    d="M4.5 2.5L8 6l-3.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              ) : (
                <span
                  className={cn(
                    'size-1 rounded-full transition-colors',
                    dirty.has(node.path) ? 'bg-amber' : 'bg-transparent'
                  )}
                />
              )}
            </span>

            <span className="min-w-0 flex-1 truncate text-[12.5px] leading-5">
              {node.name}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="overflow-hidden"
              >
                {loading.has(node.path) && !children[node.path] ? (
                  <p
                    className="py-1 text-[11.5px] text-ink-faint"
                    style={{ paddingLeft: 24 + depth * 12 }}
                  >
                    reading…
                  </p>
                ) : (
                  rows(node.path, depth + 1)
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
      {error && (
        <p data-selectable className="px-2 py-2 text-[11.5px] text-goal-rose">
          {error}
        </p>
      )}
      {!children[ROOT] && !error ? (
        <p className="px-2 py-2 text-[11.5px] text-ink-faint">reading…</p>
      ) : (
        rows(ROOT, 0)
      )}
    </div>
  )
}
