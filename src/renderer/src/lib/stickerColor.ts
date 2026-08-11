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
    shadow: 'shadow-[0_10px_30px_-12px_rgb(242_217_139_/_0.35)]'
  },
  mint: {
    surface: 'bg-paper-mint/16',
    border: 'border-paper-mint/35',
    ink: 'text-paper-mint',
    dot: 'bg-paper-mint',
    shadow: 'shadow-[0_10px_30px_-12px_rgb(168_230_207_/_0.35)]'
  },
  sky: {
    surface: 'bg-paper-sky/16',
    border: 'border-paper-sky/35',
    ink: 'text-paper-sky',
    dot: 'bg-paper-sky',
    shadow: 'shadow-[0_10px_30px_-12px_rgb(168_200_240_/_0.35)]'
  },
  blush: {
    surface: 'bg-paper-blush/16',
    border: 'border-paper-blush/35',
    ink: 'text-paper-blush',
    dot: 'bg-paper-blush',
    shadow: 'shadow-[0_10px_30px_-12px_rgb(245_184_193_/_0.35)]'
  },
  lilac: {
    surface: 'bg-paper-lilac/16',
    border: 'border-paper-lilac/35',
    ink: 'text-paper-lilac',
    dot: 'bg-paper-lilac',
    shadow: 'shadow-[0_10px_30px_-12px_rgb(203_184_240_/_0.35)]'
  }
}

export function paperStyle(color: StickerColor | null | undefined): PaperStyle {
  return STYLES[color ?? 'butter'] ?? STYLES.butter
}
