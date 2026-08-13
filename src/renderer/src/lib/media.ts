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
