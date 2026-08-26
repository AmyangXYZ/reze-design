// Offline render-to-file — the video export, the PNG sequence that shares its
// render loop, and the single still that shares its composite stack.

import {
  AudioBufferSource,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
} from "mediabunny"
import type { Engine } from "reze-engine"
import { coverCrop, openAnimatedImage, type BackdropKind, type BackdropMedia } from "./backdrop"
import { GREEN, isCompositingBackground, type ExportBackground } from "./export-background"
import { PngSequenceWriter } from "./png-sequence"
import { aeScript, type CastSample, type ShotSample } from "./ae-script"

/**
 * MMD units to AE pixels.
 *
 * A free parameter — scale the camera and everything it looks at by the same
 * number and the projection is unchanged, because the lens comes from the
 * comp's height rather than from the world. 10 puts a ~20-unit MMD figure at
 * 200px, which is a workable size to drop AE layers against and is what the
 * old converter's default lands near.
 */
const AE_SCALE = 10

export type ExportAudioSource = "music" | "none"

export type { ExportBackground }

/**
 * The file that lands.
 *
 * `mp4` carries no alpha at all — the reason the other two exist. `webm` (VP9
 * with alpha side data) plays transparent in browsers and OBS; After Effects
 * has never imported WebM, so `png` is the lane that actually reaches a
 * compositor.
 */
export type ExportTarget = "mp4" | "webm" | "png"

/**
 * A moving card the export has to advance itself.
 *
 * The live scene steps these by seeking a <video>, which is right at wall-clock
 * speed and hopeless offline: a seek costs tens of milliseconds and the export
 * renders faster than that, so the card advanced about once a second while the
 * scene ran on. The export decodes from the FILE at its own frame times, the
 * same way it handles the backdrop, and writes the result into the card's
 * texture before the frame is drawn.
 */
export type ExportPlane = {
  id: string
  file: File
  kind: BackdropKind
  /** The texture's own size — setPlaneFrame refuses anything else. */
  frameWidth: number
  frameHeight: number
}

export type ExportSettings = {
  width: number
  height: number
  fps: number
  audioSource: ExportAudioSource
  /** Draw the Reze Design wordmark bottom-right. */
  watermark: boolean
  /**
   * Also write an After Effects script for this render.
   *
   * The shot and the cast, keyed frame for frame, in a comp built from this
   * export's own width, height, rate and length. Read INSIDE the render loop
   * rather than sampled from the camera clip afterwards — whatever actually
   * drove the shot is what lands in the script, and there is no second opinion
   * to disagree with the file.
   */
  aeScript: boolean
  background: ExportBackground
  target: ExportTarget
}

export type ExportResult = {
  /** Buffered output, when nothing was streamed straight to disk. */
  blob: Blob | null
  /** The After Effects script, when one was asked for. */
  ae: string | null
  /** Bytes produced, where this side of the handoff can count them: a sequence
   *  writer knows its own total, and a buffered muxer has the blob. Streamed
   *  output is 0 — the caller holds the file handle and asks the file. */
  bytes: number
}

export type ExportPhase = "audio" | "video"

export type ExportProgress = {
  phase: ExportPhase
  /** Frames encoded so far (0 during the audio phase). */
  frame: number
  total: number
  /** Encode throughput in output-frames per wall-second. */
  encodeFps: number
  etaSeconds: number
}

/** Physics settle time at pose 0 before capture starts (frames at export fps). */
const WARMUP_FRAMES = 30
/** Yield to the event loop every N frames so the progress UI stays alive. */
const YIELD_EVERY = 3

/**
 * Hand the frame back to the browser so the progress bar can paint.
 *
 * setTimeout(0) is not zero: nested timers are clamped to ~4 ms, which over a
 * 7200-frame 4K export is ten seconds spent waiting on a clamp. scheduler.yield
 * has no clamp and resumes ahead of ordinary tasks.
 */
const yieldToUI = (): Promise<void> => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return s?.yield ? s.yield() : new Promise<void>((r) => setTimeout(r, 0))
}

/** ~0.1 bit/pixel/frame — 1080p60 ≈ 12 Mbps, 4K60 ≈ 50 Mbps — clamped to sane bounds. */
const videoBitrate = (w: number, h: number, fps: number) =>
  Math.round(Math.min(80e6, Math.max(6e6, w * h * fps * 0.1)))

