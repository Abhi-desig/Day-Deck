import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useMotionValue } from 'motion/react'
import type { StoryFrame } from '@shared/types'
import { cn } from '../../lib/cn'
import { clamp } from '../../lib/board'
import { EASE_OUT } from '../../lib/motion'
import { useStoryboards } from '../../store/useStoryboards'
import { Frame } from './Frame'

export const ZOOM_MIN = 0.3
export const ZOOM_MAX = 2.5
/** One notch of the zoom buttons, and the ceiling on one wheel event. */
const ZOOM_STEP = 1.15

const FRAME_W = 300
const FRAME_H = 240

export interface CanvasHandle {
  /** Drop a frame in the middle of whatever is currently on screen. */
  addAtCentre(): void
  zoomBy(factor: number): void
  reset(): void
}

interface CanvasProps {
  boardId: string
  frames: StoryFrame[]
  onHandle(handle: CanvasHandle): void
  onZoom(zoom: number): void
}

/**
 * The infinite surface a board's frames live on.
 *
 * Pan and zoom are motion values, not React state. The whole point of a canvas
 * is that moving around it is free, and driving a transform through `setState`
 * would re-render every frame on the board sixty times a second while the hand
 * is still moving.
 *
 * The world is `transformOrigin: 0 0` and `translate` *then* `scale`, which is
 * what makes the screen↔world conversion below a two-line affair rather than a
 * matrix inversion.
 */
export function Canvas({ boardId, frames, onHandle, onZoom }: CanvasProps) {
  const addFrame = useStoryboards((s) => s.addFrame)

  const viewportRef = useRef<HTMLDivElement>(null)
  const panX = useMotionValue(0)
  const panY = useMotionValue(0)
  const zoom = useMotionValue(1)

  const [panning, setPanning] = useState(false)

  /** Screen coordinates (relative to the viewport) → world coordinates. */
  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = viewportRef.current?.getBoundingClientRect()
      const px = clientX - (rect?.left ?? 0)
      const py = clientY - (rect?.top ?? 0)
      const scale = zoom.get()
      return { x: (px - panX.get()) / scale, y: (py - panY.get()) / scale }
    },
    [panX, panY, zoom]
  )

  /**
   * Zoom about a fixed point on screen.
   *
   * The point under the cursor has to stay under the cursor, or zooming walks
   * the board out from under you. Solve for the pan that keeps its world
   * coordinate mapping to the same screen coordinate at the new scale.
   */
  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      const px = clientX - (rect?.left ?? 0)
      const py = clientY - (rect?.top ?? 0)

      const scale = zoom.get()
      const next = clamp(scale * factor, ZOOM_MIN, ZOOM_MAX)
      if (next === scale) return

      const worldX = (px - panX.get()) / scale
      const worldY = (py - panY.get()) / scale

      zoom.set(next)
      panX.set(px - worldX * next)
      panY.set(py - worldY * next)
      onZoom(next)
    },
    [panX, panY, zoom, onZoom]
  )

  // Fresh board, fresh view. Without this, switching segments keeps the last
  // board's pan — and since frames sit wherever they were put, the new board
  // usually opens on empty space.
  useEffect(() => {
    panX.set(0)
    panY.set(0)
    zoom.set(1)
    onZoom(1)
  }, [boardId, panX, panY, zoom, onZoom])

  const place = useCallback(
    (world: { x: number; y: number }) => {
      void addFrame({
        boardId,
        x: Math.round(world.x - FRAME_W / 2),
        y: Math.round(world.y - FRAME_H / 2),
        w: FRAME_W,
        h: FRAME_H
      })
    },
    [addFrame, boardId]
  )

  // Handed up so the toolbar can drive the canvas without the canvas having to
  // render the toolbar. A ref rather than props because these are commands, not
  // state.
  useEffect(() => {
    onHandle({
      addAtCentre: () => {
        const rect = viewportRef.current?.getBoundingClientRect()
        place(
          toWorld(
            (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
            (rect?.top ?? 0) + (rect?.height ?? 0) / 2
          )
        )
      },
      zoomBy: (factor) => {
        const rect = viewportRef.current?.getBoundingClientRect()
        zoomAt(
          factor,
          (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
          (rect?.top ?? 0) + (rect?.height ?? 0) / 2
        )
      },
      reset: () => {
        panX.set(0)
        panY.set(0)
        zoom.set(1)
        onZoom(1)
      }
    })
  }, [onHandle, place, toWorld, zoomAt, panX, panY, zoom, onZoom])

  /**
   * Trackpad and mouse in one handler.
   *
   * `ctrlKey` on a wheel event is how macOS reports a pinch — it is synthesised
   * by the OS and is not the user holding control — so pinch zooms and two
   * fingers pan, which is what both gestures do everywhere else on the system.
   */
  function onWheel(e: React.WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      // Clamped per event: a hard pinch delivers deltas large enough to jump
      // the whole zoom range in one frame.
      const factor = clamp(1 - e.deltaY * 0.01, 1 / ZOOM_STEP, ZOOM_STEP)
      zoomAt(factor, e.clientX, e.clientY)
      return
    }
    panX.set(panX.get() - e.deltaX)
    panY.set(panY.get() - e.deltaY)
  }

  /**
   * Panning by dragging the background.
   *
   * Raw pointer events rather than Motion's `drag`, because the value being
   * moved is the world's own transform — handing that to a drag gesture would
   * mean a transform inside a transform, and the two would fight over the same
   * element.
   */
  function onPointerDown(e: React.PointerEvent): void {
    // A press that lands on a frame belongs to the frame.
    if ((e.target as HTMLElement).closest('[data-frame]')) return
    if (e.button !== 0 && e.button !== 1) return

    const startX = e.clientX
    const startY = e.clientY
    const originX = panX.get()
    const originY = panY.get()

    setPanning(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    const move = (event: PointerEvent): void => {
      panX.set(originX + (event.clientX - startX))
      panY.set(originY + (event.clientY - startY))
    }
    const up = (): void => {
      setPanning(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={viewportRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-frame]')) return
        place(toWorld(e.clientX, e.clientY))
      }}
      className={cn(
        'storyboard-grid relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line-soft',
        panning ? 'cursor-grabbing' : 'cursor-grab'
      )}
      role="application"
      aria-label="Storyboard canvas"
    >
      <motion.div
        className="absolute left-0 top-0 origin-top-left"
        style={{ x: panX, y: panY, scale: zoom }}
      >
        {frames.map((frame) => (
          <Frame key={frame.id} frame={frame} zoom={zoom} />
        ))}
      </motion.div>

      {frames.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <div className="max-w-xs text-center">
            <p className="text-[13.5px] text-ink-dim">This segment is empty.</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
              Double-click anywhere to drop a frame. Drag the background to pan,
              pinch to zoom.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
