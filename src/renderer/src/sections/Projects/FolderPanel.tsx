import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Project, ProjectFolder } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'
import { useProjectFolders } from '../../store/useProjectFolders'

/**
 * Folders for one project, each backed by a real directory.
 *
 * Nothing here is a virtual grouping. Creating a folder creates the directory;
 * dropping files in copies them there. That is the whole point — a panel that only
 * pretended to organise things would leave the files exactly where they were and
 * add a second place to lose them.
 */
export function FolderPanel({ project }: { project: Project }) {
  const folders = useProjectFolders((s) => s.folders)
  const loading = useProjectFolders((s) => s.loading)
  const busy = useProjectFolders((s) => s.busy)
  const error = useProjectFolders((s) => s.error)
  const notice = useProjectFolders((s) => s.notice)
  const open = useProjectFolders((s) => s.open)
  const create = useProjectFolders((s) => s.create)
  const dismiss = useProjectFolders((s) => s.dismiss)

  const [naming, setNaming] = useState<{ parentId: string | null } | null>(null)

  useEffect(() => {
    void open(project.id)
  }, [project.id, open])

  const roots = folders.filter((f) => f.parentId === null)

  return (
    <section className="mt-4 rounded-xl border border-line-soft bg-surface/50 p-3">
      <div className="flex items-center gap-2 pb-2">
        <h3 className="text-[12.5px] text-ink">Folders</h3>
        <p className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
          Real directories inside {project.path}
        </p>
        <button
          type="button"
          onClick={() => setNaming({ parentId: null })}
          disabled={busy}
          className="shrink-0 rounded-md border border-line-soft px-2 py-0.5 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-40"
        >
          + Folder
        </button>
      </div>

      <AnimatePresence initial={false}>
        {(error || notice) && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING.soft}
            className="overflow-hidden"
          >
            <button
              type="button"
              onClick={dismiss}
              className={cn(
                'block w-full pb-2 text-left text-[11.5px]',
                error ? 'text-goal-rose' : 'text-ink-faint'
              )}
            >
              {error ?? notice}
            </button>
          </motion.p>
        )}
      </AnimatePresence>

      {naming && (
        <NameForm
          onCancel={() => setNaming(null)}
          onSubmit={async (name) => {
            const made = await create(naming.parentId, name)
            if (made) setNaming(null)
          }}
        />
      )}

      {loading ? (
        <p className="py-2 text-[11.5px] text-ink-faint">Loading…</p>
      ) : roots.length === 0 && !naming ? (
        <p className="py-1 text-[11.5px] leading-relaxed text-ink-faint">
          No folders yet. Make one and drop your footage, plates and exports into it
          instead of leaving them on the desktop.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {roots.map((folder) => (
            <Row
              key={folder.id}
              folder={folder}
              all={folders}
              depth={0}
              onAddChild={(parentId) => setNaming({ parentId })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({
  folder,
  all,
  depth,
  onAddChild
}: {
  folder: ProjectFolder
  all: ProjectFolder[]
  depth: number
  onAddChild(parentId: string): void
}) {
  const rename = useProjectFolders((s) => s.rename)
  const forget = useProjectFolders((s) => s.forget)
  const addFiles = useProjectFolders((s) => s.addFiles)
  const dropFiles = useProjectFolders((s) => s.dropFiles)
  const reveal = useProjectFolders((s) => s.reveal)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(folder.name)
  const [over, setOver] = useState(false)

  const children = all.filter((f) => f.parentId === folder.id)

  return (
    <li>
      <div
        style={{ paddingLeft: depth * 14 }}
        onDragOver={(e) => {
          // Only a real file drag. Text dragged from elsewhere in the app is not
          // something to copy into somebody's project folder.
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          // The web File API has no way to name a path; the preload resolves it.
          const paths = Array.from(e.dataTransfer.files)
            .map((file) => api.pathForFile(file))
            .filter((path): path is string => Boolean(path))
          if (paths.length > 0) void dropFiles(folder.id, paths)
        }}
        className={cn(
          'group/folder flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors',
          over ? 'bg-amber/12 ring-1 ring-amber/40' : 'hover:bg-white/4'
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className={cn(
            'size-3.5 shrink-0',
            folder.missing ? 'text-goal-rose/70' : 'text-ink-faint'
          )}
          aria-hidden
        >
          <path
            d="M1.5 4.5A1 1 0 012.5 3.5h3l1.2 1.5h5.8a1 1 0 011 1v6a1 1 0 01-1 1h-10a1 1 0 01-1-1v-8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (draft.trim() && draft !== folder.name) {
                void rename(folder.id, draft)
              } else {
                setDraft(folder.name)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(folder.name)
                setEditing(false)
              }
            }}
            className="min-w-0 flex-1 border-b border-line bg-transparent text-[11.5px] text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            onClick={() => void reveal(folder.id)}
            title={
              folder.missing
                ? `${folder.relPath} is not there any more`
                : `Show ${folder.relPath} in Finder — double-click to rename`
            }
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[11.5px] transition-colors',
              folder.missing
                ? 'text-goal-rose/80'
                : 'text-ink-dim hover:text-ink'
            )}
          >
            {folder.name}
            {folder.missing && (
              <span className="ml-1.5 text-[10px] text-goal-rose/60">missing</span>
            )}
          </button>
        )}

        {!folder.missing && (
          <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
            {folder.fileCount}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100">
          <Action
            label="Add files to this folder"
            glyph="+"
            onClick={() => void addFiles(folder.id)}
          />
          <Action
            label="New folder inside this one"
            glyph="⌸"
            onClick={() => onAddChild(folder.id)}
          />
          <Action
            label="Remove from the panel — the files stay on disk"
            glyph="✕"
            onClick={() => void forget(folder.id)}
          />
        </div>
      </div>

      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((child) => (
            <Row
              key={child.id}
              folder={child}
              all={all}
              depth={depth + 1}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function Action({
  label,
  glyph,
  onClick
}: {
  label: string
  glyph: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-4.5 place-items-center rounded text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink"
    >
      {glyph}
    </button>
  )
}

function NameForm({
  onSubmit,
  onCancel
}: {
  onSubmit(name: string): void
  onCancel(): void
}) {
  const [name, setName] = useState('')

  return (
    <div className="mb-1.5 flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSubmit(name)
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Folder name…"
        className="min-w-0 flex-1 rounded-md border border-line-soft bg-canvas/60 px-2 py-1 text-[11.5px] outline-none transition-colors placeholder:text-ink-faint/50 focus:border-line"
      />
      <button
        type="button"
        onClick={() => name.trim() && onSubmit(name)}
        disabled={!name.trim()}
        className="rounded-md bg-amber/20 px-2.5 py-1 text-[11.5px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
      >
        Create
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[11px] text-ink-faint transition-colors hover:text-ink"
      >
        Cancel
      </button>
    </div>
  )
}
