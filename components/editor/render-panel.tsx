"use client"

// Right dock · Render tab — where a finished scene becomes an exported video.

import { memo, useEffect, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { Camera, Clapperboard, Film, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BackdropMedia } from "@/lib/backdrop"
import {
  captureStill,
  exportAeScript,
  exportVideo,
  type ExportAudioSource,
  type ExportPlane,
  type ExportProgress,
  type ExportTarget,
} from "@/lib/video-export"
import { isCompositingBackground, type ExportBackground } from "@/lib/export-background"
import { formatBytes } from "@/lib/png-sequence"
import { downloadBlob } from "@/lib/scene-file"
import { useT } from "@/lib/i18n"

// Minimal config, iMovie-export style
const VIDEO_FPS = 60

/**
 * What lands on disk, as one choice.
 *
 * Background and container are not independent — MP4 carries no alpha, so
 * "transparent" and "MP4" is a combination that cannot be rendered, and a
 * separate Format select would spend its life greying its own options out.
 * Naming the pair states the deliverable instead: the label is the file you
 * get, and every option in the list is one that works.
 */
type OutputMode = "scene" | "green" | "alpha-png" | "alpha-webm"
const MODES: OutputMode[] = ["scene", "green", "alpha-png", "alpha-webm"]
const MODE_BACKGROUND: Record<OutputMode, ExportBackground> = {
  scene: "scene",
  green: "green",
  "alpha-png": "alpha",
  "alpha-webm": "alpha",
}
const MODE_TARGET: Record<OutputMode, ExportTarget> = {
  scene: "mp4",
  green: "mp4",
  "alpha-png": "png",
  "alpha-webm": "webm",
}
type Aspect = "16:9" | "9:16" | "2.39:1" | "1:1" | "4:3"
const ASPECTS: Aspect[] = ["16:9", "9:16", "2.39:1", "1:1", "4:3"]
type Quality = "1080p" | "1440p" | "4k"
// 1080p is the floor: below it a dance reads as a compression artefact, and
// every platform these get shared to upscales anyway.
const QUALITIES: Quality[] = ["1080p", "1440p", "4k"]
const QUALITY_LABELS: Record<Quality, string> = { "1080p": "1080p", "1440p": "1440p", "4k": "4K" }
/**
 * Framing and quality, remembered across sessions.
 *
 * These are CHROME, not document state — a scene does not own the shape of a
 * video someone chose to render from it, and two people exporting the same
 * scene want their own frame. Which is exactly why they belong in localStorage
 * rather than in the document, next to where the floating panels keep their
 * rects.
 *
 * Read once at mount and written on change, validated on the way in: a
 * hand-edited or half-written entry falls back to the default rather than
 * putting the panel into a state with no matching option.
 */
const EXPORT_PREFS_KEY = "reze-design.export"
type ExportPrefs = { aspect: Aspect; quality: Quality; watermark: boolean }
const EXPORT_DEFAULTS: ExportPrefs = { aspect: "2.39:1", quality: "4k", watermark: true }

function readExportPrefs(): ExportPrefs {
  if (typeof window === "undefined") return EXPORT_DEFAULTS
  try {
    const raw = window.localStorage.getItem(EXPORT_PREFS_KEY)
    if (!raw) return EXPORT_DEFAULTS
    const p = JSON.parse(raw) as Partial<ExportPrefs>
    return {
      aspect: ASPECTS.includes(p.aspect as Aspect) ? (p.aspect as Aspect) : EXPORT_DEFAULTS.aspect,
      quality: QUALITIES.includes(p.quality as Quality) ? (p.quality as Quality) : EXPORT_DEFAULTS.quality,
      watermark: typeof p.watermark === "boolean" ? p.watermark : EXPORT_DEFAULTS.watermark,
    }
  } catch {
    return EXPORT_DEFAULTS
  }
}

function writeExportPrefs(prefs: ExportPrefs): void {
  try {
    window.localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage blocked — the settings simply do not carry to the next session.
  }
}

const DIMS: Record<Aspect, Record<Quality, [number, number]>> = {
  "16:9": { "1080p": [1920, 1080], "1440p": [2560, 1440], "4k": [3840, 2160] },
  "9:16": { "1080p": [1080, 1920], "1440p": [1440, 2560], "4k": [2160, 3840] },
  // Cinemascope (anamorphic ~2.39:1) — the movie-theater frame.
  "2.39:1": { "1080p": [1920, 804], "1440p": [2560, 1072], "4k": [3840, 1608] },
  "1:1": { "1080p": [1080, 1080], "1440p": [1440, 1440], "4k": [2160, 2160] },
  "4:3": { "1080p": [1440, 1080], "1440p": [1920, 1440], "4k": [2880, 2160] },
}

// min-h-6 keeps every row the height of a select trigger, so the switch row (whose control
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 flex min-h-6 items-center justify-between first:mt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}


