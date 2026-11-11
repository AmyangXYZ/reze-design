"use client"

// The scene's overlays over the frame, as every page that shows a scene draws
// them. Placed by CSS in the frame's own terms — centre and height as shares of
// the frame, the width from the picture's proportions — so they need nothing
// measured and land where the export puts them. One loop a frame sets each
// one's opacity from its lane and paints the animated ones on the scene clock.

import { useEffect, useRef, type CSSProperties } from "react"
import { imageSource, type Source } from "@/hooks/use-media-backdrop"
import { overlayAlphaAt, overlayAt, overlayDrag, type LiveOverlay, type OverlayField } from "@/lib/overlays"
import { FPS } from "@/lib/clip"

/**
 * A video overlay held to the scene clock. While the playhead moves it plays,
 * nudged back only when it has drifted a visible amount; while it is still it
 * pauses WHERE IT IS — stopping is no reason to move the picture — and seeks
 * only when the scene time it shows is far from the playhead (a scrub).
 */
function syncVideo(v: HTMLVideoElement, time: number, moving: boolean) {
  const span = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null
  if (span === null) return
  const want = ((time % span) + span) % span
  const off = Math.abs(v.currentTime - want)
  const drift = Math.min(off, span - off)
  if (moving) {
    if (drift > 0.25) v.currentTime = want
    if (v.paused) void v.play().catch(() => {})
  } else {
    if (!v.paused) v.pause()
    if (drift > 0.05) v.currentTime = want
  }
}

/** The resize squares: each corner and the middle of each side, with the
 *  cursor its direction suggests. */
const HANDLES: [number, number, string][] = [
  [0, 0, "nwse-resize"],
  [0.5, 0, "ns-resize"],
  [1, 0, "nesw-resize"],
  [1, 0.5, "ew-resize"],
  [1, 1, "nwse-resize"],
  [0.5, 1, "ns-resize"],
  [0, 1, "nesw-resize"],
  [0, 0.5, "ew-resize"],
]

/** A dragged field shows its dragged value, whatever its keys say. */
function stripKeys(keys: LiveOverlay["keys"], drag: object): LiveOverlay["keys"] {
  if (!keys) return keys
  const out = { ...keys }
  for (const k of Object.keys(drag)) delete out[k]
  return out
}

/** Where an overlay sits, as the element's style: centre and height as
 *  shares of the frame, the width from its proportions. */
function placement(o: Pick<LiveOverlay, "x" | "y" | "size" | "rotation">) {
  return {
    left: `${o.x * 100}%`,
    top: `${o.y * 100}%`,
    height: `${o.size * 100}%`,
    transform: `translate(-50%, -50%) rotate(${o.rotation}deg)`,
  }
}

function place(el: HTMLElement, o: Pick<LiveOverlay, "x" | "y" | "size" | "rotation">) {
  const p = placement(o)
  if (el.style.left !== p.left) el.style.left = p.left
  if (el.style.top !== p.top) el.style.top = p.top
  if (el.style.height !== p.height) el.style.height = p.height
  if (el.style.transform !== p.transform) el.style.transform = p.transform
}

