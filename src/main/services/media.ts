import { statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/types'
import { getDb } from '../db'
import { itemMediaPath } from '../db/storyboards'
import { takePath } from './takes'

/**
 * Serving reference media the app links but does not own.
 *
 * Reference images and video are linked in place: the database stores an absolute
 * path and nothing is ever copied. That leaves one problem — the renderer's CSP
 * is `img-src 'self' data:`, so a `file://` URL simply does not load in a
 * packaged build, and loosening the policy to allow `file:` would hand the
 * renderer the entire filesystem.
 *
 * So the renderer never names a path. It asks for `deck-media://item/<id>` and
 * this handler does the lookup. There is no path in the URL to traverse, no
 * `../` to sanitise, and nothing outside a row that some list item already points
 * at can be reached at all. Rows get their paths from the picker or a drop, and
 * the IPC layer refuses any path that is not a media file by extension — so the
 * reachable set is media the user gestured at, never an arbitrary file.
 *
 * `registerScheme()` has to run at module load, before `app.whenReady()`.
 * `registerMediaProtocol()` runs after, once the DB exists.
 */

export { MEDIA_SCHEME }

/**
 * Must be called before the app is ready, or the scheme is registered too late
 * for the renderer to treat it as a normal loadable source.
 *
 * `stream: true` is what lets a <video> element play the response progressively
 * instead of buffering the whole file first. `standard` gives the URL normal
 * origin semantics, which is what makes it addressable from CSS and markup.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true
      }
    }
  ])
}

/**
 * What this scheme answers: `deck-media://item/<id>` and `deck-media://take/<id>`.
 *
 * Two hosts, one rule. An item is media the user linked and the app looks its
 * path up; a take is a clip the app generated and owns, whose path is derived
 * from the id rather than stored anywhere. Neither URL contains a path.
 *
 * Exported for its tests. This is the whole security boundary of the scheme, so
 * it is worth asserting on directly rather than through a protocol handler that
 * needs a running Electron to exercise.
 */
export type MediaRef = { host: 'item' | 'take'; id: string }

export function mediaRefFrom(url: string): MediaRef | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
  if (parsed.host !== 'item' && parsed.host !== 'take') return null

  const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  // Ids are uuids from randomUUID. Anything with a separator in it is not an id
  // and is the shape an attempt at a path would take.
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return null
  }
  return { host: parsed.host, id }
}

/** The original single-host reader, kept because it is what the item path means. */
export function itemIdFrom(url: string): string | null {
  const ref = mediaRefFrom(url)
  return ref?.host === 'item' ? ref.id : null
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const ref = mediaRefFrom(request.url)
    if (!ref) return new Response(null, { status: 400 })

    if (ref.host === 'take') return serveTake(ref.id)

    let media: { path: string; kind: string | null } | null
    try {
      media = itemMediaPath(getDb(), ref.id)
    } catch {
      return new Response(null, { status: 500 })
    }
    if (!media) return new Response(null, { status: 404 })

    // The file belongs to the user and may have moved since it was linked. A 404
    // is the honest answer, and the item already renders a missing state from the
    // same fact discovered the same way.
    try {
      if (!statSync(media.path).isFile()) {
        return new Response(null, { status: 404 })
      }
    } catch {
      return new Response(null, { status: 404 })
    }

    // net.fetch over a file:// URL gives streaming and Range handling for free,
    // which is what makes seeking inside a reference clip work.
    return net.fetch(pathToFileURL(media.path).toString(), {
      bypassCustomProtocolHandlers: true
    })
  })
}

/**
 * A generated clip.
 *
 * No database lookup at all: the path is `<takesDir>/<id>.mp4` by construction,
 * so an id that names no take simply is not a file and 404s. Same `net.fetch`,
 * so `<video>` gets Range handling and seeking for free.
 */
async function serveTake(id: string): Promise<Response> {
  const path = takePath(id)
  try {
    if (!statSync(path).isFile()) return new Response(null, { status: 404 })
  } catch {
    return new Response(null, { status: 404 })
  }
  return net.fetch(pathToFileURL(path).toString(), {
    bypassCustomProtocolHandlers: true
  })
}
