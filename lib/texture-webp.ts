// Textures as WebP, once, on the way in.
//
// A stage's maps are 95% of its weight and they arrive as PNG: X340's 237 MB of
// textures is 34 MB as WebP at q90, at the SAME resolution and with no visible
// difference. So the conversion happens here, at the upload boundary, and
// nothing downstream ever chooses between two copies — the render, the autosave,
// the bundle, a publish and a fork all see one texture, encoded exactly once.
// Re-encoding on republish is what would cost a generation, and there is none.
//
// LEFT ALONE, each for its own reason: anything not opaque in every pixel,
// because a 2D canvas is premultiplied and destroys the colour under low alpha
// — see texture-alpha.ts, and X309's additive night sky, which it turned black;
// JPEG and WebP, already lossy, so a round trip costs a generation and buys
// little; `.spa` and `.sph`, MMD's sphere maps, whose names are read by enough
// things that renaming them is not worth the bytes; `.dds`, which the browser
// cannot decode at all; and anything small enough that the encoder cannot beat
// it. Opaque images are 90-95% of a stage's texture bytes, so the guard costs
// almost nothing.
//
// A FILE THAT GREW KEEPS ITS ORIGINAL. Flat colour and small palettes are
// exactly what PNG is good at, and a stand-in map or a 64px ramp often comes
// back bigger. The comparison is per file.
//
// The .pmx NAMES its textures, so the table is rewritten to match: a model
// asking for `body.tga` has to find `body.webp`. Maps under `maps/` need no
// rewrite — they are found by the naming rule, which already probes for .webp.
//
// NOTHING HERE MAY COST SOMEONE THEIR MODEL. Every failure — no worker, no
// OffscreenCanvas, a decoder that refuses a file, an encoder that hangs, a .pmx
// whose table will not rewrite — falls back to the bytes that were uploaded.
// The worst outcome is a bigger scene, never a character that would not load.

import { readPmxDocument, writePmxDocument } from "reze-engine"
import { decodeTga } from "@/lib/tga"
import { relFilePath } from "@/lib/scene-files"
import { declaresAlpha, opaqueEverywhere } from "@/lib/texture-alpha"
import type { WebpDone, WebpJob } from "@/lib/texture-webp.worker"

/** What is worth converting. TGA and BMP are uncompressed; PNG is the bulk. */
const CONVERT = /\.(png|tga|bmp)$/i
/** Under this, the encoder's overhead is the whole file. */
const FLOOR = 4096
const QUALITY = 0.9
/** A texture that has not come back by now is one the tab should stop waiting
 *  on. Generous: a 4K TGA on a slow machine is seconds, not minutes. */
const JOB_TIMEOUT = 60_000

export type WebpReport = { converted: number; before: number; after: number; kept: number; kept_mb: number }

/** The main-thread encoder — the fallback, and the whole implementation on a
 *  browser with no module workers. */
async function encodeHere(buffer: ArrayBuffer, path: string): Promise<ArrayBuffer | null> {
  try {
    let bitmap: ImageBitmap
    if (/\.tga$/i.test(path)) {
      const img = decodeTga(buffer)
      bitmap = await createImageBitmap(new ImageData(img.data, img.width, img.height))
    } else {
      bitmap = await createImageBitmap(new Blob([buffer]), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const c2d = canvas.getContext("2d")
    if (!c2d) {
      bitmap.close()
      return null
    }
    c2d.drawImage(bitmap, 0, 0)
    bitmap.close()
    if (declaresAlpha(buffer, path) && !opaqueEverywhere(c2d, canvas.width, canvas.height)) return null
    return await (await canvas.convertToBlob({ type: "image/webp", quality: QUALITY })).arrayBuffer()
  } catch {
    return null
  }
}

/**
 * A pool of encoders, or nothing and the main thread.
 *
 * Every worker is disposable: one that errors is dropped and its job re-runs
 * here, so a browser that half-supports this is slower rather than broken.
 */
class Encoders {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private seq = 0

  constructor(size: number) {
    if (typeof Worker === "undefined") return
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL("./texture-webp.worker.ts", import.meta.url), { type: "module" })
        this.workers.push(w)
        this.idle.push(w)
      }
    } catch {
      // A pool that failed half-built still holds live workers; nothing else
      // owns them, so they go now and the caller encodes on the main thread.
      this.close()
    }
  }

  get parallel(): number {
    return Math.max(1, this.workers.length)
  }

  async run(buffer: ArrayBuffer, path: string): Promise<ArrayBuffer | null> {
    const w = this.idle.pop()
    if (!w) return encodeHere(buffer, path)
    const id = ++this.seq
    try {
      return await new Promise<ArrayBuffer | null>((resolve) => {
        const finish = (v: ArrayBuffer | null) => {
          clearTimeout(timer)
          w.removeEventListener("message", onMessage)
          w.removeEventListener("error", onError)
          resolve(v)
        }
        const onMessage = (e: MessageEvent<WebpDone>) => {
          if (e.data.id !== id) return
          finish(e.data.ok ? e.data.out : null)
        }
        // A worker that threw is not trusted with the next texture.
        const onError = () => {
          this.drop(w)
          finish(null)
        }
        const timer = setTimeout(() => {
          this.drop(w)
          finish(null)
        }, JOB_TIMEOUT)
        w.addEventListener("message", onMessage)
        w.addEventListener("error", onError)
        // Transferred, not copied: a stage's textures are hundreds of megabytes
        // and the caller has no use for the buffer afterwards.
        w.postMessage({ id, buffer, path, quality: QUALITY } satisfies WebpJob, [buffer])
      })
    } finally {
      if (this.workers.includes(w)) this.idle.push(w)
    }
  }

  private drop(w: Worker) {
    this.workers = this.workers.filter((x) => x !== w)
    this.idle = this.idle.filter((x) => x !== w)
    try {
      w.terminate()
    } catch {
      /* already gone */
    }
  }

  close() {
    for (const w of this.workers.slice()) this.drop(w)
  }
}

