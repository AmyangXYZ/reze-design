"use client"

// The cover's ink, read off the frame behind it (app/globals.css, "The cover"):
// which side — black type or white — the picture behind all the ink zones
// ([data-ink-zone]) under `main` calls for, ONE side for every zone; plus the
// toasts' corner. On a computer, once a second:
// the pixels are read in a worker and nothing waits, and a scene's picture
// moves on its own (an animated backdrop, the camera, the music). On a phone
// or tablet, a reading waits for the GPU (iOS), so there is no clock: it reads
// when what stands behind the type changes (the backdrop, the frame's shape),
// a few times after, as slow effects and textures arrive, and once a touch
// lets go. The editor and the scene viewer both set type over a live canvas.

import { useEffect, useRef, type RefObject } from "react"
import { isPhone } from "@/lib/device"

export function useCoverInk(
  mainRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  ready: boolean,
  /** What stands behind the type, as one string: a change reads the ink again. */
  backdrop: string,
  /** True while the reading should rest (an export renders). */
  pausedRef?: RefObject<boolean>,
  /** The ink the person holds (hooks/use-ink-choice), over what the scene reads. */
  held: "dark" | "light" | null = null,
): void {
  const lookRef = useRef<(() => void) | null>(null)
  const heldRef = useRef(held)
  useEffect(() => {
    heldRef.current = held
    lookRef.current?.()
  }, [held])
  useEffect(() => {
    const main = mainRef.current
    const canvas = canvasRef.current
    if (!ready || !main || !canvas) return
    const W = 48
    const H = 32
    // The stack is composed here, on the GPU, and READ in a worker: reading
    // pixels that came from the GPU waits for the GPU, and a heavy scene froze
    // the page on that wait twice a second (cover-ink.worker.ts).
    const makeProbe = () => {
      const c = document.createElement("canvas")
      c.width = W
      c.height = H
      return c
    }
    let probe = makeProbe()
    let g = probe.getContext("2d")
    if (!g) return
    const worker = new Worker(new URL("./cover-ink.worker.ts", import.meta.url), { type: "module" })
    let answer: ((d: Uint8ClampedArray) => void) | null = null
    worker.onmessage = (e: MessageEvent<Uint8ClampedArray>) => answer?.(e.data)
    // What stands behind the type is the whole stack, not the canvas alone: the
    // page's ground, a picture or video behind a see-through canvas, then the
    // canvas. A picture served without CORS would taint the probe for good, so
    // on the first refusal the probe is made again and the stack read without it.
    let media = true
    let gone = false
    let busy = false
    const compose = (ctx: CanvasRenderingContext2D, frame: ImageBitmap) => {
      ctx.fillStyle = getComputedStyle(main).backgroundColor
      ctx.fillRect(0, 0, W, H)
      if (media) {
        for (const el of main.querySelectorAll<HTMLElement>(".frame-layer")) {
          if (el === canvas) continue
          if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement) {
            try {
              ctx.drawImage(el, 0, 0, W, H)
            } catch {}
          }
        }
      }
      ctx.drawImage(frame, 0, 0)
    }
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    // Where the canvas IS laid out, without the transform that eases it there.
    const frameBox = () => {
      const left = canvas.offsetLeft
      const top = canvas.offsetTop
      return { left, top, right: left + canvas.offsetWidth, bottom: top + canvas.offsetHeight, width: canvas.offsetWidth, height: canvas.offsetHeight }
    }
    let timers: number[] = []
    let leadTimer = 0
    let last = 0
    // Read in a frame queued from a timer: the engine queues its next frame
    // while it renders, so this one runs AFTER that render, while the canvas
    // still holds it. A frame of our own would run first and read an empty
    // canvas. At once, so the type turns with the scene (at most every 250ms
    // while a dial is dragged); again once the change has settled; and once
    // more after its textures have come in. A change arriving in several parts
    // (the frame's shape, then its place) pushes back only the later readings:
    // the first one stands.
    const read = () => requestAnimationFrame(tick)
    const look = () => {
      for (const t of timers) clearTimeout(t)
      const now = performance.now()
      if (!leadTimer && now - last >= 250) {
        last = now
        leadTimer = window.setTimeout(() => {
          leadTimer = 0
          read()
        }, 0)
      }
      timers = [250, 1500, 4000, 10000].map((ms) => window.setTimeout(read, ms))
    }
    lookRef.current = look
    // The frame changing shape (an export's aspect, the window) moves what
    // stands behind every zone at once.
    const resized = new ResizeObserver(look)
    resized.observe(canvas)
    // A reading skipped while the tab was hidden is taken on its return.
    const shown = () => {
      if (!document.hidden) look()
    }
    document.addEventListener("visibilitychange", shown)
    const phone = isPhone()
    // A computer keeps the ink with the picture; a phone reads once a gesture
    // has let go of the camera.
    const clock = phone ? 0 : window.setInterval(read, 1000)
    let rest = 0
    const letGo = () => {
      clearTimeout(rest)
      rest = window.setTimeout(look, 400)
    }
    if (phone) canvas.addEventListener("pointerup", letGo)
    // The frame, shrunk on the GPU; the stack composed over it; the pixels
    // from the worker. Nothing here waits for the GPU.
    const sample = async (): Promise<Uint8ClampedArray | null> => {
      const frame = await createImageBitmap(canvas, { resizeWidth: W, resizeHeight: H, resizeQuality: "low" })
      try {
        compose(g!, frame)
      } finally {
        frame.close()
      }
      let shot: ImageBitmap
      try {
        shot = await createImageBitmap(probe)
      } catch {
        // Tainted by a picture: read without pictures from now on.
        if (!media) return null
        media = false
        probe = makeProbe()
        g = probe.getContext("2d")
        return null
      }
      return new Promise((resolve) => {
        answer = resolve
        worker.postMessage(shot, [shot])
      })
    }
    const tick = async () => {
      if (gone || busy || document.hidden || pausedRef?.current || !canvas.width) return
      busy = true
      let d: Uint8ClampedArray | null = null
      try {
        d = await sample()
      } catch {
        // A frame not there to take (the canvas between sizes): the next read.
      } finally {
        busy = false
      }
      if (!d || gone) return
      const cr = frameBox()
      let read = false
      // ONE ink for the whole cover: every zone's pixels go into one reading,
      // and every zone takes its answer. Zones that each read their own patch
      // set the top row black and the title white over a checkered floor.
      const zones = [...main.querySelectorAll<HTMLElement>("[data-ink-zone]")]
      const all: number[] = []
      for (const el of zones) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const x0 = Math.max(r.left, cr.left)
        const x1 = Math.min(r.right, cr.right)
        const y0 = Math.max(r.top, cr.top)
        const y1 = Math.min(r.bottom, cr.bottom)
        const over = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
        // Mostly off the frame: the type stands on the black matte around it,
        // which reads as that much black.
        if (over < (r.width * r.height) / 2) {
          const cells = Math.max(1, Math.round(((r.width * r.height) / (cr.width * cr.height)) * W * H))
          for (let k = 0; k < cells; k++) all.push(0)
          continue
        }
        const qx0 = Math.floor(((x0 - cr.left) / cr.width) * W)
        const qx1 = Math.ceil(((x1 - cr.left) / cr.width) * W)
        const qy0 = Math.floor(((y0 - cr.top) / cr.height) * H)
        const qy1 = Math.ceil(((y1 - cr.top) / cr.height) * H)
        // Nothing is written to the zone but its side, and only when that
        // changes: a reading over a moving picture must not restyle the cover.
        for (let qy = qy0; qy < qy1; qy++) {
          for (let qx = qx0; qx < qx1; qx++) {
            const i = (qy * W + qx) * 4
            // A transparent pixel shows what is under the canvas, which the
            // scene's own background already speaks for.
            if (d[i + 3] < 128) continue
            const y = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
            all.push(y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y)
            read = true
          }
        }
      }
      // The type stands on what MOST of the area is, so it is judged by the
      // median lightness (L*, as the eye sees it), not the mean: a few big stars
      // or a lamp on a black sky must not turn the ink dark over black.
      // The docks' backing is laid in the ink's opposite (globals.css, "The
      // backing"), so it only adds to what the scene already decided.
      if (all.length || heldRef.current) {
        all.sort((a, b) => a - b)
        const mid = all[all.length >> 1]
        const was = zones[0]?.dataset.ink ?? main.dataset.ink
        const ink = heldRef.current ?? (was === "dark" ? (mid < 44 ? "light" : "dark") : mid > 54 ? "dark" : "light")
        for (const el of zones) if (el.dataset.ink !== ink) el.dataset.ink = ink
        // And on <main>, which a zone not yet read inherits: a dock that opens
        // between readings comes up in this ink rather than the page's guess.
        if (main.dataset.ink !== ink) {
          main.dataset.ink = ink
          // Paper laid from the cover (a dialog, the palette, a menu) turns
          // with it: the sheet is always the type's opposite.
          for (const el of document.querySelectorAll<HTMLElement>("[data-paper-laid]")) el.dataset.paper = ink === "light" ? "dark" : "light"
        }
      }
      // The chrome comes up once its ink has been read off a real frame, so
      // it never shows in a guessed ink first (globals.css, "The cover").
      if (read || !main.querySelector("[data-ink-zone]")) main.dataset.inked = ""
      // The toasts' corner (bottom right) is read the same way, so a toast is
      // laid as paper in the ink it stands on (globals.css, "Toasts").
      {
        const x0 = Math.max(window.innerWidth - 384, cr.left)
        const y0 = Math.max(window.innerHeight - 160, cr.top)
        const x1 = Math.min(window.innerWidth, cr.right)
        const y1 = Math.min(window.innerHeight, cr.bottom)
        const root = document.documentElement
        let mid: number | null = null
        if (x1 > x0 && y1 > y0) {
          const ls: number[] = []
          for (let qy = Math.floor(((y0 - cr.top) / cr.height) * H); qy < Math.ceil(((y1 - cr.top) / cr.height) * H); qy++) {
            for (let qx = Math.floor(((x0 - cr.left) / cr.width) * W); qx < Math.ceil(((x1 - cr.left) / cr.width) * W); qx++) {
              const i = (qy * W + qx) * 4
              const y = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
              ls.push(y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y)
            }
          }
          ls.sort((a, b) => a - b)
          if (ls.length) mid = ls[ls.length >> 1]
        }
        const was = root.dataset.toastPaper
        const held = heldRef.current
        const side = held
          ? held === "dark"
            ? "light"
            : "dark"
          : mid === null
            ? "dark"
            : was === "light"
              ? mid < 44
                ? "dark"
                : "light"
              : mid > 54
                ? "light"
                : "dark"
        if (was !== side) root.dataset.toastPaper = side
      }

    }
    // A scene that never gives a frame to read (nothing drawn yet, a picture
    // behind a transparent canvas) still gets its chrome, in the guessed ink.
    const giveUp = window.setTimeout(() => {
      main.dataset.inked = ""
    }, 2500)
    look()
    return () => {
      gone = true
      lookRef.current = null
      worker.terminate()
      clearTimeout(giveUp)
      resized.disconnect()
      document.removeEventListener("visibilitychange", shown)
      clearInterval(clock)
      clearTimeout(rest)
      canvas.removeEventListener("pointerup", letGo)
      for (const t of timers) clearTimeout(t)
      clearTimeout(leadTimer)
    }
  }, [ready, mainRef, canvasRef, pausedRef])
  useEffect(() => {
    lookRef.current?.()
  }, [backdrop])
}
