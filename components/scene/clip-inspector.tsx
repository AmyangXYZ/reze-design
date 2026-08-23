"use client"

// The values under the playhead, and what you can do to them.
//
// reze-studio's properties panel, in this app's right column. The timeline
// answers "where are the keys and when"; this answers "what is this one worth",
// which is the half a dopesheet structurally cannot show — a diamond has a
// frame and no value.
//
// It is SUMMONED, not permanent: it mounts with the timeline fold and unmounts
// with it, which is the one shape of right-hand surface this layout allows. The
// column it lands in is already reserved — the open timeline is capped at
// `100vw - 35rem` precisely so it stops clear of both docks — so nothing had to
// move to make room.
//
// Three things port carefully and are worth not re-deriving:
//
//   1. PREVIEW vs COMMIT. A drag mutates the clip in place and pushes it
//      through the engine door every tick; only the release clones a clip,
//      notifies the store and lands a step. See ClipEngine for why the preview
//      half cannot simply commit.
//   2. The live hooks below re-sample on their OWN rAF while playing and on
//      `currentFrame` while paused, and each is scoped to the smallest subtree
//      that needs it — so a playing scene reconciles three sliders, not a dock.
//   3. A curve belongs to a keyframe, so the interpolation editor edits the key
//      the playhead is ON. Parked between two keys it goes inert rather than
//      quietly easing the earlier one.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import type { AnimationClip, BoneInterpolation, BoneKeyframe, CameraKeyframe } from "reze-engine"
import { CameraAnimation, Vec3 } from "reze-engine"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/editor/surface"
import { AxisSliderRow } from "@/components/scene/axis-slider-row"
import {
  InterpolationCurveEditor,
  PRESETS,
  type CurvePoint,
} from "@/components/scene/interpolation-curve-editor"
import {
  eulerToQuat,
  quatToEuler,
  ROT_CHANNELS,
  TRA_CHANNELS,
  CAMERA_CHANNELS,
  CAMERA_IP_TABS,
  cameraChannelsForTab,
  cameraIpChannelForTab,
  cameraIpPair,
} from "@/lib/animation"
import {
  cloneBoneInterpolation,
  interpolationTemplateForFrame,
  VMD_LINEAR_DEFAULT_IP,
} from "@/lib/clip"
import {
  useClipActions,
  useClipEngine,
  useClipSelector,
  usePlayheadFrameRef,
  usePlayheadSelector,
} from "@/context/clip-editor"
import { CLIP_UNDO_SCOPE } from "@/components/scene/clip-history"
import { useClipOps } from "@/hooks/use-clip-ops"
import { useT } from "@/lib/i18n"
import { useZOrder } from "@/hooks/use-z-order"
import { cn } from "@/lib/utils"

// ─── Tab syncing ──────────────────────────────────────────────────────────
//
// Dragging a slider points the timeline at the curve you are dragging, so the
// change is visible where it happens. An "All" view already shows that channel
// and is left alone; anything else moves to the matching axis. Keys match the
// timeline's own TABS.

const ROT_TAB_KEYS = new Set(["allRot", "rx", "ry", "rz"])
const TRA_TAB_KEYS = new Set(["allTra", "tx", "ty", "tz"])
const ROT_AXIS_KEYS = ["rx", "ry", "rz"] as const
const TRA_AXIS_KEYS = ["tx", "ty", "tz"] as const

function syncTabForAxisDrag(
  currentTab: string,
  axisIdx: 0 | 1 | 2,
  group: "rot" | "tra",
  setTab: (t: string) => void,
) {
  const tabs = group === "rot" ? ROT_TAB_KEYS : TRA_TAB_KEYS
  const all = group === "rot" ? "allRot" : "allTra"
  if (!tabs.has(currentTab)) {
    setTab(all)
    return
  }
  if (currentTab === all) return
  const want = (group === "rot" ? ROT_AXIS_KEYS : TRA_AXIS_KEYS)[axisIdx]
  if (currentTab !== want) setTab(want)
}

/** The axis tab that shows exactly one camera channel. */
const CAMERA_AXIS_TAB: Record<string, string> = {
  crx: "camRx", cry: "camRy", crz: "camRz",
  cgx: "camTx", cgy: "camTy", cgz: "camTz",
  cds: "camDist", cfv: "camFov",
}

// ─── Keyframe helpers ─────────────────────────────────────────────────────

/**
 * A named run of rows.
 *
 * The left dock's ROW tier, not its group tier. "Rotation" contains X, Y and Z
 * exactly as "Physics" contains Gravity and Wind, so it is drawn the way
 * LayerRow draws a name: text-xs, medium, sentence case, foreground. The
 * uppercase mono heading it used to borrow belongs to CAST and SCENE, which
 * divide the dock into subjects — something this panel, being one subject
 * already, has no use for.
 *
 * pt-3 is the panel's one spacing value: above every group, and below the last
 * one, so the column's top inset and bottom inset are the same number rather
 * than two that happen to look close.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 pt-3">
      <div className="pb-1.5 text-xs font-medium text-foreground">{title}</div>
      {children}
    </div>
  )
}

/** Chip metrics, lifted from the left dock's PresetChips: the smallest control
 *  the app has, and the right size for a strip of eight. */
/** The interpolation tab strip: six of these have to fit a 16rem column, so it
 *  runs a step below the left dock's chip — but only one step. At 9px these
 *  were smaller than anything else in the panel, which made the one control
 *  that says WHICH curve you are editing the hardest thing in it to read. */
const TAB = "h-auto min-h-0 rounded-chip border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
/** A preset badge. Same family, same size — it is a target you press
 *  repeatedly, and its column is 72px wide, which "Slow Out" clears at 10px
 *  with room to spare. */
const CHIP = "h-auto min-h-0 rounded-chip border px-1 py-1 text-[10px] font-medium leading-none transition-colors"
const CHIP_ON = "border-blue-400/40 bg-blue-400/15 text-blue-400 hover:bg-blue-400/15 hover:text-blue-400"
const CHIP_OFF = "border-line-strong text-muted-foreground hover:border-white/25 hover:text-foreground"

type IpTab = "rot" | "tx" | "ty" | "tz"

/**
 * Which curve the dock eases, for a timeline tab or a selected channel.
 *
 * The three rotation axes collapse to one entry because MMD eases them on a
 * single bezier — the same fact that gives the camera one rotation channel out
 * of three tabs. "All Trans" opens on X, the way an "All" camera tab opens on
 * the first channel it spans.
 */
