"use client"

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type RefObject,
} from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useClipActions, useClipEngine, useClipSelector, usePlayhead, usePlayheadFrameRef, type SelectedKeyframe } from "@/context/clip-editor"
import type { AnimationClip, BoneKeyframe, CameraKeyframe, MorphKeyframe } from "reze-engine"
import { bezierInterpolate, Quat } from "reze-engine"
import { EffectStrips } from "@/components/scene/effect-strips"
import type { AppliedEffect } from "@/lib/effects"
import type { EffectWindow } from "@/lib/effect-schedule"
import {
  type Channel,
  quatToEuler,
  sampleBoneTrackAt,
  sampleMorphTrackAt,
  ROT_CHANNELS,
  TRA_CHANNELS,
  CAMERA_TABS,
  CAMERA_CHANNELS,
  CAMERA_DEFAULT_TAB,
  cameraChannelsForTab,
  cameraIpPair,
  isCameraTab,
  boneDisplayLabel,
} from "@/lib/animation"
import { motionFrameCount } from "@/lib/clip"

// ─── Timeline constants ─────────────────────────────────────────────────
const DOPE_H = 26
/** The music lane, under the dopesheet. Present only when a track is loaded —
 *  an empty strip would cost the curves height for nothing. */
const AUDIO_H = 26
const RULER_H = 17
// Wide enough for the longest lane name in the gutter ("Music" at 10px, right
// aligned with 6px of padding). Every x-position in this canvas is derived from
// it — the scroll origin, the curve clip, the zoom-to-fit maths — so widening
// the gutter is this one number and nothing else.
const LABEL_W = 42
const DOT_R = 3.5
const DIAMOND = 5
const MIN_PX = 0.5
const MAX_PX = 40
const Y_ZOOM_MIN = 0.5
const Y_ZOOM_MAX = 8

/** The fold's own 300ms, plus a frame — see `measurable`. */
const FOLD_SETTLE_MS = 340

function minPxPerFrameForViewport(trackWidthPx: number, frameCount: number): number {
  if (frameCount <= 0 || trackWidthPx <= LABEL_W + 1) return MIN_PX
  const fit = (trackWidthPx - LABEL_W) / frameCount
  return Math.max(MIN_PX, Math.min(fit, MAX_PX))
}

// 127-space wrapper over the engine's VMD bezier evaluator.
function bezierY(cp0: { x: number; y: number }, cp1: { x: number; y: number }, t: number) {
  return bezierInterpolate(cp0.x / 127, cp1.x / 127, cp0.y / 127, cp1.y / 127, t)
}

// Structural lines are WHITE AT LOW ALPHA, not dark hex.
//
// They were near-black (#161620 grid, #222233 axis) — values that only work on
// an opaque dark panel. This one is not: it sits in a translucent, blurred
// surface over a live 3D scene, so a dark line is drawn ON TOP of whatever the
// canvas is showing and disappears against anything dim while turning muddy
// against anything bright. Alpha-white behaves the same over every backdrop,
// which is also why the app's own --color-line tokens are white/6% and
// white/12% rather than greys.
const C = {
  bg: "rgba(0,0,0,0)",
  curveBg: "rgba(0,0,0,0)",
  ruler: "rgba(0,0,0,0)",
  rulerText: "#9ca3af",
  // The same lavender-grey the unselected keyframe diamonds use. The waveform
  // and the dopesheet are both reference material in the same gutter, so they
  // read as one layer — and staying neutral keeps the red playhead legible
  // where it crosses, which every saturated hue tried and failed to do.
  audioWave: "rgba(170,170,195,0.55)",
  rulerTick: "rgba(255,255,255,0.10)",
  rulerMajor: "rgba(255,255,255,0.20)",
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.10)",
  axisZero: "rgba(255,255,255,0.18)",
  playhead: "#d83838",
  playheadGlow: "rgba(216,56,56,0.18)",
  diamondSel: "#5aa0f0",
  keyDotSel: "#9ca3af",
  dopeBg: "rgba(0,0,0,0)",
  dopeBorder: "rgba(255,255,255,0.12)",
  dopeLabel: "#9ca3af",
  dopeLabelNum: "#6b7280",
  rotX: "#e25555",
  rotY: "#44bb55",
  rotZ: "#4477dd",
  traX: "#e2a055",
  traY: "#55bba0",
  traZ: "#7755dd",
  label: "#9ca3af",
  tabBg: "rgba(0,0,0,0)",
  tabActive: "#2a2a36",
  tabText: "#9ca3af",
  tabTextActive: "#9ca3af",
  toolbarOnAccent: "#0f0f12",
  // Not "border". That string is not a CSS colour, so every
  // `ctx.strokeStyle = C.border` silently failed and the stroke fell back to
  // canvas's default — #000 — which is why the ruler and lane rules drew as
  // hard black lines on a translucent panel. Inherited from reze-studio, where
  // an opaque near-black ground hid the mistake.
  border: "rgba(255,255,255,0.12)",
  frameBadge: "rgba(255,255,255,0.06)",
  frameBadgeText: "#9ca3af",
  sidebarBg: "rgba(0,0,0,0)",
  sidebarGroup: "#888898",
  sidebarBone: "#666672",
  sidebarActive: "#5aa0f0",
  sidebarGroupBg: "rgba(0,0,0,0)",
  sidebarHover: "#1e1e28",
} as const

const FONT = "'SF Mono','Cascadia Code','Fira Code','JetBrains Mono',monospace"

function padFrame4(n: number) {
  return String(Math.max(0, Math.round(n))).padStart(4, "0")
}

const ALL_CHANNELS: Channel[] = [...ROT_CHANNELS, ...TRA_CHANNELS]

function getChannelsForTab(tab: string): Channel[] {
  if (tab === "morph" || isCameraTab(tab)) return []
  if (tab === "allRot") return ROT_CHANNELS
  if (tab === "allTra") return TRA_CHANNELS
  const ch = ALL_CHANNELS.find((c) => c.key === tab)
  return ch ? [ch] : ROT_CHANNELS
}

/**
 * No tick cap: the value has no natural limit, so ticks follow the view and
 * keep labelling as you zoom out.
 *
 * The bounded cases are the ones where the range IS the value's range —
 * rotation's ±180 and a morph weight's 0..1 — where a tick past the end would
 * label a number the channel cannot hold. A translation, a camera distance and
 * a field of view have no such edge; capping them just stopped the axis
 * labelling halfway up the graph.
 */
const UNBOUNDED = { tickMin: -Infinity, tickMax: Infinity }

function getAxisConfig(tab: string) {
  // Camera channels each live in their own units — a target coordinate, an
  // angle, a (negative) distance, a field of view — so they get their own
  // ranges rather than borrowing a bone's.
  if (tab === "camAllTgt" || tab === "camTx" || tab === "camTy" || tab === "camTz") {
    // A world position has no natural bound — see UNBOUNDED below.
    return { min: -30, max: 30, ...UNBOUNDED, unit: "", side: "left" as const, step: 10, subStep: 5 }
  }
  if (tab === "camAllRot" || tab === "camRx" || tab === "camRy" || tab === "camRz") {
    return { min: -180, max: 180, tickMin: -180, tickMax: 180, unit: "\u00b0", side: "left" as const, step: 90, subStep: 45 }
  }
  if (tab === "camDist") {
    // MMD distance is negative — the camera sits behind its target.
    return { min: -80, max: 5, ...UNBOUNDED, unit: "", side: "left" as const, step: 20, subStep: 10 }
  }
  if (tab === "camFov") {
    return { min: 0, max: 130, ...UNBOUNDED, unit: "\u00b0", side: "left" as const, step: 30, subStep: 15 }
  }
  if (tab === "morph") {
    // Weight is [0, 1], but a keyframe sitting exactly on that boundary is
    // hard to click when the plotted range matches it exactly — a margin on
    // both ends keeps 0 and 1 off the very edge of the graph. tickMin/tickMax
    // hold the tick loop to the real [0, 1] data range regardless — the
    // margin is for click targets, not for drawing ticks past the data.
    return { min: -0.1, max: 1.1, tickMin: 0, tickMax: 1, unit: "", side: "left" as const, step: 0.25, subStep: 0.125 }
  }
  const chans = getChannelsForTab(tab)
  const isRot = chans[0].group === "rot"
  if (isRot) {
    // The full turn, matching the camera rotation axis above. A quaternion
    // decomposed to Euler yields angles across [-180, 180], so a ±90 plot
    // clipped every key outside it — the curve ran off the top of the band and
    // came back, which reads as the data being wrong rather than the axis being
    // short. 45° steps keep the tick count the same as before.
    // Plotted a little past the ticks for the same reason morph weight is
    // plotted past 0 and 1: a key sitting exactly on ±180 — which the channel
    // clamp now makes easy to land on — is hard to see and harder to grab when
    // the band ends precisely where the data does. tickMin/tickMax hold the
    // ticks and labels to the real ±180, so the extra 20° is a click target
    // rather than a value. It is also where a wrapping curve crosses out of the
    // plot, which has to be visible for the wrap to read as a wrap.
    return { min: -200, max: 200, tickMin: -180, tickMax: 180, unit: "°", side: "left" as const, step: 45, subStep: 15 }
  } else {
    // ±25, the same base the properties dock's translation sliders use — the
    // curve and the slider are two views of one number and disagreeing about
    // its scale makes them look like two numbers. ±10 was short for what
    // translation is mostly used for: a character is about twenty units tall in
    // MMD's scale, so a jump on センター left the band entirely and read as
    // broken data rather than a short axis. UNBOUNDED already lets the value
    // zoom take it further when a motion needs it.
    return { min: -25, max: 25, ...UNBOUNDED, unit: "", side: "left" as const, step: 10, subStep: 5 }
  }
}

const MORPH_COLOR = "#c084fc"

type TabDef = { key: string; label: string; color: string | null; sep: boolean }

const BONE_TABS: TabDef[] = [
  { key: "allRot", label: "Rotation", color: null, sep: false },
  { key: "rx", label: "X", color: C.rotX, sep: false },
  { key: "ry", label: "Y", color: C.rotY, sep: false },
  { key: "rz", label: "Z", color: C.rotZ, sep: false },
  { key: "_sep1", label: "", color: null, sep: true },
  { key: "allTra", label: "Translation", color: null, sep: false },
  { key: "tx", label: "X", color: C.traX, sep: false },
  { key: "ty", label: "Y", color: C.traY, sep: false },
  { key: "tz", label: "Z", color: C.traZ, sep: false },
]

// Colour-less, like "Rotation" and "Translation": those three are the only tab in
// their set, so a coloured chip would be keying a hue to nothing — there is no
// sibling channel to tell it apart from. The curve itself still draws in
// MORPH_COLOR; this is only the chip.
const MORPH_TABS: TabDef[] = [{ key: "morph", label: "Weight", color: null, sep: false }]

const CAM_TABS: TabDef[] = CAMERA_TABS.map((t) => ({ key: t.key, label: t.label, color: t.color, sep: t.sep }))

/**
 * The tabs for what is currently selected — the whole set is swapped, not
 * greyed out.
 *
 * A morph has no rotation to plot and a bone has no weight; showing either as
 * a disabled button is a row of dead controls that says nothing except "not
 * this one". Swapping the set means every tab on screen is one you can press,
 * and the count itself tells you what kind of thing you are editing.
 */
export function tabsForSelection(kind: "bone" | "morph" | "camera"): TabDef[] {
  if (kind === "camera") return CAM_TABS
  if (kind === "morph") return MORPH_TABS
  return BONE_TABS
}

/** The tab to fall back to when the selection changes out from under the
 *  current one. */
export function defaultTabForSelection(kind: "bone" | "morph" | "camera"): string {
  if (kind === "camera") return CAMERA_DEFAULT_TAB
  if (kind === "morph") return "morph"
  return "allRot"
}