// Watermark: "REZE DESIGN" wordmark, top-left

/** Geist via next/font gets a hashed family name — read it off the CSS variable. */
const brandFontFamily = () => {
  const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim()
  return fam ? `${fam}, system-ui, sans-serif` : "system-ui, sans-serif"
}

/**
 * The wordmark, in the engine demo's own style (web/components/header.tsx):
 * uppercase, ONE regular weight, 0.3em tracking, and a two-part shadow — a soft
 * white bloom over a tight dark drop, so it reads as lit on dark footage and
 * stays legible on bright. No second weight, no icon, no colour: the spacing
 * carries it, which is why that header works.
 *
 * Canvas allows one shadow per fill, so the bloom and the drop are two passes.
 */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, font: string) {
  const size = Math.max(14, Math.round(h * 0.028))
  const pad = Math.round(h * 0.024)
  const cx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  ctx.save()
  ctx.textBaseline = "top"
  ctx.font = `400 ${size}px ${font}`
  cx.letterSpacing = `${(size * 0.3).toFixed(1)}px`
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)"

  // 0 0 20px rgba(255,255,255,0.3) — the demo's bloom, scaled to type size.
  ctx.shadowColor = "rgba(255, 255, 255, 0.3)"
  ctx.shadowBlur = size * 0.83
  ctx.shadowOffsetY = 0
  ctx.fillText("REZE DESIGN", pad, pad)

  // 0 2px 10px rgba(0,0,0,0.5) — and its drop.
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
  ctx.shadowBlur = size * 0.42
  ctx.shadowOffsetY = size * 0.083
  ctx.fillText("REZE DESIGN", pad, pad)
  ctx.restore()
}

/**
 * The backdrop, as one output-sized frame per rendered frame.
 *
 * Both kinds arrive already cover-fitted to the output, so the composite is a
 * single 1:1 drawImage either way — a still is cropped once into a canvas
 * instead of re-cropped 7200 times, and a video is decoded straight to size by
 * the sink.
 */
type BackdropFrames = {
  /** The frame for the next output index, in order. Null before the first. */
  next(): Promise<CanvasImageSource | null>
  close(): void
}

/**
 * A moving backdrop, frame-locked to the render.
 *
 * NOT a <video> element. Seeking one per frame lands on the nearest keyframe
 * and decodes forward, so an offline loop — which runs at whatever speed the
 * render manages, nowhere near realtime — would drift and stutter. The demuxer
 * is handed the loop's OWN timestamps instead, monotonically sorted, which is
 * the case its pipeline documents as decoding each packet at most once. Frame
 * n of the file lands under frame n of the animation by construction rather
 * than by a clock the two have to agree on.
 *
 * The timestamps are scene time, so exporting a segment from 0:30 shows the
 * backdrop at 0:30. Past its end it WRAPS, matching the <video loop> on screen.
 *
 * Wrapping is why the iterator is rebuilt per pass rather than fed one long
 * list. A wrapped sequence is not monotonic — it drops back to zero at every
 * loop — and monotonic is the precondition for the sink decoding each packet
 * once. Handed the sawtooth directly it would seek backwards on every wrap and
 * re-decode from the previous keyframe. One iterator per pass keeps every
 * sequence it sees ascending, so the fast path holds all the way through.
 */
