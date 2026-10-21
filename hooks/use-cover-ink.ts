"use client"

// The cover's ink, read off the frame behind it (app/globals.css, "The cover"):
// for each ink zone ([data-ink-zone]) under `main`, which side — black type or
// white — the picture behind it calls for, and its colour there; plus the
// toasts' corner. Twice a second, and at once when the frame changes shape.
// The editor and the scene viewer both set type over a live canvas.

import { useEffect, type RefObject } from "react"

export function useCoverInk(
  mainRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  ready: boolean,
  /** True while the reading should rest (an export renders). */
  pausedRef?: RefObject<boolean>,
): void {
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
    let raf = 0
    let timer = 0
    // Read in a frame queued from a timer: the engine queues its next frame
    // while it renders, so this one runs AFTER that render, while the canvas
    // still holds it. A frame of our own would run first and read an empty
    // canvas. The timer is also the half-second pace.
    const next = (ms = 500) => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(tick)
      }, ms)
    }
    // The frame changing shape (an export's aspect, the window) moves what
    // stands behind every zone at once: look again at the next frame rather
    // than at the next half-second.
    // A matte comes or goes as the frame eases (above), and the zones it now
    // holds start turning at once — geometry needs no pixels — fading with it.
    const resized = new ResizeObserver(() => {
      const cr = frameBox()
      for (const el of main.querySelectorAll<HTMLElement>("[data-ink-zone]")) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const over =
          Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left)) *
          Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top))
        if (over < (r.width * r.height) / 2) {
          el.dataset.ink = "light"
          el.style.setProperty("--scene-bg", "rgb(0 0 0)")
        }
      }
      next(0)
    })
    resized.observe(canvas)
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
      next()
      if (busy || document.hidden || pausedRef?.current || !canvas.width) return
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
      for (const el of main.querySelectorAll<HTMLElement>("[data-ink-zone]")) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const x0 = Math.max(r.left, cr.left)
        const x1 = Math.min(r.right, cr.right)
        const y0 = Math.max(r.top, cr.top)
        const y1 = Math.min(r.bottom, cr.bottom)
        const over = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
        // Mostly off the frame: the type stands on the black matte around it.
        if (over < (r.width * r.height) / 2) {
          if (el.dataset.ink !== "light") el.dataset.ink = "light"
          el.style.setProperty("--scene-bg", "rgb(0 0 0)")
          continue
        }
        const qx0 = Math.floor(((x0 - cr.left) / cr.width) * W)
        const qx1 = Math.ceil(((x1 - cr.left) / cr.width) * W)
        const qy0 = Math.floor(((y0 - cr.top) / cr.height) * H)
        const qy1 = Math.ceil(((y1 - cr.top) / cr.height) * H)
        // The type stands on what MOST of the area is, so it is judged by the
        // median lightness (L*, as the eye sees it), not the mean: a few big
        // stars or a lamp on a black sky must not turn the ink dark over black.
        const px: { l: number; i: number }[] = []
        for (let qy = qy0; qy < qy1; qy++) {
          for (let qx = qx0; qx < qx1; qx++) {
            const i = (qy * W + qx) * 4
            // A transparent pixel shows what is under the canvas, which the
            // scene's own background already speaks for.
            if (d[i + 3] < 128) continue
            const y = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
            px.push({ l: y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y, i })
          }
        }
        if (px.length === 0) continue
        read = true
        px.sort((a, b) => a.l - b.l)
        const mid = px[px.length >> 1].l
        const was = el.dataset.ink ?? main.dataset.ink
        const ink = was === "dark" ? (mid < 44 ? "light" : "dark") : mid > 54 ? "dark" : "light"
        if (el.dataset.ink !== ink) el.dataset.ink = ink
        // The tint from the middle half too, so the highlights do not colour it.
        let rr = 0
        let gg = 0
        let bb = 0
        const lo = px.length >> 2
        const hi = Math.max(lo + 1, (px.length * 3) >> 2)
        for (let k = lo; k < hi; k++) {
          const i = px[k].i
          rr += d[i]
          gg += d[i + 1]
          bb += d[i + 2]
        }
        const n = hi - lo
        el.style.setProperty("--scene-bg", `rgb(${Math.round(rr / n)} ${Math.round(gg / n)} ${Math.round(bb / n)})`)
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
        const side = mid === null ? "dark" : was === "light" ? (mid < 44 ? "dark" : "light") : mid > 54 ? "light" : "dark"
        if (was !== side) root.dataset.toastPaper = side
      }

    }
    // A scene that never gives a frame to read (nothing drawn yet, a picture
    // behind a transparent canvas) still gets its chrome, in the guessed ink.
    const giveUp = window.setTimeout(() => {
      main.dataset.inked = ""
    }, 2500)
    next()
    return () => {
      gone = true
      worker.terminate()
      clearTimeout(giveUp)
      resized.disconnect()
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [ready, mainRef, canvasRef, pausedRef])
}