/** Scrub playhead 0…frameCount — track/thumb aligned with toolbar (Tailwind tokens). */
function TransportFrameSlider({
  thumbRef,
  frameCount,
  value,
  onChange,
}: {
  /** Filled by the parent so the playback rAF can move the thumb without a
   *  render — see the draw wrapper in Timeline. */
  thumbRef?: RefObject<HTMLDivElement | null>
  frameCount: number
  value: number
  onChange: (f: number) => void
}) {
  const dict = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || frameCount <= 0) return
      const rect = el.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)))
      onChange(Math.round(t * frameCount))
    },
    [frameCount, onChange],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      setFromClientX(e.clientX)
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [setFromClientX])

  const disabled = frameCount <= 0
  const pct = !disabled && frameCount > 0 ? (value / frameCount) * 100 : 0

  return (
    <div className="mx-1 ml-0.5 flex shrink-0 select-none items-center">
      <div
        ref={trackRef}
        role="slider"
        aria-label={dict.lab.timeline.scrub}
        aria-valuemin={0}
        aria-valuemax={frameCount}
        aria-valuenow={Math.round(value)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === "ArrowLeft" || e.key === "ArrowDown")
            onChange(Math.max(0, Math.round(value) - 1))
          if (e.key === "ArrowRight" || e.key === "ArrowUp")
            onChange(Math.min(frameCount, Math.round(value) + 1))
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          dragging.current = true
          setFromClientX(e.clientX)
          e.preventDefault()
        }}
        className={cn(
          "relative h-5 w-16 shrink-0 touch-none",
          disabled ? "pointer-events-none opacity-15" : "cursor-grab",
        )}
      >
        <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-[1px] bg-border" />
        <div
          ref={thumbRef}
          className="pointer-events-none absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-foreground bg-secondary box-border"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export type { SelectedKeyframe } from "@/context/clip-editor"

function ZoomRuler({
  min,
  max,
  value,
  onChange,
}: {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}) {
  const dict = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const span = max - min

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const s = max - min
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      if (s <= 0) {
        onChange(min)
        return
      }
      const raw = min + t * s
      const snap = (v: number) => (s < 2 ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2)
      onChange(Math.max(min, Math.min(max, snap(raw))))
    },
    [min, max, onChange],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      setFromClientX(e.clientX)
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [setFromClientX])

  const pct = span > 0 ? ((value - min) / span) * 100 : 50
  const snapVal = (v: number) => (span < 2 ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2)
  const nudgeDelta = span < 2 ? 0.05 : 0.5
  const nudge = (dir: -1 | 1) =>
    onChange(Math.max(min, Math.min(max, snapVal(value + dir * nudgeDelta))))

  return (
    <div className="flex shrink-0 select-none items-center gap-1 text-muted-foreground">
      <div
        ref={trackRef}
        role="slider"
        aria-label={dict.lab.timeline.zoom}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") nudge(-1)
          if (e.key === "ArrowRight" || e.key === "ArrowUp") nudge(1)
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          dragging.current = true
          setFromClientX(e.clientX)
          e.preventDefault()
        }}
        className="relative h-4 w-12 shrink-0 cursor-grab touch-none"
      >
        <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-[1px] bg-border" />
        <div
          className="pointer-events-none absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-foreground bg-transparent box-border"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Canvas ──────────────────────────────────────────────────────────────
interface TimelineCanvasProps {
  clip: AnimationClip
  pxPerFrame: number
  yZoom: number
  scrollX: number
  currentFrame: number
  selectedBone: string | null
  selectedMorph: string | null
  /** The camera shot. Drawn instead of bone/morph curves while a camera tab is
   *  active; empty means no shot loaded. */
  cameraTrack: readonly CameraKeyframe[]
  /** Timeline span — max of the clip's own length and the camera track's, so a
   *  camera-only load still gets a full ruler. See Timeline's `fc`. */
  frameCount: number
  /** RMS columns of the imported track, 0..1, or null with none loaded. */
  audioPeaks: readonly number[] | null
  /** Track length in seconds — the waveform is drawn to real time, not to the
   *  clip's length, so a song longer than the dance still reads correctly. */
  audioDuration: number
  visibleBones: string[]
  selectedKeyframes: SelectedKeyframe[]
  tab: string
  onSetCurrentFrame: (f: number) => void
  onSelectKeyframe: (kf: SelectedKeyframe, multi: boolean) => void
  /** Clicking anything that is NOT a keyframe. See the ruler branch of
   *  `onMouseDown` for why this is its own callback. */
  onClearSelection: () => void
  onMoveDopeKeyframe: (
    boneRefs: Array<{ bone: string; kf: BoneKeyframe }>,
    morphRefs: Array<{ morph: string; kf: MorphKeyframe }>,
    cameraRefs: CameraKeyframe[],
    toFrame: number,
  ) => void
  onMoveCurveKeyframe: (bone: string, kfRef: BoneKeyframe, channel: string, toFrame: number, dv: number) => void
  onMoveMorphKeyframe: (morph: string, kfRef: MorphKeyframe, toFrame: number, dw: number) => void
  onMoveCameraKeyframe: (kfRef: CameraKeyframe, channelKey: string, toFrame: number, dv: number) => void
  /** Fired on mouseup/mouseleave at the end of a keyframe drag. Parent uses
   *  this to commit the clip once (for undo/redo + engine upload) instead of
   *  per-mousemove. */
  onEndKeyframeDrag: () => void
  /** Imperative repaint hook — bumps the static-cache drag version and redraws
   *  the canvas without a React state update. Populated by TimelineCanvas. */
  dragRedrawRef?: RefObject<(() => void) | null>
  /** Imperative draw handle: playback rAF loop writes the latest frame directly
   *  via `ref.current(frame)`, bypassing React reconciliation for 60Hz playhead
   *  updates. Populated by TimelineCanvas on mount. */
  playheadDrawRef?: RefObject<((frame: number) => void) | null>
}

