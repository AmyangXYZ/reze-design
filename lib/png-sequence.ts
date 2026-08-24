// PNG image sequence writer — the transparent-export lane.
//
// After Effects, Blender, Nuke and Resolve all take an image sequence for
// footage with an alpha channel; MP4/H.264 carries no alpha at all, which is
// why this sits beside the muxer instead of inside it. MMD's own transparent
// export is a PNG sequence too, so this is the format the audience asking for
// it already knows.
//
// THE ENCODE IS THE EXPENSIVE HALF, not the render. Measured: deflate over one
// 4K RGBA frame runs 66 ms at level 3 and 170 ms at level 6, and canvas PNG
// adds row filtering on top. A two-minute 60 fps job is ~7200 frames, so on the
// main thread that is twenty minutes of blocking — in a loop whose whole job is
// to keep a progress bar honest. So a pool of workers takes the encode AND the
// file write, and the main thread is left holding only createImageBitmap.
//
// Frames are written into a directory the user picked, which is the other half
// of the point: a sequence that lands loose in Downloads is worse than no
// sequence at all.

/**
 * Pool worker. Built from a Blob URL rather than a module file: it is twenty
 * lines with no imports, and a blob worker resolves identically in dev and in
 * the production bundle without a bundler rule to keep in sync.
 *
 * A FileSystemDirectoryHandle survives structured clone, so the worker opens
 * and writes the file itself — posting the encoded blob back to the main thread
 * only to write it there would put the I/O back on the thread we are clearing.
 */
const WORKER_SOURCE = `
// ONE canvas per worker, not one per frame. A 4K OffscreenCanvas with a 2D
// context is a GPU-backed surface; allocating and dropping one per frame across
// thousands of frames outruns GC, and the driver ends up holding a queue of
// them. Reused, the pool holds exactly poolSize surfaces for the whole export.
let canvas = null
let ctx = null

self.onmessage = async (e) => {
  const { dir, bitmap, name } = e.data
  try {
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      ctx = canvas.getContext("2d")
    }
    // The frame before it, cleared: these are transparent plates, and drawing
    // over stale pixels would composite every frame onto the last.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    self.postMessage({ bytes: blob.size })
  } catch (err) {
    self.postMessage({ error: (err && err.message) || String(err) })
  } finally {
    // ALWAYS. An ImageBitmap holds GPU memory until it is closed, and at 4K
    // that is 33 MB a frame; closing it only on the success path meant one
    // failed write leaked a frame that nothing would ever collect.
    bitmap.close()
  }
}
`

/**
 * Encoders run beside a WebGPU render loop, so the pool deliberately leaves
 * cores for it: saturating every thread with deflate slows the half of the job
 * that cannot be parallelised at all.
 */
const poolSize = () => {
  const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4
  return Math.min(6, Math.max(2, cores - 2))
}

export type PngSequenceResult = { frames: number; bytes: number }

export class PngSequenceWriter {
  private readonly workers: Worker[] = []
  private readonly idle: Worker[] = []
  private readonly waiting: ((w: Worker) => void)[] = []
  private readonly pending = new Set<Promise<void>>()
  private readonly url: string
  private readonly digits: number
  private frames = 0
  private bytesWritten = 0
  /** First worker error, re-thrown from the next add() or from finish(). */
  private failure: Error | null = null

  constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly prefix: string,
    /** Total frames — decides the zero padding, so a 4-digit name never wraps. */
    total: number,
  ) {
    this.digits = Math.max(4, String(Math.max(1, total)).length)
    this.url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }))
    try {
      for (let i = 0; i < poolSize(); i++) {
        const w = new Worker(this.url)
        this.workers.push(w)
        this.idle.push(w)
      }
    } catch (e) {
      // A pool that failed half-built still holds live workers and an object
      // URL; without this the caller sees a throw and nothing owns either.
      this.terminate()
      throw e
    }
  }

  /** Bytes committed to disk — read once at the end, for the finished caption. */
  get bytes(): number {
    return this.bytesWritten
  }

  private acquire(): Promise<Worker> {
    const free = this.idle.pop()
    if (free) return Promise.resolve(free)
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  private release(w: Worker): void {
    const next = this.waiting.shift()
    if (next) next(w)
    else this.idle.push(w)
  }

  private encode(worker: Worker, bitmap: ImageBitmap, name: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        worker.removeEventListener("message", onMessage)
        const data = e.data as { bytes?: number; error?: string }
        if (data.error) reject(new Error(data.error))
        else resolve(data.bytes ?? 0)
      }
      worker.addEventListener("message", onMessage)
      worker.postMessage({ dir: this.dir, bitmap, name }, [bitmap])
    })
  }

  /**
   * Hand one composited frame to the pool.
   *
   * Awaiting a free worker before grabbing the bitmap is the backpressure: a 4K
   * RGBA bitmap is 33 MB, and a render loop that outran the encoders by even a
   * few seconds would be holding gigabytes of them.
   */
  async add(canvas: HTMLCanvasElement, index: number): Promise<void> {
    if (this.failure) throw this.failure
    const worker = await this.acquire()
    // Everything between acquiring and handing off has to give the worker back.
    // createImageBitmap is the one that can throw (a lost GPU context does it),
    // and the worker it stranded was never released: the pool drained one frame
    // at a time and then acquire() waited on a slot nothing would ever free,
    // while finish() saw an empty queue and reported success on a short folder.
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(canvas)
    } catch (e) {
      this.release(worker)
      throw e
    }
    const name = `${this.prefix}${String(index + 1).padStart(this.digits, "0")}.png`
    // Not awaited — overlapping this encode with the next render is the point.
    const job = this.encode(worker, bitmap, name)
      .then((bytes) => {
        this.bytesWritten += bytes
        this.frames++
      })
      .catch((e: Error) => {
        this.failure ??= e
      })
      .finally(() => this.release(worker))
    this.pending.add(job)
    void job.finally(() => this.pending.delete(job))
  }

  /** Drain the pool, then report what landed. */
  async finish(): Promise<PngSequenceResult> {
    while (this.pending.size) await Promise.all([...this.pending])
    this.terminate()
    if (this.failure) throw this.failure
    return { frames: this.frames, bytes: this.bytesWritten }
  }

  terminate(): void {
    for (const w of this.workers) w.terminate()
    this.workers.length = 0
    this.idle.length = 0
    this.waiting.length = 0
    URL.revokeObjectURL(this.url)
  }
}

/** "9.2 GB" — what the panel reports once an export has finished. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
