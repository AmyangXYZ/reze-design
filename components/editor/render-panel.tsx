"use client"

// Right dock · Render tab — where a finished scene becomes an exported video.
// Drives lib/video-export (engine.renderFrame offline stepping + mediabunny
// WebCodecs encode) with the panel's settings; shows a live preview of each
// composited frame at the true output aspect (the raw canvas is pinned to export
// resolution during a run, so this preview IS the honest progress view), plus a
// progress bar, throughput/ETA, and cancel. Audio source is user-chosen: the
// music track, the backdrop video's own audio, or none — the same choice also
// routes LIVE audio (page-level), keeping playback and export consistent.

import { memo, useEffect, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { Clapperboard, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Section } from "@/components/scene/scene-sidebar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BackdropMedia } from "@/lib/backdrop"
import type { SceneColors } from "@/lib/scene-settings"
import { exportVideo, type ExportAudioSource, type ExportProgress } from "@/lib/video-export"
import { useT } from "@/lib/i18n"

// Minimal config, iMovie-export style: 60 fps always (VMD samples continuously,
// so in-betweens are true); the user picks an aspect ratio + a quality tier
// (some platforms reject 4K uploads, so 1080p/1440p exist as deliberate steps —
// never freeform W×H fields). The caption under the Render button states the
// exact resulting file.
const VIDEO_FPS = 60
type Aspect = "16:9" | "9:16" | "1:1" | "4:3"
const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:3"]
type Quality = "720p" | "1080p" | "1440p" | "4k"
const QUALITIES: Quality[] = ["720p", "1080p", "1440p", "4k"]
const QUALITY_LABELS: Record<Quality, string> = { "720p": "720p", "1080p": "1080p", "1440p": "1440p", "4k": "4K" }
const DIMS: Record<Aspect, Record<Quality, [number, number]>> = {
  "16:9": { "720p": [1280, 720], "1080p": [1920, 1080], "1440p": [2560, 1440], "4k": [3840, 2160] },
  "9:16": { "720p": [720, 1280], "1080p": [1080, 1920], "1440p": [1440, 2560], "4k": [2160, 3840] },
  "1:1": { "720p": [720, 720], "1080p": [1080, 1080], "1440p": [1440, 1440], "4k": [2160, 2160] },
  "4:3": { "720p": [960, 720], "1080p": [1440, 1080], "1440p": [1920, 1440], "4k": [2880, 2160] },
}

// min-h-6 keeps every row the height of a select trigger, so the switch row (whose
// control is shorter) doesn't collapse and the vertical rhythm stays even.
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

/** "m:ss" or plain seconds → seconds; null when empty/unparseable (= use default).
 *  Full-width digits/colon/period (CJK IMEs: "１：３０") normalize to ASCII first,
 *  and decimal seconds are accepted in both forms. */
const parseClock = (text: string): number | null => {
  const s = text.trim().replace(/[０-９．：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (!s) return null
  const mmss = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(s)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

const rangeInputCls =
  "h-6 w-14 rounded-md border border-white/10 bg-white/5 px-1 text-center text-xs tabular-nums outline-none transition-colors hover:bg-white/10 focus:border-blue-400/50 placeholder:text-muted-foreground/50 disabled:opacity-50"

/** Live framing state the page mirrors into the viewport while this tab is open:
 *  the canvas pins to the selected aspect (at screen scale — free) and letterboxes,
 *  a frame border marks the video area, and the watermark previews in place. */
export type FramePreview = { aspect: number; watermark: boolean }

export const RenderPanel = memo(function RenderPanel({
  engineRef,
  canvasRef,
  modelName,
  sceneName,
  animName,
  animDuration,
  backdrop,
  colors,
  musicUrl,
  audioSource,
  onAudioSourceChange,
  greenScreen,
  onGreenScreenChange,
  onExportingChange,
  onFramePreviewChange,
}: {
  engineRef: RefObject<Engine | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  modelName: string
  /** The scene's display name — drives the exported filename. */
  sceneName: string
  animName: string | null
  /** Clip length in seconds — defines the exported video length. */
  animDuration: number
  backdrop: BackdropMedia | null
  /** Scene appearance colors (background + ground fields for green-screen suspend). */
  colors: SceneColors
  musicUrl: string | null
  /** Lifted to the page: also routes live audio (music element / backdrop video). */
  audioSource: ExportAudioSource
  onAudioSourceChange: (s: ExportAudioSource) => void
  /** Lifted to the page: toggling it repaints the LIVE scene green too (WYSIWYG). */
  greenScreen: boolean
  onGreenScreenChange: (on: boolean) => void
  /** The page suspends live audio/video mirrors while an export runs (the export
   *  drives the same model clock, so the mirrors would play, out of sync). */
  onExportingChange: (exporting: boolean) => void
  /** Live framing (see FramePreview) — null when this tab closes. */
  onFramePreviewChange: (preview: FramePreview | null) => void
}) {
  const t = useT()
  const [aspect, setAspect] = useState<Aspect>("16:9")
  const [quality, setQuality] = useState<Quality>("4k")
  // Export segment, "m:ss" text; blank = the whole clip (our default — the range
  // is an escape hatch for platform-length cuts, not a required decision).
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd] = useState("")
  const [watermark, setWatermark] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [width, height] = DIMS[aspect][quality]
  const upscaled = backdrop !== null && backdrop.width > 0 && backdrop.width < width
  // Clamp the segment into the clip. Blank or invalid text falls back to the
  // defaults (0 / clip end); an end at or before the start (times in the wrong
  // boxes) also falls back to the clip end — never a degenerate 0.1s export.
  const segStart = Math.min(Math.max(0, parseClock(rangeStart) ?? 0), Math.max(0, animDuration - 0.1))
  const endParsed = parseClock(rangeEnd)
  const segEnd = endParsed !== null && endParsed > segStart ? Math.min(endParsed, animDuration) : animDuration
  const segDuration = Math.max(0, segEnd - segStart)
  const canRender = !!animName && segDuration > 0 && !exporting

  // While this tab is open, the viewport frames the shot live: report the aspect
  // + watermark so the page pins/letterboxes the canvas and previews the mark.
  // The tab unmounting (tab switch / dock collapse) clears it via cleanup.
  useEffect(() => {
    onFramePreviewChange({ aspect: width / height, watermark: watermark && !greenScreen })
    return () => onFramePreviewChange(null)
  }, [width, height, watermark, greenScreen, onFramePreviewChange])

  const start = async () => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas || !animName) return
    setExporting(true)
    onExportingChange(true)
    setResult(null)
    setProgress(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const blob = await exportVideo({
        engine,
        canvas,
        modelName,
        startTime: segStart,
        duration: segDuration,
        settings: { width, height, fps: VIDEO_FPS, audioSource, watermark: greenScreen ? false : watermark, greenScreen },
        backdrop,
        colors,
        musicUrl,
        onProgress: setProgress,
        signal: ac.signal,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      // reze-design-<scene>-<resolution>-<date>.mp4 — scene name sanitized for
      // filesystems (illegal chars dropped, spaces → dashes; CJK passes through).
      const scene =
        sceneName
          .toLowerCase()
          .replace(/[\\/:*?"<>|]+/g, "")
          .trim()
          .replace(/\s+/g, "-") || "scene"
      a.download = `reze-design-${scene}-${width}x${height}-${new Date().toISOString().slice(0, 10)}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setResult({ ok: true })
    } catch (e) {
      // A user cancel is not an error state — just return to idle.
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setExporting(false)
      onExportingChange(false)
      abortRef.current = null
      setProgress(null)
    }
  }

  const pct = progress && progress.phase === "video" ? Math.round((progress.frame / progress.total) * 100) : 0

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title={t.render.output}>
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
          {/* Segment to export — blank boxes = the whole clip. Format is m:ss;
              plain seconds are accepted and CANONICALIZED to m:ss on blur ("90"
              → "1:30"), so the field always shows what the export will do. */}
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
                  // Clamp to the clip only when its duration is known — clamping
                  // against a not-yet-loaded 0 would wipe the entry to "0:00".
                  const v = parseClock(rangeEnd)
                  setRangeEnd(v === null ? "" : fmtClock(animDuration > 0 ? Math.min(v, animDuration) : v))
                }}
                placeholder={animDuration > 0 ? fmtClock(animDuration) : "-:--"}
                disabled={exporting}
                className={rangeInputCls}
              />
            </div>
          </Row>
          <Row label={t.render.audio}>
            <Select
              value={audioSource}
              onValueChange={(v) => onAudioSourceChange(v as ExportAudioSource)}
              disabled={exporting}
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
          {/* Chroma-key mode for external compositing (the classic MMD PV flow) —
              pure #00FF00 replaces background/backdrop/skybox and the ground
              surface hides (shadow follows Scene > Ground > Shadow). Lifted to the
              page: the LIVE scene previews it too — what you see is what renders. */}
          <Row label={t.render.greenScreen}>
            <Switch checked={greenScreen} onCheckedChange={onGreenScreenChange} disabled={exporting} className="scale-75" />
          </Row>
          {/* Disabled (not hidden — layout stays put) in green mode: keying material
              shouldn't carry a mark that survives into their composite. */}
          <Row label={t.render.watermark}>
            <Switch
              checked={greenScreen ? false : watermark}
              onCheckedChange={setWatermark}
              disabled={exporting || greenScreen}
              className="scale-75"
            />
          </Row>
          {upscaled && !greenScreen && <div className="mt-2 text-[11px] text-amber-400/90">{t.render.upscaleWarn}</div>}
        </Section>

        <Section title={t.render.export}>
          {!exporting ? (
            <Button
              size="sm"
              disabled={!canRender}
              onClick={() => void start()}
              className="h-8 w-full gap-1.5 bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
            >
              <Clapperboard className="size-3.5" />
              {t.render.renderVideo}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => abortRef.current?.abort()}
              className="h-8 w-full gap-1.5 bg-white/10 text-xs font-medium hover:bg-white/15"
            >
              <Square className="size-3.5" />
              {t.render.cancel}
            </Button>
          )}
          {/* The one line that matters — the file this button produces. */}
          <div className="mt-1.5 text-center text-[11px] text-muted-foreground/60 tabular-nums">
            {width} × {height} · {t.render.fps(String(VIDEO_FPS))} · {fmtClock(segDuration)} · mp4
          </div>

          {/* No preview card — the live viewport IS the preview: the export loop
              drives the on-screen canvas frame by frame. Just progress + ETA here. */}
          {exporting && (
            <>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-blue-400 transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
                {progress?.phase === "video"
                  ? t.render.progressLine(progress.frame, progress.total, fmtEta(progress.etaSeconds))
                  : t.render.preparingAudio}
              </div>
            </>
          )}

          {result && (
            <div className={`mt-2 text-[11px] ${result.ok ? "text-muted-foreground" : "text-red-400"}`}>
              {result.ok ? t.render.done : t.render.failed(result.message ?? "")}
            </div>
          )}
        </Section>
      </div>
    </ScrollArea>
  )
})