const fmtEta = (s: number) => {
  const v = Math.max(0, Math.round(s))
  return v >= 60 ? `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, "0")}` : `${v}s`
}

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`

/** "m:ss" or plain seconds → seconds; null when empty/unparseable (= use default). */
const parseClock = (text: string): number | null => {
  const s = text.trim().replace(/[０-９．：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (!s) return null
  const mmss = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(s)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

const rangeInputCls =
  "h-6 w-14 rounded-md border border-white/10 bg-white/5 px-1 text-center text-xs tabular-nums outline-none transition-colors hover:bg-white/10 focus:border-blue-400/50 placeholder:text-muted-foreground/50 disabled:opacity-50"

/** The part of FileSystemFileHandle this panel uses. */
type SaveHandle = {
  name: string
  createWritable(): Promise<FileSystemWritableFileStream>
  getFile(): Promise<File>
}

/** Live framing state the page mirrors into the viewport while this tab is open */
export type FramePreview = { aspect: number; watermark: boolean }

export const RenderPanel = memo(function RenderPanel({
  active,
  engineRef,
  canvasRef,
  modelName,
  extraModelNames,
  sceneName,
  animName,
  animDuration,
  backdrop,
  backgroundColor,
  musicUrl,
  audioSource,
  onAudioSourceChange,
  background,
  onBackgroundChange,
  onExportingChange,
  onFramePreviewChange,
  onProgressChange,
  rasterLyricsAt,
  planes,
}: {
  /** This tab is the visible one. */
  active: boolean
  engineRef: RefObject<Engine | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Master animated model — its clip defines the export timeline. */
  modelName: string
  /** Other animated models, driven in sync (multi-model scenes). */
  extraModelNames: string[]
  /** The scene's display name — drives the exported filename. */
  sceneName: string
  animName: string | null
  /** Clip length in seconds — defines the exported video length. */
  animDuration: number
  backdrop: BackdropMedia | null
  /** Page background hex — the bottom layer of the export composite. */
  backgroundColor: string
  musicUrl: string | null
  /** Lifted to the page: also routes live audio (music element / backdrop video). */
  /** Optional as a pair: a host that omits them hides the audio row, and the
   *  export derives the source itself — music when a track is loaded, silence
   *  otherwise. The explicit choice only mattered for audio-bearing video
   *  backgrounds, which do not exist. */
  audioSource?: ExportAudioSource
  onAudioSourceChange?: (s: ExportAudioSource) => void
  /** Lifted to the page: choosing one repaints the LIVE scene to match (WYSIWYG). */
  background: ExportBackground
  onBackgroundChange: (b: ExportBackground) => void
  /** The page suspends live audio/video mirrors while an export runs (the export drives the same */
  onExportingChange: (exporting: boolean) => void
  /** Live framing (see FramePreview) — null when this tab closes. */
  onFramePreviewChange: (preview: FramePreview | null) => void
  /** Mirrors the export progress out, for hosts that show it while the panel is hidden. */
  onProgressChange?: (p: ExportProgress | null) => void
  /** Re-rasterise the lyric sheet for a height it is about to be drawn at. The
   *  atlas is sized for the VIEWPORT while composing, which is the wrong size
   *  for a 4K render — see useEngine. */
  rasterLyricsAt?: (heightPx: number) => Promise<void>
  /** Moving cards, which the export advances itself — the live clock steps them
   *  by seeking, which is far too slow offline. */
  planes?: ExportPlane[]
}) {
  const t = useT()
  // Cinemascope by default — the whole reze-* series is named for the Chainsaw Man
  // — then whatever was chosen last, which is what actually gets exported twice.
  const [prefs] = useState(readExportPrefs)
  const [aspect, setAspect] = useState<Aspect>(prefs.aspect)
  const [quality, setQuality] = useState<Quality>(prefs.quality)
  // Export segment, "m:ss" text; blank = the whole clip (our default
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd] = useState("")
  const [watermark, setWatermark] = useState(prefs.watermark)
  // Session state, not a preference: the mode repaints the live canvas, and
  // finding the viewport keyed green on a fresh load would read as a bug.
  //
  // Seeded from the page's value rather than from "scene", because collapsing
  // the dock UNMOUNTS this panel while the page keeps the background it was
  // told — remounting to a select that said "Scene" over a checkerboarded
  // canvas would have the two disagreeing about what is on screen.
  const [mode, setMode] = useState<OutputMode>(() =>
    background === "green" ? "green" : background === "alpha" ? "alpha-png" : "scene",
  )
  const target = MODE_TARGET[mode]
  const compositing = isCompositingBackground(background)
  const changeMode = (m: OutputMode) => {
    setMode(m)
    onBackgroundChange(MODE_BACKGROUND[m])
  }
  // Written on change, not on export: someone who sets up a frame and then walks
  // away should find it there next time, whether or not they rendered anything.
  useEffect(() => {
    writeExportPrefs({ aspect, quality, watermark })
  }, [aspect, quality, watermark])

  const [exporting, setExporting] = useState(false)
  const [progress, setProgressState] = useState<ExportProgress | null>(null)
  const setProgress = (p: ExportProgress | null) => {
    setProgressState(p)
    onProgressChange?.(p)
  }
  // `file` names what actually landed, so the caption can point at it — a bare
  // "downloaded" leaves the user hunting through their downloads folder.
  const [result, setResult] = useState<{
    ok: boolean
    message?: string
    file?: string
    still?: boolean
    /** The AE composition script rather than a picture. */
    script?: boolean
    /** A folder of frames rather than a file — the caption counts them. */
    frames?: number
    /** What landed, measured after the fact rather than projected during. */
    size?: string
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Guards a second click without touching the button's appearance. A capture is
  // over in well under a second; a spinner that fast is noise.
  const capturingRef = useRef(false)

  const [width, height] = DIMS[aspect][quality]
  const upscaled = backdrop !== null && backdrop.width > 0 && backdrop.width < width
  // Clamp the segment into the clip.
  const segStart = Math.min(Math.max(0, parseClock(rangeStart) ?? 0), Math.max(0, animDuration - 0.1))
  const endParsed = parseClock(rangeEnd)
  const segEnd = endParsed !== null && endParsed > segStart ? Math.min(endParsed, animDuration) : animDuration
  const segDuration = Math.max(0, segEnd - segStart)
  const canRender = !!animName && segDuration > 0 && !exporting

  // While this tab is open, the viewport frames the shot live
  useEffect(() => {
    if (!active) return
    onFramePreviewChange({ aspect: width / height, watermark: watermark && !compositing })
    return () => onFramePreviewChange(null)
  }, [active, width, height, watermark, compositing, onFramePreviewChange])

  // reze-design-<scene>-<resolution>-<date>[.ext] — the folder a PNG sequence
  // lands in is the same name without one.
  const baseName = () => {
    const scene =
      sceneName
        .toLowerCase()
        .replace(/[\\/:*?"<>|]+/g, "")
        .trim()
        .replace(/\s+/g, "-") || "scene"
    const stamp = new Date()
    const two = (n: number) => String(n).padStart(2, "0")
    const when = `${stamp.getFullYear()}-${two(stamp.getMonth() + 1)}-${two(stamp.getDate())}-${two(stamp.getHours())}${two(stamp.getMinutes())}${two(stamp.getSeconds())}`
    return `reze-design-${scene}-${width}x${height}-${when}`
  }
  const filenameFor = (ext: string) => `${baseName()}.${ext}`

  /** lib/scene-file's, not a second copy — the two had already drifted, and the
   *  one that was wrong was the one nobody had exported from on Safari. */
  const download = downloadBlob

  /** A still of the shot as framed, at the output size — the thumbnail a publish
   *  asks for, without leaving for a screenshot tool. */
  const capture = async () => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas || capturingRef.current || exporting) return
    capturingRef.current = true
    setResult(null)
    try {
      await rasterLyricsAt?.(height)
      const blob = await captureStill({
        engine,
        canvas,
        settings: { width, height, watermark: compositing ? false : watermark, background },
        backdrop,
        backgroundColor,
        // The still is the pose on screen, so a moving backdrop has to be the
        // frame under that pose rather than the one it opens on.
        atTime: engine.getModel(modelName)?.getAnimationProgress().current ?? 0,
      })
      const filename = filenameFor("png")
      download(blob, filename)
      // Same completion line the video uses: the caption names the file that
      // just landed in the downloads folder.
      setResult({ ok: true, file: filename, still: true, size: formatBytes(blob.size) })
      // captureStill restores the render size to viewport-tracking, which
      // silently unpins a framed-aspect canvas — the amber border then no
      // longer matches what renders. Re-emitting the preview as a FRESH object
      // makes the host's framing effect re-run and re-assert the pin.
      if (active) onFramePreviewChange({ aspect: width / height, watermark: watermark && !compositing })
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      // Back to the viewport's size, which is what the live canvas draws at.
      await rasterLyricsAt?.(canvas.height)
      capturingRef.current = false
    }
  }

  /**
   * The shot's 3D space, as a .jsx After Effects runs to rebuild it.
   *
   * ITS OWN BUTTON, not a switch on the render. Adjusting the camera and
   * looking at the comp again is a thing you do ten times in an hour, and it
   * used to cost a full encode each time.
   */
  const aeScript = async () => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas || !animName || exporting) return
    setExporting(true)
    onExportingChange(true)
    setResult(null)
    setProgress(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const jsx = await exportAeScript({
        engine,
        canvas,
        modelName,
        extraModelNames,
        startTime: segStart,
        duration: segDuration,
        // The comp is the VIDEO's, whether or not one was rendered — the lens is
        // in pixels of comp height, so a script built to any other size is a
        // shot at a different focal length.
        width,
        height,
        fps: VIDEO_FPS,
        onProgress: setProgress,
        signal: ac.signal,
      })
      const filename = filenameFor("jsx")
      const blob = new Blob([jsx], { type: "application/javascript" })
      download(blob, filename)
      setResult({ ok: true, file: filename, script: true, size: formatBytes(blob.size) })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setExporting(false)
      onExportingChange(false)
      abortRef.current = null
      setProgress(null)
    }
  }

  const start = async () => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas || !animName) return
    const base = baseName()
    const ext = target === "webm" ? "webm" : "mp4"
    const filename = `${base}.${ext}`
    const totalFrames = Math.max(1, Math.round(segDuration * VIDEO_FPS))

    // File System Access path (Chromium desktop): ask WHERE first
    let fileStream: FileSystemWritableFileStream | undefined
    let fileHandle: SaveHandle | undefined
    let directory: FileSystemDirectoryHandle | undefined
    // What the user actually called it, which can differ from our suggestion.
    let pickedName: string | undefined
    if (target === "png") {
      // A sequence has no in-memory fallback: thousands of 4K PNGs have to go
      // to disk as they are made, so a browser without the picker cannot do
      // this at all — say so rather than starting a render that has nowhere to
      // put its frames.
      if (!("showDirectoryPicker" in window)) {
        setResult({ ok: false, message: t.render.needsFolderPicker })
        return
      }
      try {
        const root = await (
          window as unknown as {
            showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle>
          }
        ).showDirectoryPicker({ mode: "readwrite", id: "reze-design-sequence" })
        // Frames get a folder of their own inside whatever was picked: 7200
        // files loose in someone's Desktop is its own kind of data loss.
        directory = await root.getDirectoryHandle(base, { create: true })
        pickedName = base
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
        return
      }
    } else if ("showSaveFilePicker" in window) {
      try {
        const handle = await (
          window as unknown as {
            showSaveFilePicker: (o: object) => Promise<SaveHandle>
          }
        ).showSaveFilePicker({
          suggestedName: filename,
          types:
            target === "webm"
              ? [{ description: "WebM video", accept: { "video/webm": [".webm"] } }]
              : [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        })
        pickedName = handle.name
        fileHandle = handle
        fileStream = await handle.createWritable()
      } catch (e) {
        // Canceling the picker cancels the export (nothing rendered yet).
        if (e instanceof DOMException && e.name === "AbortError") return
        // Picker unavailable/failed for another reason — fall back to memory.
        fileStream = undefined
      }
    }

    setExporting(true)
    onExportingChange(true)
    setResult(null)
    setProgress(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await rasterLyricsAt?.(height)
      const out = await exportVideo({
        engine,
        canvas,
        modelName,
        extraModelNames,
        startTime: segStart,
        duration: segDuration,
        settings: {
          width,
          height,
          fps: VIDEO_FPS,
          audioSource: audioSource ?? (musicUrl ? "music" : "none"),
          watermark: compositing ? false : watermark,
          background,
          target,
        },
        backdrop,
        backgroundColor,
        musicUrl,
        fileStream,
        directory,
        planes,
        onProgress: setProgress,
        signal: ac.signal,
      })
      let bytes = out.bytes
      if (fileStream) {
        // Committing the writable materializes the picked file on disk.
        await fileStream.close().catch(() => {})
        // Only true once the writable is closed, and truer than anything the
        // muxer could report: it is what the filesystem actually holds.
        bytes = await fileHandle
          ?.getFile()
          .then((f) => f.size)
          .catch(() => bytes) ?? bytes
      } else if (out.blob) {
        download(out.blob, filename)
      }
      // With a picked file the user chose the name themselves; report the one
      // they picked, not the one we would have generated.
      setResult({
        ok: true,
        file: directory ? (pickedName ?? base) : fileStream ? (pickedName ?? filename) : filename,
        frames: directory ? totalFrames : undefined,
        size: formatBytes(bytes),
      })
    } catch (e) {
      // Discard the partial file — abort() drops everything written since createWritable
      await fileStream?.abort().catch(() => {})
      // A user cancel is not an error state — just return to idle.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const raw = e instanceof Error ? e.message : String(e)
        // The encoder rejecting our config is a browser capability gap, not a
        // user-fixable parameter problem — say so instead of dumping the config.
        const friendly = /encoder configuration|not supported by this browser/i.test(raw)
        setResult({ ok: false, message: friendly ? t.render.encoderUnsupported : raw })
      }
    } finally {
      await rasterLyricsAt?.(canvas.height)
      setExporting(false)
      onExportingChange(false)
      abortRef.current = null
      setProgress(null)
    }
  }

  // No phase test: the audio phase reports frame 0, so it already reads as 0%.
  const pct = progress && progress.total > 0 ? Math.round((progress.frame / progress.total) * 100) : 0

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        {/* No section title — the panel IS the output settings; a heading over
            the only content is furniture. */}
        <div className="mt-1">
          <Row label={t.render.aspect}>
            <Select value={aspect} onValueChange={(v) => setAspect(v as Aspect)} disabled={exporting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Aspect notation is universal — no translation needed. */}
                {ASPECTS.map((a) => (
                  <SelectItem key={a} value={a} className="tabular-nums">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t.render.quality}>
            <Select value={quality} onValueChange={(v) => setQuality(v as Quality)} disabled={exporting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITIES.map((q) => (
                  <SelectItem key={q} value={q} className="tabular-nums">
                    {QUALITY_LABELS[q]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {/* Segment to export — blank boxes = the whole clip. */}
          <Row label={t.render.range}>
            <div className="flex items-center gap-1">
              <input
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                onBlur={() => {
                  const v = parseClock(rangeStart)
                  setRangeStart(v === null ? "" : fmtClock(v))
                }}
                placeholder="0:00"
                disabled={exporting}
                className={rangeInputCls}
              />
              <span className="text-xs text-muted-foreground/60">–</span>
              <input
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                onBlur={() => {
                  // Clamp to the clip only when its duration is known
                  const v = parseClock(rangeEnd)
                  setRangeEnd(v === null ? "" : fmtClock(animDuration > 0 ? Math.min(v, animDuration) : v))
                }}
                placeholder={animDuration > 0 ? fmtClock(animDuration) : "-:--"}
                disabled={exporting}
                className={rangeInputCls}
              />
            </div>
          </Row>
          {onAudioSourceChange && (
          // A PNG sequence has no track to carry audio in, so the row goes
          // inert rather than offering a choice the file cannot keep.
          <Row label={t.render.audio}>
            <Select
              value={target === "png" ? "none" : audioSource}
              onValueChange={(v) => onAudioSourceChange(v as ExportAudioSource)}
              disabled={exporting || target === "png"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="music" disabled={!musicUrl}>
                  {t.render.audioMusic}
                </SelectItem>
                <SelectItem value="none">
                  {t.render.audioNone}
                </SelectItem>
              </SelectContent>
            </Select>
          </Row>
          )}
          {/* Disabled (not hidden — layout stays put) for a compositing handoff */}
          <Row label={t.render.watermark}>
            <Switch
              checked={compositing ? false : watermark}
              onCheckedChange={setWatermark}
              disabled={exporting || compositing}
              className="scale-75"
            />
          </Row>
          {/* Background and container as one choice — see OutputMode. */}
          <Row label={t.render.output}>
            <Select value={mode} onValueChange={(v) => changeMode(v as OutputMode)} disabled={exporting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t.render.modes[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {upscaled && !compositing && <div className="mt-2 text-xs text-amber-400/90">{t.render.upscaleWarn}</div>}
        </div>

        {/* No section title (the surface hosting this already says Export) and
            no caption lines — the settings above state exactly what the file
            will be.

            The script goes first and quiet: it hands off the 3D space, where the
            two below make the picture and keep the bottom of the panel. Same
            disabled rule as Render — it walks the same frames and needs the same
            clip to walk. */}
        <Button
          size="sm"
          variant="outline"
          disabled={!canRender}
          onClick={() => void aeScript()}
          className="mt-5 h-8 w-full gap-1.5 border-line-strong bg-surface-raised text-xs font-medium text-foreground hover:bg-white/5 disabled:opacity-40"
        >
          <Film className="size-3.5" />
          {t.render.aeScript}
        </Button>
        {/* Two actions, one row: still and video are peers. */}
        <div className="mt-2 flex">
          {/* Same framing, one frame. Needs no animation, so it stays available on
              a still scene where Render has nothing to render. */}
          <Button
            size="sm"
            disabled={exporting}
            onClick={() => void capture()}
            className="h-8 flex-1 gap-1.5 rounded-r-none bg-white text-xs font-medium text-zinc-950 hover:bg-white/90 disabled:opacity-40"
          >
            <Camera className="size-3.5" />
            {t.render.capturePng}
          </Button>
          {!exporting ? (
            <Button
              size="sm"
              disabled={!canRender}
              onClick={() => void start()}
              className="h-8 flex-1 gap-1.5 rounded-l-none bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
            >
              <Clapperboard className="size-3.5" />
              {t.render.renderVideo}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => abortRef.current?.abort()}
              // SOLID red, white text — the same weight as the blue Publish
              // button, because it is the same kind of control: the one thing
              // this panel is for while it is exporting. A translucent tint
              // reads as a disabled surface, which is the opposite of what a
              // button you may urgently want should look like. Red because
              // stopping throws the render away: the encoded frames are gone,
              // not paused.
              className="h-8 flex-1 gap-1.5 rounded-l-none bg-red-500 text-xs font-medium text-white hover:bg-red-400"
            >
              <Square className="size-3.5" />
              {t.render.cancel}
            </Button>
          )}
        </div>
        {exporting ? (
          <div className="mt-4">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-blue-400 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 text-center text-xs text-muted-foreground tabular-nums">
              {!progress
                ? t.render.preparing
                : progress.phase === "audio"
                  ? t.render.preparingAudio
                  : t.render.progressLine(progress.frame, progress.total, fmtEta(progress.etaSeconds))}
            </div>
          </div>
        ) : result ? (
          <div className={`mt-2 text-center text-xs ${result.ok ? "text-muted-foreground" : "text-red-400"}`}>
            {result.ok
              ? result.frames
                ? t.render.seqDone(result.frames, result.file ?? "", result.size ?? "")
                : (result.script ? t.render.scriptDone : result.still ? t.render.stillDone : t.render.done)(
                    result.file ?? "",
                    result.size ?? "",
                  )
              : t.render.failed(result.message ?? "")}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  )
})