const BONE_IP_FOR_CHANNEL: Record<string, IpTab> = {
  allRot: "rot", rx: "rot", ry: "rot", rz: "rot",
  allTra: "tx", tx: "tx", ty: "ty", tz: "tz",
}

const BONE_IP_TABS = [
  { key: "rot", label: "Rotation" },
  { key: "tx", label: "Trans X" },
  { key: "ty", label: "Trans Y" },
  { key: "tz", label: "Trans Z" },
] as const

function findKeyframeAt(clip: AnimationClip, bone: string, frame: number): BoneKeyframe | null {
  return clip.boneTracks.get(bone)?.find((k) => k.frame === frame) ?? null
}

/** The last key at or before `frame` — what the pose is currently coming from. */
function sampleBoneKeyframe(clip: AnimationClip | null, bone: string, frame: number) {
  if (!clip) return null
  const track = clip.boneTracks.get(bone)
  if (!track?.length) return null
  const f = Math.round(frame)
  let kf = track[0]
  for (const k of track) {
    if (k.frame <= f) kf = k
    else break
  }
  return kf
}

function interpolationPairFromTab(kf: BoneKeyframe, tab: IpTab): [CurvePoint, CurvePoint] | null {
  const row =
    tab === "rot"
      ? kf.interpolation.rotation
      : tab === "tx"
        ? kf.interpolation.translationX
        : tab === "ty"
          ? kf.interpolation.translationY
          : kf.interpolation.translationZ
  if (!row || row.length < 2) return null
  return [{ x: row[0].x, y: row[0].y }, { x: row[1].x, y: row[1].y }]
}

function mergeInterpolation(kf: BoneKeyframe, tab: IpTab, p1: CurvePoint, p2: CurvePoint): BoneInterpolation {
  const ip = cloneBoneInterpolation(kf.interpolation)
  const pair = [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]
  if (tab === "rot") ip.rotation = pair
  else if (tab === "tx") ip.translationX = pair
  else if (tab === "ty") ip.translationY = pair
  else ip.translationZ = pair
  return ip
}

function interpolationTemplateForChannel(tab: IpTab): [CurvePoint, CurvePoint] {
  const ip = VMD_LINEAR_DEFAULT_IP
  const row =
    tab === "rot"
      ? ip.rotation
      : tab === "tx"
        ? ip.translationX
        : tab === "ty"
          ? ip.translationY
          : ip.translationZ
  return [{ x: row[0].x, y: row[0].y }, { x: row[1].x, y: row[1].y }]
}

/** Mutate the keyframe in the shared track (the engine holds the same array)
 *  then shallow-copy the clip so React sees a change. */
function patchKeyframeAt(
  clip: AnimationClip,
  bone: string,
  keyFrame: number,
  patch: (kf: BoneKeyframe) => void,
): AnimationClip {
  const track = clip.boneTracks.get(bone)
  if (!track) return clip
  const i = track.findIndex((k) => k.frame === keyFrame)
  if (i < 0) return clip
  patch(track[i])
  return { ...clip, boneTracks: new Map(clip.boneTracks) }
}

// ─── Live sampling ────────────────────────────────────────────────────────

type LivePose = { euler: { x: number; y: number; z: number }; translation: Vec3 }

function poseNearEqual(a: LivePose, b: LivePose, eps = 1e-5) {
  return (
    Math.abs(a.euler.x - b.euler.x) < eps &&
    Math.abs(a.euler.y - b.euler.y) < eps &&
    Math.abs(a.euler.z - b.euler.z) < eps &&
    Math.abs(a.translation.x - b.translation.x) < eps &&
    Math.abs(a.translation.y - b.translation.y) < eps &&
    Math.abs(a.translation.z - b.translation.z) < eps
  )
}

/**
 * A sampler that is live during playback and exact while paused.
 *
 * Both states are needed and they are not the same read. Paused, React owns the
 * clock, so the model has to be seeked before its pose means anything. Playing,
 * the engine owns the clock and is already ahead of us — seeking there would
 * fight playback — so the rAF just reads whatever the frame ref says.
 *
 * Shared by the three hooks below so the split is stated once.
 */
function useLiveSample<T>(sample: () => T | null, equal: (a: T | null, b: T | null) => boolean): T | null {
  const playing = usePlayheadSelector((s) => s.playing)
  const currentFrame = usePlayheadSelector((s) => s.currentFrame)
  const [value, setValue] = useState<T | null>(null)

  const apply = useCallback(
    (next: T | null) => {
      setValue((prev) => (equal(prev, next) ? prev : next))
    },
    [equal],
  )

  // Paused: re-sample on scrub, selection and clip edits.
  //
  // On the next frame rather than in the effect body. Sampling READS the engine
  // and seeks it first — an external system, which is what a callback is for
  // and what an effect body is not — and deferring also coalesces a burst of
  // scrub events into a single read.
  useEffect(() => {
    const raf = requestAnimationFrame(() => apply(sample()))
    return () => cancelAnimationFrame(raf)
  }, [sample, currentFrame, apply])

  // Playing: the engine is the clock.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      apply(sample())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, sample, apply])

  return value
}

const poseEqual = (a: LivePose | null, b: LivePose | null) =>
  a === b || (!!a && !!b && poseNearEqual(a, b))

function useLivePose(selectedBone: string | null, clip: AnimationClip | null): LivePose | null {
  const playing = usePlayheadSelector((s) => s.playing)
  const frameRef = usePlayheadFrameRef()
  const engine = useClipEngine()
  const sample = useCallback((): LivePose | null => {
    if (!selectedBone || !clip) return null
    const cf = frameRef.current
    const p = engine.current?.samplePose(selectedBone, playing ? null : cf)
    if (!p) return null
    // Paused on a keyed frame, the STORED value is the truth. The runtime
    // skeleton hands back the post-IK pose, so a bone under an IK chain would
    // otherwise read differently from the number in its own keyframe. During
    // playback the snap is skipped: a fractional frame rarely lands on a key,
    // and the engine's pose is the interpolated truth there.
    if (!playing) {
      const kfAt = clip.boneTracks.get(selectedBone)?.find((k) => k.frame === Math.round(Math.max(0, cf)))
      if (kfAt) return { euler: quatToEuler(kfAt.rotation), translation: kfAt.translation }
    }
    return { euler: quatToEuler(p.rotation), translation: p.translation }
  }, [selectedBone, clip, playing, frameRef, engine])
  return useLiveSample(sample, poseEqual)
}