function TimelineCanvas({
  clip,
  pxPerFrame,
  yZoom,
  scrollX,
  currentFrame,
  selectedBone,
  selectedMorph,
  cameraTrack,
  frameCount,
  audioPeaks,
  audioDuration,
  visibleBones,
  selectedKeyframes,
  tab,
  onSetCurrentFrame,
  onSelectKeyframe,
  onClearSelection,
  onMoveDopeKeyframe,
  onMoveCurveKeyframe,
  onMoveMorphKeyframe,
  onMoveCameraKeyframe,
  onEndKeyframeDrag,
  playheadDrawRef,
  dragRedrawRef,
}: TimelineCanvasProps) {
  const dict = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Latest frame for the draw closure to read — keeps `currentFrame` out of
   *  the `draw` useCallback deps so playback ticks don't re-run layout effects. */
  const frameRef = useRef(currentFrame)
  frameRef.current = currentFrame
  const sizeRef = useRef({ w: 0, h: 0, dpr: 0 })
  /** Offscreen cache: ruler + grid + curves + dopesheet. Repainted only when
   *  non-currentFrame deps change, so playback ticks just blit + draw the playhead. */
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticCacheRef = useRef<{
    w: number
    h: number
    clip: AnimationClip | null
    pxPerFrame: number
    yZoom: number
    scrollX: number
    selectedBone: string | null
    selectedMorph: string | null
    cameraTrack: readonly CameraKeyframe[] | null
    frameCount: number
    audioPeaks: readonly number[] | null
    visibleBones: readonly string[] | null
    selectedKeyframes: readonly SelectedKeyframe[] | null
    tab: string
    dragVersion: number
  }>({
    w: 0,
    h: 0,
    clip: null,
    pxPerFrame: 0,
    yZoom: 0,
    scrollX: 0,
    selectedBone: null,
    selectedMorph: null,
    cameraTrack: null,
    frameCount: 0,
    audioPeaks: null,
    visibleBones: null,
    selectedKeyframes: null,
    tab: "",
    dragVersion: 0,
  })
  /** Bumped by parent via `dragRedrawRef` while a keyframe drag is in progress.
   *  Participates in static-cache invalidation so in-place mutations repaint
   *  without needing a new clip reference (which would cascade a commit +
   *  engine clip reupload per mousemove). */
  const dragVersionRef = useRef(0)
  const drag = useRef<{
    type: string
    bone?: string
    channel?: string
    startX?: number
    startY?: number
    boneKfRef?: BoneKeyframe
    morphKfRef?: MorphKeyframe
    dopeBoneRefs?: Array<{ bone: string; kf: BoneKeyframe }>
    dopeMorphRefs?: Array<{ morph: string; kf: MorphKeyframe }>
    cameraKfRef?: CameraKeyframe
    dopeCameraRefs?: CameraKeyframe[]
    dopeFrame?: number
  } | null>(null)

  const getDopeFrames = useCallback(() => {
    const frames = new Map<number, number>()
    if (isCameraTab(tab)) {
      // One diamond per camera keyframe. Every channel keys together in a
      // camera VMD — a keyframe carries the whole pose — so the dopesheet is
      // the shot's cut list regardless of which channel tab is showing.
      for (const kf of cameraTrack) frames.set(kf.frame, 1)
    } else if (tab === "morph" && selectedMorph) {
      const track = clip.morphTracks.get(selectedMorph)
      if (track) for (const kf of track) frames.set(kf.frame, 1)
    } else if (selectedBone) {
      const track = clip.boneTracks.get(selectedBone)
      if (track) for (const kf of track) frames.set(kf.frame, 1)
    } else {
      for (const name of visibleBones) {
        const track = clip.boneTracks.get(name)
        if (track) for (const kf of track) frames.set(kf.frame, (frames.get(kf.frame) || 0) + 1)
      }
    }
    return frames
  }, [clip, visibleBones, selectedBone, selectedMorph, cameraTrack, tab])

  const draw = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const mainCtx = el.getContext("2d")
    if (!mainCtx) return
    const dpr = Math.min(4, Math.max(1, (window.devicePixelRatio || 1) * 1.5))
    const w = el.clientWidth,
      h = el.clientHeight
    const backingW = Math.max(1, Math.floor(w * dpr))
    const backingH = Math.max(1, Math.floor(h * dpr))
    const size = sizeRef.current
    let mainResized = false
    if (size.w !== backingW || size.h !== backingH || size.dpr !== dpr) {
      el.width = backingW
      el.height = backingH
      sizeRef.current = { w: backingW, h: backingH, dpr }
      mainResized = true
    }

    // ── Static cache: paint heavy layer to offscreen only when non-currentFrame deps change ──
    let off = staticCanvasRef.current
    if (!off) {
      off = document.createElement("canvas")
      staticCanvasRef.current = off
    }
    const cache = staticCacheRef.current
    const needRepaintStatic =
      mainResized ||
      cache.w !== backingW ||
      cache.h !== backingH ||
      cache.clip !== clip ||
      cache.pxPerFrame !== pxPerFrame ||
      cache.yZoom !== yZoom ||
      cache.scrollX !== scrollX ||
      cache.selectedBone !== selectedBone ||
      cache.selectedMorph !== selectedMorph ||
      cache.cameraTrack !== cameraTrack ||
      cache.frameCount !== frameCount ||
      cache.audioPeaks !== audioPeaks ||
      cache.visibleBones !== visibleBones ||
      cache.selectedKeyframes !== selectedKeyframes ||
      cache.tab !== tab ||
      cache.dragVersion !== dragVersionRef.current

    const ox = LABEL_W - scrollX
    // The lane is a SLOT, so it is there whether or not a track is in it. A
    // row that appears when you load music and vanishes when you remove it
    // makes the editor's whole layout shift under an unrelated action — and
    // an empty lane is also the only thing that says the slot exists at all.
    const audioH = AUDIO_H
    const audioY = h - audioH
    const dopeY = audioY - DOPE_H
    const curveTop = RULER_H
    const curveBot = dopeY - 1
    const curveH = curveBot - curveTop

    const channels = getChannelsForTab(tab)
    const ax = getAxisConfig(tab)
    // Y-zoom: shrink the visible value range around the axis center.
    const axCenter = (ax.min + ax.max) / 2
    const axHalf = (ax.max - ax.min) / 2 / Math.max(0.0001, yZoom)
    const vMin = axCenter - axHalf
    const vMax = axCenter + axHalf
    const toY = (v: number) => curveTop + (1 - (v - vMin) / (vMax - vMin)) * curveH
    const toX = (f: number) => ox + f * pxPerFrame

    if (needRepaintStatic) {
    if (off.width !== backingW || off.height !== backingH) {
      off.width = backingW
      off.height = backingH
    }
    const ctx = off.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // ── Backgrounds ──
    ctx.fillStyle = "rgba(0,0,0,0)"
    ctx.fillRect(0, 0, w, dopeY)
    ctx.fillStyle = C.dopeBg
    ctx.fillRect(0, dopeY, w, DOPE_H)
    ctx.strokeStyle = C.dopeBorder
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LABEL_W, dopeY + 0.5)
    ctx.lineTo(w, dopeY + 0.5)
    ctx.stroke()

    // ── Ruler ──
    ctx.fillStyle = C.ruler
    ctx.fillRect(0, 0, w, RULER_H)
    ctx.strokeStyle = C.border
    ctx.beginPath()
    ctx.moveTo(LABEL_W, RULER_H - 0.5)
    ctx.lineTo(w, RULER_H - 0.5)
    ctx.stroke()

    const fStep = pxPerFrame >= 12 ? 1 : pxPerFrame >= 6 ? 5 : 10
    const fMajor = fStep * 10
    const rulerFontPx = 9
    ctx.font = `${rulerFontPx}px ${FONT}`
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"
    const rulerTickTop = (maj: boolean) => (maj ? 2 : RULER_H - 4)
    const minRulerLabelGapPx = 32
    let lastRulerLabelX = -1e9
    for (let f = 0; f <= frameCount; f += fStep) {
      const x = ox + f * pxPerFrame
      if (x < LABEL_W - 10 || x > w + 10) continue
      const isM = f % fMajor === 0
      ctx.strokeStyle = isM ? C.rulerMajor : C.rulerTick
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, rulerTickTop(isM))
      ctx.lineTo(Math.round(x) + 0.5, RULER_H)
      ctx.stroke()
      if (isM && x - lastRulerLabelX >= minRulerLabelGapPx) {
        ctx.fillStyle = C.rulerText
        ctx.fillText(String(f), x, RULER_H - 2)
        lastRulerLabelX = x
      }
    }

    // ── Value plot: fixed left strip (doesn’t scroll with ox) + Y ticks/labels ──
    ctx.fillStyle = C.ruler
    ctx.fillRect(0, curveTop, LABEL_W, curveBot - curveTop)

    ctx.font = `9px ${FONT}`
    const isRotAxis = channels[0]?.group === "rot"
    // Snap tick iteration to multiples of subStep within the current view range,
    // further clamped to tickMin/tickMax — morph's plotted range pads past
    // [0, 1] for click-target room, but there's nothing to tick past the data.
    const tickLo = Math.max(vMin, ax.tickMin)
    const tickHi = Math.min(vMax, ax.tickMax)
    const firstTick = Math.ceil(tickLo / ax.subStep) * ax.subStep
    const lastTick = Math.floor(tickHi / ax.subStep) * ax.subStep
    const vSteps = Math.max(0, Math.round((lastTick - firstTick) / ax.subStep))
    for (let i = 0; i <= vSteps; i++) {
      const v = firstTick + i * ax.subStep
      if (v < vMin - 0.0001 || v > vMax + 0.0001) continue
      const y = toY(v)
      const isZero = Math.abs(v) < 0.001
      const isMajor = Math.abs(v % ax.step) < 0.001
      const stroke = isZero ? C.axisZero : isMajor ? C.axis : C.grid
      ctx.strokeStyle = stroke
      ctx.lineWidth = isZero ? 1 : 0.5
      // Tick into the fixed left gutter (value axis) so scale stays visible when scrolled
      ctx.beginPath()
      ctx.moveTo(LABEL_W - (isMajor || isZero ? 5 : 3), y)
      ctx.lineTo(LABEL_W, y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(LABEL_W, y)
      ctx.lineTo(w, y)
      ctx.stroke()

      if (isMajor || isZero) {
        ctx.fillStyle = C.rulerText
        ctx.textAlign = "right"
        ctx.textBaseline = "middle"
        const label = isRotAxis
          ? `${Math.round(v)}°`
          : Math.abs(v) < 0.001
            ? "0"
            : Math.abs(v - Math.round(v)) < 0.05
              ? String(Math.round(v))
              : v.toFixed(1)
        ctx.fillText(label, LABEL_W - 6, y)
      }
    }

    // Full-height Y-axis at plot left (screen-fixed at LABEL_W when scrollX moves content)
    ctx.strokeStyle = C.axis
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LABEL_W + 0.5, curveTop)
    ctx.lineTo(LABEL_W + 0.5, curveBot)
    ctx.stroke()

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"

    // Vertical frame grid (skip x = LABEL_W — Y-axis above)
    ctx.lineWidth = 0.5
    for (let f = 0; f <= frameCount; f += fStep) {
      const x = toX(f)
      if (x <= LABEL_W || x > w) continue
      ctx.strokeStyle = f % fMajor === 0 ? C.axis : C.grid
      ctx.beginPath()
      ctx.moveTo(x, curveTop)
      ctx.lineTo(x, curveBot)
      ctx.stroke()
    }

    // ── Curves ── (clip to plot area so zoomed-out-of-view values don't bleed)
    ctx.save()
    ctx.beginPath()
    ctx.rect(LABEL_W, curveTop, w - LABEL_W, curveBot - curveTop)
    ctx.clip()
    const isCamTab = isCameraTab(tab)
    const isMorphTab = tab === "morph"
    if (isCamTab) {
      // ── Camera curves ──
      // One line per channel under this tab: a single curve for target/
      // distance/fov, three for "Rotation" (MMD eases all three euler
      // components on one bezier, so they are shown, and keyed, together).
      const camChannels = cameraChannelsForTab(tab)
      if (cameraTrack.length > 0) {
        for (const ch of camChannels) {
          ctx.strokeStyle = ch.color
          ctx.lineWidth = camChannels.length === 1 ? 2 : 1.5
          ctx.beginPath()
          for (let i = 0; i < cameraTrack.length; i++) {
            const kf = cameraTrack[i]
            const val = ch.get(kf)
            const x = toX(kf.frame)
            if (i === 0) {
              ctx.moveTo(x, toY(val))
              continue
            }
            // Sample the segment's bezier rather than joining the dots. A
            // straight line here is what made the interpolation editor look
            // broken: the curve on screen ignored the bytes it was writing.
            // The incoming curve lives on the segment's END keyframe, which is
            // the convention camera-animation.ts samples with.
            const prev = cameraTrack[i - 1]
            const prevVal = ch.get(prev)
            const prevX = toX(prev.frame)
            const cp = cameraIpPair(kf.interpolation, ch.ip)
            const segs = Math.max(12, Math.ceil((x - prevX) / 3))
            for (let sIdx = 1; sIdx <= segs; sIdx++) {
              const t = sIdx / segs
              const interp = bezierY(cp[0], cp[1], t)
              ctx.lineTo(prevX + (x - prevX) * t, toY(prevVal + (val - prevVal) * interp))
            }
          }
          ctx.stroke()

          for (const kf of cameraTrack) {
            const x = toX(kf.frame)
            if (x < LABEL_W - 8 || x > w + 8) continue
            const isSel = selectedKeyframes.some(
              (sk) => sk.channel === ch.key && sk.frame === kf.frame,
            )
            ctx.beginPath()
            ctx.arc(x, toY(ch.get(kf)), isSel ? DOT_R + 1.5 : DOT_R, 0, Math.PI * 2)
            ctx.fillStyle = isSel ? C.keyDotSel : ch.color
            ctx.fill()
            if (isSel) {
              ctx.strokeStyle = ch.color
              ctx.lineWidth = 2
              ctx.stroke()
            }
          }
        }
      } else {
        ctx.fillStyle = C.label
        ctx.font = `13px ${FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(dict.lab.timeline.noKeys(dict.lab.timeline.camera), (w + LABEL_W) / 2, (curveTop + curveBot) / 2)
      }
    } else if (isMorphTab) {
      // ── Morph weight curve ──
      if (selectedMorph) {
        const morphKfs = clip.morphTracks.get(selectedMorph)
        if (morphKfs && morphKfs.length > 0) {
          // Draw linear curve
          ctx.strokeStyle = MORPH_COLOR
          ctx.lineWidth = 2
          ctx.beginPath()
          for (let i = 0; i < morphKfs.length; i++) {
            const kf = morphKfs[i]
            const x = toX(kf.frame), y = toY(kf.weight)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()

          // Dots
          for (const kf of morphKfs) {
            const x = toX(kf.frame)
            if (x < LABEL_W - 8 || x > w + 8) continue
            const isSel = selectedKeyframes.some(
              (s) => s.morph === selectedMorph && s.frame === kf.frame,
            )
            ctx.beginPath()
            ctx.arc(x, toY(kf.weight), isSel ? DOT_R + 1.5 : DOT_R, 0, Math.PI * 2)
            ctx.fillStyle = isSel ? C.keyDotSel : MORPH_COLOR
            ctx.fill()
            if (isSel) {
              ctx.strokeStyle = MORPH_COLOR
              ctx.lineWidth = 2
              ctx.stroke()
            }
          }

          // (value readout is drawn in the per-tick overlay below)
        } else {
          ctx.fillStyle = C.label
          ctx.font = `13px ${FONT}`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(dict.lab.timeline.noKeys(selectedMorph), (w + LABEL_W) / 2, (curveTop + curveBot) / 2)
        }
      } else {
        ctx.fillStyle = C.label
        ctx.font = `13px ${FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(dict.lab.timeline.pickMorph, (w + LABEL_W) / 2, (curveTop + curveBot) / 2)
      }
    } else if (selectedBone) {
      const keyframes = clip.boneTracks.get(selectedBone)
      if (keyframes && keyframes.length > 0) {
        const isSingle = channels.length === 1

        /**
         * Rotation, sampled the way playback evaluates it.
         *
         * Between two keyframes a bone SLERPS: the eased t drives a quaternion
         * interpolation, and the euler the panels show is a decomposition of
         * the result. Easing the three euler numbers independently — which is
         * what this used to draw — is a different curve, and across a ±180 wrap
         * it is the OPPOSITE one: the line falls the long way through zero
         * while the bone turns the short way. A turn built against that graph
         * fights the model, which is what makes going past 180° feel
         * impossible.
         *
         * Sampled once for all three axes, because rx/ry/rz are components of
         * the same sampled quaternion and the slerp is the expensive part.
         * Built lazily, so a translation-only tab pays nothing.
         */
        let rotSamples: { x: number; e: [number, number, number] }[] | null = null
        const buildRotSamples = () => {
          const out: { x: number; e: [number, number, number] }[] = []
          for (let i = 1; i < keyframes.length; i++) {
            const prev = keyframes[i - 1]
            const kf = keyframes[i]
            const prevX = toX(prev.frame)
            const x = toX(kf.frame)
            // Culled at both ends only, so this never opens a hole in the
            // middle of the path: what it drops is a prefix and a suffix.
            if (x < LABEL_W - 8 || prevX > w + 8) continue
            if (out.length === 0) {
              const e0 = quatToEuler(prev.rotation)
              out.push({ x: prevX, e: [e0.x, e0.y, e0.z] })
            }
            const cp = kf.interpolation.rotation
            // One sample per ~3px — finer than that is below what the canvas
            // can show, and every sample is a slerp plus a decomposition.
            const segs = Math.max(2, Math.min(96, Math.ceil((x - prevX) / 3)))
            for (let sIdx = 1; sIdx <= segs; sIdx++) {
              const u = sIdx / segs
              const e = quatToEuler(Quat.slerp(prev.rotation, kf.rotation, bezierY(cp[0], cp[1], u)))
              out.push({ x: prevX + (x - prevX) * u, e: [e.x, e.y, e.z] })
            }
          }
          return out
        }

        for (const ch of channels) {
          ctx.strokeStyle = ch.color
          ctx.lineWidth = isSingle ? 2 : 1.2
          ctx.beginPath()
          if (ch.group === "rot") {
            if (!rotSamples) rotSamples = buildRotSamples()
            const axis = ch.key === "rx" ? 0 : ch.key === "ry" ? 1 : 2
            let prevV: number | null = null
            let prevPx = 0
            for (const smp of rotSamples) {
              const v = smp.e[axis]
              if (prevV === null) {
                ctx.moveTo(smp.x, toY(v))
                prevV = v
                prevPx = smp.x
                continue
              }
              // A component crossing ±180 is the same rotation seen from the
              // other side of the wrap, not a leap across the whole plot.
              //
              // Drawn the way any wrapped angle should be: the line runs OFF
              // one edge and re-enters at the other, crossing at the x where it
              // actually passes ±180. Simply breaking the stroke here was worse
              // than the cliff it avoided — a break is a `moveTo`, and a
              // `moveTo` nothing follows draws no pixels at all, so a keyframe
              // whose sample happened to be the one suppressed lost the line to
              // its own dot and sat orphaned in empty space.
              let d = v - prevV
              if (d > 180) d -= 360
              else if (d < -180) d += 360
              if (Math.abs(v - prevV) > 180 && d !== 0) {
                const exit = d > 0 ? 180 : -180
                const xc = prevPx + (smp.x - prevPx) * ((exit - prevV) / d)
                ctx.lineTo(xc, toY(exit))
                // moveTo opens a new subpath inside the same path object, so
                // this still costs one stroke for the whole channel.
                ctx.moveTo(xc, toY(-exit))
              }
              ctx.lineTo(smp.x, toY(v))
              prevV = v
              prevPx = smp.x
            }
          } else {
            // Translation is three independent per-axis curves, so easing
            // between the keyframe values IS what playback does.
            const interpKey =
              ch.key === "tx" ? "translationX" : ch.key === "ty" ? "translationY" : "translationZ"
            let started = false
            for (let i = 0; i < keyframes.length; i++) {
              const kf = keyframes[i]
              const val = ch.get(kf)
              const x = toX(kf.frame)
              if (!started) {
                ctx.moveTo(x, toY(val))
                started = true
                continue
              }
              const prev = keyframes[i - 1]
              const prevVal = ch.get(prev)
              const prevX = toX(prev.frame)
              const cp = kf.interpolation[interpKey] as [{ x: number; y: number }, { x: number; y: number }]
              const segs = Math.max(12, Math.ceil((x - prevX) / 3))
              for (let s = 1; s <= segs; s++) {
                const t = s / segs
                const interp = bezierY(cp[0], cp[1], t)
                ctx.lineTo(prevX + (x - prevX) * t, toY(prevVal + (val - prevVal) * interp))
              }
            }
          }
          ctx.stroke()

          // Dots
          for (const kf of keyframes) {
            const val = ch.get(kf)
            const x = toX(kf.frame)
            if (x < LABEL_W - 8 || x > w + 8) continue
            const isSel = selectedKeyframes.some(
              (s) => s.bone === selectedBone && s.frame === kf.frame && s.channel === ch.key,
            )
            ctx.beginPath()
            ctx.arc(x, toY(val), isSel ? DOT_R + 1.5 : DOT_R, 0, Math.PI * 2)
            ctx.fillStyle = isSel ? C.keyDotSel : ch.color
            ctx.fill()
            if (isSel) {
              ctx.strokeStyle = ch.color
              ctx.lineWidth = 2
              ctx.stroke()
            }
          }
        }

        // (value readout is drawn in the per-tick overlay below)
      } else {
        ctx.fillStyle = C.label
        ctx.font = `13px ${FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(dict.lab.timeline.noKeys(boneDisplayLabel(selectedBone)), (w + LABEL_W) / 2, (curveTop + curveBot) / 2)
      }
    } else {
      ctx.fillStyle = C.label
      ctx.font = `13px ${FONT}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(dict.lab.timeline.pickBone, (w + LABEL_W) / 2, (curveTop + curveBot) / 2)
    }
    ctx.restore()

    // ── Dopesheet ──
    const frames = getDopeFrames()
    const maxCount = Math.max(1, ...frames.values())
    // Centre, not 0.4 down. The diamonds are the lane's whole content and there
    // is nothing beneath them to leave room for, so the bias only ever read as
    // the row sitting off-axis from the music lane beside it. Changed in the
    // hit-test as well — these two must agree or clicks miss.
    const dopeMid = dopeY + DOPE_H / 2

    // Clipped to the plot, like the curve band above it.
    //
    // The per-item guards this replaces let a diamond centred at LABEL_W - 5
    // draw half of itself into the gutter, and the label cell that was supposed
    // to mask it is filled with C.dopeBg — which is rgba(0,0,0,0), so it masks
    // nothing at all. On a dense motion that reads as the keys sliding under
    // the word "Keys". Clipping is the fix that cannot be got wrong later: no
    // caller has to remember a margin, and it covers the grid, the diamonds and
    // anything added here afterwards.
    ctx.save()
    ctx.beginPath()
    ctx.rect(LABEL_W, dopeY, w - LABEL_W, h - dopeY)
    ctx.clip()

    // Dope grid
    ctx.lineWidth = 0.3
    for (let f = 0; f <= frameCount; f += fStep) {
      const x = toX(f)
      if (x < LABEL_W || x > w) continue
      ctx.strokeStyle = C.grid
      ctx.beginPath()
      ctx.moveTo(x, dopeY + 1)
      ctx.lineTo(x, h)
      ctx.stroke()
    }

    ctx.font = `10px ${FONT}`
    ctx.textAlign = "center"
    const sortedDope = Array.from(frames.entries()).sort((a, b) => a[0] - b[0])
    for (const [frame, count] of sortedDope) {
      const x = toX(frame)
      if (x < LABEL_W - DIAMOND || x > w + DIAMOND) continue
      const isSel = selectedKeyframes.some((s) => s.frame === frame && s.type === "dope")
      const intensity = selectedBone ? 0.85 : 0.4 + 0.6 * (count / maxCount)

      ctx.save()
      ctx.translate(x, dopeMid)
      ctx.rotate(Math.PI / 4)
      // One size, always. Growing a diamond because the frame carries several
      // keys made the whole strip lumpy the moment nothing was selected —
      // which is how the editor first opens — and it says the same thing the
      // alpha above already says. Density belongs in one channel, and the one
      // that does not change the shape of a row is the right one.
      const sz = DIAMOND
      ctx.fillStyle = isSel ? C.diamondSel : `rgba(170,170,195,${intensity})`
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz)
      if (isSel) {
        ctx.strokeStyle = "rgba(156,163,175,0.35)"
        ctx.lineWidth = 1
        ctx.strokeRect(-sz / 2 - 1, -sz / 2 - 1, sz + 2, sz + 2)
      }
      ctx.restore()
    }
    ctx.restore()

    // ── Music lane ──
    // A reference, not a track you edit: where the beats are is most of what
    // syncing a dance to a song needs, and it is the one thing a frame number
    // cannot tell you. Drawn to REAL TIME (its own duration at 30fps), not to
    // the clip's length, so a song longer than the dance still reads correctly
    // and its end lands where it actually falls.
    {
      ctx.fillStyle = C.dopeBg
      ctx.fillRect(LABEL_W, audioY, w - LABEL_W, audioH)
      ctx.strokeStyle = C.dopeBorder
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(LABEL_W, audioY + 0.5)
      ctx.lineTo(w, audioY + 0.5)
      ctx.stroke()

      const mid = audioY + audioH / 2
      const half = (audioH - 6) / 2
      const audioEndFrame = audioDuration * 30
      ctx.fillStyle = C.audioWave
      // One bar per pixel column across the visible span, each reading the
      // precomputed RMS array — sampling a fixed array beats re-walking the
      // decoded buffer on every zoom step.
      if (audioPeaks && audioPeaks.length > 0) {
        for (let px = LABEL_W; px < w; px++) {
          const frame = (px - ox) / pxPerFrame
          if (frame < 0 || frame > audioEndFrame) continue
          const t = audioEndFrame > 0 ? frame / audioEndFrame : 0
          const idx = Math.min(audioPeaks.length - 1, Math.max(0, Math.round(t * (audioPeaks.length - 1))))
          const a = audioPeaks[idx] * half
          if (a <= 0) continue
          ctx.fillRect(px, mid - a, 1, a * 2)
        }
      } else {
        // Empty, and saying so with a line rather than with words: a lane that
        // holds a waveform reads as a lane holding silence, which is what it is.
        ctx.strokeStyle = C.dopeBorder
        ctx.beginPath()
        ctx.moveTo(LABEL_W, mid + 0.5)
        ctx.lineTo(w, mid + 0.5)
        ctx.stroke()
      }

      // Its own label cell, like the dopesheet's.
      ctx.fillStyle = C.dopeBg
      ctx.fillRect(0, audioY, LABEL_W, audioH)
      ctx.strokeStyle = C.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(LABEL_W - 0.5, audioY)
      ctx.lineTo(LABEL_W - 0.5, audioY + audioH)
      ctx.stroke()
      // Same treatment as the dopesheet's "Keys" below it — they are two lane
      // names in one gutter, and anything that differs between them reads as a
      // difference in kind rather than in styling.
      ctx.fillStyle = C.dopeLabel
      ctx.font = `10px ${FONT}`
      ctx.textAlign = "right"
      ctx.textBaseline = "middle"
      ctx.fillText("Music", LABEL_W - 6, mid + 1)
    }

    // Dopesheet label
    ctx.fillStyle = C.dopeBg
    ctx.fillRect(0, dopeY, LABEL_W, DOPE_H)
    ctx.strokeStyle = C.border
    ctx.beginPath()
    ctx.moveTo(LABEL_W - 0.5, dopeY)
    ctx.lineTo(LABEL_W - 0.5, h)
    ctx.stroke()
    ctx.fillStyle = C.dopeLabel
    ctx.font = `10px ${FONT}`
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillText("Keys", LABEL_W - 6, dopeMid + 1)

      cache.w = backingW
      cache.h = backingH
      cache.clip = clip
      cache.pxPerFrame = pxPerFrame
      cache.yZoom = yZoom
      cache.scrollX = scrollX
      cache.selectedBone = selectedBone
      cache.selectedMorph = selectedMorph
      cache.cameraTrack = cameraTrack
      cache.frameCount = frameCount
      cache.audioPeaks = audioPeaks
      cache.visibleBones = visibleBones
      cache.selectedKeyframes = selectedKeyframes
      cache.tab = tab
      cache.dragVersion = dragVersionRef.current
    }

    // ── Composite cached static layer onto the visible canvas ──
    mainCtx.setTransform(1, 0, 0, 1, 0, 0)
    mainCtx.clearRect(0, 0, backingW, backingH)
    mainCtx.drawImage(off, 0, 0)
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // ── Per-tick overlay: value readout (reads frameRef so playback rAF can
    //    call `draw()` without invalidating the useCallback closure) ──
    const frame = frameRef.current
    {
      const ctx = mainCtx
      if (tab === "morph" && selectedMorph) {
        const morphKfs = clip.morphTracks.get(selectedMorph)
        if (morphKfs && morphKfs.length > 0) {
          ctx.font = `10px ${FONT}`
          ctx.textBaseline = "top"
          ctx.textAlign = "right"
          // Sampled, for the same reason the bone readout below is: the curve
          // beside it is drawn linear between keys, so a held value contradicts
          // the line it sits on.
          const val = sampleMorphTrackAt(morphKfs, frame)
          ctx.fillStyle = MORPH_COLOR
          ctx.fillText(`Weight: ${val.toFixed(2)}`, w - 8, curveTop + 5)
        }
      } else if (selectedBone) {
        const keyframes = clip.boneTracks.get(selectedBone)
        if (keyframes && keyframes.length > 0) {
          ctx.font = `10px ${FONT}`
          ctx.textBaseline = "top"
          ctx.textAlign = "right"
          // `?.` like the axis label above: the morph tab has no channels, so
          // channels[0] is undefined here whenever a bone is also selected.
          const isRotGroup = channels[0]?.group === "rot"
          const numWidth = isRotGroup ? 7 : 6
          const formatVal = (v: number) => {
            const s = isRotGroup ? `${v.toFixed(1)}°` : v.toFixed(2)
            return s.padStart(numWidth, " ")
          }
          // Sampled, not held. This used to show the last keyframe at or
          // before the playhead, so between keys it reported a pose the model
          // was no longer in and never agreed with the properties dock — the
          // other half of "the numbers and the curve disagree".
          const pose = sampleBoneTrackAt(keyframes, frame)
          channels.forEach((ch, i) => {
            const val = pose ? ch.pick(pose) : 0
            ctx.fillStyle = ch.color
            ctx.fillText(
              `${dict.lab.timeline.labels[ch.label] ?? ch.label}: ${formatVal(val)}`,
              w - 8,
              curveTop + 5 + i * 13,
            )
          })
        }
      }

      // ── Playhead ──
      const px = toX(frame)
      if (px >= LABEL_W && px <= w) {
        const g = ctx.createLinearGradient(px - 14, 0, px + 14, 0)
        g.addColorStop(0, "transparent")
        g.addColorStop(0.5, C.playheadGlow)
        g.addColorStop(1, "transparent")
        ctx.fillStyle = g
        ctx.fillRect(px - 14, RULER_H, 28, h - RULER_H)
        // Dashed, so the line reads as a MARKER over the content rather than as
        // another curve drawn on it — at one pixel wide in a band full of
        // one-pixel curves, solid red was just the reddest of them. The head
        // and the glow stay solid: those are the parts you aim at.
        ctx.strokeStyle = C.playhead
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, h)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = C.playhead
        ctx.beginPath()
        ctx.moveTo(px - 5, 0)
        ctx.lineTo(px + 5, 0)
        ctx.lineTo(px, 7)
        ctx.closePath()
        ctx.fill()
      }
    }
    // dict.lab.timeline, because the canvas PAINTS its own empty states — a
    // language change has to repaint them, and nothing else here would.
  }, [clip, pxPerFrame, yZoom, scrollX, selectedBone, selectedMorph, cameraTrack, frameCount, audioPeaks, audioDuration, visibleBones, selectedKeyframes, tab, getDopeFrames, dict.lab.timeline])

  // Layout-phase paint: `useEffect`+nested rAF ran after browser paint → playhead lagged 1–2 frames behind transport.
  // `currentFrame` is in deps (not in `draw`'s deps) so scrubbing + throttled
  // playback state updates still repaint; 60Hz playback bypasses this via
  // `playheadDrawRef` below.
  useLayoutEffect(() => {
    draw()
  }, [draw, currentFrame])

  // Publish the imperative draw handle so the playback rAF loop can update the
  // playhead without going through React state.
  useEffect(() => {
    if (!playheadDrawRef) return
    playheadDrawRef.current = (frame: number) => {
      frameRef.current = frame
      draw()
    }
    return () => {
      if (playheadDrawRef.current) playheadDrawRef.current = null
    }
  }, [draw, playheadDrawRef])

  // Publish the drag-redraw handle. Parent drag callbacks mutate keyframes
  // in place then invoke this to invalidate the static cache and repaint —
  // no React state updates, no clip commits, no engine re-uploads.
  useEffect(() => {
    if (!dragRedrawRef) return
    dragRedrawRef.current = () => {
      dragVersionRef.current++
      draw()
    }
    return () => {
      if (dragRedrawRef.current) dragRedrawRef.current = null
    }
  }, [draw, dragRedrawRef])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    // Coalesced into one rAF rather than drawing per callback.
    //
    // A ResizeObserver fires for every intermediate size, and the panel this
    // lives in ANIMATES its width for 300ms when it opens or closes — so the
    // naive version ran a full static-layer repaint (ruler, grid, every curve,
    // every diamond) sixty times over a third of a second, on the exact frames
    // the fold is trying to be smooth on. Coalescing means at most one repaint
    // per frame no matter how many entries arrive, which is all a canvas that
    // paints once per frame could ever use.
    let raf = 0
    const obs = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    })
    obs.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [draw])

  // ── Hit testing ──
  const hitTest = useCallback(
    (e: React.MouseEvent) => {
      const el = canvasRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left,
        my = e.clientY - rect.top
      const ox = LABEL_W - scrollX
      const h = el.clientHeight
      const dopeY = h - DOPE_H - AUDIO_H
      const curveH = dopeY - 1 - RULER_H
      const ax = getAxisConfig(tab)
      const axCenter = (ax.min + ax.max) / 2
      const axHalf = (ax.max - ax.min) / 2 / Math.max(0.0001, yZoom)
      const vMin = axCenter - axHalf
      const vMax = axCenter + axHalf
      const toY = (v: number) => RULER_H + (1 - (v - vMin) / (vMax - vMin)) * curveH
      const toX = (f: number) => ox + f * pxPerFrame

      if (my < RULER_H) {
        const f = Math.round((mx - ox) / pxPerFrame)
        return { zone: "ruler" as const, frame: Math.max(0, Math.min(frameCount, f)) }
      }

      if (my >= dopeY) {
        const frames = getDopeFrames()
        // Centre, not 0.4 down. The diamonds are the lane's whole content and there
    // is nothing beneath them to leave room for, so the bias only ever read as
    // the row sitting off-axis from the music lane beside it. Changed in the
    // hit-test as well — these two must agree or clicks miss.
    const dopeMid = dopeY + DOPE_H / 2
        for (const [frame] of frames) {
          const x = toX(frame)
          if (Math.abs(mx - x) < 8 && Math.abs(my - dopeMid) < 12)
            return { zone: "dope" as const, frame }
        }
        const f = Math.round((mx - ox) / pxPerFrame)
        return { zone: "ruler" as const, frame: Math.max(0, Math.min(frameCount, f)) }
      }

      if (isCameraTab(tab)) {
        // Nearest dot wins across every channel drawn under this tab, so the
        // three rotation curves are all grabbable where they overlap.
        for (const ch of cameraChannelsForTab(tab)) {
          for (const kf of cameraTrack) {
            const x = toX(kf.frame)
            const y = toY(ch.get(kf))
            if (Math.hypot(mx - x, my - y) < DOT_R + 5)
              return { zone: "camera-curve" as const, channel: ch.key, frame: kf.frame }
          }
        }
      } else if (tab === "morph" && selectedMorph) {
        const morphKfs = clip.morphTracks.get(selectedMorph)
        if (morphKfs) {
          for (const kf of morphKfs) {
            const x = toX(kf.frame), y = toY(kf.weight)
            if (Math.hypot(mx - x, my - y) < DOT_R + 5)
              return { zone: "morph-curve" as const, morph: selectedMorph, frame: kf.frame }
          }
        }
      } else if (selectedBone) {
        const keyframes = clip.boneTracks.get(selectedBone)
        if (keyframes) {
          const channels = getChannelsForTab(tab)
          for (const ch of channels) {
            for (const kf of keyframes) {
              const x = toX(kf.frame),
                y = toY(ch.get(kf))
              if (Math.hypot(mx - x, my - y) < DOT_R + 5)
                return { zone: "curve" as const, bone: selectedBone, frame: kf.frame, channel: ch.key }
            }
          }
        }
      }

      const f = Math.round((mx - ox) / pxPerFrame)
      return { zone: "ruler" as const, frame: Math.max(0, Math.min(frameCount, f)) }
    },
    [clip, pxPerFrame, yZoom, scrollX, selectedBone, selectedMorph, cameraTrack, frameCount, audioPeaks, tab, getDopeFrames],
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Left button only. Every gesture on this canvas — scrub, select, drag a
      // keyframe — starts here, so without this a right-click anywhere in the
      // ruler or the dope strip moved the playhead on its way to opening a
      // context menu, and a middle-click did it silently.
      if (e.button !== 0) return
      const hit = hitTest(e)
      if (!hit) return
      if (hit.zone === "ruler") {
        // Clicking empty space DESELECTS.
        //
        // "ruler" is the fall-through: hitTest only names a keyframe zone when
        // a diamond or a curve dot is actually under the pointer, so every
        // click on the ruler, on empty curve space or on a gap in the dope
        // strip lands here. It moved the playhead and left the selection
        // alone, so a selected key stayed drawn at its larger radius for the
        // rest of the session — while the interpolation panel dimmed, because
        // that reads whether the PLAYHEAD is on a key, not what is selected.
        // Two different questions, and the canvas was answering the older one.
        //
        // Shift is the additive gesture everywhere else here, so it is spared:
        // shift-clicking to extend a selection must not begin by dropping it.
        if (!e.shiftKey) onClearSelection()
        onSetCurrentFrame(hit.frame)
        drag.current = { type: "scrub" }
      } else if (hit.zone === "dope") {
        onSelectKeyframe({ frame: hit.frame, type: "dope" }, e.shiftKey)
        // Capture references to all keyframes (across bones/morphs) sharing this frame
        const dopeBoneRefs: Array<{ bone: string; kf: BoneKeyframe }> = []
        const dopeMorphRefs: Array<{ morph: string; kf: MorphKeyframe }> = []
        const dopeCameraRefs: CameraKeyframe[] = []
        if (isCameraTab(tab)) {
          const kf = cameraTrack.find((k) => k.frame === hit.frame)
          if (kf) dopeCameraRefs.push(kf)
        } else if (tab === "morph" && selectedMorph) {
          const track = clip.morphTracks.get(selectedMorph)
          const kf = track?.find((k) => k.frame === hit.frame)
          if (kf) dopeMorphRefs.push({ morph: selectedMorph, kf })
        } else {
          const bones = selectedBone ? [selectedBone] : visibleBones
          for (const name of bones) {
            const track = clip.boneTracks.get(name)
            const kf = track?.find((k) => k.frame === hit.frame)
            if (kf) dopeBoneRefs.push({ bone: name, kf })
          }
        }
        drag.current = {
          type: "dope",
          startX: e.clientX,
          dopeBoneRefs,
          dopeMorphRefs,
          dopeCameraRefs,
          dopeFrame: hit.frame,
        }
      } else if (hit.zone === "camera-curve") {
        const kfRef = cameraTrack.find((k) => k.frame === hit.frame)
        if (!kfRef) return
        onSelectKeyframe({ frame: hit.frame, channel: hit.channel, type: "curve" }, e.shiftKey)
        drag.current = {
          type: "camera-curve",
          channel: hit.channel,
          cameraKfRef: kfRef,
          startX: e.clientX,
          startY: e.clientY,
        }
      } else if (hit.zone === "morph-curve") {
        const track = clip.morphTracks.get(hit.morph)
        const kfRef = track?.find((k) => k.frame === hit.frame)
        if (!kfRef) return
        onSelectKeyframe(
          { morph: hit.morph, frame: hit.frame, type: "curve" },
          e.shiftKey,
        )
        drag.current = {
          type: "morph-curve",
          bone: hit.morph,
          morphKfRef: kfRef,
          startX: e.clientX,
          startY: e.clientY,
        }
      } else if (hit.zone === "curve") {
        const track = clip.boneTracks.get(hit.bone)
        const kfRef = track?.find((k) => k.frame === hit.frame)
        if (!kfRef) return
        onSelectKeyframe(
          { bone: hit.bone, frame: hit.frame, channel: hit.channel, type: "curve" },
          e.shiftKey,
        )
        drag.current = {
          type: "curve",
          bone: hit.bone,
          boneKfRef: kfRef,
          channel: hit.channel,
          startX: e.clientX,
          startY: e.clientY,
        }
      }
    },
    [hitTest, onSetCurrentFrame, onSelectKeyframe, onClearSelection, clip, tab, selectedBone, selectedMorph, cameraTrack, visibleBones],
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = canvasRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const ox = LABEL_W - scrollX

      if (drag.current?.type === "scrub") {
        const f = Math.round((mx - ox) / pxPerFrame)
        onSetCurrentFrame(Math.max(0, Math.min(frameCount, f)))
        return
      }
      if (drag.current?.type === "dope") {
        const dx = e.clientX - (drag.current.startX ?? 0)
        const df = Math.round(dx / pxPerFrame)
        if (df !== 0 && drag.current.dopeFrame !== undefined) {
          const newFrame = drag.current.dopeFrame + df
          onMoveDopeKeyframe(
            drag.current.dopeBoneRefs ?? [],
            drag.current.dopeMorphRefs ?? [],
            drag.current.dopeCameraRefs ?? [],
            newFrame,
          )
          drag.current.dopeFrame = Math.max(0, newFrame)
          drag.current.startX = e.clientX
        }
        return
      }
      if (drag.current?.type === "camera-curve") {
        const dx = e.clientX - (drag.current.startX ?? 0)
        const dy = e.clientY - (drag.current.startY ?? 0)
        const df = Math.round(dx / pxPerFrame)
        const h = el.clientHeight
        const curveH = h - DOPE_H - (audioPeaks ? AUDIO_H : 0) - 1 - RULER_H
        const ax = getAxisConfig(tab)
        const dv = -(dy / curveH) * ((ax.max - ax.min) / Math.max(0.0001, yZoom))
        const ref = drag.current.cameraKfRef
        if ((df !== 0 || Math.abs(dv) > 0.01) && drag.current.channel && ref) {
          onMoveCameraKeyframe(ref, drag.current.channel, ref.frame + df, dv)
          if (df !== 0) drag.current.startX = e.clientX
          drag.current.startY = e.clientY
        }
        return
      }
      if (drag.current?.type === "morph-curve") {
        const dx = e.clientX - (drag.current.startX ?? 0)
        const dy = e.clientY - (drag.current.startY ?? 0)
        const df = Math.round(dx / pxPerFrame)
        const h = el.clientHeight
        const curveH = h - DOPE_H - (audioPeaks ? AUDIO_H : 0) - 1 - RULER_H
        const ax = getAxisConfig(tab)
        const dw = -(dy / curveH) * ((ax.max - ax.min) / Math.max(0.0001, yZoom))
        const ref = drag.current.morphKfRef
        if ((df !== 0 || Math.abs(dw) > 0.005) && drag.current.bone && ref) {
          const newFrame = ref.frame + df
          onMoveMorphKeyframe(drag.current.bone, ref, newFrame, dw)
          if (df !== 0) drag.current.startX = e.clientX
          drag.current.startY = e.clientY
        }
        return
      }
      if (drag.current?.type === "curve") {
        const dx = e.clientX - (drag.current.startX ?? 0)
        const dy = e.clientY - (drag.current.startY ?? 0)
        const df = Math.round(dx / pxPerFrame)
        const h = el.clientHeight
        const curveH = h - DOPE_H - (audioPeaks ? AUDIO_H : 0) - 1 - RULER_H
        const ax = getAxisConfig(tab)
        const dv = -(dy / curveH) * ((ax.max - ax.min) / Math.max(0.0001, yZoom))
        const ref = drag.current.boneKfRef
        if ((df !== 0 || Math.abs(dv) > 0.01) && drag.current.bone && drag.current.channel && ref) {
          const newFrame = ref.frame + df
          onMoveCurveKeyframe(drag.current.bone, ref, drag.current.channel, newFrame, dv)
          if (df !== 0) drag.current.startX = e.clientX
          drag.current.startY = e.clientY
        }
        return
      }

      const hit = hitTest(e)
      el.style.cursor =
        hit?.zone === "dope"
          ? "ew-resize"
          : hit?.zone === "curve" || hit?.zone === "morph-curve" || hit?.zone === "camera-curve"
            ? "grab"
            : hit?.zone === "ruler"
              ? "col-resize"
              : "default"
    },
    [hitTest, pxPerFrame, yZoom, scrollX, clip, frameCount, audioPeaks, tab, onSetCurrentFrame, onMoveDopeKeyframe, onMoveCurveKeyframe, onMoveMorphKeyframe, onMoveCameraKeyframe],
  )

  const endDrag = useCallback(() => {
    const d = drag.current
    drag.current = null
    if (d && (d.type === "dope" || d.type === "curve" || d.type === "morph-curve" || d.type === "camera-curve")) {
      onEndKeyframeDrag()
    }
  }, [onEndKeyframeDrag])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    />
  )
}