export function SceneOverlays({
  overlays,
  frameNow,
  previewRef,
  editable = false,
  selected = null,
  onPick,
  onChange,
  className,
  style,
}: {
  overlays: LiveOverlay[]
  /** Filled with a function that shows a dragged value on one overlay at
   *  once, ahead of the document — a dial's drag, as the effect dials preview. */
  previewRef?: { current: ((id: string, patch: Partial<Pick<LiveOverlay, OverlayField>>) => void) | null }
  /** Overlays take the pointer: a press picks one, a drag moves it. Off, they
   *  are click-through and the camera has the frame. */
  editable?: boolean
  /** The picked overlay, outlined in the ink while editable. */
  selected?: string | null
  onPick?: (id: string) => void
  /** A drag let go: what it moved — centre, size or turn. */
  onChange?: (id: string, patch: Partial<Pick<LiveOverlay, "x" | "y" | "size" | "rotation">>) => void
  /** The scene's playhead, in frames, read every display frame. */
  frameNow: () => number
  className?: string
  style?: CSSProperties
}) {
  const els = useRef(new Map<string, HTMLElement>())
  const sources = useRef(new Map<string, { file: File; src: Source | null }>())
  const list = useRef(overlays)
  const box = useRef<HTMLDivElement | null>(null)
  const handles = useRef<HTMLDivElement | null>(null)
  const picked = useRef<string | null>(null)
  useEffect(() => {
    picked.current = editable ? selected : null
  })
  // A drag's values, over the document's until the document catches up.
  const dragged = useRef(new Map<string, Partial<Pick<LiveOverlay, OverlayField>>>())
  useEffect(() => {
    list.current = overlays
    dragged.current.clear()
  }, [overlays])
  useEffect(() => {
    if (!previewRef) return
    previewRef.current = (id, patch) => {
      dragged.current.set(id, { ...dragged.current.get(id), ...patch })
    }
    return () => {
      previewRef.current = null
    }
  }, [previewRef])

  // A decoder per animated overlay, opened when it arrives and closed when it
  // leaves or its file changes.
  useEffect(() => {
    const open = sources.current
    for (const [id, s] of open) {
      const o = overlays.find((x) => x.id === id)
      if (!o || o.file !== s.file || o.kind !== "animated") {
        s.src?.close()
        open.delete(id)
      }
    }
    for (const o of overlays) {
      if (o.kind !== "animated" || open.has(o.id)) continue
      const slot: { file: File; src: Source | null } = { file: o.file, src: null }
      open.set(o.id, slot)
      void imageSource(o.file)
        .then((src) => {
          if (open.get(o.id) === slot) slot.src = src
          else src?.close()
        })
        .catch(() => {})
    }
  }, [overlays])
  useEffect(() => {
    const open = sources.current
    return () => {
      for (const s of open.values()) s.src?.close()
      open.clear()
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let lastFrame = NaN
    const tick = () => {
      const frame = frameNow()
      // The playhead moved since the last display frame: playing, or a scrub.
      const moving = frame !== lastFrame
      lastFrame = frame
      for (const doc of list.current) {
        const drag = dragged.current.get(doc.id)
        const o = drag ? { ...doc, ...drag, keys: stripKeys(doc.keys, drag) } : doc
        const el = els.current.get(o.id)
        if (!el) continue
        const a = overlayAlphaAt(o, frame)
        const want = a <= 0 ? "0" : String(a)
        if (el.style.opacity !== want) el.style.opacity = want
        // Keyed or dragged placement, frame by frame; written only when it moved.
        const at = o.keys || drag ? overlayAt(o, frame) : o
        if (o.keys || drag) place(el, at)
        // The picked one's frame rides with it.
        if (handles.current && o.id === picked.current) place(handles.current, at)
        if (el instanceof HTMLVideoElement) {
          syncVideo(el, frame / FPS, moving)
          continue
        }
        const src = sources.current.get(o.id)?.src
        if (src && a > 0 && el instanceof HTMLCanvasElement) {
          const t = frame / FPS
          src.paint(((t % src.span) + src.span) % src.span, el)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameNow])

  /**
   * A press on an overlay or one of its handles: picked, and dragged — the body
   * moves it, a resize handle scales it about its centre (its proportions are
   * its picture's), the stem's knob turns it, Shift in 15° steps. Shown at once
   * through the drag map; written on release.
   */
  const startDrag = (e: React.PointerEvent<HTMLElement>, o: LiveOverlay, mode: "move" | "scale" | "rotate") => {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onPick?.(o.id)
    const frame = box.current?.getBoundingClientRect()
    if (!frame || frame.width <= 0 || frame.height <= 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const from = overlayAt({ ...o, ...dragged.current.get(o.id) }, frameNow())
    const cx = frame.left + from.x * frame.width
    const cy = frame.top + from.y * frame.height
    const sx = e.clientX
    const sy = e.clientY
    const reach = Math.max(1, Math.hypot(sx - cx, sy - cy))
    // A turn is how far the pointer has swung round the centre since the
    // press, added to the angle it started at — never the pointer's own
    // angle, which would snap the picture to wherever the knob was grabbed.
    const startAngle = Math.atan2(sy - cy, sx - cx)
    let swung = 0
    let lastAngle = startAngle
    let patch: Partial<Pick<LiveOverlay, "x" | "y" | "size" | "rotation">> | null = null
    const move = (ev: PointerEvent) => {
      if (mode === "move") patch = { x: from.x + (ev.clientX - sx) / frame.width, y: from.y + (ev.clientY - sy) / frame.height }
      else if (mode === "scale") patch = { size: Math.max(0.005, (from.size * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / reach) }
      else {
        // Unwrapped across ±180°, so a turn past the back does not jump.
        const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx)
        let step = angle - lastAngle
        if (step > Math.PI) step -= 2 * Math.PI
        if (step < -Math.PI) step += 2 * Math.PI
        swung += step
        lastAngle = angle
        let deg = from.rotation + (swung * 180) / Math.PI
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15
        deg = ((((deg + 180) % 360) + 360) % 360) - 180
        patch = { rotation: deg }
      }
      dragged.current.set(o.id, { ...dragged.current.get(o.id), ...patch })
      // The dock's dials follow the drag through the store, not the page.
      overlayDrag.set({ id: o.id, patch })
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      if (patch) onChange?.(o.id, patch)
      overlayDrag.set(null)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
  }

  const shown = editable ? overlays.find((o) => o.id === selected) : undefined

  if (overlays.length === 0) return null
  return (
    // data-keep: overlays are the picture, and stay when the UI is hidden.
    <div ref={box} data-keep className={className} style={{ ...style, overflow: "hidden", pointerEvents: "none" }}>
      {overlays.map((o) => {
        // Keyed fields are the loop's to write; React writes the plain ones.
        const placed: CSSProperties = {
          position: "absolute",
          ...(o.keys ? {} : placement(o)),
          aspectRatio: String(o.aspect),
          opacity: 0,
          ...(editable
            ? {
                pointerEvents: "auto",
                cursor: "move",
                touchAction: "none",
              }
            : {}),
        }
        const handlers = {
          "data-overlay": "",
          onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, o, "move"),
          draggable: false,
        }
        const ref = (el: HTMLElement | null) => {
          if (el) els.current.set(o.id, el)
          else els.current.delete(o.id)
        }
        if (o.kind === "video")
          return (
            // Muted: its own sound would play under the music. The loop
            // matches the export's wrap.
            <video key={o.id} ref={ref} src={o.url} muted loop playsInline preload="auto" style={placed} {...handlers} />
          )
        return o.kind === "animated" ? (
          <canvas key={o.id} ref={ref} style={{ ...placed, width: "auto" }} {...handlers} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={o.id} ref={ref} src={o.url} alt="" style={placed} {...handlers} />
        )
      })}
      {shown && (
        // The picked overlay's frame, as a slide's picture has: its bound in
        // the ink, with the ink's soft edge so it holds over any scene; a
        // square at each corner and side to scale it; a knob above to turn it.
        <div
          ref={handles}
          // cover-type: the ink and its soft edge are the cover's, set there.
          className="cover-type"
          style={{
            color: "var(--foreground)",
            position: "absolute",
            ...(shown.keys ? {} : placement(shown)),
            aspectRatio: String(shown.aspect),
            border: "1px solid currentColor",
            filter: "var(--ink-line-shadow)",
            pointerEvents: "none",
          }}
        >
          {HANDLES.map(([hx, hy, cursor]) => (
            <div
              key={`${hx}${hy}`}
              onPointerDown={(e) => startDrag(e, shown, "scale")}
              style={{
                position: "absolute",
                left: `${hx * 100}%`,
                top: `${hy * 100}%`,
                width: 8,
                height: 8,
                transform: "translate(-50%, -50%)",
                // Hollow, as a slide's are: the paper inside, the ink round it.
                // Round at the corners, square on the sides.
                borderRadius: hx !== 0.5 && hy !== 0.5 ? "9999px" : 1,
                background: "var(--background)",
                border: "1px solid currentColor",
                pointerEvents: "auto",
                touchAction: "none",
                cursor,
              }}
            />
          ))}
          <div style={{ position: "absolute", left: "50%", top: -18, width: 1, height: 18, transform: "translateX(-50%)", background: "currentColor" }} />
          <div
            onPointerDown={(e) => startDrag(e, shown, "rotate")}
            style={{
              position: "absolute",
              left: "50%",
              top: -18,
              width: 9,
              height: 9,
              transform: "translate(-50%, -50%)",
              borderRadius: "9999px",
              background: "var(--background)",
              border: "1px solid currentColor",
              pointerEvents: "auto",
              touchAction: "none",
              cursor: "grab",
            }}
          />
        </div>
      )}
    </div>
  )
}
