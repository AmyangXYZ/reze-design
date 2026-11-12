// Overlays: pictures laid flat over the finished frame — a logo, a sticker, a
// transparent gif. A still or an animated gif/webp/apng, transparency kept.
//
// Not the engine's: an overlay never meets the 3D scene, so it is drawn the way
// the backdrop is, over the canvas instead of under it. Live it is an element
// in the frame's rect (an animated one a canvas painted on the scene clock, as
// the backdrop's is); in an export it is decoded and drawn into every frame.

import { BACKDROP_ANIMATED_RE, BACKDROP_VIDEO_RE, openAnimatedImage, probeVideoBackdrop } from "@/lib/backdrop"
import type { AssetRef, SceneOverlay } from "@/lib/scene"
import { FPS } from "@/lib/clip"
import { visibilityAt } from "@/lib/timeline/visibility"
import { dialAt, type DialKey } from "@/lib/effects"
import type { EffectParamDecl } from "reze-engine"
import { tgaToPng } from "@/lib/tga"

/** What the picker offers: pictures, with or without motion. */
export const OVERLAY_ACCEPT = ".png,.apng,.gif,.webp,.jpg,.jpeg,.avif,.svg,.tga,.mp4,.webm,.mov,.m4v"
export const OVERLAY_FILE = /\.(png|apng|gif|webp|jpe?g|avif|svg|tga|mp4|webm|mov|m4v)$/i
const SVG = /\.svg$/i

/** An overlay in the editor: the document's placement, with its file. */
export type LiveOverlay = Omit<SceneOverlay, "asset"> & {
  name: string
  file: File
  /** Object URL for the live element. Revoked when it leaves. */
  url: string
  /** Animated and video: stepped on the scene clock, live and in the export.
   *  A video loops, muted — its own sound would play under the music. */
  kind: "image" | "animated" | "video"
}

/** Placement for a fresh overlay: the middle of the frame, a quarter of its
 *  height — big enough to grab, small enough not to hide her. */
export const NEW_OVERLAY = { x: 0.5, y: 0.5, size: 0.25, rotation: 0, opacity: 1 }

/** Read an upload: its proportions and whether it moves. Throws on a file the
 *  browser cannot decode, while the person who picked it is there to be told. */
export async function probeOverlay(
  file: File,
): Promise<{ file: File; url: string; aspect: number; kind: LiveOverlay["kind"] }> {
  if (BACKDROP_VIDEO_RE.test(file.name)) {
    // Through the demuxer the export decodes with, so a file it cannot read
    // is refused now rather than at render time.
    const v = await probeVideoBackdrop(file)
    return { file, url: v.url, aspect: v.width / Math.max(1, v.height), kind: "video" }
  }
  if (/\.tga$/i.test(file.name)) file = await tgaToPng(file)
  // A File rebuilt from a bundle has no type, and an <img> will not read an
  // SVG served as nothing.
  if (SVG.test(file.name) && file.type !== "image/svg+xml") file = new File([file], file.name, { type: "image/svg+xml" })
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`Can't decode image: ${file.name}`))
      el.src = url
    })
    let kind: LiveOverlay["kind"] = "image"
    if (BACKDROP_ANIMATED_RE.test(file.name)) {
      const animated = await openAnimatedImage(file)
      animated?.dec.close()
      if (animated) kind = "animated"
    }
    let aspect = img.naturalWidth / Math.max(1, img.naturalHeight)
    // An SVG with no width or height has no natural size; its viewBox has the shape.
    if (SVG.test(file.name) && (!img.naturalWidth || !img.naturalHeight)) aspect = svgAspect(await file.text())
    return { file, url, aspect, kind }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function svgAspect(text: string): number {
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  const w = box ? Number(box[1]) : 0
  const h = box ? Number(box[2]) : 0
  return w > 0 && h > 0 ? w / h : 1
}

/** The document's overlay for a live one, its picture at `asset`. */
export function sceneOverlayOf(o: LiveOverlay, asset: AssetRef): SceneOverlay {
  return {
    id: o.id,
    asset,
    x: o.x,
    y: o.y,
    size: o.size,
    aspect: o.aspect,
    rotation: o.rotation,
    opacity: o.opacity,
    ...(o.visibility?.length ? { visibility: o.visibility } : {}),
    ...(o.keys && Object.keys(o.keys).length ? { keys: o.keys } : {}),
  }
}

