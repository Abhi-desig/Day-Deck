import { MEDIA_SCHEME } from '@shared/types'

/**
 * The URL for a reference item's media.
 *
 * An id, never a path. The renderer has no business knowing where a file lives,
 * and the main-process handler will only serve a path that some list item already
 * points at — so this is the one and only way to address linked media, and there
 * is nothing in the URL that could be pointed somewhere else.
 *
 * See src/main/services/media.ts for the other end.
 */
export const mediaUrl = (itemId: string): string =>
  `${MEDIA_SCHEME}://item/${encodeURIComponent(itemId)}`

/**
 * The URL for a generated clip.
 *
 * Same rule, second host. A take's file is `<takeId>.mp4` inside the app's own
 * directory, so the id is not just an identifier here — it is the entire path,
 * which is why an id that names nothing simply 404s rather than reaching for
 * something else.
 */
export const takeUrl = (takeId: string): string =>
  `${MEDIA_SCHEME}://take/${encodeURIComponent(takeId)}`
