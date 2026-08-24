// Rasterise parsed lyric lines into the atlas the engine samples.
//
// The engine's lyric interface carries timing in a buffer and the words in a
// texture; effects sample the words through rzLyricText and never see a font.
// Canvas2D is the rasteriser because it is the one that already speaks every
// script the platform does — CJK is exactly why lyric text is not an atlas of
// individual glyphs.
//
// Lines are SHELF-PACKED into a page that follows the playhead. Only ONE line
// is on screen at a time — the effect asks for the live index and draws nothing
// between lines — so the length of a song has no business deciding how sharp
// its words are. Fitting every line onto one sheet made it decide exactly that:
// the sheet has a fixed ceiling, so each extra verse bought its room by taking
// resolution from every line at once.
//
// One line per row was the obvious layout and it wasted most of the sheet. The
// atlas is 4096 wide and a lyric line is usually a fraction of that, so height
// — the scarce dimension, since it is lines × rowH against a fixed cap — was
// being spent on empty space to the right of every line. Packing lines side by
// side until a shelf fills roughly doubles the height a row can afford, and a
// row that can afford to be tall is the whole difference between crisp text and
// soft text.

import { LYRIC_ATLAS_MAX_H, LYRIC_ATLAS_MAX_W, type LyricLine, type LyricRect } from "reze-engine"

const FONT_STACK = '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif'
/**
 * A row's height, aimed above the size the line is drawn at.
 *
 * The karaoke effect's box is 0.05 of canvas height, so this is a supersampling
 * factor in disguise: the ratio between the two is what the glyph is minified
 * by. 0.065 makes it 1.3.
 *
 * 1.3 IS NOT A MEASURED OPTIMUM — it is a default nobody has re-measured since
 * the thing that made measuring pointless was fixed.
 *
 * Raising it to 3.2 once produced a picture indistinguishable from 1.3, and the
 * conclusion drawn at the time — that the softness was in the effect rather
 * than the sheet — was wrong. The Lyrics effect was silently running at HALF
 * resolution: its `// @fullres` carried a note on the same line, which the
 * engine's end-anchored parser could not match, so the pragma read as an
 * ordinary comment. The half-res layer stored a binary edge and the composite's
 * bilinear upsample manufactured the ramp, so no sample ever landed inside the
 * atlas's own — which is exactly why its density changed nothing.
 *
 * That is fixed at both ends now (the effect's pragma, and the engine warning
 * when one fails to parse), so this number is finally worth an experiment. Edge
 * WIDTH is set in screen space by the effect's four-tap filter and will not
 * move; stroke fidelity at small sizes is what more texels would buy.
 */
const TARGET_ROW_FRAC = 0.065
/** Ceiling on a row. A 4K display backs its canvas at ~3600 device pixels,
 *  where the drawn box is 180 — so 176 was a ceiling the biggest screens hit
 *  from below, and the sheet went back to being stretched on exactly the
 *  displays that show it. */
const ROW_H_MAX = 256
const ROW_H_MIN = 32
/** Fallback when the canvas has not been sized yet — a middling retina row. */
const ROW_H_DEFAULT = 96
/** Margin around the ink, as a fraction of the row — the room an effect's
 *  outline and shadow taps grow into instead of clipping at the rect edge. */
const PAD_FRAC = 0.14

export type LyricAtlas = {
  source: HTMLCanvasElement
  width: number
  height: number
  /** One entry per LINE OF THE SONG, zeroed outside the resident page — a zero
   *  rect reads as "no box", which the effect draws as nothing. */
  rects: LyricRect[]
  /** The half-open range of lines this sheet actually holds. */
  from: number
  to: number
}

/** One line's place on the sheet: where its padded box sits, and the type size
 *  it is drawn at (a line too wide for the atlas condenses rather than clips). */
type Placement = { x: number; y: number; boxW: number; px: number }

/**
 * Where every line would go at a given row height, and how tall that makes the
 * sheet.
 *
 * Measured, never guessed: glyph widths depend on the font the platform
 * actually resolved, and CJK against Latin against a mixed line are three
 * different answers.
 */
