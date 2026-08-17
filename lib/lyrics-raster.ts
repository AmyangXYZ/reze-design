// Rasterise parsed lyric lines into the atlas the engine samples.
//
// The engine's lyric interface carries timing in a buffer and the words in a
// texture; effects sample the words through rzLyricText and never see a font.
// Canvas2D is the rasteriser because it is the one that already speaks every
// script the platform does — CJK is exactly why lyric text is not an atlas of
// individual glyphs.
//
// One line per row, sized to the track rather than to the maximum: a short
// song gets tall crisp rows, a long one gets shorter ones, and the atlas is
// only ever as big as its own lines need.

import { LYRIC_ATLAS_MAX_H, LYRIC_ATLAS_MAX_W, type LyricLine, type LyricRect } from "reze-engine"

const FONT_STACK = '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif'
/** Rows taller than this buy nothing: the line is drawn at a fraction of the
 *  canvas height, so past roughly this the atlas is being minified anyway. */
const ROW_H_MAX = 96
const ROW_H_MIN = 32
/** Margin around the ink, as a fraction of the row — the room an effect's
 *  outline and shadow taps grow into instead of clipping at the rect edge. */
const PAD_FRAC = 0.14

export type LyricAtlas = {
  source: HTMLCanvasElement
  width: number
  height: number
  rects: LyricRect[]
}

export function rasterizeLyrics(lines: LyricLine[]): LyricAtlas | null {
  if (lines.length === 0) return null
  const rowH = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, Math.floor(LYRIC_ATLAS_MAX_H / lines.length)))
  const pad = Math.max(4, Math.round(rowH * PAD_FRAC))
  const size = rowH - 2 * pad

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  // Measure first, so the atlas is as wide as the longest line and no wider.
  const font = (px: number) => `700 ${px}px ${FONT_STACK}`
  ctx.font = font(size)
  const widths = lines.map((l) => ctx.measureText(l.text).width)
  const atlasW = Math.min(LYRIC_ATLAS_MAX_W, Math.max(64, Math.ceil(Math.max(...widths)) + 2 * pad))
  const maxTextW = atlasW - 2 * pad

  // Sizing the canvas resets its context, so everything below is set after.
  canvas.width = atlasW
  canvas.height = Math.min(LYRIC_ATLAS_MAX_H, lines.length * rowH)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "middle"

  const rects: LyricRect[] = []
  for (let i = 0; i < lines.length; i++) {
    const y0 = i * rowH
    if (y0 + rowH > canvas.height) break
    // A line wider than the atlas condenses its own type rather than clipping.
    let px = size
    let w = widths[i]
    if (w > maxTextW) {
      px = Math.max(10, Math.floor((size * maxTextW) / w))
      ctx.font = font(px)
      w = ctx.measureText(lines[i].text).width
    } else {
      ctx.font = font(size)
    }
    ctx.fillText(lines[i].text, pad, y0 + rowH / 2)
    // The rect carries the padding, so uv 0..1 has margin all around the ink.
    rects.push([0, y0 / canvas.height, Math.min(1, (w + 2 * pad) / atlasW), (y0 + rowH) / canvas.height])
  }
  return { source: canvas, width: canvas.width, height: canvas.height, rects }
}