/** The fields an overlay keys, in the order its dials and curve tabs list them. */
export const OVERLAY_FIELDS = ["size", "x", "y", "rotation", "opacity"] as const
export type OverlayField = (typeof OVERLAY_FIELDS)[number]
/** Where a restack sends an overlay: to an end of the pile, or one step. */
export type OverlayOrder = "front" | "forward" | "backward" | "back"

/** An overlay's placement at a frame (30fps clip frames): each keyed field
 *  through its keys, the rest as placed. */
export function overlayAt<T extends Pick<SceneOverlay, OverlayField | "keys">>(o: T, frame: number): T {
  if (!o.keys) return o
  let out = o
  for (const f of OVERLAY_FIELDS) {
    const ks = o.keys[f]
    if (!ks?.length) continue
    const v = dialAt(ks, frame)
    if (typeof v === "number") out = { ...out, [f]: v }
  }
  return out
}

/** Where an overlay lands in a frame `w`×`h` pixels: its centre, its drawn
 *  size, its turn in radians. One answer for the live layer and the export. */
export function overlayRect(o: Pick<SceneOverlay, "x" | "y" | "size" | "aspect" | "rotation">, w: number, h: number) {
  const height = o.size * h
  return { cx: o.x * w, cy: o.y * h, width: height * o.aspect, height, angle: (o.rotation * Math.PI) / 180 }
}

/** How much of an overlay shows at a frame (30fps clip frames): its opacity,
 *  through its lane. */
export function overlayAlphaAt(o: Pick<SceneOverlay, "opacity" | "visibility" | "keys">, frame: number): number {
  const at = visibilityAt(o.visibility, frame)
  if (!at.visible) return 0
  const keyed = o.keys?.opacity?.length ? dialAt(o.keys.opacity, frame) : undefined
  return Math.min(1, Math.max(0, typeof keyed === "number" ? keyed : o.opacity)) * at.dissolve
}

/**
 * The overlays for an export: every picture decoded once up front, an animated
 * one's frame decoded when the frame it shows changes.
 *
 * Two steps a frame, because the composite may not wait. `prepare` awaits the
 * decodes BEFORE the render; `draw` then paints with nothing awaited between
 * the render and reading the canvas back — see the WebGPU readback rule in
 * video-export.
 */
export type OverlayFrames = {
  prepare(time: number): Promise<void>
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void
  close(): void
}

export async function openOverlayFrames(
  overlays: readonly LiveOverlay[],
  /** The export's frames: a video overlay is decoded on exactly these
   *  timestamps, one per prepare, in order. */
  run: { startTime: number; fps: number; total: number },
): Promise<OverlayFrames> {
  type Layer = {
    o: LiveOverlay
    video?: { next(): Promise<CanvasImageSource | null>; close(): void }
    image: CanvasImageSource | null
    anim: { dec: ImageDecoder; ends: number[]; span: number; shown: number; frame: VideoFrame | null } | null
  }
  const urls: string[] = []
  const layers: Layer[] = await Promise.all(
    overlays.map(async (o): Promise<Layer> => {
      if (o.kind === "video") {
        const { openVideoBackdrop } = await import("@/lib/video-export")
        // At its own size, so the composite scales it once, where it is drawn.
        const probe = await probeVideoBackdrop(o.file)
        URL.revokeObjectURL(probe.url)
        const video = await openVideoBackdrop(probe, {
          width: probe.width,
          height: probe.height,
          startTime: run.startTime,
          fps: run.fps,
          total: run.total,
          loop: true,
        })
        return { o, video, image: null, anim: null }
      }
      if (o.kind === "animated") {
        const opened = await openAnimatedImage(o.file)
        if (opened) {
          const ends: number[] = []
          let acc = 0
          for (let i = 0; i < opened.frames; i++) {
            const { image } = await opened.dec.decode({ frameIndex: i })
            acc += (image.duration ?? 100_000) / 1e6
            image.close()
            ends.push(acc)
          }
          return { o, image: null, anim: { dec: opened.dec, ends, span: Math.max(acc, 1 / 1000), shown: -1, frame: null } }
        }
      }
      // A still, read into memory once: a File reference may go unreadable
      // part-way through a long export.
      const bytes = new Blob([await o.file.arrayBuffer()], { type: o.file.type || undefined })
      if (SVG.test(o.file.name)) {
        // Drawn as an <img>, which draws a vector sharp at whatever size it is
        // drawn — and which createImageBitmap refuses in some browsers.
        // Its URL lives until close: a vector is drawn afresh at each size.
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }))
        urls.push(url)
        const img = new Image()
        img.src = url
        await img.decode()
        return { o, image: img, anim: null }
      }
      return { o, image: await createImageBitmap(bytes), anim: null }
    }),
  )
  return {
    async prepare(time) {
      for (const l of layers) {
        // Every frame, shown or not: the video's frames are taken in order.
        if (l.video) l.image = await l.video.next()
        const a = l.anim
        if (!a || overlayAlphaAt(l.o, time * FPS) <= 0) continue
        const t = ((time % a.span) + a.span) % a.span
        let want = 0
        while (want < a.ends.length - 1 && t >= a.ends[want]) want++
        if (want === a.shown) continue
        const { image } = await a.dec.decode({ frameIndex: want })
        a.frame?.close()
        a.frame = image
        a.shown = want
      }
    },
    draw(ctx, width, height, time) {
      for (const l of layers) {
        const alpha = overlayAlphaAt(l.o, time * FPS)
        const src = l.anim ? l.anim.frame : l.image
        if (alpha <= 0 || !src) continue
        const r = overlayRect(overlayAt(l.o, time * FPS), width, height)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(r.cx, r.cy)
        ctx.rotate(r.angle)
        ctx.drawImage(src, -r.width / 2, -r.height / 2, r.width, r.height)
        ctx.restore()
      }
    },
    close() {
      for (const l of layers) {
        l.video?.close()
        l.anim?.frame?.close()
        l.anim?.dec.close()
        if (l.image instanceof ImageBitmap) l.image.close()
      }
      for (const u of urls) URL.revokeObjectURL(u)
    },
  }
}