const identical = <T,>(a: T, b: T) => a === b

/** The key under the playhead. Gated on keyframe IDENTITY, so it reconciles
 *  when the playhead crosses a boundary rather than every rAF tick. */
function useLiveActiveKeyframe(clip: AnimationClip | null, bone: string | null): BoneKeyframe | null {
  const frameRef = usePlayheadFrameRef()
  const sample = useCallback(
    () => (clip && bone ? sampleBoneKeyframe(clip, bone, frameRef.current) : null),
    [clip, bone, frameRef],
  )
  return useLiveSample(sample, identical)
}

function useLiveMorphWeight(selectedMorph: string | null, clip: AnimationClip | null): number | null {
  const playing = usePlayheadSelector((s) => s.playing)
  const frameRef = usePlayheadFrameRef()
  const engine = useClipEngine()
  // `clip` is a dependency for a reason that is easy to miss: without it a
  // commit never re-samples, so this handed back the PRE-EDIT weight and the
  // thumb snapped back to the old number the moment a drag ended.
  const sample = useCallback((): number | null => {
    if (!selectedMorph) return null
    if (!playing) {
      const f = Math.round(Math.max(0, frameRef.current))
      const kfAt = clip?.morphTracks.get(selectedMorph)?.find((k) => k.frame === f)
      if (kfAt) return kfAt.weight
    }
    return engine.current?.morphWeight(selectedMorph) ?? null
  }, [selectedMorph, clip, playing, frameRef, engine])
  return useLiveSample(sample, identical)
}

// ─── Shared chrome ────────────────────────────────────────────────────────

/** Subscribes to the playhead so nothing above it has to. Reads the ref on its
 *  own rAF while playing — the store deliberately does not tick during
 *  playback, and a frame counter that freezes while the scene moves is worse
 *  than no counter. */
function PlayheadFrameLabel({ frameCount }: { frameCount: number | null }) {
  const stored = usePlayheadSelector((s) => s.currentFrame)
  const playing = usePlayheadSelector((s) => s.playing)
  const frameRef = usePlayheadFrameRef()
  const [ticked, setTicked] = useState(stored)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setTicked(frameRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, frameRef])
  // Paused, the store IS the playhead — no state to keep in step with it.
  const live = playing ? ticked : stored
  return (
    // Spaces around the slash are what made this read as three things — a
    // letter, a number, another number — when it is one reading. Tightened to a
    // single unit, with the F kept a hair off the digits so it still reads as a
    // label rather than as a leading glyph of the number.
    <span className="shrink-0 font-mono text-[10px] tracking-tight tabular-nums text-muted-foreground">
      F&thinsp;{Math.round(live)}
      {frameCount != null ? `/${frameCount}` : ""}
    </span>
  )
}

/** The subject line: what these values belong to, and where in it you are. */
function SubjectHeader({
  title,
  frameCount,
  onClose,
}: {
  title: string
  frameCount: number | null
  onClose: () => void
}) {
  const t = useT()
  // ONE header row, not two. A panel title above a subject line spent two rows
  // of a short dock saying "Properties" over the name of the thing whose
  // properties these are — and what the panel is is already obvious from its
  // arriving with the timeline.
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-2">
      {/* select-all, not merely select-text. The name here is a rig string —
          左手首, 上半身2 — and what you want it for is pasting it into an
          effect's @anchor line or a search. Dragging over three CJK characters
          in a 12px row to catch all of them and none of the whitespace is the
          fiddliest possible way to copy one word, and truncation means the tail
          may not even be on screen to drag to. One click takes the whole name,
          hidden overflow included. `title` is the other half: the full string
          on hover, since this row is the one place it is stated. */}
      <div className="min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-foreground select-all" title={title}>
        {title}
      </div>
      <PlayheadFrameLabel frameCount={frameCount} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t.lab.timeline.close}
        onClick={onClose}
        className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X />
      </Button>
    </div>
  )
}

/**
 * The interpolation editor, shared by bones and the camera.
 *
 * Extracted so "the same panel" is true by construction rather than by two
 * copies staying in step. What differs between callers is only WHICH curves
 * exist — a bone has four, a camera six — and what one means; the controls are
 * identical.
 */
function InterpolationPanel({
  tabs,
  activeTab,
  onTabChange,
  p1,
  p2,
  disabled,
  onChange,
}: {
  tabs: readonly { key: string; label: string }[]
  activeTab: string
  onTabChange: (key: string) => void
  p1: CurvePoint
  p2: CurvePoint
  disabled: boolean
  onChange: (p1: CurvePoint, p2: CurvePoint) => void
}) {
  const t = useT()
  return (
    <Group title={t.lab.timeline.interpolation}>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <Button
            key={t.key}
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onTabChange(t.key)}
            className={cn(TAB, activeTab === t.key ? CHIP_ON : CHIP_OFF)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {/* Presets beside the curve, as studio has them: the chart is a square
          and the column next to it is otherwise dead space. `flex-1` on each
          badge divides the chart's height between the eight of them, which is
          where their padding comes from — at 9px type that leaves each one
          comfortably taller than its own text. */}
      <div className="flex items-stretch gap-1.5" style={{ height: 148 }}>
        <InterpolationCurveEditor p1={p1} p2={p2} disabled={disabled} onChange={onChange} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {PRESETS.map((pr) => {
            const active = pr.p1.x === p1.x && pr.p1.y === p1.y && pr.p2.x === p2.x && pr.p2.y === p2.y
            return (
              <Button
                key={pr.label}
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => onChange(pr.p1, pr.p2)}
                className={cn(CHIP, "flex-1 truncate", active ? CHIP_ON : CHIP_OFF)}
              >
                {t.lab.timeline.presets[pr.label] ?? pr.label}
              </Button>
            )
          })}
        </div>
      </div>
    </Group>
  )
}

/** Insert / Delete over Simplify / Clear. Always rendered, going inert rather
 *  than vanishing: a block that changes shape as the selection moves is one you
 *  have to find again every time. */