async function openVideoBackdrop(
  media: BackdropMedia,
  o: { width: number; height: number; startTime: number; fps: number; total: number; loop: boolean },
): Promise<BackdropFrames> {
  const { Input, BufferSource, CanvasSink, ALL_FORMATS } = await import("mediabunny")
  // READ ONCE, UP FRONT, rather than letting the demuxer read the File lazily
  // for the length of the export.
  //
  // A File from a picker is a reference to something on disk, and the browser
  // is entitled to decide later that it can no longer read it — "The requested
  // file could not be read, typically due to permission problems that have
  // occurred after a reference to a file was acquired" is the exact failure.
  // A muxed export reads for seconds and rarely loses that race; a PNG sequence
  // runs for minutes, which is long enough for the reference to go stale
  // half-way through and take a finished-looking export down with it.
  //
  // The cost is holding the backdrop in memory for the export. That is bounded
  // and known, next to a render already holding hundreds of megabytes of GPU
  // targets, and it buys a decode that cannot fail part-way for a reason that
  // has nothing to do with the file's contents.
  const bytes = await media.file.arrayBuffer()
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error(`No video track in ${media.name}`)
  const sink = new CanvasSink(track, { width: o.width, height: o.height, fit: "cover", poolSize: 2 })
  const span = o.loop ? Math.max(await track.computeDuration(), 1 / 1000) : Infinity
  /** Scene time -> time within the file, wrapping when the backdrop loops. */
  const sourceTime = (i: number) => {
    const t = o.startTime + i / o.fps
    return span === Infinity ? t : t % span
  }

  /** Timestamps from `from` up to the wrap, which is where this pass ends. */
  const passFrom = (from: number) => {
    let prev = -Infinity
    return (function* () {
      for (let i = from; i < o.total; i++) {
        const t = sourceTime(i)
        if (t < prev) return // the wrap: the next pass starts here
        prev = t
        yield t
      }
    })()
  }

  let held: CanvasImageSource | null = null
  let index = 0
  let frames = sink.canvasesAtTimestamps(passFrom(0))

  return {
    async next() {
      const { value, done } = await frames.next()
      if (done) {
        // This pass ended at a wrap. The next one opens at the same index and
        // begins at the top of the file, ascending again.
        void frames.return(undefined)
        frames = sink.canvasesAtTimestamps(passFrom(index))
        const again = await frames.next()
        if (!again.done && again.value) held = again.value.canvas
      } else if (value) {
        held = value.canvas
      }
      index++
      return held
    },
    close() {
      void frames.return(undefined)
      void input.dispose?.()
    },
  }
}

/**
 * An animated image — gif, animated webp, APNG — decoded frame by frame.
 *
 * Its live layer is an <img>, which has always animated on its own; this path
 * exists because drawImage takes frame one and nothing else, so an animated
 * backdrop exported as a frozen picture. WebCodecs' ImageDecoder reads the
 * rest, and these formats carry a per-frame delay rather than a frame rate, so
 * scene time maps to a frame by walking cumulative durations instead of
 * dividing by an fps the file does not have.
 *
 * They loop by nature and the <img> does too, so this always wraps.
 */
async function openAnimatedBackdrop(
  media: BackdropMedia,
  o: { width: number; height: number; startTime: number; fps: number },
): Promise<BackdropFrames> {
  // The shared opener: it waits on tracks.ready rather than completed, and
  // falls back to the extension when a bundled File has no type. Null means
  // nothing here can step it, and the still path draws it correctly.
  const opened = await openAnimatedImage(media.file)
  if (!opened) return openImageBackdrop(media, o)
  const { dec, frames: count } = opened

  // WHEN each frame ends, walked once. These formats carry a per-frame delay
  // rather than a frame rate, so there is no arithmetic that skips this.
  //
  // The frames themselves are NOT kept. Fitting all of them to the output up
  // front is the obvious move and is unaffordable: an output-sized canvas is
  // 33 MB at 4K, so a hundred-frame gif would hold three gigabytes to save a
  // decode. They are closed as they are counted, and the frame actually needed
  // is decoded when the index changes — which for a ~10 fps gif against a 60
  // fps export is once every six output frames, and never for the five in
  // between.
  const ends: number[] = []
  let acc = 0
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i })
    // Microseconds. A frame with no stated delay runs at the 100 ms every
    // decoder substitutes for one.
    acc += (image.duration ?? 100_000) / 1e6
    image.close()
    ends.push(acc)
  }
  const span = Math.max(acc, 1 / 1000)

  // One scratch canvas, reused: the composite draws whatever this returns 1:1,
  // so the cover-fit happens here once per frame CHANGE rather than per output
  // frame.
  const scratch = document.createElement("canvas")
  scratch.width = o.width
  scratch.height = o.height
  const sx = scratch.getContext("2d")!
  sx.imageSmoothingQuality = "high"

  let index = 0
  let shown = -1
  let closed = false
  return {
    async next() {
      const t = (o.startTime + index / o.fps) % span
      index++
      let f = 0
      while (f < ends.length - 1 && t >= ends[f]) f++
      if (f !== shown && !closed) {
        const { image } = await dec.decode({ frameIndex: f })
        const crop = coverCrop(image.displayWidth, image.displayHeight, o.width, o.height)
        sx.clearRect(0, 0, o.width, o.height)
        sx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, o.width, o.height)
        image.close()
        shown = f
      }
      return shown >= 0 ? scratch : null
    },
    close() {
      closed = true
      dec.close()
    },
  }
}

