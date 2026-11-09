// The watermark an export stamps over the picture: one lockup of the REZE
// DESIGN wordmark over the author's name. It sits at one of nine places, the
// frame's corners, edges and centre, or drifts around the frame. The export and the
// frame preview (components/scene/marks-preview.tsx) both draw through
// drawMark, so what you frame is what you get.

/** Row (top, middle, bottom) then column (left, centre, right). */
export type MarkPlace = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br"
/** Reading order of the picker, row by row. */
export const MARK_PLACES: MarkPlace[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]
export const MARK_DEFAULT_PLACE: MarkPlace = "tl"
export const MARK_DEFAULT_COLOR = "#ffffff"
/** Longest name drawn; a name, not a caption. */
export const MARK_NAME_MAX = 40

/** `name` empty draws the wordmark alone. `moving` ignores `place`. `size`
 *  scales the whole lockup (1 is the default measure); `opacity` is 0–1. */
export type Mark = { name: string; place: MarkPlace; moving: boolean; color: string; size: number; opacity: number }
export const MARK_SIZE = { min: 0.5, max: 2, default: 1 }
export const MARK_OPACITY_DEFAULT = 0.92

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
function metrics(h: number, scale: number) {
  const size = Math.max(10, Math.round(h * 0.026 * scale))
  return {
    size,
    nameSize: Math.max(10, Math.round(size * 0.9)),
    pad: Math.round(h * 0.03),
    lead: Math.round(size * 1.2),
    track: size * 0.28,
    stroke: size * 0.017,
  }
}

/** 0→1→0 over each unit of `x`, eased: the mark slows into each edge and
 *  turns, so its velocity never jumps the way a straight bounce's does. */
const glide = (x: number) => (1 - Math.cos(2 * Math.PI * x)) / 2

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

type Sprite = { key: string; canvas: HTMLCanvasElement; boxW: number; boxH: number; margin: number; scale: number }
/** Kept per size: the preview and an export draw at once, at two densities. */
const sprites = new Map<string, Sprite>()

/**
 * The lockup drawn once, into its own canvas, at the pixel density of the
 * frame it will land on. Moving it is then one image copy a frame: an image
 * copy lands on fractional pixels smoothly, where text snaps its glyphs to
 * whole ones and a slow drift steps; and the two blurred shadow passes are
 * paid once, not every frame. A few are kept, since a render asks for the
 * same lockup thousands of times over.
 */
function lockup(h: number, font: string, mark: Mark, align: "left" | "center" | "right", scale: number): Sprite {
  const name = mark.name.trim().slice(0, MARK_NAME_MAX)
  const key = [h, font, name, mark.size, mark.color, align, scale].join("|")
  const kept = sprites.get(key)
  if (kept) return kept

  const { size, nameSize, lead, track, stroke } = metrics(h, mark.size)
  const brandFont = `400 ${size}px ${font}`
  const nameFont = `400 ${nameSize}px ${font}`
  const nameTrack = nameSize * 0.06
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const cx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }

  // Widths first: the block is laid out as a box, then each line inside it.
  ctx.textBaseline = "top"
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  // Tracking trails the last letter too; that space is not part of the word.
  const brandW = ctx.measureText("REZE DESIGN").width - track
  ctx.font = nameFont
  cx.letterSpacing = `${nameTrack.toFixed(2)}px`
  const nameW = name ? ctx.measureText(name).width - nameTrack : 0
  const boxW = Math.max(brandW, nameW)
  const boxH = name ? lead + nameSize : size
  // Room for the bloom, which reaches past the letters.
  const margin = Math.ceil(size * 1.5)

  // Resizing clears it and resets its state.
  canvas.width = Math.ceil((boxW + 2 * margin) * scale)
  canvas.height = Math.ceil((boxH + 2 * margin) * scale)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  const lineX = (lw: number) => margin + (align === "left" ? 0 : align === "center" ? (boxW - lw) / 2 : boxW - lw)

  ctx.fillStyle = mark.color
  const lit = isLight(mark.color)
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  fillLit(ctx, "REZE DESIGN", lineX(brandW), margin, size, lit)
  if (name) {
    ctx.font = nameFont
    cx.letterSpacing = `${nameTrack.toFixed(2)}px`
    fillLit(ctx, name, lineX(nameW), margin + lead, nameSize, lit)
  }
  // The masthead's stroke on both lines, over the fill and outside the shadow.
  ctx.shadowColor = "transparent"
  ctx.strokeStyle = mark.color
  ctx.lineWidth = stroke
  ctx.lineJoin = "round"
  ctx.font = brandFont
  cx.letterSpacing = `${track.toFixed(1)}px`
  ctx.strokeText("REZE DESIGN", lineX(brandW), margin)
  if (name) {
    ctx.font = nameFont
    cx.letterSpacing = `${nameTrack.toFixed(2)}px`
    ctx.lineWidth = stroke * (nameSize / size)
    ctx.strokeText(name, lineX(nameW), margin + lead)
  }
  const made = { key, canvas, boxW, boxH, margin, scale }
  // Oldest out past four: a dial being dragged mints one a frame.
  if (sprites.size >= 4) sprites.delete(sprites.keys().next().value!)
  sprites.set(key, made)
  return made
}

/**
 * The lockup onto an output frame. `time` is the scene time a moving mark is
 * placed by: it sweeps the frame's free width and back in 44 s and its height
 * in 30.5 s, never in step, so it wanders every part of the frame; its top
 * speed is a crossing of the width in 14 s. A pure function of time, so a
 * re-export or a range export puts it in the same place.
 */
export function drawMark(ctx: CanvasRenderingContext2D, w: number, h: number, font: string, mark: Mark, time = 0) {
  const { pad } = metrics(h, mark.size)
  const col = mark.place[1]
  const align = mark.moving ? "left" : col === "l" ? "left" : col === "c" ? "center" : "right"
  // The frame's own pixel density under any transform the caller set, so the
  // sprite is drawn 1:1 with the pixels it lands on.
  const scale = Math.abs(ctx.getTransform().a) || 1
  const sp = lockup(h, font, mark, align, scale)

  let left: number
  let top: number
  if (mark.moving) {
    left = pad + glide(time / 44) * Math.max(0, w - 2 * pad - sp.boxW)
    top = pad + glide(time / 30.5 + 0.3) * Math.max(0, h - 2 * pad - sp.boxH)
  } else {
    left = col === "l" ? pad : col === "c" ? (w - sp.boxW) / 2 : w - pad - sp.boxW
    const row = mark.place[0]
    top = row === "t" ? pad : row === "m" ? (h - sp.boxH) / 2 : h - pad - sp.boxH
    // Still, on whole pixels: between two, the copy would soften it.
    left = Math.round(left * scale) / scale
    top = Math.round(top * scale) / scale
  }

  ctx.save()
  ctx.globalAlpha = Math.min(1, Math.max(0, mark.opacity))
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(sp.canvas, left - sp.margin, top - sp.margin, sp.canvas.width / scale, sp.canvas.height / scale)
  ctx.restore()
}