/** An overlay's keys with one field's replaced, or taken off keys with none.
 *  No field keyed at all is no keys. */
export function withFieldKeys(keys: SceneOverlay["keys"], field: string, next: DialKey[] | undefined): SceneOverlay["keys"] {
  const out = { ...(keys ?? {}) }
  if (next?.length) out[field] = next
  else delete out[field]
  return Object.keys(out).length ? out : undefined
}

/** An overlay's fields as dials, for the dial panel and the curve editor: the
 *  plain value is each one's default, so an unkeyed field shows where it is. */
export function overlayDecls(o: Pick<SceneOverlay, OverlayField>, label: Record<OverlayField, string>): EffectParamDecl[] {
  const range: Record<OverlayField, [number, number]> = {
    size: [0.02, 3],
    x: [0, 1],
    y: [0, 1],
    rotation: [-180, 180],
    opacity: [0, 1],
  }
  return OVERLAY_FIELDS.map((f) => ({ name: f, kind: "float", value: o[f], min: range[f][0], max: range[f][1], label: label[f] }))
}

/**
 * Fields set at a frame, as an update: a keyed field gets a key there (an
 * existing one moved), the rest their plain value — what moving the dial does,
 * for a drag on the canvas.
 */
export function overlayFieldsAt(
  o: Pick<SceneOverlay, "keys">,
  patch: Partial<Record<OverlayField, number>>,
  frame: number,
): Partial<Pick<SceneOverlay, OverlayField | "keys">> {
  const out: Partial<Pick<SceneOverlay, OverlayField | "keys">> = {}
  let keys = o.keys
  for (const [f, v] of Object.entries(patch) as [OverlayField, number][]) {
    const old = keys?.[f]
    if (old?.length) {
      const kept = old.find((k) => k.frame === frame)
      keys = withFieldKeys(keys, f, [...old.filter((k) => k.frame !== frame), { ...(kept ?? {}), frame, value: v }].sort((a, b) => a.frame - b.frame))
    } else out[f] = v
  }
  if (keys !== o.keys) out.keys = keys
  return out
}

/**
 * The canvas drag in progress — which overlay, and the fields it has moved so
 * far — for the one panel that shows them live. A store rather than page
 * state: a drag writes it every pointer move, and the page is too large to
 * re-render at that rate.
 */
type OverlayDragNow = { id: string; patch: Partial<Record<OverlayField, number>> } | null
let dragNow: OverlayDragNow = null
const dragSubs = new Set<() => void>()
export const overlayDrag = {
  get: (): OverlayDragNow => dragNow,
  set(next: OverlayDragNow) {
    dragNow = next
    for (const f of dragSubs) f()
  },
  subscribe(f: () => void) {
    dragSubs.add(f)
    return () => {
      dragSubs.delete(f)
    }
  },
}
