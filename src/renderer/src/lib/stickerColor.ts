import type { StickerColor } from '@shared/types'

/**
 * Tailwind scans source text for complete class names, so these are written out
 * rather than interpolated — same reason as lib/goalColor.ts.
 *
 * Paper is rendered as a tinted translucent surface with a matching border and
 * ink, rather than a flat fill, so a sticker still sits in the app's glass
 * language instead of looking like a pasted-on rectangle.
 */
interface PaperStyle {
  surface: string
  border: string
  ink: string
  dot: string
  shadow: string
}

const STYLES: Record<StickerColor, PaperStyle> = {
  butter: {
    surface: 'bg-paper-butter/16',
    border: 'border-paper-butter/35',
    ink: 'text-paper-butter',
    dot: 'bg-paper-butter',
    shadow: 'paper-shadow-butter'
  },
  mint: {
    surface: 'bg-paper-mint/16',
    border: 'border-paper-mint/35',
    ink: 'text-paper-mint',
    dot: 'bg-paper-mint',
    shadow: 'paper-shadow-mint'
  },
  sky: {
    surface: 'bg-paper-sky/16',
    border: 'border-paper-sky/35',
    ink: 'text-paper-sky',
    dot: 'bg-paper-sky',
    shadow: 'paper-shadow-sky'
  },
  blush: {
    surface: 'bg-paper-blush/16',
    border: 'border-paper-blush/35',
    ink: 'text-paper-blush',
    dot: 'bg-paper-blush',
    shadow: 'paper-shadow-blush'
  },
  lilac: {
    surface: 'bg-paper-lilac/16',
    border: 'border-paper-lilac/35',
    ink: 'text-paper-lilac',
    dot: 'bg-paper-lilac',
    shadow: 'paper-shadow-lilac'
  }
}

export function paperStyle(color: StickerColor | null | undefined): PaperStyle {
  return STYLES[color ?? 'butter'] ?? STYLES.butter
}