// ─── Timeline (public component) ─────────────────────────────────────────
interface TimelineProps {
  visibleBones: string[]
  /** Bumped on new clip load / reset — triggers local view state reset. */
  clipVersion: number
  /** Lifted channel tab state — synced from keyframe selection and slider interactions. */
  tab: string
  setTab: (tab: string) => void
  /** Imperative playhead draw handle — see TimelineCanvasProps. */
  playheadDrawRef?: RefObject<((frame: number) => void) | null>
  /** A restored draft's view (zoom + scroll), applied once as soon as it
   *  arrives (boot restore resolves asynchronously, after this component has
   *  already mounted with the plain defaults below). */
  audioPeaks: readonly number[] | null
  audioDuration: number
  /** Whether the fold is open. The canvas stops MEASURING itself when it is
   *  not — see the ResizeObserver. */
  open: boolean
  initialView?: { pxPerFrame: number; yZoom: number; scrollX: number }
  /** Fires after mount on every view change (not on the initial render) —
   *  lets the parent persist it without owning this state itself. */
  onViewChange?: (view: { pxPerFrame: number; yZoom: number; scrollX: number }) => void
  /** The host transport's chrome, at the end of the channel row. Camera follow,
   *  loop and the collapse toggle belong to the SCENE, not to this clip, but
   *  once the editor is open they are the only transport controls left — so
   *  they ride the toolbar that is already there rather than keeping a row of
   *  their own alive above it just to hold three buttons. */
  trailing?: ReactNode
  /**
   * The scene's effects, for the strips band above the canvas.
   *
   * They arrive HERE, at the bottom of the tree, because this is where the axis
   * lives: `pxPerFrame` and `scrollX` are this component's own state, so a band
   * rendered alongside the canvas shares its mapping to the pixel and moves
   * with every zoom and scroll. A band positioned anywhere else is a second
   * axis, and the seam shows the first time anyone zooms.
   */
  effects?: AppliedEffect[]
  selectedEffect?: string | null
  selectedStrip?: number | null
  onSelectStrip?: (uid: string, i: number) => void
  onLane?: (uid: string, lane: EffectWindow[]) => void
}