/**
 * Convert an upload's textures, and point its .pmx at the results.
 *
 * Returns the same shape it was given, so a caller that does not care about the
 * report can use it as a filter. An upload with nothing to convert — or a
 * browser that cannot do this — comes back untouched, by identity.
 */
export async function texturesToWebp(
  files: File[],
  pmx: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: File[]; pmx: File; report: WebpReport }> {
  const untouched = { files, pmx, report: { converted: 0, before: 0, after: 0, kept: 0, kept_mb: 0 } }
  // The encoder every path here needs. Without it there is nothing to fall back
  // to, so the upload proceeds exactly as it did before this existed.
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return untouched
  const targets = files.filter((f) => CONVERT.test(relFilePath(f)) && f.size > FLOOR)
  if (!targets.length) return untouched

  const report: WebpReport = { converted: 0, before: 0, after: 0, kept: 0, kept_mb: 0 }
  const replaced = new Map<File, File>()
  /** Old basename, lower-case, to the new one — how the .pmx is rewritten. */
  const renamed = new Map<string, string>()
  // Lanes rather than all at once: every lane holds a decoded bitmap, and a
  // stage's worth of 2048s decoded together is gigabytes of transient memory.
  const pool = new Encoders(Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4)))
  try {
    let next = 0
    let done = 0
    const lane = async () => {
      for (;;) {
        const i = next++
        if (i >= targets.length) return
        const file = targets[i]
        const path = relFilePath(file)
        let out: ArrayBuffer | null = null
        try {
          out = await pool.run(await file.arrayBuffer(), path)
        } catch {
          out = null
        }
        done++
        onProgress?.(done, targets.length)
        if (!out || out.byteLength >= file.size) {
          // Left as it was — an encoder that refused it, or the alpha guard.
          report.kept++
          report.kept_mb += file.size
          continue
        }
        const to = path.replace(/\.[^./]+$/, ".webp")
        replaced.set(file, new File([out], to, { type: "image/webp" }))
        renamed.set((path.split("/").pop() ?? path).toLowerCase(), to.split("/").pop()!)
        report.converted++
        report.before += file.size
        report.after += out.byteLength
      }
    }
    await Promise.all(Array.from({ length: pool.parallel }, lane))
  } catch (e) {
    console.warn("[webp] textures left as they were:", e)
    return untouched
  } finally {
    pool.close()
  }
  if (!replaced.size) return untouched

  // The model's texture table, pointed at what now exists.
  let outPmx = pmx
  try {
    const doc = readPmxDocument(await pmx.arrayBuffer()) as { textures: string[] }
    let touched = false
    doc.textures = doc.textures.map((t) => {
      const base = (t.replace(/\\/g, "/").split("/").pop() ?? t).toLowerCase()
      const to = renamed.get(base)
      if (!to) return t
      touched = true
      return t.replace(/[^/\\]+$/, to)
    })
    if (touched) outPmx = new File([writePmxDocument(doc as never)], relFilePath(pmx))
  } catch (e) {
    // A .pmx that cannot be rewritten keeps its originals rather than losing its
    // textures: every rename is dropped, not half of them.
    console.warn("[webp] the model's texture table could not be rewritten; textures left as they were", e)
    return untouched
  }

  const out = files.map((f) => (f === pmx ? outPmx : (replaced.get(f) ?? f)))
  return { files: out, pmx: outPmx, report }
}