/** The frame source this backdrop needs, by kind. */
function openBackdrop(
  media: BackdropMedia,
  o: { width: number; height: number; startTime: number; fps: number; total: number },
): Promise<BackdropFrames> {
  if (media.kind === "video") return openVideoBackdrop(media, { ...o, loop: true })
  if (media.kind === "animated") return openAnimatedBackdrop(media, o)
  return openImageBackdrop(media, o)
}

/** A still, cover-cropped once into an output-sized canvas. */
async function openImageBackdrop(
  media: BackdropMedia,
  o: { width: number; height: number },
): Promise<BackdropFrames> {
  const img = await loadImage(media.url)
  const fitted = document.createElement("canvas")
  fitted.width = o.width
  fitted.height = o.height
  const fctx = fitted.getContext("2d")!
  fctx.imageSmoothingQuality = "high"
  const c = coverCrop(img.naturalWidth, img.naturalHeight, o.width, o.height)
  fctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, o.width, o.height)
  return { next: async () => fitted, close: () => {} }
}

/** Backdrop bitmap, decoded once. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("Can't decode backdrop image"))
    el.src = url
  })
}

/**
 * Paint the layer the cast lands on.
 *
 * Transparent mode CLEARS rather than fills: a 2D canvas keeps whatever it drew
 * last, so skipping the fill would composite every frame onto the one before it
 * and smear the whole shot into a single accumulating ghost.
 */
function paintBase(
  ctx: CanvasRenderingContext2D,
  background: ExportBackground,
  color: string,
  w: number,
  h: number,
) {
  if (background === "alpha") {
    ctx.clearRect(0, 0, w, h)
    return
  }
  ctx.fillStyle = background === "green" ? GREEN : color
  ctx.fillRect(0, 0, w, h)
}

/**
 * One frame of the same composite the video produces, as a PNG.
 *
 * Nothing seeks and nothing resets physics: the still is the pose that was on
 * screen when the button was pressed, rendered at the output size instead of the
 * viewport's. That makes it the obvious way to produce a publish thumbnail —
 * the framing you were just looking at, at the resolution you were going to
 * render at. In transparent mode the PNG carries its alpha, so the same button
 * is also how you get one plate out for a still comp.
 */