export function Timeline({
  visibleBones,
  clipVersion,
  tab,
  setTab,
  playheadDrawRef,
  audioPeaks,
  audioDuration,
  open,
  initialView,
  onViewChange,
  trailing,
  effects,
  selectedEffect = null,
  selectedStrip = null,
  onSelectStrip,
  onLane,
}: TimelineProps) {
  const dict = useT()
  const clip = useClipSelector((s) => s.clip)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const selectedMorph = useClipSelector((s) => s.selectedMorph)
  const selectedKeyframes = useClipSelector((s) => s.selectedKeyframes)
  const cameraTrack = useClipSelector((s) => s.cameraTrack)
  const cameraSelected = useClipSelector((s) => s.cameraSelected)
  const { commit, commitCamera, setSelectedKeyframes } = useClipActions()
  const selectionKind: "bone" | "morph" | "camera" = cameraSelected
    ? "camera"
    : selectedMorph
      ? "morph"
      : "bone"
  const visibleTabs = tabsForSelection(selectionKind)
  const { currentFrame, setCurrentFrame, playing, setPlaying } = usePlayhead()
  // Written, not read, by this component: the draw callback below publishes the
  // live frame into it for every consumer that must not subscribe. See there.
  const frameRef = usePlayheadFrameRef()
  // THE BODY MOTION SETS THE LENGTH, and only in its absence does anything else.
  //
  // A camera VMD carries no bone or morph frames, so a camera-only load leaves
  // `clip.frameCount` at its default while the shot runs for minutes — the ruler
  // would end long before the track it is drawing. That is what the fallback is
  // for, and it used to be a plain max() over both, which made the longest FILE
  // the axis: a shot that keeps rolling after the dance, or an expression file
  // with a trailing key, and the ruler runs past the take with the scrub thumb
  // shrunk to match.
  //
  // The clip's own frameCount is already the motion's (see clipTrimmedToMotion,
  // applied where the expression file is laid on), so with a motion present this
  // is simply that — including any growth from an edit, which is deliberate.
  const lastCameraFrame = cameraTrack.length > 0 ? cameraTrack[cameraTrack.length - 1].frame : 0
  const hasMotion = useMemo(() => (clip ? motionFrameCount(clip) > 0 : false), [clip])
  const fc = hasMotion ? (clip?.frameCount ?? 0) : Math.max(clip?.frameCount ?? 0, lastCameraFrame)
  const [endDraft, setEndDraft] = useState<string | null>(null)
  const [frameDraft, setFrameDraft] = useState<string | null>(null)
  // Lazy-initialized from a restored draft's view, read once at first mount —
  // NOT patched in afterward. `currentFrame` above is global playback state,
  // already settled by the time this component exists; if scrollX/pxPerFrame
  // instead arrived a render or two later (the old approach: mount on plain
  // defaults, patch via an effect once the prop showed up), the playhead and
  // scroll would briefly disagree about where "frame N" is on screen — the
  // draw() guard below hides anything that lands off the computed canvas
  // area, so that disagreement showed up as the playhead or the whole
  // timeline going blank until something forced another redraw. StudioPage
  // only mounts <Timeline> once boot has fully resolved (see `studioReady`),
  // so `initialView` is already final here, not a later patch.
  const [pxPerFrame, setPxPerFrame] = useState(() => initialView?.pxPerFrame ?? 4)
  const pxRef = useRef(pxPerFrame)
  pxRef.current = pxPerFrame
  const [yZoom, setYZoom] = useState(() => initialView?.yZoom ?? 1)
  const yZoomRef = useRef(yZoom)
  yZoomRef.current = yZoom
  const [scrollX, setScrollX] = useState(() => initialView?.scrollX ?? 0)
  const scrollXRef = useRef(0)
  scrollXRef.current = scrollX
  const timelineAreaRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)

  const minPxPerFrame = useMemo(() => minPxPerFrameForViewport(trackWidth, fc), [trackWidth, fc])
  /**
   * Whether a width measured right now means anything.
   *
   * False while the fold is shut, and ALSO for as long as it is opening. Both
   * directions matter and only the first is obvious. Opening flips `open` to
   * true immediately and then animates the transport from fit-content to the
   * working area over 300ms, so the first measurements after a reopen are of a
   * pill — narrow enough that `minPxPerFrame` spikes and the effect below
   * ratchets `pxPerFrame` up to meet it. Nothing lowers it again, so the editor
   * came back rezoomed, showing a different range with the playhead somewhere
   * else, which is what a reopened fold must never do.
   *
   * One deliberate measurement when the motion is over, rather than sixty
   * during it.
   */
  const measurable = useRef(false)
  useEffect(() => {
    measurable.current = false
    if (!open) return
    const t = setTimeout(() => {
      measurable.current = true
      const el = timelineAreaRef.current
      if (el) setTrackWidth(el.clientWidth)
    }, FOLD_SETTLE_MS)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    const el = timelineAreaRef.current
    if (!el) return
    // Not while the fold is SHUT.
    //
    // Collapsing does not just hide this — the transport pill it lives in
    // shrinks from the working area to fit-content, so the measured width drops
    // to a few hundred pixels. `minPxPerFrame` is derived from that width and
    // the effect below raises `pxPerFrame` to meet it. Reopening restores the
    // width and lowers the minimum again, but nothing lowers the ZOOM back:
    // Math.max only ever raises it. So a collapse quietly rezoomed the editor,
    // and reopening showed a different range with the playhead somewhere else
    // on screen — the one thing a fold must not do. Measuring only while open
    // means the width this knows is the width it was last usable at.
    const ro = new ResizeObserver(() => {
      if (!measurable.current) return
      setTrackWidth(el.clientWidth)
    })
    ro.observe(el)
    setTrackWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setPxPerFrame((p) => Math.min(MAX_PX, Math.max(minPxPerFrame, p)))
  }, [minPxPerFrame])

  // Reset local view state when a DIFFERENT clip is loaded, or the editor reset.
  //
  // The first arrival is not a swap, and counting it was wiping the restore.
  // This component mounts with the transport, long before a clip is read out of
  // the engine — reze-studio mounts its timeline only once boot has resolved, so
  // the version it baselines against is already the real one, and the guard that
  // works there does not work here. So `initialView` was applied at mount and
  // then thrown away a moment later, when null→clip counted as a change: after
  // any refresh the editor opened at scroll 0 and zoom 4 having just been told
  // where it was. `sawClip` is the missing half — the baseline is the first REAL
  // version, not whatever was there before one existed.
  const clipVersionRef = useRef(clipVersion)
  const sawClip = useRef(false)
  useEffect(() => {
    if (clipVersionRef.current === clipVersion) return
    clipVersionRef.current = clipVersion
    if (!sawClip.current) {
      sawClip.current = true
      return
    }
    setScrollX(0)
    setPxPerFrame(4)
    setYZoom(1)
    setEndDraft(null)
  }, [clipVersion])

  // Report view changes upward for persistence — skips the initial mount
  // render so restoring a draft's view doesn't immediately re-save it back.
  const viewMountedRef = useRef(false)
  useEffect(() => {
    if (!viewMountedRef.current) {
      viewMountedRef.current = true
      return
    }
    onViewChange?.({ pxPerFrame, yZoom, scrollX })
  }, [pxPerFrame, yZoom, scrollX, onViewChange])

  // `trackWidth` is 0 until the ResizeObserver below reports the real
  // measurement, right after mount — the SAME mount whose scrollX just came
  // from a restored draft (or a fresh default). That first measurement isn't
  // a real resize, just the DOM catching up, but both effects below react to
  // any `trackWidth` change; without this guard they'd "helpfully" clamp or
  // recenter a scrollX that was already exactly right, on every single
  // mount. Read-only in both effects, written by the bookkeeping effect
  // declared after them so it reflects what THIS render saw, not what just
  // changed — see the three effects for how that ordering is load-bearing.
  const trackWidthKnownRef = useRef(false)

  // Clamp scroll when viewport or clip size changes (NOT on pxPerFrame — zoom handles its own scroll)
  useEffect(() => {
    if (trackWidth <= 0 || !trackWidthKnownRef.current) return
    const maxScroll = Math.max(0, LABEL_W + fc * pxRef.current - trackWidth)
    setScrollX((s) => Math.min(maxScroll, Math.max(0, s)))
  }, [trackWidth, fc])

  // ── Auto-scroll: page-turn when playhead leaves the visible window ──
  // During playback the rAF loop drives the playhead imperatively and does NOT
  // update `currentFrame` state — so page-turn is handled in the wrapped
  // `playheadDrawRef` below. This effect only covers scrub / paused navigation.
  useEffect(() => {
    if (trackWidth <= 0 || !trackWidthKnownRef.current) return
    const viewable = trackWidth - LABEL_W
    if (viewable <= 0) return
    const px = pxRef.current
    const playheadX = currentFrame * px
    const maxScroll = Math.max(0, LABEL_W + fc * px - trackWidth)
    const visLeft = scrollXRef.current
    const visRight = scrollXRef.current + viewable

    if (playheadX >= visLeft && playheadX <= visRight) return

    const target = Math.max(0, Math.min(maxScroll, playheadX - viewable * 0.1))
    setScrollX(target)
  }, [currentFrame, trackWidth, fc])

  // Marks trackWidth "known" for the two effects above, on their NEXT run —
  // declared after both so it updates only once this render's checks have
  // already happened, not before. From here on every real trackWidth change
  // (an actual window resize) is treated normally.
  useEffect(() => {
    if (trackWidth > 0) trackWidthKnownRef.current = true
  }, [trackWidth])

  // Wrap the parent's imperative draw handle so each 60Hz tick can page-turn
  // the timeline if the playhead leaves the visible window. `setScrollX` fires
  // only on the page-turn frame (a few times per clip), not per-frame.
  const innerDrawRef = useRef<((frame: number) => void) | null>(null)
  // Both of these READ the playhead and both were bound to `currentFrame`,
  // which the store deliberately does not update during playback — the rAF
  // writes its ref without notifying anyone, which is the whole reason playback
  // costs no reconciliation. So the number and the thumb simply froze at
  // whatever frame play started from.
  //
  // They are moved from the same per-frame call that moves the playhead, by
  // touching the DOM directly. React re-syncs both on the next real render,
  // which after a pause is the flushed frame — so the imperative value and the
  // rendered one never disagree once anything stops moving.
  const frameFieldRef = useRef<HTMLInputElement>(null)
  const thumbElRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef(fc)
  fcRef.current = fc
  const trackWidthRef = useRef(trackWidth)
  trackWidthRef.current = trackWidth
  // Whether the scene is actually MOVING, which is not the same as whether this
  // callback is being invoked — see the guard below.
  const playingRef = useRef(playing)
  playingRef.current = playing
  useEffect(() => {
    if (!playheadDrawRef) return
    playheadDrawRef.current = (frame: number) => {
      // The live frame, published for everyone who is NOT this canvas.
      //
      // The store documents `frameRef` as "written by AnimPlayer's rAF without
      // notifying anyone", and nothing was writing it: the transport's clock
      // reached this callback and stopped, so the ref held whatever the last
      // deliberate scrub had put there. Everything that reads the playhead
      // without subscribing was therefore reading a stale number during
      // playback — including the pause path, which flushes `frameRef` into the
      // store and so snapped the playhead back to wherever play STARTED, and
      // the inspector, which samples the pose it is showing from it.
      //
      // A ref write notifies nobody, so this stays as free as the rest of the
      // draw path.
      frameRef.current = frame
      // Follow the playhead only while it is going somewhere.
      //
      // In reze-studio this callback exists only during playback, so following
      // unconditionally was the same thing. Design's transport rAF runs the
      // whole time the editor is mounted — it drives the scrub bar and the
      // camera-follow toggle too — so this fires sixty times a second with a
      // STATIONARY playhead. Scroll forward to a later part of the clip and the
      // very next frame decided the playhead had left the window and pulled the
      // view back to it. From the outside that is "the timeline will not scroll
      // to later time": it scrolls, and is dragged home before it can paint.
      const tw = trackWidthRef.current
      const viewable = tw - LABEL_W
      if (playingRef.current && viewable > 0) {
        const px = pxRef.current
        const playheadX = frame * px
        const visLeft = scrollXRef.current
        const visRight = visLeft + viewable
        if (playheadX < visLeft || playheadX > visRight) {
          const maxScroll = Math.max(0, LABEL_W + fcRef.current * px - tw)
          const target = Math.max(0, Math.min(maxScroll, playheadX - viewable * 0.1))
          setScrollX(target)
        }
      }
      const field = frameFieldRef.current
      // Never while it is focused — that is someone typing a frame to jump to,
      // and overwriting it under the caret would make the field unusable.
      if (field && document.activeElement !== field) field.value = padFrame4(frame)
      const thumb = thumbElRef.current
      if (thumb) {
        const total = fcRef.current
        thumb.style.left = `${total > 0 ? Math.max(0, Math.min(100, (frame / total) * 100)) : 0}%`
      }
      innerDrawRef.current?.(frame)
    }
    return () => {
      if (playheadDrawRef.current) playheadDrawRef.current = null
    }
  }, [playheadDrawRef, frameRef])

  // Zoom anchored on the playhead: adjust scrollX so the playhead stays at the
  // same screen-relative position before and after the pxPerFrame change.
  const zoomTo = useCallback(
    (newPx: number) => {
      const clamped = Math.max(minPxPerFrame, Math.min(MAX_PX, newPx))
      const oldPx = pxRef.current
      if (clamped === oldPx) return
      const viewable = trackWidth - LABEL_W
      if (viewable > 0) {
        const playheadScreen = currentFrame * oldPx - scrollXRef.current
        const newScroll = currentFrame * clamped - playheadScreen
        const maxScroll = Math.max(0, LABEL_W + fc * clamped - trackWidth)
        setScrollX(Math.max(0, Math.min(maxScroll, newScroll)))
      }
      setPxPerFrame(clamped)
    },
    [minPxPerFrame, trackWidth, currentFrame, fc],
  )

  // Native non-passive wheel listener — React's synthetic onWheel is passive,
  // so `preventDefault()` there is ignored and the page scrolls instead of the
  // timeline handling the gesture. Attach directly to the DOM node.
  //  - ctrl/⌘ + wheel → time zoom
  //  - shift + wheel  → value zoom
  //  - plain wheel    → horizontal scroll
  useEffect(() => {
    const el = timelineAreaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomTo(pxRef.current - e.deltaY * 0.02)
      } else if (e.shiftKey) {
        // macOS remaps shift+wheel vertical delta onto deltaX — take whichever is non-zero.
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
        const factor = Math.exp(-delta * 0.002)
        setYZoom((z) => Math.max(Y_ZOOM_MIN, Math.min(Y_ZOOM_MAX, z * factor)))
      } else {
        // Clamped at BOTH ends. It used to stop at 0 and run on forever to the
        // right, so a few flicks past the end of the clip left the canvas
        // showing empty space with no indication which way home was — which
        // reads as the timeline being broken rather than as being scrolled past
        // its content. The ceiling is the same one the resize clamp uses: the
        // clip's full width, less what is already on screen.
        const el2 = timelineAreaRef.current
        const w = el2 ? el2.clientWidth : 0
        const maxScroll = Math.max(0, LABEL_W + fcRef.current * pxRef.current - w)
        setScrollX((p) => Math.max(0, Math.min(maxScroll, p + e.deltaX + e.deltaY)))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomTo])

  const onSelectKeyframe = useCallback(
    (kf: SelectedKeyframe, multi: boolean) => {
      setSelectedKeyframes((prev) => {
        if (multi) {
          const exists = prev.some(
            (s) => s.frame === kf.frame && s.type === kf.type && s.channel === kf.channel && s.bone === kf.bone,
          )
          return exists ? prev.filter((s) => !(s.frame === kf.frame && s.type === kf.type)) : [...prev, kf]
        }
        return [kf]
      })
    },
    [setSelectedKeyframes],
  )

  // ─── Imperative drag path ───────────────────────────────────────────
  //     Drag move callbacks mutate keyframes in place and trigger a canvas
  //     repaint via `dragRedrawRef` — no React state updates, no clip
  //     commits, no engine clip reuploads. The single commit happens in
  //     `onEndKeyframeDrag` on mouseup, which cascades once:
  //       studio store → EngineBridge `loadClip` + seek → Timeline repaint.
  //     `selectedKeyframes` entries are mutated in place so the highlighted
  //     diamonds track the drag; on end, we clone the array to notify the
  //     store for downstream subscribers (inspector, etc.).
  const dragRedrawRef = useRef<(() => void) | null>(null)
  const dragTouchedRef = useRef(false)
  const engine = useClipEngine()

  /**
   * Stand on the keyframe while it is being dragged.
   *
   * Two halves, and both are needed for the viewport to show the edit as it
   * happens. The clip being mutated is the editor's CLONE, so the engine is
   * still playing the pre-drag motion — pushing it through the door is what
   * makes the pose change at all. Moving the playhead is what makes it change
   * where you are looking, since a keyframe only means anything at its own
   * frame.
   *
   * Per tick, which the drag path otherwise avoids — but the door seeks one
   * model rather than scrubbing the cast, and the ruler's own scrub has always
   * written the playhead on every tick, so this is the cost that path already
   * pays. Physics settles once, on release, which is what Scrub.end is for.
   */
  const followDrag = useCallback(
    (frame: number, kind: "clip" | "camera") => {
      if (kind === "camera") engine.current?.previewCamera(cameraTrack)
      else if (clip) engine.current?.preview(clip, frame)
      setCurrentFrame(frame)
    },
    [engine, clip, cameraTrack, setCurrentFrame],
  )

  const onMoveDopeKeyframe = useCallback(
    (
      boneRefs: Array<{ bone: string; kf: BoneKeyframe }>,
      morphRefs: Array<{ morph: string; kf: MorphKeyframe }>,
      cameraRefs: CameraKeyframe[],
      toFrame: number,
    ) => {
      if (!clip) return
      const clamped = Math.max(0, toFrame)
      const fromFrame = boneRefs[0]?.kf.frame ?? morphRefs[0]?.kf.frame ?? cameraRefs[0]?.frame
      if (fromFrame === undefined || clamped === fromFrame) return
      for (const { bone, kf } of boneRefs) {
        kf.frame = clamped
        clip.boneTracks.get(bone)?.sort((a, b) => a.frame - b.frame)
      }
      for (const { morph, kf } of morphRefs) {
        kf.frame = clamped
        clip.morphTracks.get(morph)?.sort((a, b) => a.frame - b.frame)
      }
      for (const kf of cameraRefs) kf.frame = clamped
      for (const s of selectedKeyframes) {
        if (s.type === "dope" && s.frame === fromFrame) (s as { frame: number }).frame = clamped
      }
      dragTouchedRef.current = true
      dragRedrawRef.current?.()
      followDrag(clamped, cameraRefs.length > 0 ? "camera" : "clip")
    },
    [clip, selectedKeyframes, followDrag],
  )

  const onMoveCurveKeyframe = useCallback(
    (bone: string, kfRef: BoneKeyframe, chKey: string, toFrame: number, dv: number) => {
      if (!clip) return
      const track = clip.boneTracks.get(bone)
      if (!track || !track.includes(kfRef)) return
      const clamped = Math.max(0, toFrame)
      const fromFrame = kfRef.frame
      if (clamped !== fromFrame) {
        kfRef.frame = clamped
        track.sort((a: BoneKeyframe, b: BoneKeyframe) => a.frame - b.frame)
      }
      if (dv) {
        const ch = ALL_CHANNELS.find((c) => c.key === chKey)
        if (ch) ch.set(kfRef, ch.get(kfRef) + dv)
      }
      for (const s of selectedKeyframes) {
        if (s.bone === bone && s.channel === chKey && s.frame === fromFrame) {
          ;(s as { frame: number }).frame = clamped
        }
      }
      dragTouchedRef.current = true
      dragRedrawRef.current?.()
      followDrag(clamped, "clip")
    },
    [clip, selectedKeyframes, followDrag],
  )

  const onMoveMorphKeyframe = useCallback(
    (morph: string, kfRef: MorphKeyframe, toFrame: number, dw: number) => {
      if (!clip) return
      const track = clip.morphTracks.get(morph)
      if (!track) return
      // Identity first, then the frame it describes. A ref captured before an
      // undo points at a keyframe that is still on screen but is no longer the
      // object in the track — cloneAnimationClip rebuilds every one of them —
      // and an identity-only test made that keyframe silently undraggable with
      // nothing on screen to say why.
      const kf = track.includes(kfRef) ? kfRef : track.find((k) => k.frame === kfRef.frame)
      if (!kf) return
      const clamped = Math.max(0, toFrame)
      const fromFrame = kf.frame
      if (clamped !== fromFrame) {
        kf.frame = clamped
        track.sort((a, b) => a.frame - b.frame)
      }
      if (dw) kf.weight = Math.max(0, Math.min(1, kf.weight + dw))
      for (const s of selectedKeyframes) {
        if (s.morph === morph && s.frame === fromFrame) (s as { frame: number }).frame = clamped
      }
      dragTouchedRef.current = true
      dragRedrawRef.current?.()
      followDrag(clamped, "clip")
    },
    [clip, selectedKeyframes, followDrag],
  )

  /** Live camera edit: mutate the keyframe in place (the engine is handed the
   *  same array, so the viewport follows the drag) and repaint. The undoable
   *  commit lands once, on mouse-up, like every other drag here. */
  const onMoveCameraKeyframe = useCallback(
    (kfRef: CameraKeyframe, channelKey: string, toFrame: number, dv: number) => {
      const ch = CAMERA_CHANNELS.find((c) => c.key === channelKey)
      if (!ch) return
      // Identity first, then the frame it describes — a ref captured before an
      // undo points at a keyframe that is on screen but no longer in the track.
      const kf = cameraTrack.includes(kfRef) ? kfRef : cameraTrack.find((k) => k.frame === kfRef.frame)
      if (!kf) return
      const clamped = Math.max(0, toFrame)
      const fromFrame = kf.frame
      if (clamped !== fromFrame) kf.frame = clamped
      if (dv) ch.set(kf, ch.get(kf) + dv)
      for (const sk of selectedKeyframes) {
        if (sk.channel === channelKey && sk.frame === fromFrame) (sk as { frame: number }).frame = clamped
      }
      dragTouchedRef.current = true
      dragRedrawRef.current?.()
      followDrag(clamped, "camera")
    },
    [cameraTrack, selectedKeyframes, followDrag],
  )

  const clearSelection = useCallback(() => {
    // Guarded, so a click on empty space does not notify every keyframe
    // consumer when there was nothing selected to begin with — which is most
    // clicks in a timeline.
    setSelectedKeyframes((prev) => (prev.length === 0 ? prev : []))
  }, [setSelectedKeyframes])

  const onEndKeyframeDrag = useCallback(() => {
    if (!dragTouchedRef.current) return
    dragTouchedRef.current = false
    // Single commit for the whole drag — this is what lands in undo/redo and
    // triggers the engine reupload via EngineBridge.
    if (isCameraTab(tab)) {
      // Sorting happens inside commitCamera — a drag can carry a keyframe past
      // its neighbour, and the sampler binary-searches.
      commitCamera((t) => [...t])
    } else {
      commit((c) =>
        c ? { ...c, boneTracks: new Map(c.boneTracks), morphTracks: new Map(c.morphTracks) } : null,
      )
    }
    // Notify selection subscribers with a new array reference (entries were
    // already mutated in place during the drag).
    setSelectedKeyframes((prev) => [...prev])
  }, [commit, commitCamera, tab, setSelectedKeyframes])

  return (
    <div className="flex h-full w-full select-none flex-col" style={{ fontFamily: FONT }}>
      {/* Toolbar — compact controls + channel tabs; axis hues stay exact via inline `t.color` when set */}
      <div className="flex h-[26px] shrink-0 flex-nowrap items-center gap-0 overflow-hidden border-b border-line px-1.5">
        {/* Fixed square + Lucide icons — avoids uneven unicode box and mixed h-5 / h-[22px] misalignment */}
        {(
          [
            {
              key: "first",
              el: <ChevronsLeft className="size-3.5" strokeWidth={1.75} />,
              onClick: () => setCurrentFrame(0),
            },
            {
              key: "prev",
              el: <ChevronLeft className="size-3.5" strokeWidth={1.75} />,
              onClick: () => setCurrentFrame((p) => Math.max(0, Math.round(typeof p === "number" ? p : 0) - 1)),
            },
          ] as const
        ).map(({ key, el, onClick }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center overflow-hidden p-0 text-muted-foreground",
              "hover:bg-transparent dark:hover:bg-transparent",
              "active:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-0",
            )}
            onClick={onClick}
          >
            {el}
          </Button>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center overflow-hidden p-0",
            "focus-visible:outline-none focus-visible:ring-0",
            "bg-transparent"
          )}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" strokeWidth={1.5} />
          ) : (
            <Play className="size-3.5 fill-current" strokeWidth={1.5} />
          )}
        </Button>
        {(
          [
            {
              key: "next",
              el: <ChevronRight className="size-3.5" strokeWidth={1.75} />,
              onClick: () => setCurrentFrame((p) => Math.min(fc, Math.round(typeof p === "number" ? p : 0) + 1)),
            },
            {
              key: "last",
              el: <ChevronsRight className="size-3.5" strokeWidth={1.75} />,
              onClick: () => setCurrentFrame(fc),
            },
          ] as const
        ).map(({ key, el, onClick }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center overflow-hidden p-0 text-muted-foreground",
              "hover:bg-transparent dark:hover:bg-transparent",
              "active:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-0",
            )}
            onClick={onClick}
          >
            {el}
          </Button>
        ))}
        <TransportFrameSlider
          frameCount={fc}
          value={currentFrame}
          thumbRef={thumbElRef}
          onChange={(f) => {
            setPlaying(false)
            setCurrentFrame(f)
          }}
        />
        <div className="mx-0.5 flex min-w-0 items-center gap-0.5 whitespace-nowrap rounded-chip border border-line bg-white/[0.06] px-1 py-px font-mono text-[9px] tabular-nums text-muted-foreground">
          <span>F</span>
          <input
            type="text"
            inputMode="numeric"
            ref={frameFieldRef}
            aria-label={dict.lab.timeline.currentFrame}
            disabled={!clip}
            value={frameDraft ?? padFrame4(currentFrame)}
            onFocus={() => setFrameDraft(padFrame4(currentFrame))}
            onChange={(e) => setFrameDraft(e.target.value)}
            onBlur={() => {
              const raw = frameDraft ?? ""
              setFrameDraft(null)
              const v = parseInt(raw.replace(/\s/g, ""), 10)
              if (!Number.isFinite(v) || !clip) return
              setPlaying(false)
              setCurrentFrame(Math.max(0, Math.min(fc, v)))
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            }}
            className={cn(
              "h-4 w-8 min-w-0 rounded border border-transparent bg-transparent px-0.5 text-right text-[9px] tabular-nums outline-none",
              "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
              !clip && "pointer-events-none opacity-40",
            )}
          />
          <span className="opacity-40">/</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={dict.lab.timeline.endFrame}
            disabled={!clip}
            value={endDraft ?? padFrame4(fc)}
            onFocus={() => setEndDraft(padFrame4(fc))}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={() => {
              const raw = endDraft ?? ""
              setEndDraft(null)
              const v = parseInt(raw.replace(/\s/g, ""), 10)
              if (!Number.isFinite(v) || !clip) return
              commit({ ...clip, frameCount: v })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            }}
            className={cn(
              "h-4 w-8 min-w-0 rounded border border-transparent bg-transparent px-0.5 text-right text-[9px] tabular-nums outline-none",
              "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
              !clip && "pointer-events-none opacity-40",
            )}
          />
        </div>
        <div className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />
        {/* Channel tabs */}
        {visibleTabs.map((t) => {
          if (t.sep)
            return <div key={t.key} className="mx-px h-3.5 w-px shrink-0 bg-line" />
          const active = tab === t.key
          return (
            <Button
              type="button"
              key={t.key}
              variant="ghost"
              size="sm"
              onClick={() => setTab(t.key)}
              className={cn(
                "h-5 max-h-5 min-h-5 shrink-0 overflow-hidden rounded-md px-1.5 font-mono text-[10px]",
                "focus-visible:outline-none focus-visible:ring-0",
                // The Button base ships `transition-all`, which fades the fill
                // in over ~150ms. That was invisible while the active chip was
                // barely a shade off the toolbar; against a solid fill it reads
                // as the highlight lagging the click. A tab is a statement of
                // where you are, not an animation — it should land at once.
                "transition-none",
                // The ghost variant ships `hover:text-accent-foreground` and
                // `dark:hover:bg-accent/50`, both of which out-specify a plain
                // `text-*`/`bg-*` here — so the tab you just clicked kept
                // showing HOVER styling (dark fill, light text) for as long as
                // the pointer stayed on it, which looked like the highlight
                // never arrived. An active tab has nothing to advertise on
                // hover: it is already where you are. So its hover state is
                // pinned to its active state, dark: variant included.
                active
                  ? t.color
                    ? "text-[#0f0f12] hover:text-[#0f0f12] hover:opacity-90 dark:hover:bg-transparent"
                    // The aggregate tabs (Rotation / Translation / Target) and
                    // Weight carry no hue of their own, so they cannot use the
                    // solid-fill treatment the axis tabs get from `t.color`.
                    // bg-secondary is barely a shade off the toolbar and read
                    // as inactive; a solid light chip gives them the same
                    // weight as a coloured one without claiming a hue that
                    // belongs to a channel.
                    : "bg-foreground/90 text-background hover:bg-foreground hover:text-background dark:hover:bg-foreground"
                  : "opacity-65 hover:opacity-100 hover:bg-transparent dark:hover:bg-transparent active:bg-muted/50",
                !active && !t.color && "text-muted-foreground",
              )}
              style={
                active && t.color
                  ? { backgroundColor: t.color }
                  : !active && t.color
                    ? { color: t.color }
                    : undefined
              }
            >
              {dict.lab.timeline.labels[t.label] ?? t.label}
            </Button>
          )
        })}
        <div className="min-w-0 flex-1" />
        <span className="shrink-0 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {dict.lab.timeline.axisTime}
        </span>
        <ZoomRuler min={minPxPerFrame} max={MAX_PX} value={pxPerFrame} onChange={zoomTo} />
        <span className="shrink-0 px-1 pl-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {dict.lab.timeline.axisValue}
        </span>
        <ZoomRuler min={Y_ZOOM_MIN} max={Y_ZOOM_MAX} value={yZoom} onChange={setYZoom} />
        {trailing && <div className="ml-1.5 flex shrink-0 items-center gap-0.5 pl-1.5">{trailing}</div>}
      </div>
      {/* THE SEQUENCE LEVEL, over the channel level. A row is an effect and a
          bar on it is one FIRING; the canvas below is what a clip is made of,
          frame by frame. Both read left to right on the same axis, which is the
          whole reason this sits here rather than beside the transport. */}
      {effects && effects.length > 0 && onSelectStrip && onLane && (
        <EffectStrips
          effects={effects}
          pxPerFrame={pxPerFrame}
          scrollX={scrollX}
          labelWidth={LABEL_W}
          frameCount={fc}
          playhead={currentFrame}
          selectedEffect={selectedEffect}
          selectedStrip={selectedStrip}
          onSelectStrip={onSelectStrip}
          onLane={onLane}
        />
      )}
      {/* Canvas */}
      <div ref={timelineAreaRef} style={{ flex: 1, minHeight: 0 }}>
        {clip ? (
          <TimelineCanvas
            clip={clip}
            pxPerFrame={pxPerFrame}
            yZoom={yZoom}
            scrollX={scrollX}
            currentFrame={currentFrame}
            selectedBone={selectedBone}
            selectedMorph={selectedMorph}
            cameraTrack={cameraTrack}
            frameCount={fc}
            audioPeaks={audioPeaks}
            audioDuration={audioDuration}
            visibleBones={visibleBones}
            selectedKeyframes={selectedKeyframes}
            tab={tab}
            onSetCurrentFrame={(f) => {
              setPlaying(false)
              setCurrentFrame(f)
            }}
            onSelectKeyframe={onSelectKeyframe}
            onClearSelection={clearSelection}
            onMoveDopeKeyframe={onMoveDopeKeyframe}
            onMoveCurveKeyframe={onMoveCurveKeyframe}
            onMoveMorphKeyframe={onMoveMorphKeyframe}
            onMoveCameraKeyframe={onMoveCameraKeyframe}
            onEndKeyframeDrag={onEndKeyframeDrag}
            playheadDrawRef={innerDrawRef}
            dragRedrawRef={dragRedrawRef}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.label,
              fontSize: 11,
              background: C.curveBg,
            }}
          >
            Load VMD for timeline…
          </div>
        )}
      </div>
    </div>
  )
}