function OperationsSection({
  onInsert,
  onDelete,
  onSimplify,
  onClear,
  canInsert,
  canDelete,
  canSimplify,
  canClear,
  simplifyTitle,
}: {
  onInsert: () => void
  onDelete: () => void
  onSimplify?: () => void
  onClear: () => void
  canInsert: boolean
  canDelete: boolean
  canSimplify: boolean
  canClear: boolean
  simplifyTitle?: string
}) {
  const t = useT()
  // Chip height. Four buttons at button height read as the loudest thing in a
  // panel whose subject is the numbers above them.
  const row = "h-5 flex-1 rounded-chip px-1 text-[11px]"
  return (
    <Group title={t.lab.timeline.operations}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-[10px] tracking-wider text-muted-foreground uppercase">
            {t.lab.timeline.key}
          </span>
          <Button type="button" variant="secondary" size="xs" className={row} disabled={!canInsert} onClick={onInsert}>
            {t.lab.timeline.insert}
          </Button>
          <Button type="button" variant="secondary" size="xs" className={row} disabled={!canDelete} onClick={onDelete}>
            {t.lab.timeline.delete}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-[10px] tracking-wider text-muted-foreground uppercase">
            {t.lab.timeline.track}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className={row}
            disabled={!canSimplify}
            onClick={onSimplify}
            title={simplifyTitle ?? t.lab.timeline.simplifyHint}
          >
            {t.lab.timeline.simplify}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className={row}
            disabled={!canClear}
            onClick={onClear}
            title={t.lab.timeline.clearHint}
          >
            {t.lab.timeline.clear}
          </Button>
        </div>
      </div>
    </Group>
  )
}

// ─── Bone ─────────────────────────────────────────────────────────────────

const ROT_RANGE = { min: -180, max: 180 }
/**
 * How far a translation slider reaches, and how it grows.
 *
 * ±10 was too small for the thing translation is mostly used for: a character
 * is about twenty units tall in MMD's scale, so any real jump or lift on センター
 * ran off the end of its own slider and could only be typed in.
 *
 * A fixed ceiling only moves the problem, though — whatever it is, some motion
 * exceeds it. So the base is 25 and it DOUBLES to cover whatever the pose
 * actually holds. Doubling rather than fitting exactly, because a range that
 * tracked the value continuously would move the thumb under a stationary
 * pointer; this way it steps at 25, 50, 100, and between steps the scale is
 * fixed.
 */
const TRA_BASE = 25

function traRangeFor(value: number): number {
  let range = TRA_BASE
  const a = Math.abs(value)
  while (a > range) range *= 2
  return range
}

/** Isolated from the panel so its rAF, which ticks while the scene plays, only
 *  reconciles the six sliders — not the interpolation editor or the buttons. */
function LiveBoneSliders({
  selectedBone,
  clip,
  applyRotationAxis,
  applyTranslationAxis,
}: {
  selectedBone: string
  clip: AnimationClip | null
  applyRotationAxis: (axisIdx: 0 | 1 | 2, v: number, mode: "preview" | "commit") => void
  applyTranslationAxis: (axisIdx: 0 | 1 | 2, v: number, mode: "preview" | "commit") => void
}) {
  const t = useT()
  const tab = useClipSelector((s) => s.tab)
  const { setTab } = useClipActions()
  const livePose = useLivePose(selectedBone, clip)
  const rot = livePose ? [livePose.euler.x, livePose.euler.y, livePose.euler.z] : null
  const tra = livePose ? [livePose.translation.x, livePose.translation.y, livePose.translation.z] : null

  // ONE range for the three axes, so they stay comparable — three sliders at
  // three scales look alike and mean different things, which is worse than a
  // coarse scale.
  //
  // It only ever grows while a bone is selected. Shrinking it the moment the
  // pose came back under a step would make the thumb jump on the way back
  // through the same value it just jumped on. A different bone starts over.
  const [traMax, setTraMax] = useState(TRA_BASE)
  const [rangeBone, setRangeBone] = useState(selectedBone)
  if (rangeBone !== selectedBone) {
    setRangeBone(selectedBone)
    setTraMax(TRA_BASE)
  }
  const needed = tra ? Math.max(...tra.map(traRangeFor)) : TRA_BASE
  if (needed > traMax) setTraMax(needed)

  return (
    <>
      <Group title={t.lab.timeline.rotation}>
        <div>
          {rot ? (
            ROT_CHANNELS.map((ch, i) => (
              <AxisSliderRow
                key={ch.key}
                axis={["X", "Y", "Z"][i]}
                color={ch.color}
                value={rot[i]}
                min={ROT_RANGE.min}
                max={ROT_RANGE.max}
                decimals={2}
                disabled={!clip}
                onChange={(v) => {
                  syncTabForAxisDrag(tab, i as 0 | 1 | 2, "rot", setTab)
                  applyRotationAxis(i as 0 | 1 | 2, v, "preview")
                }}
                onCommit={(v) => applyRotationAxis(i as 0 | 1 | 2, v, "commit")}
              />
            ))
          ) : (
            <div className="text-[10px] text-muted-foreground">—</div>
          )}
        </div>
      </Group>

      <Group title={t.lab.timeline.translation}>
        <div>
          {tra ? (
            TRA_CHANNELS.map((ch, i) => (
              <AxisSliderRow
                key={ch.key}
                axis={["X", "Y", "Z"][i]}
                color={ch.color}
                value={tra[i]}
                min={-traMax}
                max={traMax}
                decimals={3}
                disabled={!clip}
                onChange={(v) => {
                  syncTabForAxisDrag(tab, i as 0 | 1 | 2, "tra", setTab)
                  applyTranslationAxis(i as 0 | 1 | 2, v, "preview")
                }}
                onCommit={(v) => applyTranslationAxis(i as 0 | 1 | 2, v, "commit")}
              />
            ))
          ) : (
            <div className="text-[10px] text-muted-foreground">—</div>
          )}
        </div>
      </Group>
    </>
  )
}

/** Owns the interpolation tab and the curve. Subscribes to the playhead itself
 *  so the sliders above do not re-render when the playhead crosses a key. */