export async function captureStill(opts: {
  engine: Engine
  /** The engine's (transparent) WebGPU canvas — composited over the backdrop. */
  canvas: HTMLCanvasElement
  settings: Pick<ExportSettings, "width" | "height" | "watermark" | "background">
  backdrop: BackdropMedia | null
  backgroundColor: string
  /** Scene time of the pose being captured — which backdrop frame a moving
   *  backdrop is showing. Ignored for a still backdrop. */
  atTime?: number
}): Promise<Blob> {
  const { engine, canvas, settings, backdrop, backgroundColor } = opts
  const { width, height, background } = settings

  // Decoded before the engine is touched, so the render size is restored promptly.
  const wantsBackdrop = backdrop && !isCompositingBackground(background)
  // The still shares the video path's frame lookup, so the frame under the pose
  // is the frame the video export would put there.
  const bgFrames = wantsBackdrop
    ? await openBackdrop(backdrop, {
        width,
        height,
        startTime: Math.max(0, opts.atTime ?? 0),
        fps: 1,
        total: 1,
      })
    : null
  const bgFrame = bgFrames ? await bgFrames.next() : null
  bgFrames?.close()

  const composite = document.createElement("canvas")
  composite.width = width
  composite.height = height
  const ctx = composite.getContext("2d")!
  ctx.imageSmoothingQuality = "high"

  // Stopped, because the live loop would redraw at viewport size in the gap
  // between our frame and reading it back.
  engine.stopRenderLoop()
  // Restore the exact pixels we found, NOT null: null means viewport-tracking,
  // and if the host had pinned the canvas to a framed aspect, a null restore
  // painted one viewport-sized frame before the host could re-pin — a visible
  // aspect flash after every capture. Same-size restore has no wrong frame;
  // the host then re-asserts pin-or-tracking invisibly.
  const prevW = canvas.width
  const prevH = canvas.height
  engine.setRenderSize(width, height)
  try {
    // dt = 0 redraws the current pose rather than advancing it.
    engine.renderFrame(0)
    paintBase(ctx, background, backgroundColor, width, height)
    if (bgFrame) ctx.drawImage(bgFrame, 0, 0, width, height)
    ctx.drawImage(canvas, 0, 0, width, height)
    if (settings.watermark) drawWatermark(ctx, width, height, brandFontFamily())
  } finally {
    engine.setRenderSize(prevW, prevH)
    engine.renderFrame(0)
    engine.runRenderLoop()
  }

  const blob = await new Promise<Blob | null>((resolve) => composite.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Canvas produced no image")
  return blob
}

/** Decode the music track and slice [startTime, startTime + exportDuration] out */
async function buildMusicAudio(url: string, startTime: number, exportDuration: number): Promise<AudioBuffer | null> {
  const data = await (await fetch(url)).arrayBuffer()
  const ac = new AudioContext()
  try {
    const decoded = await ac.decodeAudioData(data)
    if (startTime <= 0 && decoded.duration <= exportDuration + 0.05) return decoded
    const rate = decoded.sampleRate
    const from = Math.min(Math.floor(startTime * rate), decoded.length)
    const length = Math.max(1, Math.min(Math.ceil(exportDuration * rate), decoded.length - from))
    const out = new AudioBuffer({ length, numberOfChannels: decoded.numberOfChannels, sampleRate: rate })
    for (let c = 0; c < decoded.numberOfChannels; c++)
      out.getChannelData(c).set(decoded.getChannelData(c).subarray(from, from + length))
    return out
  } finally {
    void ac.close()
  }
}

/**
 * Where composited frames go.
 *
 * The render loop is identical for a muxed video and for a folder of PNGs —
 * same warmup, same clocks, same restore — so the difference is one object
 * rather than a second copy of the loop.
 */
type FrameSink = {
  /** One composited frame, in order. Awaits encoder or writer backpressure. */
  add(index: number, time: number): Promise<void>
  /** Bytes on disk so far, where the sink can know. */
  bytes(): number | undefined
  /** Returns a Blob only when the output was buffered in memory. */
  finish(): Promise<Blob | null>
  cancel(): Promise<void>
}

/** Muxed video — MP4 (opaque) or WebM (VP9 carrying alpha side data). */
async function muxerSink(opts: {
  composite: HTMLCanvasElement
  settings: ExportSettings
  fps: number
  audioBuffer: AudioBuffer | null
  fileStream?: FileSystemWritableFileStream
}): Promise<FrameSink> {
  const { composite, settings, fps, audioBuffer, fileStream } = opts
  const { width, height, target } = settings
  const webm = target === "webm"

  const videoCodec = await getFirstEncodableVideoCodec(webm ? ["vp9", "vp8"] : ["avc", "hevc", "av1"], {
    width,
    height,
  })
  if (!videoCodec) throw new Error(`No supported video encoder for ${width}×${height}`)

  const output = new Output({
    format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(),
    // StreamTarget is FileSystemWritableFileStream-compatible
    target: fileStream ? new StreamTarget(fileStream, { chunked: true }) : new BufferTarget(),
  })
  const videoSource = new CanvasSource(composite, {
    codec: videoCodec,
    bitrate: videoBitrate(width, height, fps),
    // mediabunny splits colour and alpha on the CPU when the encoder cannot
    // keep alpha itself, and emits the alpha as VP9 side data — which is what
    // makes the track come out marked transparent.
    alpha: settings.background === "alpha" ? "keep" : "discard",
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  let audioSource: AudioBufferSource | null = null
  if (audioBuffer) {
    // WebM has no AAC. Asking for it anyway would have the muxer reject the
    // track after the video had already been configured.
    const audioCodec = await getFirstEncodableAudioCodec(webm ? ["opus"] : ["aac", "opus"], {
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
    })
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 })
      output.addAudioTrack(audioSource)
    }
  }

  await output.start()
  if (audioSource && audioBuffer) {
    await audioSource.add(audioBuffer)
    audioSource.close()
  }

  return {
    add: (_index, time) => videoSource.add(time, 1 / fps).then(() => undefined),
    bytes: () => undefined,
    async finish() {
      videoSource.close()
      await output.finalize()
      if (fileStream) return null // streamed to disk — nothing to hand back
      const buffer = (output.target as BufferTarget).buffer
      if (!buffer) throw new Error("Muxer produced no output")
      return new Blob([buffer], { type: webm ? "video/webm" : "video/mp4" })
    },
    async cancel() {
      if (output.state === "started") await output.cancel().catch(() => {})
    },
  }
}