function planAtlas(
  lines: LyricLine[],
  rowH: number,
  ctx: CanvasRenderingContext2D,
  font: (px: number) => string,
): { height: number; atlasW: number; rowH: number; pad: number; placements: Placement[] } {
  const pad = Math.max(4, Math.round(rowH * PAD_FRAC))
  const size = Math.max(8, rowH - 2 * pad)
  const maxTextW = LYRIC_ATLAS_MAX_W - 2 * pad

  let x = 0
  let y = 0
  let widest = 0
  const placements: Placement[] = []
  for (const line of lines) {
    ctx.font = font(size)
    let px = size
    let w = ctx.measureText(line.text).width
    // A line wider than the atlas condenses its own type rather than clipping.
    if (w > maxTextW) {
      px = Math.max(10, Math.floor((size * maxTextW) / w))
      ctx.font = font(px)
      w = ctx.measureText(line.text).width
    }
    const boxW = Math.min(LYRIC_ATLAS_MAX_W, Math.ceil(w) + 2 * pad)
    // A shelf that cannot hold this line starts the next one. `x > 0` so a box
    // as wide as the atlas still gets a shelf of its own rather than an empty
    // one above it.
    if (x > 0 && x + boxW > LYRIC_ATLAS_MAX_W) {
      x = 0
      y += rowH
    }
    placements.push({ x, y, boxW, px })
    x += boxW
    widest = Math.max(widest, x)
  }
  return { height: y + rowH, atlasW: Math.max(64, Math.min(LYRIC_ATLAS_MAX_W, widest)), rowH, pad, placements }
}

/**
 * Rasterise a PAGE of lines at the height they will be drawn at.
 *
 * ROW HEIGHT IS FIXED AND THE LINE COUNT VARIES, which is the opposite of what
 * this did and the reason a long song looked worse than a short one. Only one
 * line is ever on screen — the effect asks for the live index and draws nothing
 * between lines — so a song's length has no business deciding how sharp its
 * words are. Fitting all of them onto one sheet made it decide exactly that:
 * the sheet has a ceiling, so every extra verse bought itself room by taking
 * resolution from every line at once.
 *
 * So the sheet holds as many lines as fit at full size, starting at `from`, and
 * the caller moves the page when the song walks off the end of it. Lines
 * outside it get a zero rect and simply have no box until their page is
 * resident.
 */
export function rasterizeLyrics(lines: LyricLine[], canvasHeightPx = 0, from = 0): LyricAtlas | null {
  if (lines.length === 0) return null
  const start = Math.max(0, Math.min(from, lines.length - 1))

  const scratch = document.createElement("canvas").getContext("2d")
  if (!scratch) return null
  const font = (px: number) => `700 ${px}px ${FONT_STACK}`

  const rowH = Math.max(
    ROW_H_MIN,
    Math.min(ROW_H_MAX, canvasHeightPx > 0 ? Math.round(canvasHeightPx * TARGET_ROW_FRAC) : ROW_H_DEFAULT),
  )
  // How many lines from `start` fit at that height. At least one, always: a
  // single line taller than the whole sheet is still better resident than
  // absent, and the draw loop clips it.
  let plan = planAtlas(lines.slice(start), rowH, scratch, font)
  let count = lines.length - start
  while (count > 1 && plan.height > LYRIC_ATLAS_MAX_H) {
    // Each pass drops the overflow proportionally, so a long song pages in two
    // or three steps rather than one line at a time.
    const next = Math.max(1, Math.floor(count * (LYRIC_ATLAS_MAX_H / plan.height)))
    count = next >= count ? count - 1 : next
    plan = planAtlas(lines.slice(start, start + count), rowH, scratch, font)
  }
  const end = Math.min(lines.length, start + count)
  const page = lines.slice(start, end)

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  // Sizing the canvas resets its context, so everything below is set after.
  canvas.width = plan.atlasW
  canvas.height = Math.min(LYRIC_ATLAS_MAX_H, plan.height)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "middle"

  // Indexed by the song's own line numbers, so the effect's rzLyricRect(i) is
  // the same lookup whichever page is loaded.
  const rects: LyricRect[] = lines.map(() => [0, 0, 0, 0] as LyricRect)
  // What was actually DRAWN, which is what "resident" has to mean. The loop can
  // stop early, and a `to` that promised more than the sheet holds would leave
  // those lines with a zero rect — invisible, and never re-paged, because the
  // caller would believe they were already here.
  let drawn = 0
  for (let i = 0; i < page.length; i++) {
    const at = plan.placements[i]
    if (at.y + plan.rowH > canvas.height) break
    ctx.font = font(at.px)
    ctx.fillText(page[i].text, at.x + plan.pad, at.y + plan.rowH / 2)
    // The rect carries the padding, so uv 0..1 has margin all around the ink.
    rects[start + i] = [
      at.x / canvas.width,
      at.y / canvas.height,
      (at.x + at.boxW) / canvas.width,
      (at.y + plan.rowH) / canvas.height,
    ]
    drawn = i + 1
  }
  return { source: canvas, width: canvas.width, height: canvas.height, rects, from: start, to: start + drawn }
}