function BoneInterpolationSection({ clip, selectedBone }: { clip: AnimationClip | null; selectedBone: string }) {
  const t = useT()
  const { commit } = useClipActions()
  const [ipTab, setIpTab] = useState<IpTab>("rot")
  const kfSample = useLiveActiveKeyframe(clip, selectedBone)
  const currentFrame = usePlayheadSelector((s) => s.currentFrame)
  const selectedKeyframes = useClipSelector((st) => st.selectedKeyframes)
  const tab = useClipSelector((st) => st.tab)

  // The dock follows the timeline, one way.
  //
  // Reading Trans Y and then easing it should not mean finding the curve again
  // in a second control — the channel you are looking at is the channel you
  // mean. Only on a CHANGE, and never back: the camera panel documents why, and
  // it holds here too. Picking a curve to ease is not a request to move the
  // timeline off whatever you were watching.
  // Adjusted during render against a state copy, which is React's documented way
  // to follow a changing input — an effect that calls setState is what this
  // repo's lint forbids, and it would also paint one frame on the old curve.
  const [lastTab, setLastTab] = useState(tab)
  if (lastTab !== tab) {
    setLastTab(tab)
    const next = BONE_IP_FOR_CHANNEL[tab]
    if (next && next !== ipTab) setIpTab(next)
  }

  // Selecting a keyframe on a curve says which channel just as plainly as the
  // tab strip does — a curve hit carries the channel it was on.
  const selChannel = selectedKeyframes.find((sk) => sk.channel && sk.bone === selectedBone)?.channel
  const [lastChannel, setLastChannel] = useState(selChannel)
  if (lastChannel !== selChannel) {
    setLastChannel(selChannel)
    const next = selChannel ? BONE_IP_FOR_CHANNEL[selChannel] : undefined
    if (next && next !== ipTab) setIpTab(next)
  }

  /**
   * Which key this curve belongs to: the one SELECTED, else the one under the
   * playhead.
   *
   * Selection first, because clicking a diamond does not move the playhead —
   * so gating on the playhead alone left the panel inert on a key you had just
   * clicked and could see highlighted, which reads as the editor refusing to
   * open the thing you picked.
   *
   * The playhead is still the fallback, and it is still EXACT rather than
   * "the last key at or before". `kfSample` is the right read for a live value
   * and the wrong one for an edit: parked between two keys it would ease the
   * earlier one while the timeline highlighted nothing, landing the change
   * somewhere you were not looking. Both rules say the same thing — edit what
   * is visibly indicated, never something inferred.
   */
  const selectedFrame = useMemo(() => {
    for (const sel of selectedKeyframes) {
      if (sel.bone === selectedBone) return sel.frame
      // A dopesheet column carries no bone: it is every track at that frame,
      // this one included.
      if (!sel.bone && !sel.morph && sel.type === "dope") return sel.frame
    }
    return null
  }, [selectedKeyframes, selectedBone])

  const kfSelected =
    selectedFrame == null ? null : (clip?.boneTracks.get(selectedBone)?.find((k) => k.frame === selectedFrame) ?? null)
  const kfAtPlayhead =
    kfSelected ?? (kfSample && kfSample.frame === Math.round(Math.max(0, currentFrame)) ? kfSample : null)
  // No useMemo: `patchKeyframeAt` mutates in place and returns a shallow clone,
  // so the keyframe keeps its identity across edits and a memo keyed on it
  // would feed stale numbers back to the editor — dragging one control point
  // would appear to reset the other.
  const ipPair =
    (kfAtPlayhead && interpolationPairFromTab(kfAtPlayhead, ipTab)) ?? interpolationTemplateForChannel(ipTab)

  const applyInterpolation = useCallback(
    (p1: CurvePoint, p2: CurvePoint) => {
      if (!clip || !kfAtPlayhead) return
      commit(
        patchKeyframeAt(clip, selectedBone, kfAtPlayhead.frame, (kf) => {
          kf.interpolation = mergeInterpolation(kf, ipTab, p1, p2)
        }),
      )
    },
    [clip, selectedBone, ipTab, kfAtPlayhead, commit],
  )

  return (
    <InterpolationPanel
      tabs={BONE_IP_TABS.map((x) => ({ key: x.key, label: t.lab.timeline.labels[x.label] ?? x.label }))}
      activeTab={ipTab}
      onTabChange={(k) => setIpTab(k as IpTab)}
      p1={ipPair[0]}
      p2={ipPair[1]}
      disabled={!kfAtPlayhead}
      onChange={applyInterpolation}
    />
  )
}

// ─── Camera ───────────────────────────────────────────────────────────────

/** Slider range per camera channel — each is in its own unit, so none of them
 *  can share a range the way a bone's three rotation axes do. */
const CAMERA_RANGES: Record<string, { min: number; max: number; decimals: number }> = {
  cgx: { min: -30, max: 30, decimals: 2 },
  cgy: { min: -30, max: 30, decimals: 2 },
  cgz: { min: -30, max: 30, decimals: 2 },
  crx: { min: -180, max: 180, decimals: 1 },
  cry: { min: -180, max: 180, decimals: 1 },
  crz: { min: -180, max: 180, decimals: 1 },
  cds: { min: -100, max: 0, decimals: 2 },
  cfv: { min: 1, max: 150, decimals: 0 },
}

/** Mirrors the bone panel's Rotation / Translation split — eight ungrouped rows
 *  showed "X Y Z" twice with nothing saying which was which. Distance and FOV
 *  get no heading of their own: a one-row section whose title repeats the row's
 *  label is a header saying nothing. */
const CAMERA_GROUPS = [
  { group: "rot" as const, label: "rotation" as const, strip: true },
  { group: "tgt" as const, label: "target" as const, strip: true },
  { group: "dist" as const, label: null, strip: false },
  { group: "fov" as const, label: null, strip: false },
]

/**
 * A camera's pose at `frame`, ready to insert.
 *
 * Sampled with the engine's own CameraAnimation so an inserted key sits exactly
 * on the curve the viewport is already showing — a second implementation of the
 * same beziers would drift in the small, and the drift would only ever show up
 * as a camera that twitches when you key it.
 */
function sampleCameraAt(track: readonly CameraKeyframe[], frame: number): CameraKeyframe {
  const pose = track.length > 0 ? new CameraAnimation([...track]).sample(frame / 30) : null
  if (!pose) {
    return { frame, distance: -35, target: new Vec3(0, 10, 0), rotation: new Vec3(0, 0, 0), fov: 30 }
  }
  return {
    frame,
    distance: pose.distance,
    target: new Vec3(pose.target.x, pose.target.y, pose.target.z),
    rotation: new Vec3(pose.rotation.x, pose.rotation.y, pose.rotation.z),
    // CameraAnimation hands fov back in radians; the file stores whole degrees.
    fov: Math.round((pose.fov * 180) / Math.PI),
  }
}

function withCameraIp(ip: Uint8Array | undefined, channel: number, p1: CurvePoint, p2: CurvePoint): Uint8Array {
  const next = new Uint8Array(24)
  if (ip && ip.length >= 24) next.set(ip.subarray(0, 24))
  else for (let c = 0; c < 6; c++) next.set([20, 107, 20, 107], c * 4)
  const b = channel * 4
  next[b] = p1.x
  next[b + 1] = p2.x
  next[b + 2] = p1.y
  next[b + 3] = p2.y
  return next
}