/** A folder of numbered PNGs, encoded and written by a worker pool. */
function pngSink(opts: {
  composite: HTMLCanvasElement
  dir: FileSystemDirectoryHandle
  total: number
}): FrameSink {
  const writer = new PngSequenceWriter(opts.dir, "frame_", opts.total)
  return {
    add: (index) => writer.add(opts.composite, index),
    bytes: () => writer.bytes,
    async finish() {
      await writer.finish()
      return null
    },
    async cancel() {
      writer.terminate()
    },
  }
}

export async function exportVideo(opts: {
  engine: Engine
  /** The engine's (transparent) WebGPU canvas — composited over the backdrop. */
  canvas: HTMLCanvasElement
  /** Master model (longest clip) — its clock defines the timeline. */
  modelName: string
  /** Every OTHER animated model */
  extraModelNames?: string[]
  /** Segment start on the clip's timeline, seconds (default 0). */
  startTime?: number
  /** Segment length in seconds — defines the video length. */
  duration: number
  settings: ExportSettings
  backdrop: BackdropMedia | null
  /** Page background hex — the bottom composite layer. */
  backgroundColor: string
  /** Object/blob URL of the music track (used when audioSource === "music"). */
  musicUrl: string | null
  /** File System Access API writable — muxed targets. */
  fileStream?: FileSystemWritableFileStream
  /** Destination folder — PNG sequence target. */
  directory?: FileSystemDirectoryHandle
  /** Moving cards in the scene, advanced by this loop rather than by the clock. */
  planes?: ExportPlane[]
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<ExportResult> {
  const { engine, canvas, modelName, duration, settings, backdrop, backgroundColor, musicUrl } = opts
  const startTime = Math.max(0, opts.startTime ?? 0)
  const bgColor = backgroundColor
  const { width, height, fps, background, target } = settings
  const total = Math.max(1, Math.round(duration * fps))
  const model = engine.getModel(modelName)
  if (!model) throw new Error("No model loaded")
  const extras = (opts.extraModelNames ?? [])
    .map((n) => engine.getModel(n))
    .filter((m): m is NonNullable<typeof m> => !!m)
  const cast = [model, ...extras]
  if (target === "png" && !opts.directory) throw new Error("No destination folder")

  // Where the shot is collected, or null when nobody asked for it. Allocated
  // up front so the render loop's branch is a null check rather than a settings
  // lookup per frame.
  //
  // 全ての親 is the bone a whole MMD figure hangs from — the same one camera
  // follow targets by default — so a null on it is where the character IS,
  // which is what a compositor wants to attach something to. The model's root
  // transform is where you PUT her, and it does not move.
  const shot: {
    camera: ShotSample[]
    cast: { id: string; name: string; bone: string; samples: CastSample[] }[]
  } | null = settings.aeScript
    ? {
        camera: [],
        cast: [modelName, ...(opts.extraModelNames ?? [])]
          .filter((n) => engine.getModel(n))
          .map((n) => ({ id: n, name: n, bone: "全ての親", samples: [] })),
      }
    : null

  // ── Audio, decoded up-front (the muxer interleaves it) ──
  const progress = (p: ExportProgress) => opts.onProgress?.(p)
  progress({ phase: "audio", frame: 0, total, encodeFps: 0, etaSeconds: 0 })
  let audioBuffer: AudioBuffer | null = null
  // A PNG sequence has no audio track to carry — the music comes out of the
  // ordinary video export beside it.
  if (target !== "png" && settings.audioSource === "music" && musicUrl)
    audioBuffer = await buildMusicAudio(musicUrl, startTime, duration)

  // ── Backdrop layer (skipped entirely for a compositing handoff) ──
  const backdropFrames =
    backdrop && !isCompositingBackground(background)
      ? await openBackdrop(backdrop, { width, height, startTime, fps, total })
      : null

  /**
   * Is there anything to composite?
   *
   * The 2D canvas exists to put layers UNDER and OVER the render — a backdrop
   * photo and the wordmark. With neither, every one of its operations is a
   * repaint of something the engine already drew: it fills the same colour the
   * engine's own background is set to, then copies a 4K frame onto it, and the
   * encoder copies that 4K frame again. Encoding the engine canvas directly
   * halves the per-frame copying, and it is the common case for exactly the
   * modes that need the speed — green screen and transparent both arrive here
   * with no backdrop, and both force the watermark off.
   */
  const needsComposite = backdropFrames !== null || settings.watermark
  const watermarkFont = needsComposite ? brandFontFamily() : ""

  // Moving cards, opened at their OWN texture size — a card is a fixed
  // rectangle of texels and setPlaneFrame refuses any other, so there is no
  // fitting to do here.
  const planeSources = await Promise.all(
    (opts.planes ?? []).map(async (p) => ({
      plane: p,
      frames: await openBackdrop(
        {
          file: p.file,
          url: "",
          name: p.file.name,
          width: p.frameWidth,
          height: p.frameHeight,
          kind: p.kind,
          duration: null,
          fps: null,
        },
        { width: p.frameWidth, height: p.frameHeight, startTime, fps, total },
      ),
    })),
  )

  // ── Engine: remember live state, switch to offline stepping ──
  const prior = model.getAnimationProgress()
  engine.stopRenderLoop()
  // Same-size restore as captureStill — see the note there.
  const prevW = canvas.width
  const prevH = canvas.height
  let sink: FrameSink | null = null

  try {
    // Before the sink: a source canvas has to be at output size when the
    // encoder reads its dimensions off the first frame.
    engine.setRenderSize(width, height)
    // Compositing state (background, ground surface, skybox suspension) is LIVE page state

    let ctx: CanvasRenderingContext2D | null = null
    let source = canvas
    if (needsComposite) {
      const composite = document.createElement("canvas")
      composite.width = width
      composite.height = height
      ctx = composite.getContext("2d")!
      ctx.imageSmoothingQuality = "high"
      source = composite
    }

    sink =
      target === "png"
        ? pngSink({ composite: source, dir: opts.directory!, total })
        : await muxerSink({ composite: source, settings, fps, audioBuffer, fileStream: opts.fileStream })

    // Seek to the segment start, physics reset + settle so the first frame isn't mid-fall hair
    for (const m of cast) {
      m.pause()
      m.seek(startTime)
    }
    engine.resetPhysics()
    // The rzAudio* clock, driven with the export's own exact frame times — the
    // reason analysis is precomputed instead of live: this loop does not play
    // audio, it states what time it is.
    engine.setAudioTime(startTime)
    engine.setMidiTime(startTime)
    for (let i = 0; i < WARMUP_FRAMES; i++) engine.renderFrame(1 / fps)
    for (const m of cast) m.play()

    const started = performance.now()
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export canceled", "AbortError")
      const t = i / fps

      // THE BACKDROP IS FETCHED BEFORE THE RENDER, and this order is load-bearing.
      //
      // A WebGPU canvas is presented at the end of the task that drew it, and
      // its contents are not guaranteed to survive into the next one. Reading
      // it back therefore has to happen in the SAME task as renderFrame, with
      // nothing awaited in between — and this await is a real one, since the
      // sink decodes.
      //
      // With the await sitting between the two, the first frames of an export
      // composited the backdrop over an already-presented, cleared canvas: a
      // moving background with no cast in front of it. Only the first few,
      // because that is when the decoder is opening its pipeline and the wait
      // is long; once it is running ahead the promise settles in a microtask
      // and the canvas survives, which is exactly what makes the bug look
      // intermittent rather than structural.
      const bgFrame = backdropFrames ? await backdropFrames.next() : null
      // Cards, before the render for the same reason: the texture a card samples
      // has to hold this frame's picture by the time the frame is drawn.
      for (const s of planeSources) {
        const frame = await s.frames.next()
        // The narrowing is real, not a cast for the compiler's sake: a frame
        // source yields canvases and decoded images, both of which WebGPU
        // accepts — the union it is typed as also admits an SVG element, which
        // it does not.
        if (frame && !(frame instanceof SVGImageElement)) {
          engine.setPlaneFrame(s.plane.id, frame, s.plane.frameWidth, s.plane.frameHeight)
        }
      }

      // dt=0 renders the t=0 pose itself; afterwards each call advances one frame.
      // Audio time is TRACK time: the export may start mid-song.
      engine.setAudioTime(startTime + t)
      // The score's clock, on the same frame time. Both are per-frame state an
      // effect reads, and both freeze if this loop forgets one — a score-driven
      // effect exported a still keyboard while everything else animated.
      engine.setMidiTime(startTime + t)
      engine.renderFrame(i === 0 ? 0 : 1 / fps)

      // THE SHOT, AFTER THE FRAME IS BUILT AND BEFORE ANYTHING ELSE TOUCHES IT.
      //
      // Here, and not from the camera clip afterwards, because a clip is only
      // one of the things that can move this camera: a follow, a framing
      // override, an orbit the person left it on. Read in the loop, the script
      // describes the video. Read from the VMD, it describes a video that would
      // have been rendered if nothing else had a say — and the two part company
      // silently, which is the worst way for a compositing tool to be wrong.
      if (shot) {
        const p = engine.getCameraPose()
        shot.camera.push({
          target: [p.target.x, p.target.y, p.target.z],
          rotation: [p.rotation.x, p.rotation.y, p.rotation.z],
          distance: p.distance,
          fov: p.fov,
        })
        for (const m of shot.cast) {
          const model = engine.getModel(m.id)
          // Model space out of the bone, so the model's own placement composes
          // on top — a character standing at the origin is the common case and
          // exactly the one that would hide this if it were skipped.
          const b = model?.getBoneWorldPosition(m.bone) ?? null
          const at = model?.position
          m.samples.push({
            position: b && at ? [b.x + at.x, b.y + at.y, b.z + at.z] : [0, 0, 0],
            rotation: [0, 0, 0],
          })
        }
      }

      // From here to the end of this iteration: no await before the canvas has
      // been consumed.
      if (ctx) {
        paintBase(ctx, background, bgColor, width, height)
        // Already cover-fitted to the output — see BackdropFrames.
        if (bgFrame) ctx.drawImage(bgFrame, 0, 0, width, height)
        ctx.drawImage(canvas, 0, 0, width, height)
        if (settings.watermark) drawWatermark(ctx, width, height, watermarkFont)
      }

      await sink.add(i, t)

      const elapsed = (performance.now() - started) / 1000
      const encodeFps = (i + 1) / Math.max(elapsed, 1e-3)
      progress({ phase: "video", frame: i + 1, total, encodeFps, etaSeconds: (total - i - 1) / encodeFps })
      if (i % YIELD_EVERY === 0) await yieldToUI()
    }

    const blob = await sink.finish()
    return {
      blob,
      bytes: sink.bytes() ?? blob?.size ?? 0,
      // Built from the SAME numbers the video was: the comp's size, rate and
      // length all come from this export rather than from anything the person
      // has to keep in step.
      ae: shot
        ? aeScript({
            width,
            height,
            fps,
            frames: shot.camera.length,
            startTime,
            camera: shot.camera,
            cast: shot.cast.map((m) => ({ name: m.name, samples: m.samples })),
            scale: AE_SCALE,
          })
        : null,
    }
  } catch (e) {
    await sink?.cancel()
    throw e
  } finally {
    backdropFrames?.close()
    for (const s of planeSources) s.frames.close()
    // Restore the live session at the exact prior size (the host re-asserts
    // pin-or-tracking afterwards), background/skybox (compositing mode
    engine.setRenderSize(prevW, prevH)
    for (const m of cast) {
      m.pause()
      m.seek(prior.current)
    }
    engine.renderFrame(0)
    if (prior.playing) for (const m of cast) m.play()
    engine.runRenderLoop()
  }
}
