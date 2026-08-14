import { useEffect, useRef } from 'react'
import type { StoryListItem } from '@shared/types'
import { cn } from '../../../lib/cn'
import { mediaUrl } from '../../../lib/media'
import { useStoryboards } from '../../../store/useStoryboards'

/**
 * A reference's picture, at whatever size the caller needs.
 *
 * Three states, and the third is the point: media that renders, media whose file
 * has gone, and an item with no media at all. Because references are linked in
 * place rather than copied, the second one is not an error condition — it is a
 * thing that happens when you tidy your desktop — so it gets a visible, calm
 * treatment rather than a broken-image glyph.
 */
export function RefThumb({
  item,
  size,
  onDetach
}: {
  item: StoryListItem
  size: number
  onDetach?: () => void
}) {
  const box = { width: size, height: size }

  if (item.missing) {
    return (
      <span
        title={`Missing: ${item.mediaPath ?? item.label}`}
        style={box}
        className="grid shrink-0 place-items-center rounded border border-dashed border-amber/40 bg-amber/8 text-[9px] text-amber-soft/80"
      >
        !
      </span>
    )
  }

  if (!item.mediaPath) {
    return (
      <span
        style={box}
        className="grid shrink-0 place-items-center rounded border border-line-soft bg-well text-[9px] text-ink-faint"
        aria-hidden
      >
        ·
      </span>
    )
  }

  return (
    <span
      title={onDetach ? `${item.label} — click to disconnect` : item.label}
      onClick={onDetach}
      style={box}
      className={cn(
        'relative shrink-0 overflow-hidden rounded border border-line-soft bg-well-deep',
        onDetach && 'nodrag cursor-pointer hover:border-amber/50'
      )}
    >
      {item.thumb ? (
        <img
          src={item.thumb}
          alt={item.label}
          className="size-full object-cover"
        />
      ) : (
        <Poster item={item} />
      )}

      {/* The only theme-fixed colour left in the app, deliberately: this badge
          sits on the reference's own frame, and a photograph does not get
          lighter when the app does. Both the scrim and the ink stay dark-mode
          values in both themes. */}
      {item.mediaKind === 'video' && (
        <span className="absolute bottom-0 right-0 bg-scrim px-0.5 text-[7px] leading-tight text-white/80">
          ▶
        </span>
      )}
    </span>
  )
}

/**
 * The live file, plus the one-time job of turning it into a stored thumbnail.
 *
 * Runs only while `thumb` is null. Drawing the first frame to a canvas here means
 * a video reference gets a poster without an ffmpeg dependency anywhere in the
 * app, and once the JPEG is saved the board never touches the original file again
 * — which is what keeps a board of thirty clips from being thirty open file
 * handles on every paint.
 */
function Poster({ item }: { item: StoryListItem }) {
  const patchItem = useStoryboards((s) => s.patchItem)
  const done = useRef(false)
  const src = mediaUrl(item.id)

  useEffect(() => {
    done.current = false
  }, [item.id])

  function capture(source: HTMLImageElement | HTMLVideoElement): void {
    // StrictMode runs effects twice and a load event can fire more than once;
    // without this the same thumbnail is encoded and written repeatedly.
    if (done.current) return
    done.current = true

    const width = source instanceof HTMLVideoElement
      ? source.videoWidth
      : source.naturalWidth
    const height = source instanceof HTMLVideoElement
      ? source.videoHeight
      : source.naturalHeight
    if (!width || !height) return

    const scale = Math.min(1, 320 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      void patchItem(item.id, { thumb: canvas.toDataURL('image/jpeg', 0.7) })
    } catch {
      // A file the decoder cannot read just stays thumbnail-less. The reference
      // itself is still perfectly usable as a path.
    }
  }

  if (item.mediaKind === 'video') {
    return (
      <video
        src={`${src}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        onLoadedData={(e) => capture(e.currentTarget)}
        className="size-full object-cover"
      />
    )
  }

  return (
    <img
      src={src}
      alt={item.label}
      onLoad={(e) => capture(e.currentTarget)}
      className="size-full object-cover"
    />
  )
}