/**
 * What a camera row calls itself.
 *
 * Rotation and target rows drop their prefix — the group heading above already
 * says which they are — and what is left is a bare axis letter that reads the
 * same in any language. Distance and FOV have no heading of their own, so their
 * label carries the whole meaning and has to be translated.
 */
function cameraAxisLabel(label: string, strip: boolean, labels: Record<string, string>): string {
  const bare = strip ? label.replace(/^(Tgt|Rot)\./, "") : label
  return labels[bare] ?? bare
}

const CameraSection = memo(function CameraSection({ onClose }: { onClose: () => void }) {
  const t = useT()
  const cameraTrack = useClipSelector((s) => s.cameraTrack)
  const tab = useClipSelector((s) => s.tab)
  const { commitCamera, setTab } = useClipActions()
  const ops = useClipOps()
  const playhead = usePlayheadSelector((s) => s.currentFrame)
  const frame = Math.round(Math.max(0, playhead))

  // The key AT the playhead, or null. Deliberately exact rather than "the last
  // one at or before": editing the previous key while parked between two of
  // them is what made the sliders appear to move the wrong keyframe.
  const keyAtPlayhead = useMemo(() => cameraTrack.find((kf) => kf.frame === frame) ?? null, [cameraTrack, frame])

  // The curve follows the SELECTION when there is one, for the reason the bone
  // panel's does: clicking a key in the timeline does not move the playhead, so
  // a key you can see highlighted must not leave this inert. The sliders stay
  // on the playhead — they edit the pose at the frame you are watching, which
  // is a different question from which curve you are easing.
  const selectedKeyframes = useClipSelector((st) => st.selectedKeyframes)
  const keyForCurve = useMemo(() => {
    for (const sel of selectedKeyframes) {
      if (sel.morph || sel.bone) continue
      const hit = cameraTrack.find((kf) => kf.frame === sel.frame)
      if (hit) return hit
    }
    return keyAtPlayhead
  }, [selectedKeyframes, cameraTrack, keyAtPlayhead])

  // What the sliders READ: the real key when there is one, otherwise the shot's
  // interpolated pose there — so the numbers always describe the frame you are
  // looking at, whether or not it has been keyed yet.
  const displayed = useMemo(
    () => keyAtPlayhead ?? sampleCameraAt(cameraTrack, frame),
    [keyAtPlayhead, cameraTrack, frame],
  )

  // Its OWN state, seeded from the timeline's tab but not chained to it.
  // Deriving it meant picking a curve to ease also yanked the timeline off
  // whatever you were looking at. The two are related, not the same: one is
  // which curve you are reading, the other is which you are easing.
  const [ipChannel, setIpChannel] = useState(() => cameraIpChannelForTab(tab))
  const lastTab = useRef(tab)
  useEffect(() => {
    if (lastTab.current === tab) return
    lastTab.current = tab
    setIpChannel(cameraIpChannelForTab(tab))
  }, [tab])

  /** Edit the key at the playhead, creating it from the pose already showing if
   *  there is none — the same "drag a slider and it keys" contract the bone
   *  sliders have. A new key changes nothing on its own; only the channel you
   *  dragged moves.
   *
   *  Every tick commits, unlike the bone path. A camera track is a handful of
   *  keys rather than a track per bone, and it has no in-place preview door:
   *  the shot lives on the engine, not on the model. Worth revisiting if a
   *  camera drag ever feels heavy — the cost is one loadCameraClip and a scene
   *  seek per tick. */
  const applyChannel = useCallback(
    (channelKey: string, v: number) => {
      const ch = CAMERA_CHANNELS.find((c) => c.key === channelKey)
      if (!ch) return
      commitCamera((track) => {
        const existing = track.find((kf) => kf.frame === frame)
        if (existing) {
          return track.map((kf) => {
            if (kf.frame !== frame) return kf
            const next = { ...kf }
            ch.set(next, v)
            return next
          })
        }
        const seeded = { ...sampleCameraAt(track, frame) }
        ch.set(seeded, v)
        return [...track, seeded]
      })
    },
    [frame, commitCamera],
  )

  /** Point the timeline at the curve being dragged, on the FIRST tick, the way
   *  a bone slider does — so the view is already right while you drag. An "All"
   *  view already shows this channel and is left alone. */
  const syncTab = useCallback(
    (channelKey: string) => {
      if (cameraChannelsForTab(tab).some((c) => c.key === channelKey)) return
      const want = CAMERA_AXIS_TAB[channelKey]
      if (want) setTab(want)
    },
    [tab, setTab],
  )

  const insertKey = useCallback(() => {
    if (keyAtPlayhead) return
    commitCamera((track) => [...track, sampleCameraAt(track, frame)])
  }, [keyAtPlayhead, frame, commitCamera])

  const deleteKey = useCallback(() => {
    if (!keyAtPlayhead) return
    commitCamera((track) => track.filter((kf) => kf.frame !== frame))
  }, [keyAtPlayhead, frame, commitCamera])

  const applyIp = useCallback(
    (p1: CurvePoint, p2: CurvePoint) => {
      if (!keyForCurve) return
      const at = keyForCurve.frame
      commitCamera((track) =>
        track.map((kf) =>
          kf.frame === at ? { ...kf, interpolation: withCameraIp(kf.interpolation, ipChannel, p1, p2) } : kf,
        ),
      )
    },
    [keyForCurve, ipChannel, commitCamera],
  )

  const ipPair = cameraIpPair(keyForCurve?.interpolation, ipChannel)

  return (
    <>
      <SubjectHeader onClose={onClose} title={t.lab.timeline.camera} frameCount={null} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {CAMERA_GROUPS.map((g) => {
          const rows = (
            <div>
              {CAMERA_CHANNELS.filter((c) => c.group === g.group).map((ch) => {
                const r = CAMERA_RANGES[ch.key]
                return (
                  <AxisSliderRow
                    key={ch.key}
                    axis={cameraAxisLabel(ch.label, g.strip, t.lab.timeline.labels)}
                    color={ch.color}
                    value={ch.get(displayed)}
                    min={r.min}
                    max={r.max}
                    decimals={r.decimals}
                    // Distance runs -100…0 and FOV 1…150; a bar growing from a
                    // zero that is off the end of its own track is a bar that
                    // is always full or always empty.
                    origin={ch.group === "dist" || ch.group === "fov" ? r.min : 0}
                    onChange={(v) => {
                      applyChannel(ch.key, v)
                      syncTab(ch.key)
                    }}
                    onCommit={(v) => applyChannel(ch.key, v)}
                  />
                )
              })}
            </div>
          )
          // Distance and FOV are separated from Target by space rather than by
          // a heading of their own — see CAMERA_GROUPS.
          return g.label ? (
            <Group key={g.group} title={t.lab.timeline[g.label]}>
              {rows}
            </Group>
          ) : (
            // px-4 like every other run of rows. Having no LABEL does not make
            // it a different kind of block — it was the one branch that did not
            // go through <Group/>, so Dist and FOV sat flush against the panel
            // edge with their readouts hanging off the other side.
            <div key={g.group} className="mt-3 px-4">
              {rows}
            </div>
          )
        })}

        <InterpolationPanel
          tabs={CAMERA_IP_TABS.map((c) => ({
            key: String(c.ip),
            label: t.lab.timeline.labels[c.label] ?? c.label,
          }))}
          activeTab={String(ipChannel)}
          onTabChange={(k) => setIpChannel(Number(k))}
          p1={ipPair[0]}
          p2={ipPair[1]}
          disabled={!keyForCurve}
          onChange={applyIp}
        />

        <OperationsSection
          onInsert={insertKey}
          onDelete={deleteKey}
          onClear={ops.clearCameraTrack}
          canInsert={!keyAtPlayhead}
          canDelete={!!keyAtPlayhead}
          // Permanently inert, and kept anyway: Simplify fits a curve through
          // dense keys, and a camera VMD is sparse by nature — its keys ARE the
          // cuts, so there is nothing to reduce. Dropping the button would make
          // this row one control wide and the whole block a different shape
          // from the bone one.
          canSimplify={false}
          simplifyTitle={t.lab.timeline.simplifyCameraHint}
          canClear={cameraTrack.length > 0}
        />
      </div>
    </>
  )
})

