// Rasterise parsed lyric lines into the engine's fixed atlas.
//
// The engine's lyric interface carries timing in a buffer and the words in a
// texture; effects sample the words through rzLyricText and never see a font.
// Canvas2D is the rasteriser because it is the one that already speaks every
// script the platform does — CJK is exactly why lyric text is not a glyph
// atlas of individual characters.
//
// One line per row, glyphs inset from the row edge so an effect's outline
// taps have empty margin to grow into instead of clipping at the rect.

import { LYRIC_ATLAS_H, LYRIC_ATLAS_W, type LyricLine, type LyricRect } from "reze-engine"

const FONT_STACK = '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif'

export type LyricAtlas = {
  source: HTMLCanvasElement
  width: number
  height: number
  rects: LyricRect[]
}

export function rasterizeLyrics(lines: LyricLine[]): LyricAtlas | null {
  if (lines.length === 0) return null
  // Every line gets a row; a track with very many lines gets shorter rows
  // rather than dropped lines.
  const rowH = Math.min(64, Math.floor(LYRIC_ATLAS_H / lines.length))
  const pad = Math.max(3, Math.round(rowH * 0.12))
  const baseSize = rowH - 2 * pad

  const canvas = document.createElement("canvas")
  canvas.width = LYRIC_ATLAS_W
  const usedH = Math.min(LYRIC_ATLAS_H, lines.length * rowH)
  canvas.height = usedH
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "middle"

  const rects: LyricRect[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text
    const y0 = i * rowH
    // A line wider than the atlas condenses its own type rather than clipping.
    let size = baseSize
    ctx.font = `700 ${size}px ${FONT_STACK}`
    const wide = ctx.measureText(text).width
    const maxW = LYRIC_ATLAS_W - 2 * pad
    if (wide > maxW) {
      size = Math.max(10, Math.floor((size * maxW) / wide))
      ctx.font = `700 ${size}px ${FONT_STACK}`
    }
    const w = Math.min(maxW, ctx.measureText(text).width)
    ctx.fillText(text, pad, y0 + rowH / 2, maxW)
    // The rect includes the padding, so uv 0..1 has margin all around the ink.
    rects.push([0, y0 / LYRIC_ATLAS_H, (w + 2 * pad) / LYRIC_ATLAS_W, (y0 + rowH) / LYRIC_ATLAS_H])
  }
  return { source: canvas, width: LYRIC_ATLAS_W, height: usedH, rects }
}
