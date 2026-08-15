// Offline render-to-file — the video export, and the single still that shares its
// composite stack.

import {
  AudioBufferSource,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
} from "mediabunny"
import type { Engine } from "reze-engine"
import { coverCrop, type BackdropMedia } from "./backdrop"

export type ExportAudioSource = "music" | "none"

export type ExportSettings = {
  width: number
  height: number
  fps: number
  audioSource: ExportAudioSource
  /** Draw the Reze Design wordmark bottom-right. */
  watermark: boolean
  /** Chroma-key mode: pure #00FF00 background replaces the scene background, backdrop */
  greenScreen: boolean
}

const GREEN = "#00ff00"

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
 * One frame of the same composite the video produces, as a PNG.
 *
 * Nothing seeks and nothing resets physics: the still is the pose that was on
 * screen when the button was pressed, rendered at the output size instead of the
 * viewport's. That makes it the obvious way to produce a publish thumbnail —
 * the framing you were just looking at, at the resolution you were going to
 * render at.
 */
export async function captureStill(opts: {
  engine: Engine
  /** The engine's (transparent) WebGPU canvas — composited over the backdrop. */
  canvas: HTMLCanvasElement
  settings: Pick<ExportSettings, "width" | "height" | "watermark" | "greenScreen">
  backdrop: BackdropMedia | null
  backgroundColor: string
}): Promise<Blob> {
  const { engine, canvas, settings, backdrop, backgroundColor } = opts
  const { width, height } = settings

  // Decoded before the engine is touched, so the render size is restored promptly.
  const bgImage = backdrop && !settings.greenScreen ? await loadImage(backdrop.url) : null

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
    ctx.fillStyle = settings.greenScreen ? GREEN : backgroundColor
    ctx.fillRect(0, 0, width, height)
    if (bgImage) {
      const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, width, height)
      ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
    }
    ctx.drawImage(canvas, 0, 0, width, height)
    if (settings.watermark && !settings.greenScreen) drawWatermark(ctx, width, height, brandFontFamily())
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
  /** File System Access API writable */
  fileStream?: FileSystemWritableFileStream
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<Blob | null> {
  const { engine, canvas, modelName, duration, settings, backdrop, backgroundColor, musicUrl } = opts
  const startTime = Math.max(0, opts.startTime ?? 0)
  const bgColor = backgroundColor
  const { width, height, fps } = settings
  const total = Math.max(1, Math.round(duration * fps))
  const model = engine.getModel(modelName)
  if (!model) throw new Error("No model loaded")
  const extras = (opts.extraModelNames ?? [])
    .map((n) => engine.getModel(n))
    .filter((m): m is NonNullable<typeof m> => !!m)
  const cast = [model, ...extras]

  const videoCodec = await getFirstEncodableVideoCodec(["avc", "hevc", "av1"], { width, height })
  if (!videoCodec) throw new Error(`No supported video encoder for ${width}×${height}`)

  // ── Composite stack ──
  const composite = document.createElement("canvas")
  composite.width = width
  composite.height = height
  const ctx = composite.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  const watermarkFont = brandFontFamily()

  const output = new Output({
    format: new Mp4OutputFormat(),
    // StreamTarget is FileSystemWritableFileStream-compatible
    target: opts.fileStream ? new StreamTarget(opts.fileStream, { chunked: true }) : new BufferTarget(),
  })
  const videoSource = new CanvasSource(composite, {
    codec: videoCodec,
    bitrate: videoBitrate(width, height, fps),
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  // ── Audio track (assembled up-front; the muxer interleaves) ──
  const progress = (p: ExportProgress) => opts.onProgress?.(p)
  progress({ phase: "audio", frame: 0, total, encodeFps: 0, etaSeconds: 0 })
  let audioBuffer: AudioBuffer | null = null
  if (settings.audioSource === "music" && musicUrl) audioBuffer = await buildMusicAudio(musicUrl, startTime, duration)
  let audioSource: AudioBufferSource | null = null
  if (audioBuffer) {
    const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], {
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
    })
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 })
      output.addAudioTrack(audioSource)
    }
  }

  // ── Backdrop layer (skipped entirely in green-screen mode) ──
  let bgImage: HTMLImageElement | null = null
  if (backdrop && !settings.greenScreen) bgImage = await loadImage(backdrop.url)

  // ── Engine: remember live state, switch to offline stepping ──
  const prior = model.getAnimationProgress()
  engine.stopRenderLoop()
  // Same-size restore as captureStill — see the note there.
  const prevW = canvas.width
  const prevH = canvas.height
  engine.setRenderSize(width, height)
  // Green-screen state (background, ground surface, skybox suspension) is LIVE page state
  const fillColor = settings.greenScreen ? GREEN : bgColor

  try {
    await output.start()
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer)
      audioSource.close()
    }

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
    engine.setScoreTime(startTime)
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
      engine.setScoreTime(startTime + t)
      engine.renderFrame(i === 0 ? 0 : 1 / fps)

      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, width, height)
      if (bgImage) {
        const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, width, height)
        ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
      }
      ctx.drawImage(canvas, 0, 0, width, height)
      if (settings.watermark) drawWatermark(ctx, width, height, watermarkFont)

      await videoSource.add(t, 1 / fps)

      const elapsed = (performance.now() - started) / 1000
      const encodeFps = (i + 1) / Math.max(elapsed, 1e-3)
      progress({ phase: "video", frame: i + 1, total, encodeFps, etaSeconds: (total - i - 1) / encodeFps })
      if (i % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0))
    }
    videoSource.close()

    await output.finalize()
    if (opts.fileStream) return null // streamed to disk — nothing to hand back
    const buffer = (output.target as BufferTarget).buffer
    if (!buffer) throw new Error("Muxer produced no output")
    return new Blob([buffer], { type: "video/mp4" })
  } catch (e) {
    if (output.state === "started") await output.cancel().catch(() => {})
    throw e
  } finally {
    // Restore the live session at the exact prior size (the host re-asserts
    // pin-or-tracking afterwards), background/skybox (green-screen mode
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
