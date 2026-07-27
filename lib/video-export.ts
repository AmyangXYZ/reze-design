// Offline render-to-video. Drives the engine frame-by-frame (engine.renderFrame(1/fps)
// — deterministic: animation, physics, and the camera VMD all advance exactly one
// frame regardless of wall time) at an explicit resolution (engine.setRenderSize),
// composites the same layer stack the live view shows (background color → backdrop
// image → transparent engine canvas), and encodes via mediabunny (WebCodecs
// hardware encode under the hood) into an mp4 with the music track.

import {
  AudioBufferSource,
  BufferTarget,
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
  /** Draw the Reze Design wordmark bottom-right. Default-on, freely removable —
   *  it's advertising users choose to carry, never a paywall. */
  watermark: boolean
  /** Chroma-key mode: pure #00FF00 background replaces the scene background,
   *  backdrop, and skybox for this export only — for compositing the character
   *  into other footage in an external editor (the classic MMD PV workflow). */
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

// ── Watermark: "REZE DESIGN" wordmark, top-left — uppercase Geist with wide,
// editorial letterspacing and a soft drop shadow. Deliberately pretty and quiet:
// people should WANT to keep it.

/** Geist via next/font gets a hashed family name — read it off the CSS variable. */
const brandFontFamily = () => {
  const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim()
  return fam ? `${fam}, system-ui, sans-serif` : "system-ui, sans-serif"
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, font: string) {
  const size = Math.max(14, Math.round(h * 0.028))
  const pad = Math.round(h * 0.022)
  ctx.save()
  ctx.font = `500 ${size}px ${font}`
  // Wide tracking sells the uppercase wordmark (Chromium supports canvas letterSpacing).
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(size * 0.22).toFixed(1)}px`
  ctx.textBaseline = "top"
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
  ctx.shadowBlur = size * 0.6
  ctx.shadowOffsetY = size * 0.08
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)"
  ctx.fillText("REZE DESIGN", pad, pad)
  ctx.restore()
}

/** Decode the music track and slice [startTime, startTime + exportDuration] out
 *  of it — the export range's audio. A track shorter than the range end simply
 *  goes silent at its natural end. */
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
  modelName: string
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
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<Blob> {
  const { engine, canvas, modelName, duration, settings, backdrop, backgroundColor, musicUrl } = opts
  const startTime = Math.max(0, opts.startTime ?? 0)
  const bgColor = backgroundColor
  const { width, height, fps } = settings
  const total = Math.max(1, Math.round(duration * fps))
  const model = engine.getModel(modelName)
  if (!model) throw new Error("No model loaded")

  const videoCodec = await getFirstEncodableVideoCodec(["avc", "hevc", "av1"], { width, height })
  if (!videoCodec) throw new Error(`No supported video encoder for ${width}×${height}`)

  // ── Composite stack ──
  const composite = document.createElement("canvas")
  composite.width = width
  composite.height = height
  const ctx = composite.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  const watermarkFont = brandFontFamily()

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
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
  if (backdrop && !settings.greenScreen) {
    bgImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("Can't decode backdrop image"))
      el.src = backdrop.url
    })
  }

  // ── Engine: remember live state, switch to offline stepping ──
  const prior = model.getAnimationProgress()
  engine.stopRenderLoop()
  engine.setRenderSize(width, height)
  // Green-screen state (background, ground surface, skybox suspension) is LIVE
  // page state — toggling the switch previews it in the viewport, and the export
  // renders exactly that (WYSIWYG). Here it only affects the composite fill and
  // skips the flat backdrop layer.
  const fillColor = settings.greenScreen ? GREEN : bgColor

  try {
    await output.start()
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer)
      audioSource.close()
    }

    // Seek to the segment start, physics reset + settle so the first frame
    // isn't mid-fall hair (the warm-up settles at whatever pose is current).
    model.pause()
    model.seek(startTime)
    engine.resetPhysics()
    for (let i = 0; i < WARMUP_FRAMES; i++) engine.renderFrame(1 / fps)
    model.play()

    const started = performance.now()
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export canceled", "AbortError")
      const t = i / fps
      // dt=0 renders the t=0 pose itself; afterwards each call advances one frame.
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
    const buffer = (output.target as BufferTarget).buffer
    if (!buffer) throw new Error("Muxer produced no output")
    return new Blob([buffer], { type: "video/mp4" })
  } catch (e) {
    if (output.state === "started") await output.cancel().catch(() => {})
    throw e
  } finally {
    // Restore the live session: viewport-tracked size, background/skybox (green-
    // screen mode suspended them), prior playhead + play state.
    engine.setRenderSize(null)
    model.pause()
    model.seek(prior.current)
    engine.renderFrame(0)
    if (prior.playing) model.play()
    engine.runRenderLoop()
  }
}