// ─── The dock ─────────────────────────────────────────────────────────────

function InspectorBody({ onClose }: { onClose: () => void }) {
  const clip = useClipSelector((s) => s.clip)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const selectedMorph = useClipSelector((s) => s.selectedMorph)
  const cameraSelected = useClipSelector((s) => s.cameraSelected)
  const { commit, setTab } = useClipActions()
  const t = useT()
  const engine = useClipEngine()
  const frameRef = usePlayheadFrameRef()
  const ops = useClipOps()
  // Read inside the morph callback below without subscribing it to tab changes
  // — it points the timeline at Weight, which must not rebuild the callback.
  const tab = useClipSelector((s) => s.tab)
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  })

  // ─── The preview / commit split ────────────────────────────────────────
  //     `preview` fires every drag tick: it mutates the clip's keyframe in
  //     place (the engine shares the same track arrays) and pushes it through
  //     the engine door so the viewport follows the pointer, WITHOUT committing
  //     — no clip clone, no store notification, no scene-wide seek.
  //     `commit` fires once on release: a new clip reference, which cascades
  //     through the store and lands one write-back and one history step.
  const applyRotationAxis = useCallback(
    (axisIdx: 0 | 1 | 2, v: number, mode: "preview" | "commit") => {
      if (!selectedBone || !clip) return
      const frame = Math.round(Math.max(0, Math.min(clip.frameCount, frameRef.current)))
      const atKey = findKeyframeAt(clip, selectedBone, frame)
      if (atKey) {
        const e = quatToEuler(atKey.rotation)
        const next = axisIdx === 0 ? { ...e, x: v } : axisIdx === 1 ? { ...e, y: v } : { ...e, z: v }
        // In place — the engine's clip shares these keyframe objects.
        atKey.rotation = eulerToQuat(next.x, next.y, next.z)
      } else {
        const pose = engine.current?.samplePose(selectedBone, frame)
        if (!pose) return
        const e = quatToEuler(pose.rotation)
        const next = axisIdx === 0 ? { ...e, x: v } : axisIdx === 1 ? { ...e, y: v } : { ...e, z: v }
        const track = clip.boneTracks.get(selectedBone) ?? []
        if (!clip.boneTracks.has(selectedBone)) clip.boneTracks.set(selectedBone, track)
        track.push({
          boneName: selectedBone,
          frame,
          rotation: eulerToQuat(next.x, next.y, next.z),
          translation: pose.translation,
          interpolation: interpolationTemplateForFrame(track, frame),
        })
        track.sort((a, b) => a.frame - b.frame)
      }
      engine.current?.preview(clip, frame)
      if (mode === "commit") commit({ ...clip, boneTracks: new Map(clip.boneTracks) })
    },
    [selectedBone, clip, commit, engine, frameRef],
  )

  const applyTranslationAxis = useCallback(
    (axisIdx: 0 | 1 | 2, v: number, mode: "preview" | "commit") => {
      if (!selectedBone || !clip) return
      const frame = Math.round(Math.max(0, Math.min(clip.frameCount, frameRef.current)))
      const atKey = findKeyframeAt(clip, selectedBone, frame)
      if (atKey) {
        const t = atKey.translation
        atKey.translation =
          axisIdx === 0 ? new Vec3(v, t.y, t.z) : axisIdx === 1 ? new Vec3(t.x, v, t.z) : new Vec3(t.x, t.y, v)
      } else {
        const pose = engine.current?.samplePose(selectedBone, frame)
        if (!pose) return
        const t = pose.translation
        const track = clip.boneTracks.get(selectedBone) ?? []
        if (!clip.boneTracks.has(selectedBone)) clip.boneTracks.set(selectedBone, track)
        track.push({
          boneName: selectedBone,
          frame,
          rotation: pose.rotation,
          translation:
            axisIdx === 0 ? new Vec3(v, t.y, t.z) : axisIdx === 1 ? new Vec3(t.x, v, t.z) : new Vec3(t.x, t.y, v),
          interpolation: interpolationTemplateForFrame(track, frame),
        })
        track.sort((a, b) => a.frame - b.frame)
      }
      engine.current?.preview(clip, frame)
      if (mode === "commit") commit({ ...clip, boneTracks: new Map(clip.boneTracks) })
    },
    [selectedBone, clip, commit, engine, frameRef],
  )

  const applyMorphWeight = useCallback(
    (w: number, mode: "preview" | "commit") => {
      if (!selectedMorph || !clip) return
      const frame = Math.round(Math.max(0, Math.min(clip.frameCount, frameRef.current)))
      // Installing a MISSING track has to go through commit, not through the
      // live clip's Map. Adding it here mutates the object the store is holding
      // while a preview deliberately does not commit, so `clip` and
      // `clipSnapshot` drift apart — and the next commit then pushes a snapshot
      // that predates edits already applied, which is undo silently losing a
      // morph. Adding one expression and then editing another is exactly the
      // sequence that reaches it.
      //
      // Weight edits to an EXISTING keyframe stay in place: that is what makes
      // preview cheap, and the track already belongs to the clip.
      const track = clip.morphTracks.get(selectedMorph)
      if (!track) {
        const morphTracks = new Map(clip.morphTracks)
        morphTracks.set(selectedMorph, [{ morphName: selectedMorph, frame, weight: w }])
        commit({ ...clip, morphTracks })
        return
      }
      const existing = track.find((k) => k.frame === frame)
      if (existing) existing.weight = w
      else {
        track.push({ morphName: selectedMorph, frame, weight: w })
        track.sort((a, b) => a.frame - b.frame)
      }
      engine.current?.preview(clip, frame)
      if (tabRef.current !== "morph") setTab("morph")
      if (mode === "commit") commit({ ...clip, morphTracks: new Map(clip.morphTracks) })
    },
    [selectedMorph, clip, commit, engine, frameRef, setTab],
  )

  if (cameraSelected) return <CameraSection onClose={onClose} />

  if (selectedMorph) {
    return (
      <>
        <SubjectHeader onClose={onClose} title={selectedMorph} frameCount={clip?.frameCount ?? null} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          <Group title={t.lab.timeline.weight}>
            <LiveMorphSlider selectedMorph={selectedMorph} clip={clip} applyMorphWeight={applyMorphWeight} />
          </Group>
          <OperationsSection
            onInsert={ops.insertKeyframeAtPlayhead}
            onDelete={ops.deleteSelectedKeyframes}
            onSimplify={ops.simplifySelectedBoneTrack}
            onClear={ops.clearSelectedTrack}
            canInsert={ops.canInsert}
            canDelete={ops.canDelete}
            // A morph track has no curve to fit — a VMD morph frame carries a
            // weight and no interpolation at all.
            canSimplify={false}
            simplifyTitle={t.lab.timeline.simplifyMorphHint}
            canClear={ops.canClear}
          />
        </div>
      </>
    )
  }

  if (selectedBone) {
    return (
      <>
        {/* The bone's own name. An English gloss beside it was a second name
            for one thing in a column this narrow, and the picker on the left
            already lists them the way the rig does. */}
        <SubjectHeader onClose={onClose} title={selectedBone} frameCount={clip?.frameCount ?? null} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          <LiveBoneSliders
            selectedBone={selectedBone}
            clip={clip}
            applyRotationAxis={applyRotationAxis}
            applyTranslationAxis={applyTranslationAxis}
          />
          <BoneInterpolationSection clip={clip} selectedBone={selectedBone} />
          <OperationsSection
            onInsert={ops.insertKeyframeAtPlayhead}
            onDelete={ops.deleteSelectedKeyframes}
            onSimplify={ops.simplifySelectedBoneTrack}
            onClear={ops.clearSelectedTrack}
            canInsert={ops.canInsert}
            canDelete={ops.canDelete}
            canSimplify={ops.canSimplify}
            canClear={ops.canClear}
          />
        </div>
      </>
    )
  }

  // Nothing picked. The picker beside the timeline is where you pick, and
  // saying so beats an empty column that looks broken.
  // Unreachable: <ClipInspector/> does not mount this without a subject.
  return null
}

