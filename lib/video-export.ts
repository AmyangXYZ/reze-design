// Offline render-to-video. Drives the engine frame-by-frame (engine.renderFrame(1/fps)
// — deterministic: animation, physics, and the camera VMD all advance exactly one
// frame regardless of wall time) at an explicit resolution (engine.setRenderSize),
// composites the same layer stack the live view shows (background color → backdrop
// image/video → transparent engine canvas), and encodes via mediabunny (WebCodecs
// hardware encode under the hood) into an mp4 with the chosen audio track.
//
// The backdrop video is sampled frame-accurately with a linear decoder (CanvasSink
// iterator — export time moves forward, so no seeking), looping when shorter than
// the clip; its audio (or the music track) is assembled into one AudioBuffer.

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  type WrappedCanvas,
} from "mediabunny"
import type { Engine } from "reze-engine"
import { coverCrop, type BackdropMedia } from "./backdrop"

export type ExportAudioSource = "music" | "backdrop" | "none"

export type ExportSettings = {
  width: number
  height: number
  fps: number
  audioSource: ExportAudioSource
  /** Draw the Reze Design wordmark bottom-right. Default-on, freely removable —
   *  it's advertising users choose to carry, never a paywall. */
  watermark: boolean
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

/** Frame-accurate, forward-only sampler over the backdrop video, looping at its
 *  duration. Decodes linearly (no seeks); a loop wrap restarts the iterator. */
async function createBackdropSampler(backdrop: BackdropMedia) {
  const input = new Input({ source: new BlobSource(backdrop.file), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) {
    input.dispose()
    return null
  }
  const sink = new CanvasSink(track, { poolSize: 3 })
  const cycle = backdrop.duration
  let iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null
  let current: WrappedCanvas | null = null
  let pending: WrappedCanvas | null = null
  let prevLocal = Infinity

  return {
    /** Latest frame at export time `t` (seconds), or null before the first sample. */
    async frameAt(t: number): Promise<WrappedCanvas | null> {
      const local = cycle > 0 ? t % cycle : 0
      if (local < prevLocal) {
        // First call or loop wrap — restart the linear decode from the top.
        await iter?.return()
        iter = sink.canvases(0)
        current = null
        pending = null
      }
      prevLocal = local
      for (;;) {
        if (pending) {
          if (pending.timestamp > local) break
          current = pending
          pending = null
          continue
        }
        const r = await iter!.next()
        if (r.done) break
        if (r.value.timestamp <= local) current = r.value
        else {
          pending = r.value
          break
        }
      }
      return current
    },
    dispose() {
      void iter?.return()
      input.dispose()
    },
  }
}

/** Decode the music track and trim it to the clip length (shorter tracks are kept
 *  as-is — the tail of the video is simply silent). */
async function buildMusicAudio(url: string, exportDuration: number): Promise<AudioBuffer | null> {
  const data = await (await fetch(url)).arrayBuffer()
  const ac = new AudioContext()
  try {
    const decoded = await ac.decodeAudioData(data)
    if (decoded.duration <= exportDuration + 0.05) return decoded
    const length = Math.ceil(exportDuration * decoded.sampleRate)
    const out = new AudioBuffer({
      length,
      numberOfChannels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
    })
    for (let c = 0; c < decoded.numberOfChannels; c++)
      out.getChannelData(c).set(decoded.getChannelData(c).subarray(0, length))
    return out
  } finally {
    void ac.close()
  }
}

/** Extract the backdrop video's audio and loop it to the clip length — matching the
 *  looping video layer, so picture and sound stay consistent. */
async function buildBackdropAudio(backdrop: BackdropMedia, exportDuration: number): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(backdrop.file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const sink = new AudioBufferSink(track)
    const chunks: { buffer: AudioBuffer; timestamp: number }[] = []
    for await (const w of sink.buffers(0, backdrop.duration)) chunks.push({ buffer: w.buffer, timestamp: w.timestamp })
    if (!chunks.length) return null
    const rate = chunks[0].buffer.sampleRate
    const channels = chunks[0].buffer.numberOfChannels
    const out = new AudioBuffer({ length: Math.ceil(exportDuration * rate), numberOfChannels: channels, sampleRate: rate })
    const cycle = backdrop.duration > 0 ? backdrop.duration : exportDuration
    for (let base = 0; base < exportDuration; base += cycle) {
      for (const c of chunks) {
        const start = Math.round((base + c.timestamp) * rate)
        if (start >= out.length) break
        for (let ch = 0; ch < channels; ch++) {
          const src = c.buffer.getChannelData(Math.min(ch, c.buffer.numberOfChannels - 1))
          const n = Math.min(src.length, out.length - start)
          out.getChannelData(ch).set(src.subarray(0, n), start)
        }
      }
      if (cycle <= 0) break
    }
    return out
  } finally {
    input.dispose()
  }
}

export async function exportVideo(opts: {
  engine: Engine
  /** The engine's (transparent) WebGPU canvas — composited over the backdrop. */
  canvas: HTMLCanvasElement
  modelName: string
  /** Clip length in seconds — defines the video length. */
  duration: number
  settings: ExportSettings
  backdrop: BackdropMedia | null
  /** Scene background color (hex) — the bottom composite layer, as in the live view. */
  bgColor: string
  /** Object/blob URL of the music track (used when audioSource === "music"). */
  musicUrl: string | null
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<Blob> {
  const { engine, canvas, modelName, duration, settings, backdrop, bgColor, musicUrl } = opts
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
  if (settings.audioSource === "music" && musicUrl) audioBuffer = await buildMusicAudio(musicUrl, duration)
  else if (settings.audioSource === "backdrop" && backdrop?.kind === "video" && backdrop.hasAudio)
    audioBuffer = await buildBackdropAudio(backdrop, duration)
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

  // ── Backdrop layers ──
  let bgImage: HTMLImageElement | null = null
  if (backdrop?.kind === "image") {
    bgImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("Can't decode backdrop image"))
      el.src = backdrop.url
    })
  }
  const sampler = backdrop?.kind === "video" ? await createBackdropSampler(backdrop) : null

  // ── Engine: remember live state, switch to offline stepping ──
  const prior = model.getAnimationProgress()
  engine.stopRenderLoop()
  engine.setRenderSize(width, height)

  try {
    await output.start()
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer)
      audioSource.close()
    }

    // Pose 0, physics reset + settle so frame 0 isn't mid-fall hair.
    model.pause()
    model.seek(0)
    engine.resetPhysics()
    for (let i = 0; i < WARMUP_FRAMES; i++) engine.renderFrame(1 / fps)
    model.play()

    const started = performance.now()
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export canceled", "AbortError")
      const t = i / fps
      // dt=0 renders the t=0 pose itself; afterwards each call advances one frame.
      engine.renderFrame(i === 0 ? 0 : 1 / fps)

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)
      if (bgImage) {
        const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, width, height)
        ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
      } else if (sampler) {
        const f = await sampler.frameAt(t)
        if (f) {
          const c = coverCrop(f.canvas.width, f.canvas.height, width, height)
          ctx.drawImage(f.canvas, c.sx, c.sy, c.sw, c.sh, 0, 0, width, height)
        }
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
    sampler?.dispose()
    // Restore the live session: viewport-tracked size, prior playhead + play state.
    engine.setRenderSize(null)
    model.pause()
    model.seek(prior.current)
    engine.renderFrame(0)
    if (prior.playing) model.play()
    engine.runRenderLoop()
  }
}
