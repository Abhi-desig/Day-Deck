/**
 * The two path operations the renderer needs. Node's `path` is not available
 * here — and should not be — so these are the whole of it.
 */

/** Last segment of a path, with any trailing separators ignored. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * A path short enough for a header, keeping the end — which is the part that
 * identifies the folder. `~` stands in for the home directory when we can spot
 * it, which is most of the time on a personal machine.
 */
export function shortenPath(path: string, max = 52): string {
  if (path.length <= max) return path
  const segments = path.split('/')
  let out = segments.pop() ?? path
  while (segments.length > 0) {
    const next = `${segments.pop()}/${out}`
    if (next.length + 2 > max) break
    out = next
  }
  return `…/${out}`
}