/** Morph weight, scoped to its own rAF — mirrors <LiveBoneSliders>. */
function LiveMorphSlider({
  selectedMorph,
  clip,
  applyMorphWeight,
}: {
  selectedMorph: string
  clip: AnimationClip | null
  applyMorphWeight: (w: number, mode: "preview" | "commit") => void
}) {
  const weight = useLiveMorphWeight(selectedMorph, clip)
  return (
    <AxisSliderRow
      axis="W"
      color="#c084fc"
      value={weight ?? 0}
      min={0}
      max={1}
      decimals={2}
      origin={0}
      disabled={!clip}
      onChange={(v) => applyMorphWeight(v, "preview")}
      onCommit={(v) => applyMorphWeight(v, "commit")}
    />
  )
}

export function ClipInspector({ onClose }: { onClose: () => void }) {
  // Nothing selected, nothing to inspect, no panel.
  //
  // The alternative was a panel holding one line telling you to go and select
  // something — which is a surface whose entire content is an apology for
  // existing, in the column the timeline deliberately stops short of. Summoned
  // means summoned: it arrives with a subject and leaves with it.
  //
  // Split in two so the guard runs BEFORE useZOrder: registering a z-order
  // entry and an Escape closer for a surface that renders nothing would put an
  // invisible panel at the top of the stack and let it swallow the key.
  const hasSubject = useClipSelector((s) => s.cameraSelected || s.selectedBone != null || s.selectedMorph != null)
  if (!hasSubject) return null
  return <ClipInspectorSurface onClose={onClose} />
}

function ClipInspectorSurface({ onClose }: { onClose: () => void }) {
  const z = useZOrder(undefined, onClose)
  return (
    <Surface
      placement="side"
      // Same scope string as the timeline: one history, two surfaces. Undo
      // belongs to the CLIP, not to whichever half of the editor you happen to
      // have clicked into last.
      data-undo-scope={CLIP_UNDO_SCOPE}
      // Starts BELOW the top-right pills, exactly like the materials dock, so
      // the two never disagree about where this column begins.
      //
      // `bottom-auto` is what makes it FIT: the side placement pins top and
      // bottom, which stretches a panel of six sliders down the whole window
      // and leaves it mostly empty — a surface should be the size of what is in
      // it. The cap is the same arithmetic read downwards (3.75rem above,
      // 0.75rem below), and only bites on a short window, where the body
      // scrolls instead.
      className="top-[3.75rem] bottom-auto max-h-[calc(100%-4.5rem)] animate-[panel-in_0.2s_cubic-bezier(0.32,0.72,0,1)]"
      style={{ zIndex: z.z }}
      onPointerDownCapture={z.onPointerDownCapture}
      onFocusCapture={z.onFocusCapture}
    >
      <InspectorBody onClose={onClose} />
    </Surface>
  )
}
