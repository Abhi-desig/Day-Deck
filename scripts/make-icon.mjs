#!/usr/bin/env node
/**
 * Generates build/icon.icns (and icon.png) for electron-builder.
 *
 * Drawn procedurally rather than committed as a binary, for two reasons: the
 * artwork stays reviewable in a diff, and every size is rendered at its own
 * resolution instead of being downsampled from 1024 — a 16px icon that was
 * squashed from 1024 is mud, and the Dock and Finder sidebar both use it.
 *
 * Signed distance fields give clean antialiased edges without pulling in a
 * rasteriser: coverage is computed from the distance to each shape's boundary,
 * so a 16px render is genuinely sharp rather than blurry.
 *
 * Everything here is stdlib (zlib for PNG deflate) plus macOS's own iconutil.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA pixel buffer -> PNG. Filter type 0 on every scanline; zlib does the rest. */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* -------------------------------------------------------------- geometry */

/**
 * Distance from a point to a rounded rectangle, negative inside.
 * The point arrives already rotated into the shape's own frame.
 */
function sdRoundRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius)
  const qy = Math.abs(py) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

/** Coverage from a distance, antialiased across roughly one device pixel. */
function coverage(distance, aa) {
  return Math.min(1, Math.max(0, 0.5 - distance / aa))
}

function rotate(x, y, cx, cy, degrees) {
  const a = (degrees * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [dx * cos + dy * sin, -dx * sin + dy * cos]
}

const hex = (value) => [
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff
]

/* ------------------------------------------------------------- the art */

/*
 * A deck of day cards on the app's own canvas colour: one near-white card in
 * front with an amber band across its head, one amber card fanned out behind
 * it. Two shapes, because at 16px anything more becomes texture.
 *
 * All coordinates are in a 1024 design space and scaled per render, so the
 * composition is identical at every size.
 */
const D = 1024

const CANVAS_TOP = hex(0x1b1b22)
const CANVAS_BOTTOM = hex(0x0d0d11)
const AMBER = hex(0xffb020)
const AMBER_DEEP = hex(0xc9821a)
const PAPER = hex(0xf6f6f9)

// The rounded square macOS expects, inset so the Dock's own padding looks right.
const PLATE = { cx: D / 2, cy: D / 2, half: 412, radius: 186 }

const BACK_CARD = {
  cx: 442,
  cy: 528,
  halfW: 170,
  halfH: 214,
  radius: 34,
  rotate: -10
}
const FRONT_CARD = {
  cx: 566,
  cy: 502,
  halfW: 178,
  halfH: 228,
  radius: 36,
  rotate: 6
}
// Sits in the front card's own rotated frame, at its head.
const BAND = { dx: 0, dy: -152, halfW: 112, halfH: 19, radius: 19 }

function render(size) {
  const scale = size / D
  const aa = 1 / scale // one device pixel, expressed in design units
  const rgba = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at the pixel centre.
      const x = (px + 0.5) / scale
      const y = (py + 0.5) / scale

      const plate = coverage(
        sdRoundRect(x - PLATE.cx, y - PLATE.cy, PLATE.half, PLATE.half, PLATE.radius),
        aa
      )

      const offset = (py * size + px) * 4
      if (plate <= 0) continue // outside the icon's shape: stays transparent

      // Background gradient, top to bottom.
      const t = y / D
      let r = CANVAS_TOP[0] + (CANVAS_BOTTOM[0] - CANVAS_TOP[0]) * t
      let g = CANVAS_TOP[1] + (CANVAS_BOTTOM[1] - CANVAS_TOP[1]) * t
      let b = CANVAS_TOP[2] + (CANVAS_BOTTOM[2] - CANVAS_TOP[2]) * t

      const over = (colour, alpha) => {
        if (alpha <= 0) return
        r += (colour[0] - r) * alpha
        g += (colour[1] - g) * alpha
        b += (colour[2] - b) * alpha
      }

      // Back card, clipped to the plate so it cannot bleed off the shape.
      const [bx, by] = rotate(x, y, BACK_CARD.cx, BACK_CARD.cy, BACK_CARD.rotate)
      const back = coverage(
        sdRoundRect(bx, by, BACK_CARD.halfW, BACK_CARD.halfH, BACK_CARD.radius),
        aa
      )
      over(AMBER_DEEP, back * plate * 0.55)
      over(AMBER, back * plate * 0.85)

      // A soft dark edge under the front card reads as a shadow without
      // needing an actual blur pass.
      const [fx, fy] = rotate(x, y, FRONT_CARD.cx, FRONT_CARD.cy, FRONT_CARD.rotate)
      const shadow = coverage(
        sdRoundRect(
          fx + 10,
          fy + 14,
          FRONT_CARD.halfW,
          FRONT_CARD.halfH,
          FRONT_CARD.radius
        ),
        aa * 14
      )
      over([0, 0, 0], shadow * plate * 0.45)

      const front = coverage(
        sdRoundRect(fx, fy, FRONT_CARD.halfW, FRONT_CARD.halfH, FRONT_CARD.radius),
        aa
      )
      over(PAPER, front * plate)

      const band = coverage(
        sdRoundRect(fx - BAND.dx, fy - BAND.dy, BAND.halfW, BAND.halfH, BAND.radius),
        aa
      )
      over(AMBER, band * front * plate)

      rgba[offset] = Math.round(r)
      rgba[offset + 1] = Math.round(g)
      rgba[offset + 2] = Math.round(b)
      rgba[offset + 3] = Math.round(plate * 255)
    }
  }

  return encodePng(rgba, size)
}

/* --------------------------------------------------------------- output */

/** The set `iconutil` expects. Each is rendered, never downsampled. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const buildDir = 'build'
const iconset = join(buildDir, 'icon.iconset')

mkdirSync(iconset, { recursive: true })

const cache = new Map()
for (const [name, size] of ICONSET) {
  if (!cache.has(size)) cache.set(size, render(size))
  writeFileSync(join(iconset, name), cache.get(size))
}

// electron-builder can take a 512+ png directly; keeping it means the icon still
// works if iconutil is unavailable (a non-macOS CI, for instance).
writeFileSync(join(buildDir, 'icon.png'), cache.get(1024))

try {
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(buildDir, 'icon.icns')
  ])
  rmSync(iconset, { recursive: true, force: true })
  console.log('build/icon.icns + build/icon.png written')
} catch (err) {
  console.warn(
    `iconutil failed (${err.message}); build/icon.png is still there for electron-builder to convert.`
  )
}
