// The watermark an export stamps over the picture: one lockup of the REZE
// DESIGN wordmark over the author's name. It sits at one of six places along
// the top and bottom edges, or drifts around the frame. The export and the
// frame preview (components/scene/marks-preview.tsx) both draw through
// drawMark, so what you frame is what you get.

export type MarkPlace = "tl" | "tc" | "tr" | "bl" | "bc" | "br"
/** Reading order of the picker: the top row, then the bottom. */
export const MARK_PLACES: MarkPlace[] = ["tl", "tc", "tr", "bl", "bc", "br"]
export const MARK_DEFAULT_PLACE: MarkPlace = "tl"
export const MARK_DEFAULT_COLOR = "#ffffff"
/** Longest name drawn; a name, not a caption. */
export const MARK_NAME_MAX = 40

/** `name` empty draws the wordmark alone. `moving` ignores `place`. */
export type Mark = { name: string; place: MarkPlace; moving: boolean; color: string }

/** The lockup's face: the masthead's Instrument Serif, as
 *  components/wordmark.tsx sets it, read off next/font's CSS variable (its
 *  family name is hashed). */
export const markFont = (): string => {
  const f = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-serif").trim()
  return f ? `${f}, serif` : "serif"
}

/**
 * The lockup's measures, from the frame's height. The wordmark is the
 * masthead's face: serif capitals at `size`, tracked 0.28em (tighter than the
 * masthead's 0.45em, so the lockup holds together as one block), with a hairline stroke
 * in its own colour (the face has one weight, and a thin serif is what video
 * compression smears first). The name sits under it in the same face, stroke
 * and light, in its own capitals at `nameSize`, tracked lightly: one lockup,
 * the publisher over the author. `lead` is top to top.
 */
function metrics(h: number) {
  const size = Math.max(14, Math.round(h * 0.026))
  return {
    size,
    nameSize: Math.max(12, Math.round(size * 0.8)),
    pad: Math.round(h * 0.03),
    lead: Math.round(size * 1.2),
    track: size * 0.28,
    stroke: size * 0.017,
  }
}

/** 0→1→0 over each unit of `x`: the bounce of a mark between two walls. */
const pingPong = (x: number) => {
  const f = x - Math.floor(x)
  return f < 0.5 ? f * 2 : 2 - f * 2
}

/** Whether a hex colour is light: its relative luminance past the point
 *  where black and white text have equal contrast. */
function isLight(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16)
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.18
}

/** Light type gets the cover's treatment: a soft white bloom over a tight dark
 *  drop, so it reads as lit on dark footage and stays legible on bright.
 *  Canvas allows one shadow per fill, so that is two passes. Dark type gets
 *  none, as the cover's black ink has none: a dark edge on dark letters only
 *  smudges them. */
function fillLit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, lit: boolean) {
  if (!lit) {
    ctx.shadowColor = "transparent"
    ctx.fillText(text, x, y)
    return
  }
  ctx.shadowColor = "rgba(255, 255, 255, 0.3)"
  ctx.shadowBlur = size * 0.83
  ctx.shadowOffsetY = 0
  ctx.fillText(text, x, y)
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
  ctx.shadowBlur = size * 0.42
  ctx.shadowOffsetY = size * 0.083
  ctx.fillText(text, x, y)
}

/**
 * The lockup onto an output frame. `time` is the scene time a moving mark is
 * placed by: it crosses the frame's free width in 14 s and its height in 9.7 s,
 * never in step, so it wanders every part of the frame, and a re-export or a
 * range export puts it in the same place.
 */
export function drawMark(ctx: CanvasRenderingContext2D, w: number, h: number, font: string, mark: Mark, time = 0) {
  const { size, nameSize, pad, lead, track, stroke } = metrics(h)
  const name = mark.name.trim().slice(0, MARK_NAME_MAX)
  const cx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  const brandFont = `400 ${size}px ${font}`
  const nameFont = `400 ${nameSize}px ${font}`
  const nameTrack = nameSize * 0.06

  ctx.save()
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  // Widths first: the block is laid out as a box, then each line inside it.
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  // Tracking trails the last letter too; that space is not part of the word.
  const brandW = ctx.measureText("REZE DESIGN").width - track
  ctx.font = nameFont
  cx.letterSpacing = `${nameTrack.toFixed(2)}px`
  const nameW = name ? ctx.measureText(name).width - nameTrack : 0
  const boxW = Math.max(brandW, nameW)
  const boxH = name ? lead + nameSize : size

  let left: number
  let top: number
  let align: "left" | "center" | "right"
  if (mark.moving) {
    left = pad + pingPong(time / 28) * Math.max(0, w - 2 * pad - boxW)
    top = pad + pingPong(time / 19.4 + 0.3) * Math.max(0, h - 2 * pad - boxH)
    align = "left"
  } else {
    const col = mark.place[1]
    align = col === "l" ? "left" : col === "c" ? "center" : "right"
    left = col === "l" ? pad : col === "c" ? (w - boxW) / 2 : w - pad - boxW
    top = mark.place[0] === "t" ? pad : h - pad - boxH
  }
  // Each line's left edge inside the box, by the block's alignment.
  const lineX = (lw: number) => (align === "left" ? left : align === "center" ? left + (boxW - lw) / 2 : left + boxW - lw)

  ctx.fillStyle = mark.color
  ctx.globalAlpha = 0.92
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  const lit = isLight(mark.color)
  fillLit(ctx, "REZE DESIGN", lineX(brandW), top, size, lit)
  if (name) {
    ctx.font = nameFont
    cx.letterSpacing = `${nameTrack.toFixed(2)}px`
    fillLit(ctx, name, lineX(nameW), top + lead, nameSize, lit)
  }
  // The masthead's stroke on both lines, over the fill and outside the shadow.
  ctx.shadowColor = "transparent"
  ctx.strokeStyle = mark.color
  ctx.lineWidth = stroke
  ctx.lineJoin = "round"
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  ctx.strokeText("REZE DESIGN", lineX(brandW), top)
  if (name) {
    ctx.font = nameFont
    cx.letterSpacing = `${nameTrack.toFixed(2)}px`
    ctx.lineWidth = stroke * (nameSize / size)
    ctx.strokeText(name, lineX(nameW), top + lead)
  }
  ctx.restore()
}
