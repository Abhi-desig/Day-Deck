import type { BinEntry, Project, ProjectFolder } from '@shared/types'

/**
 * Where a bin entry probably belongs.
 *
 * Pure, and simple on purpose: extension decides the folder name, recency
 * decides the project, and anything this cannot place confidently gets no
 * suggestion at all — the row's dropdown still offers every folder, so a null
 * here costs one click rather than filing something somewhere surprising.
 */

/** Folder names from PROJECT_TEMPLATE, by what kind of file goes there. */
const CREATIVE_TARGET: Record<string, string> = {
  // Footage: the material a cut is made from.
  mp4: 'Footage',
  mov: 'Footage',
  m4v: 'Footage',
  webm: 'Footage',
  avi: 'Footage',
  mkv: 'Footage',
  braw: 'Footage',
  wav: 'Footage',
  mp3: 'Footage',
  aif: 'Footage',
  aiff: 'Footage',
  m4a: 'Footage',
  // References: things you look at while working.
  png: 'References',
  jpg: 'References',
  jpeg: 'References',
  gif: 'References',
  webp: 'References',
  avif: 'References',
  heic: 'References',
  bmp: 'References',
  tif: 'References',
  tiff: 'References',
  pdf: 'References',
  // Project files: another app's own documents.
  prproj: 'Project files',
  aep: 'Project files',
  psd: 'Project files',
  ai: 'Project files',
  drp: 'Project files',
  blend: 'Project files'
}

/** Code projects mostly receive assets; source files rarely sit on a Desktop. */
const CODE_TARGET: Record<string, string> = {
  png: 'assets',
  jpg: 'assets',
  jpeg: 'assets',
  gif: 'assets',
  webp: 'assets',
  svg: 'assets',
  ico: 'assets',
  md: 'docs',
  pdf: 'docs',
  txt: 'docs'
}

export interface BinSuggestion {
  projectId: string
  folderId: string
  /** For the row's label: "Reel spring · Footage". */
  projectName: string
  folderName: string
}

const extension = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Most recently opened first; never-opened projects trail in grid order. */
const byRecency = (a: Project, b: Project): number => {
  const at = a.lastOpenedAt ?? ''
  const bt = b.lastOpenedAt ?? ''
  if (at !== bt) return at < bt ? 1 : -1
  return a.sortIndex - b.sortIndex
}

/**
 * The suggestion, or null.
 *
 * Creative projects are tried first for media — that is what a Desktop mostly
 * collects — then code projects for the few extensions they claim. A directory
 * gets no suggestion: filing a whole folder is a decision, not a default.
 */
export function suggestDestination(
  entry: BinEntry,
  projects: readonly Project[],
  folders: readonly ProjectFolder[]
): BinSuggestion | null {
  if (entry.directory) return null
  const ext = extension(entry.name)
  if (!ext) return null

  const usable = folders.filter((f) => !f.missing)
  const candidates: { project: Project; folderName: string }[] = []

  const creativeTarget = CREATIVE_TARGET[ext]
  if (creativeTarget) {
    for (const project of projects.filter((p) => p.kind === 'creative' && !p.missing)) {
      candidates.push({ project, folderName: creativeTarget })
    }
  }
  const codeTarget = CODE_TARGET[ext]
  if (codeTarget) {
    for (const project of projects.filter((p) => p.kind === 'code' && !p.missing)) {
      candidates.push({ project, folderName: codeTarget })
    }
  }

  candidates.sort((a, b) => byRecency(a.project, b.project))

  for (const { project, folderName } of candidates) {
    const folder = usable.find(
      (f) => f.projectId === project.id && f.name === folderName
    )
    if (folder) {
      return {
        projectId: project.id,
        folderId: folder.id,
        projectName: project.name,
        folderName: folder.name
      }
    }
  }

  return null
}
