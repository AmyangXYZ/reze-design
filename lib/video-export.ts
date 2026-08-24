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
import { coverCrop, type BackdropMedia } from "./backdrop"
import { GREEN, isCompositingBackground, type ExportBackground } from "./export-background"
import { PngSequenceWriter } from "./png-sequence"

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

export type ExportSettings = {
  width: number
  height: number
  fps: number
  audioSource: ExportAudioSource
  /** Draw the Reze Design wordmark bottom-right. */
  watermark: boolean
  background: ExportBackground
  target: ExportTarget
}

export type ExportResult = {
  /** Buffered output, when nothing was streamed straight to disk. */
  blob: Blob | null
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
}): Promise<Blob> {
  const { engine, canvas, settings, backdrop, backgroundColor } = opts
  const { width, height, background } = settings

  // Decoded before the engine is touched, so the render size is restored promptly.
  const bgImage = backdrop && !isCompositingBackground(background) ? await loadImage(backdrop.url) : null

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
    if (bgImage) {
      const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, width, height)
      ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
    }
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

  // ── Audio, decoded up-front (the muxer interleaves it) ──
  const progress = (p: ExportProgress) => opts.onProgress?.(p)
  progress({ phase: "audio", frame: 0, total, encodeFps: 0, etaSeconds: 0 })
  let audioBuffer: AudioBuffer | null = null
  // A PNG sequence has no audio track to carry — the music comes out of the
  // ordinary video export beside it.
  if (target !== "png" && settings.audioSource === "music" && musicUrl)
    audioBuffer = await buildMusicAudio(musicUrl, startTime, duration)

  // ── Backdrop layer (skipped entirely for a compositing handoff) ──
  let bgImage: HTMLImageElement | null = null
  if (backdrop && !isCompositingBackground(background)) bgImage = await loadImage(backdrop.url)

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
  const needsComposite = bgImage !== null || settings.watermark
  const watermarkFont = needsComposite ? brandFontFamily() : ""

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
      // dt=0 renders the t=0 pose itself; afterwards each call advances one frame.
      // Audio time is TRACK time: the export may start mid-song.
      engine.setAudioTime(startTime + t)
      // The score's clock, on the same frame time. Both are per-frame state an
      // effect reads, and both freeze if this loop forgets one — a score-driven
      // effect exported a still keyboard while everything else animated.
      engine.setMidiTime(startTime + t)
      engine.renderFrame(i === 0 ? 0 : 1 / fps)

      if (ctx) {
        paintBase(ctx, background, bgColor, width, height)
        if (bgImage) {
          const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, width, height)
          ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
        }
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
    return { blob, bytes: sink.bytes() ?? blob?.size ?? 0 }
  } catch (e) {
    await sink?.cancel()
    throw e
  } finally {
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
