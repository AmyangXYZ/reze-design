"use client"

// The 0.4.0 chrome, built fresh rather than adapted.
//
// A visual shell: the real engine, the real scene, the real hooks — but the
// handlers that would make every control work still live in app/page.tsx, so
// anything needing one is inert here. That is the point. Whether a collapsed row
// naming its preset reads better than today's docks is a question you answer by
// looking, and it is worth answering before 59 callbacks get consolidated around
// the answer.
//
// Reference: docs/design/chrome-study.html. Rules: AGENTS.md.
//
// What differs from the study, deliberately: there is no View/Compose/Edit
// switch. The study said "depth, not modes" and then shipped three mode buttons.
// One collapse toggle instead — collapsed IS the view state, so "what a share
// link renders" stops being a mode anybody has to maintain.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import {
  Atom,
  Camera,
  Globe,
  Grid3x3,
  Users,
  Clapperboard,
  Code2,
  ChevronDown,
  ChevronUp,
  Contrast,
  Music,
  Mountain,
  Plus,
  RefreshCw,
  Palette,
  PenLine,
  Share2,
  Sun,
  Video,
  Workflow,
  Upload,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AccountButton } from "@/components/editor/account-panel"
import { AnimPlayer } from "@/components/scene/anim-player"
import { MaterialsPanel } from "@/components/scene/material-sidebar"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { RenderPanel } from "@/components/editor/render-panel"
import { CastSwatch } from "@/components/editor/cast-swatch"
import { CommandPalette } from "@/components/editor/command-palette"
import type { PaletteItem } from "@/lib/command-search"
import { SceneName } from "@/components/editor/scene-name"
import { Surface } from "@/components/editor/surface"
import { LayerRow, StackGroup } from "@/components/editor/layer-row"
import {
  ColorRow,
  FOLLOW_BONE,
  FOLLOW_OFFSET_DEFAULT,
  SliderRow,
  TARGET_DEFAULT,
} from "@/components/scene/scene-sidebar"
import { QuickPick } from "@/components/scene/quick-pick"
import { GradeLibrary } from "@/components/editor/grade-library"
import { BackgroundLibrary } from "@/components/editor/background-library"
import { ColorField } from "@/components/color-picker"
import { useAudioClock } from "@/hooks/use-audio-clock"
import { useEngine } from "@/hooks/use-engine"
import { useRenderFraming } from "@/hooks/use-render-framing"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { useZOrder } from "@/hooks/use-z-order"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import { hydrateScene, type SceneCamera } from "@/lib/scene"
import { expandUploadFiles } from "@/lib/uploads"
import { GRADE_PRESETS, gradeSpec, recallIntensity, rememberIntensity } from "@/lib/grade"
import { communityQuickPickItems, quickPickItems, type EffectItem, type GradeItem, type GraphItem } from "@/lib/library"
import { communityItems, useCommunity } from "@/hooks/use-community"
import { useDrafts } from "@/hooks/use-drafts"
import { applyDefaults, BACKGROUND_EFFECTS } from "@/lib/background-effects"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import type { ExportProgress } from "@/lib/video-export"
import { castColour } from "@/lib/model-colour"
import { castSourceFor } from "@/lib/cast-source"
import { NEUTRAL_PALETTE, type CastPaletteId } from "@/lib/cast-palette"
import { relFilePath, sceneFiles } from "@/lib/scene-files"
import { loadDrafts } from "@/lib/drafts"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { DEFAULT_GRAPH, type StyleGroup } from "reze-engine"
import { WIND_MAX, windFreqFromSlider, windSliderFromFreq, type SceneSettings } from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

/** Floating chrome — editor-chrome.tsx's `floating`, taken through the surface
 *  token so the pills and the panel cannot drift apart. */
const PILL = "rounded-xl border border-white/10 bg-surface shadow-float backdrop-blur-xs"

/** The iOS sheet curve — decelerating, no overshoot. Width, height and radius
 *  all ride it so the transport reads as ONE surface changing shape rather than
 *  three properties animating near each other. */
const FOLD = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"

/**
 * The working area — what the canvas has left between the docks.
 *
 * The right inset assumes the inspector matching the stack at 17rem, which does
 * not exist on this route yet. Sizing against where it WILL be costs nothing now
 * and stops the geometry changing the day it lands — and matching widths means
 * the timeline stays centred on the canvas rather than drifting off it.
 *
 * Both insets hold whether the stack is open or not. Collapsing it must NOT let
 * the timeline widen: the transport would then resize every time you hid a panel
 * you were not even looking at, and a timeline whose scale changes underneath you
 * is worse than one that leaves a strip of canvas unused.
 *
 * Written out rather than interpolated from a constant: Tailwind scans source
 * for literal class names, so a template string here produces no CSS at all.
 */
const WORKSPACE = "left-[calc(18rem+1.5rem)] right-[calc(18rem+1.5rem)]"

/** A viewport a hair narrower than the target still counts as matching it. */
const FRAME_ASPECT_TOL = 1.03

/** Palette recents, persisted — Suggestions should remember across sessions. */
const RECENTS_KEY = "reze-design.palette-recents"

/** Each layer's presets. Static here — the real stack reads these from the
 *  document and the libraries; the shell only needs them to have names. */
const LAYERS = [
  { id: "camera", name: "Camera", icon: Camera, presets: [] },
  // "Environment", not "Stage": the row holds Stage | Ground | Background, and
  // a container named after one of its tabs read as filing confusion.
  { id: "stage", name: "Environment", icon: Mountain, presets: [] },
  // Its own row, not a Background line: an effect can sit in front of the
  // scene as well as behind it (the layer flag is coming with the engine's
  // global mount), so it is scene dressing like Grade, not part of the
  // backdrop.
  { id: "effect", name: "Effect", icon: Sparkles, presets: [] },
  // Post, not Grade: the row is the whole after-the-render pass — the colour
  // grade and the glow the camera adds to bright pixels. Lighting (including a
  // future character rim) stays in Light; those change how surfaces respond,
  // not what happens to the finished frame.
  { id: "post", name: "Post", icon: Contrast, presets: [] },
  { id: "light", name: "Light", icon: Sun, presets: [] },
  { id: "physics", name: "Physics", icon: Atom, presets: [] },
] as const

/**
 * Every CONTROL in the dock, as data: where it lives (row, pane) and what it is
 * called in both search languages. The palette's Settings section is generated
 * from this, so "shadow" or 阴影 lands on Environment · Ground — searching a
 * knob by name navigates to the knob, not to a guess.
 */
const DOCK_CONTROLS: {
  id: string
  en: string
  zh: string
  row: string
  stageTab?: "stage" | "ground" | "background"
  lightTab?: "world" | "sun"
  cameraTab?: "lens" | "focus"
  postTab?: "grade" | "bloom"
  keywords?: string[]
}[] = [
  { id: "camera-fov", en: "Camera FOV", zh: "相机视场角", row: "camera", cameraTab: "lens", keywords: ["fov", "field of view", "视野"] },
  { id: "camera-follow", en: "Follow character", zh: "跟随角色", row: "camera", cameraTab: "lens", keywords: ["follow", "center", "センター"] },
  { id: "camera-distance", en: "Camera distance", zh: "相机距离", row: "camera", cameraTab: "lens", keywords: ["zoom", "距离"] },
  { id: "camera-angle", en: "Camera angle", zh: "相机角度", row: "camera", cameraTab: "lens", keywords: ["orbit", "azimuth", "elevation", "方位"] },
  { id: "camera-target", en: "Camera target", zh: "相机目标", row: "camera", cameraTab: "lens", keywords: ["offset", "look at", "偏移"] },
  { id: "camera-dof", en: "Depth of field", zh: "景深", row: "camera", cameraTab: "focus", keywords: ["dof", "bokeh", "blur", "focus", "虚化"] },
  { id: "stage-scale", en: "Stage scale", zh: "舞台缩放", row: "stage", stageTab: "stage" },
  { id: "stage-position", en: "Stage position", zh: "舞台位置", row: "stage", stageTab: "stage" },
  { id: "ground-color", en: "Ground color", zh: "地面颜色", row: "stage", stageTab: "ground" },
  { id: "ground-opacity", en: "Ground opacity", zh: "地面不透明度", row: "stage", stageTab: "ground" },
  { id: "shadow", en: "Shadow", zh: "阴影", row: "stage", stageTab: "ground" },
  { id: "grid", en: "Grid lines", zh: "网格", row: "stage", stageTab: "ground" },
  { id: "bg-color", en: "Background color", zh: "背景颜色", row: "stage", stageTab: "background" },
  { id: "bg-image", en: "Background image", zh: "背景图片", row: "stage", stageTab: "background", keywords: ["backdrop", "photo"] },
  { id: "bg-360", en: "360° background", zh: "360 全景背景", row: "stage", stageTab: "background", keywords: ["360", "skybox", "panorama", "equirect", "全景"] },
  { id: "effect", en: "Effect", zh: "特效", row: "effect", keywords: ["wgsl", "stars", "shader", "背景特效"] },
  { id: "grade-preset", en: "Grade preset", zh: "调色预设", row: "post", postTab: "grade", keywords: ["color", "look", "后期"] },
  { id: "grade-intensity", en: "Grade intensity", zh: "调色强度", row: "post", postTab: "grade" },
  { id: "bloom-intensity", en: "Bloom intensity", zh: "泛光强度", row: "post", postTab: "bloom", keywords: ["glow", "辉光"] },
  { id: "bloom-threshold", en: "Bloom threshold", zh: "泛光阈值", row: "post", postTab: "bloom", keywords: ["cutoff"] },
  { id: "bloom-radius", en: "Bloom radius", zh: "泛光半径", row: "post", postTab: "bloom", keywords: ["spread", "扩散"] },
  { id: "world-strength", en: "World strength", zh: "环境光强度", row: "light", lightTab: "world", keywords: ["ambient"] },
  { id: "sun-strength", en: "Sun strength", zh: "太阳强度", row: "light", lightTab: "sun" },
  { id: "sun-azimuth", en: "Sun azimuth", zh: "太阳方位", row: "light", lightTab: "sun" },
  { id: "sun-elevation", en: "Sun elevation", zh: "太阳高度", row: "light", lightTab: "sun" },
  { id: "gravity", en: "Gravity", zh: "重力", row: "physics" },
  { id: "wind", en: "Wind", zh: "风", row: "physics" },
  { id: "wind-frequency", en: "Wind frequency", zh: "风频率", row: "physics" },
  { id: "wind-direction", en: "Wind direction", zh: "风向", row: "physics" },
]

const ROW_META: Record<string, { icon: ComponentType<{ className?: string }>; name: string }> = {
  camera: { icon: Camera, name: "Camera" },
  stage: { icon: Mountain, name: "Environment" },
  effect: { icon: Sparkles, name: "Effect" },
  post: { icon: Contrast, name: "Post" },
  light: { icon: Sun, name: "Light" },
  physics: { icon: Atom, name: "Physics" },
}
const TAB_NAME: Record<string, string> = {
  stage: "Stage",
  ground: "Ground",
  background: "Background",
  world: "World",
  sun: "Sun",
}

/** The generated Settings entries — the breadcrumb hint says where it lives. */
const CONTROL_ITEMS: PaletteItem[] = DOCK_CONTROLS.map((c) => ({
  id: `ctl-${c.id}`,
  repeatable: true,
  section: "setting" as const,
  icon: ROW_META[c.row].icon,
  label: c.en,
  hint: ROW_META[c.row].name + (c.stageTab ?? c.lightTab ? ` · ${TAB_NAME[(c.stageTab ?? c.lightTab)!]}` : ""),
  altLabels: [c.zh],
  keywords: c.keywords,
}))

/** A stand-in command set — enough to judge ranking, sections and the ">" mode.
 *  The real one comes from the registry, where each entry owns its `when` and
 *  `run`; these deliberately carry altLabels and keywords so folding and the
 *  keyword bag can be exercised (try "着色", "しぇーだー", "mp4", "bgm"). The
 *  hints show what each row acts on; rows with nothing to say leave it blank.
 *
 *  `nextLikely` and `repeatable` drive Suggestions — finish a look and Publish
 *  rises, export once and Export drops out. See suggestionsFor. */
const COMMANDS: PaletteItem[] = [
  {
    id: "graph",
    suggested: true,
    repeatable: true,
    nextLikely: ["export", "publish"],
    section: "command",
    deep: true,
    icon: Workflow,
    label: "Edit shader graph",
    hint: "Dress",
    altLabels: ["编辑着色器图"],
    keywords: ["wgsl", "material", "node"],
  },
  {
    id: "wgsl",
    repeatable: true,
    nextLikely: ["export"],
    section: "command",
    deep: true,
    icon: Code2,
    label: "Write a WGSL background effect",
    altLabels: ["编写 WGSL 背景特效"],
    keywords: ["shader", "effect", "background"],
  },
  {
    id: "export",
    suggested: true,
    nextLikely: ["publish"],
    section: "command",
    icon: Clapperboard,
    label: "Export video",
    hint: "3840 × 2160",
    altLabels: ["导出视频"],
    keywords: ["mp4", "4k", "render", "encode"],
  },
  {
    id: "publish",
    suggested: true,
    section: "command",
    icon: Share2,
    label: "Publish scene",
    altLabels: ["发布场景"],
    keywords: ["share", "upload", "link"],
  },
  {
    id: "upload-stage",
    nextLikely: ["light", "post"],
    section: "command",
    icon: Mountain,
    label: "Upload stage PMX",
    altLabels: ["上传舞台 PMX"],
    keywords: ["environment", "floor", "舞台"],
  },
  {
    id: "music",
    nextLikely: ["export"],
    section: "command",
    icon: Music,
    label: "Upload music",
    hint: "One More Last Time",
    altLabels: ["上传音乐"],
    keywords: ["bgm", "audio", "mp3", "song"],
  },
  {
    id: "cast",
    repeatable: true,
    section: "goto",
    icon: Users,
    label: "Cast",
    altLabels: ["演员"],
    keywords: ["model", "character", "模型"],
  },
  {
    id: "clips",
    repeatable: true,
    section: "goto",
    icon: Clapperboard,
    label: "Clips",
    altLabels: ["片段"],
    keywords: ["camera motion", "music", "音乐"],
  },
  {
    id: "camera",
    repeatable: true,
    nextLikely: ["light"],
    section: "goto",
    icon: Camera,
    label: "Camera",
    altLabels: ["镜头"],
  },
  {
    id: "stage",
    repeatable: true,
    section: "goto",
    icon: Mountain,
    label: "Stage",
    altLabels: ["舞台"],
    keywords: ["environment", "环境"],
  },
  {
    id: "ground",
    repeatable: true,
    section: "goto",
    icon: Grid3x3,
    label: "Ground",
    altLabels: ["地面"],
    keywords: ["floor", "grid", "shadow"],
  },
  {
    id: "background",
    repeatable: true,
    section: "goto",
    icon: Mountain,
    label: "Background",
    altLabels: ["背景"],
    keywords: ["backdrop", "skybox", "360"],
  },
  {
    id: "effect",
    repeatable: true,
    section: "goto",
    icon: Sparkles,
    label: "Effect",
    altLabels: ["特效"],
    keywords: ["wgsl", "stars", "shader"],
  },
  {
    id: "post",
    repeatable: true,
    nextLikely: ["export"],
    section: "goto",
    icon: Contrast,
    label: "Post",
    altLabels: ["后期"],
    keywords: ["grade", "color", "调色", "bloom", "glow", "泛光"],
  },
  {
    id: "light",
    repeatable: true,
    nextLikely: ["post"],
    section: "goto",
    icon: Sun,
    label: "Light",
    altLabels: ["灯光"],
  },
  {
    id: "world",
    repeatable: true,
    section: "goto",
    icon: Globe,
    label: "World light",
    altLabels: ["环境光"],
    keywords: ["ambient"],
  },
  {
    id: "sun",
    repeatable: true,
    section: "goto",
    icon: Sun,
    label: "Sun",
    altLabels: ["太阳"],
    keywords: ["azimuth", "elevation"],
  },
  {
    id: "physics",
    repeatable: true,
    section: "goto",
    icon: Atom,
    label: "Physics",
    altLabels: ["物理"],
    keywords: ["gravity", "wind", "重力", "风"],
  },
  // A command, not a goto: it opens a panel to work in, the way Export does —
  // the goto section is for places in the dock.
  {
    id: "materials",
    // The palette is materials' only door — the cast row deliberately does not
    // open it — so the row has to be there without typing, not just findable.
    suggested: "key",
    repeatable: true,
    section: "command",
    icon: MaterialSphereIcon,
    label: "Edit material presets",
    altLabels: ["编辑材质预设"],
    keywords: ["style groups", "shader", "look", "材质", "材料"],
  },
  // Deliberately palette-only: outlines are a preference most scenes never
  // touch, and a dock row for them would cost every user attention to serve a
  // few. Searchable, not shelved.
  {
    id: "outline",
    repeatable: true,
    section: "command",
    icon: PenLine,
    label: "Toggle outline",
    altLabels: ["切换描边"],
    keywords: ["edge", "rim", "线稿", "轮廓"],
  },
  ...CONTROL_ITEMS,
]

/**
 * Every image a model might be textured with.
 *
 * An uploaded model still has its Files in memory, which is both cheaper and
 * more reliable than re-fetching. A served one is a folder URL plus the texture
 * paths the PMX declared. A bundled one has neither, so it keeps its name hash.
 */
/** The cast row's exact box, shimmering. Used both before the engine reports
 *  ready and while a loaded model's colour is still resolving — the name and the
 *  swatch arrive TOGETHER or not at all, because a row that fills in piecemeal
 *  is three small movements instead of one appearance. */
/**
 * One actionable line — a cast member's name, their motion, a scene-wide clip.
 *
 * The actions OVERLAY the text instead of reserving a slot beside it, so at
 * rest the name owns the line's full width. On hover the text's tail fades out
 * under the buttons via a mask — a mask and not padding, because padding would
 * re-truncate the text and the ellipsis would jump the moment the pointer
 * arrives. The fade is the no-reflow way to yield the space.
 */
function CastLine({ text, actions }: { text: ReactNode; actions: ReactNode }) {
  return (
    // -mx-1 px-1: the highlight breathes past the text without moving it.
    <span className="group relative -mx-1 flex h-5 items-center rounded-interior px-1 transition-colors hover:bg-white/[0.05]">
      {/* pr-12 ends a long name clear of the button zone entirely — the
          buttons appear on empty reserve, never on text, so the row's own
          highlight is all the hover needs. (Graded dims and edge fades were
          tried on top and deleted: with a real reserve there is nothing left
          for them to fix.) */}
      <span className="flex min-w-0 flex-1 items-center pr-12">{text}</span>
      <span className="absolute inset-y-0 right-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </span>
    </span>
  )
}


/** Unique kebab id for a new (peeled / created) style group — main's own minting. */
const newGroupId = (material: string, groups: StyleGroup[]): string => {
  const base = material.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group"
  const ids = new Set(groups.map((g) => g.id))
  if (!ids.has(base)) return base
  let i = 1
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** The empty file-slot invitation — muted, underlined, and ITSELF the button.
 *  One visual verb for every asset kind: animation, camera, music, image. */
function UploadInvite({
  label,
  onClick,
  aria,
  className,
}: {
  label: string
  onClick: () => void
  aria?: string
  /** Size and alignment come from the HOST line — the invite must sit at
   *  exactly the size its filled name would. */
  className?: string
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={aria ?? label}
      className={cn(
        "min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] text-muted-foreground underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current hover:text-foreground",
        className,
      )}
    >
      {label}
    </button>
  )
}

/** NO tooltip, deliberately: these sit in stacked hover rows, and a tip pops
 *  open across the cursor's travel line — hovering one row's actions physically
 *  blocked the hover path to the row beneath. They are also upload/replace/
 *  delete sitting beside the thing they act on; the context is the explanation.
 *  The aria-label keeps the words for anyone not seeing the icons.
 *
 *  size-5 fits the line exactly — anything taller sets the row height from the
 *  buttons rather than the text. */
function CastAction({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  compact,
}: {
  icon: ComponentType<{ className?: string }>
  /** Names the target too, since a screen reader hears these out of context. */
  label: string
  onClick: () => void
  danger?: boolean
  /** Rendered, dimmed and inert. Dropping the button instead would let the pair
   *  reflow between states, and a control that moves is worse than one that is
   *  visibly unavailable — the position is what you aim at. */
  disabled?: boolean
  /** size-4 instead of size-5, to sit in a small line box without setting the
   *  row's height from the button. The icon does NOT shrink with it — a 16px
   *  target only needs a smaller box, not a smaller mark. */
  compact?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      // stopPropagation: these sit inside rows that SELECT on click, and
      // deleting a model must not also inspect it.
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      className={cn(
        "shrink-0 rounded-chip text-muted-foreground hover:bg-white/10",
        compact ? "size-4" : "size-5",
        danger ? "hover:text-red-400" : "hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}

/** One row of the timeline. Fixed height and a fixed label column, so lanes of
 *  different kinds still read as one grid. */
function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-3">
      {/* Mono, uppercase and tracked — the study's lane key. It names the KIND of
          thing the lane holds, so it must not look like content. */}
      <span className="w-24 shrink-0 truncate font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="relative h-7 min-w-0 flex-1">{children}</span>
    </div>
  )
}

/** What a lane holds. Full width, NOT a duration: the lanes have no shared time
 *  axis to be proportional to yet, and a block sized to look like a measurement
 *  that is not one is worse than one that plainly fills its lane. */
function LaneBlock({ children }: { children: ReactNode }) {
  return (
    <span className="absolute inset-0 flex items-center overflow-hidden rounded-interior border border-blue-400/50 bg-blue-400/25 px-2.5 text-xs whitespace-nowrap text-foreground">
      {children}
    </span>
  )
}

/** An empty lane, which is an invitation rather than a gap. */
function LaneSlot({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="absolute inset-0 h-auto w-full rounded-interior border border-dashed border-line-strong text-xs font-normal text-muted-foreground hover:border-blue-400/50 hover:bg-transparent hover:text-blue-400"
    >
      {label}
    </Button>
  )
}

/**
 * A scene-wide clip in the stack — the camera motion, the music. One line in
 * the cast row's language: same hover reveal, same action pair, an icon where
 * a cast member carries a swatch. These are two of MMD's five basic
 * components, and an upload you must unfold the timeline to find is not an
 * entry point — the lanes VIEW this state on the time axis; this is where it
 * is set.
 */
function ClipRow({
  icon: Icon,
  clip,
  empty,
  kind,
  of,
  onPick,
  onRemove,
}: {
  icon: ComponentType<{ className?: string }>
  /** Loaded clip name, or null. */
  clip: string | null
  /** What the empty slot says — "No camera motion", "No music". */
  empty: string
  /** Names the kind for tooltips and screen readers: "camera motion", "music". */
  kind: string
  /** Whose clip, when several rows share a kind — aria only; the eye matches
   *  rows to the cast by order, the way the timeline lanes do. */
  of?: string
  onPick: () => void
  onRemove: () => void
}) {
  return (
    // Bare size-4 icon at gap-2.5, exactly as LayerRow sets its own icon and
    // name — a clip row and a Scene row are siblings in the same column, and
    // an invisible centring box around the icon read as a wider gap.
    <div className="flex items-center gap-2.5 px-4 py-1">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* One differentiator, the underline: a filled name is muted plain
            text, an empty slot is the same mute WITH an underline — the CTA
            mark — and is itself the button. White-filled was tried and put two
            white lines in every cast row, flattening name-over-value. */}
        <CastLine
          text={
            clip ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{clip}</span>
            ) : (
              <UploadInvite label={empty} onClick={onPick} aria={`Upload ${kind}${of ? ` for ${of}` : ""}`} />
            )
          }
          actions={
            <>
              <CastAction
                icon={clip ? RefreshCw : Upload}
                label={`${clip ? "Replace" : "Upload"} ${kind}${of ? ` for ${of}` : ""}`}
                onClick={onPick}
              />
              <CastAction
                icon={X}
                danger
                disabled={!clip}
                label={`Delete ${kind}${of ? ` for ${of}` : ""}`}
                onClick={onRemove}
              />
            </>
          }
        />
      </span>
    </div>
  )
}

// The row's true geometry, kept in step by hand: py-1.5, two h-5 lines, the
// motion line's leading icon slot. A skeleton that is not the shape of what
// replaces it is just a differently-timed layout shift — measure the real row
// before touching this one.
function CastRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-1.5">
      <Skeleton className="size-6 shrink-0 rounded-interior" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-28 rounded-chip" />
        </span>
        <span className="flex h-5 items-center">
          <Skeleton className="h-2.5 w-20 rounded-chip" />
        </span>
      </span>
    </div>
  )
}

/** What to call a model on screen. The extension is filesystem detail — every
 *  model here is a .pmx, so printing it on every row says nothing. */
const displayName = (file: string) => file.replace(/\.pmx$/i, "")


export default function Lab() {
  const [scene] = useState(() => hydrateScene(DEFAULT_SCENE))
  // Local for now — the Scene document has no name field; the shipped editor
  // keeps it beside the doc, in the draft record.
  const [sceneName, setSceneName] = useState("My first scene")
  const {
    canvasRef,
    engineRef,
    models,
    ready,
    bundleFile,
    loadVmdFile,
    loadVmdUrl,
    error,
    groupsByModel,
    addModelFromFiles,
    replaceModelFromFiles,
    removeModelById,
    stopAnimation,
    stages,
    addStageFromFiles,
    setStageTransform,
    setCameraView,
    applyGroups,
    upsertGroup,
    highlight,
    toggleVisible,
  } = useEngine(scene)

  // Motion names by model id. One clip per character is already the document's
  // shape (lib/scene.ts: "the model plus ITS motion clip"), so this holds the
  // name to show and nothing more — the engine owns the clip itself.
  //
  // SEEDED from the document, not discovered from loading: the doc names every
  // model's clip before a byte of VMD has parsed, and a row that says
  // "No animation" for the seconds until the loader confirms what the doc
  // already said is a flash of false state. The boot loader only corrects the
  // seed when a clip genuinely fails.
  //
  // Entries keep their SOURCE, not just a display name — that is what lets a
  // model replace re-apply the motion to the new engine instance (clips are
  // per instance), the way main's slots keep theirs.
  const [animByModel, setAnimByModel] = useState<Record<string, { name: string; src: File | string }>>(() => {
    const seed: Record<string, { name: string; src: File | string }> = {}
    for (const entry of scene.assets.models)
      if (entry.animation) seed[entry.model.id] = { name: entry.animation.name, src: entry.animation.url }
    return seed
  })
  const animRef = useRef(animByModel)
  useEffect(() => {
    animRef.current = animByModel
  })
  const vmdInput = useRef<HTMLInputElement | null>(null)
  // Which model the next .vmd pick lands on, set before the dialog opens.
  const animTarget = useRef<string | null>(null)
  const pickAnimation = (id: string) => {
    animTarget.current = id
    vmdInput.current?.click()
  }
  const removeAnimation = (id: string) => {
    stopAnimation(id)
    setAnimByModel((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // loadSceneInto deliberately leaves ANIMATED models hidden — it reveals only
  // the ones with no clip, so the first visible frame wears the motion's first
  // pose instead of flashing bind pose. Whatever loads the clips owns the
  // reveal, and in the shipped editor that lives in app/page.tsx. Without it the
  // model loads, styles, and never becomes visible.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      for (const entry of scene.assets.models) {
        const clip = entry.animation
        if (!clip) continue
        const packed = bundleFile(clip.url)
        const loaded = await (packed
          ? loadVmdFile(entry.model.id, packed)
          : loadVmdUrl(entry.model.id, clip.name, clip.url))
        if (cancelled) return
        setAnimByModel((prev) => {
          // Success upgrades the seed's src to what actually loaded (a bundled
          // File outlives its idb url); failure retracts the seed's claim.
          if (loaded) return { ...prev, [entry.model.id]: { name: clip.name, src: packed ?? clip.url } }
          const next = { ...prev }
          delete next[entry.model.id]
          return next
        })
        // Reveal even if the clip failed — a bind-pose model beats no model.
        engineRef.current?.setModelTransform(entry.model.id, { visible: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, scene, bundleFile, loadVmdFile, loadVmdUrl, engineRef])
  // Models that actually carry a clip — AnimPlayer drives the longest as master.
  const modelNames = useMemo(() => models.map((m) => m.id), [models])
  // First model carrying a clip — the clock for audio AND the export.
  const masterId = models.find((m) => animByModel[m.id])?.id ?? null
  // Clip duration, polled until the engine reports it (main's approach — meta
  // arrives whenever the VMD finishes parsing, so a one-shot read races it).
  // Keyed by owner instead of reset-on-change: a stale value simply stops
  // matching, so the effect never needs a synchronous zeroing write.
  const [duration, setDuration] = useState<{ owner: string | null; value: number }>({ owner: null, value: 0 })
  const masterClipName = masterId ? (animByModel[masterId]?.name ?? null) : null
  const durationOwner = masterId && masterClipName ? masterId + "\0" + masterClipName : null
  const animDuration = duration.owner !== null && duration.owner === durationOwner ? duration.value : 0
  useEffect(() => {
    if (!durationOwner || !masterId) return
    const timer = setInterval(() => {
      const d = engineRef.current?.getModel(masterId)?.getAnimationProgress().duration ?? 0
      if (d > 0) {
        setDuration({ owner: durationOwner, value: d })
        clearInterval(timer)
      }
    }, 300)
    return () => clearInterval(timer)
  }, [durationOwner, masterId, engineRef])

  // Export framing: letterbox preview, green screen, exporting — the shared
  // hook, because an export in flight must survive whatever the chrome does.
  const framing = useRenderFraming()
  const [exportOpen, setExportOpen] = useState(false)
  const exportZ = useZOrder(undefined, () => setExportOpen(false))
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const exportPct =
    exportProgress && exportProgress.phase === "video" && exportProgress.total > 0
      ? Math.round((exportProgress.frame / exportProgress.total) * 100)
      : null

  // Pin the canvas to the framed aspect while composing/exporting (main's own
  // effect): resize once, and only when the viewport genuinely cannot hold it.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (framing.exporting) return // the export pins the full output resolution itself
    if (framing.activeFrame && !framing.frameVp) return
    if (
      framing.activeFrame &&
      framing.frameVp &&
      framing.activeFrame.aspect > (framing.frameVp.w / framing.frameVp.h) * FRAME_ASPECT_TOL
    ) {
      const dpr = window.devicePixelRatio || 1
      engine.setRenderSize(
        Math.round(framing.frameVp.w * dpr),
        Math.round((framing.frameVp.w * dpr) / framing.activeFrame.aspect),
      )
    } else {
      engine.setRenderSize(null)
    }
  }, [framing.activeFrame, framing.frameVp, framing.exporting, ready, engineRef])
  // Frame rect in CSS pixels (the canvas fills the window; object-contain centres).
  const frameRect =
    framing.activeFrame && framing.frameVp
      ? (() => {
          const va = framing.frameVp.w / framing.frameVp.h
          const a = framing.activeFrame.aspect
          if (a <= va * FRAME_ASPECT_TOL && a >= va / FRAME_ASPECT_TOL)
            return { x: 0, y: 0, w: framing.frameVp.w, h: framing.frameVp.h }
          const w = a < va ? framing.frameVp.h * a : framing.frameVp.w
          const h = a < va ? framing.frameVp.h : framing.frameVp.w / a
          return { x: (framing.frameVp.w - w) / 2, y: (framing.frameVp.h - h) / 2, w, h }
        })()
      : null

  // Music follows the model clock — the exact mirror main uses, shared. Silent
  // while an export runs; the export mixes its own audio.
  const audioRef = useRef<HTMLAudioElement | null>(null)
  useAudioClock({
    engineRef,
    masterId,
    audioRef,
    disabled: framing.exporting,
  })

  // Only one row open at a time — that is what lets presets-then-parameters sit
  // inside a row without the stack becoming a wall of sliders.
  // The transport IS the timeline, collapsed. Same surface, same controls in the
  // same place — unfolding it must never feel like a different panel appeared.
  const [timelineOpen, setTimelineOpen] = useState(false)
  // The scene document already has cameraAnimation and audio slots. The camera
  // one the engine can load today, so it is wired rather than drawn.
  const [cameraClip, setCameraClip] = useState<string | null>(null)
  const cameraInput = useRef<HTMLInputElement | null>(null)
  const removeCamera = () => {
    engineRef.current?.clearCameraVmd()
    setCameraClip(null)
  }
  // Orbit framing, main's own model: the document's camera is the state, and
  // every edit goes through the hook's one applier — so the lab, the editor and
  // the viewer cannot drift on what a scene's camera means.
  const [camera, setCamera] = useState<SceneCamera>(scene.state.camera)
  const changeCamera = useCallback(
    (next: SceneCamera) => {
      setCamera(next)
      setCameraView(next)
    },
    [setCameraView],
  )
  // Orbit FOV in degrees; the engine default is π/4. A camera VMD animates fov
  // itself and the engine restores the orbit value when the clip releases, so
  // the slider only has to sit out while a camera clip is loaded.
  const [fovDeg, setFovDeg] = useState(45)
  const applyFov = (deg: number) => {
    setFovDeg(deg)
    // Optional call: the packaged engine's types predate setCameraFov — the
    // guard (and this cast) drop with the next engine install.
    const eng = engineRef.current as { setCameraFov?: (fov: number) => void } | null
    eng?.setCameraFov?.((deg * Math.PI) / 180)
  }
  // Depth of field, mirrored locally like FOV. Focus is ALWAYS automatic: the
  // engine tracks the character's own depth span every frame, which is both the
  // right answer and one nobody can dial in by hand while a dance moves. That
  // leaves one dial — how much blur — and the switch.
  const [dof, setDof] = useState({ enabled: false, aperture: 1 })
  const applyDof = (patch: Partial<typeof dof>) => {
    // Engine call OUTSIDE the state updater — updaters run twice in StrictMode.
    const next = { ...dof, ...patch }
    setDof(next)
    // Optional call, same story as setCameraFov above.
    const eng = engineRef.current as {
      setDepthOfField?: (p: { enabled: boolean; focusMode: "auto"; aperture: number }) => void
    } | null
    eng?.setDepthOfField?.({ enabled: next.enabled, focusMode: "auto", aperture: next.aperture })
  }
  // Registered now, audible later: the file lands in sceneFiles.audio — the
  // same slot the shipped editor reads — so the upload is real even though this
  // route has no audio clock yet to play it against.
  // Seeded from the scene document, exactly as main does — the default scene
  // ships with a track, and an empty music row under a dancing model would be
  // the chrome contradicting the scene. Uploads become object URLs, revoked on
  // the way out so replaced tracks do not pin their bytes for the session.
  const [musicClip, setMusicClip] = useState<{ name: string; url: string } | null>(() =>
    scene.assets.audio ? { name: scene.assets.audio.name, url: scene.assets.audio.url } : null,
  )
  const musicInput = useRef<HTMLInputElement | null>(null)
  const dropMusicUrl = (clip: { url: string } | null) => {
    if (clip?.url.startsWith("blob:")) URL.revokeObjectURL(clip.url)
  }
  const removeMusic = () => {
    sceneFiles.audio = null
    setMusicClip((prev) => {
      dropMusicUrl(prev)
      return null
    })
  }
  const [openRow, setOpenRow] = useState<string | null>(null)

  const stage = stages[0] ?? null
  const stageSummary = stage ? displayName(stage.file) : "Ground"
  // Controlled (not key-remounted): go-to deep-links need to land on a pane —
  // "Background" opens this row on its background tab.
  const [stageTab, setStageTab] = useState<"stage" | "ground" | "background">(stage ? "stage" : "ground")
  const [cameraTab, setCameraTab] = useState<"lens" | "focus">("lens")
  const [postTab, setPostTab] = useState<"grade" | "bloom">("grade")
  const [lightTab, setLightTab] = useState<"world" | "sun">("world")

  // Sun, world and glow — seeded from the document, which is ALSO what the
  // Engine constructor was handed, so the sliders open already agreeing with
  // the canvas. Edits make the same calls use-scene-sync would; the first run
  // is skipped because construction already applied these exact values (and a
  // redundant setSun dirties the shadow map for a full extra pass).
  // ONE settings object, applied by the SAME hook main and the viewer use.
  // The per-section local applies this replaces were honest scaffolding while
  // ownership was unaudited; the audit found the lab never applied the
  // background effect at all, so adopting use-scene-sync both consolidates the
  // apply layer and turns the document's effect on for the first time here.
  const [settings, setSettings] = useState<SceneSettings>(() => scene.state.settings)
  const patch = useCallback(
    <K extends keyof SceneSettings>(key: K, part: Partial<SceneSettings[K]>) =>
      setSettings((s2) => ({ ...s2, [key]: { ...s2[key], ...part } })),
    [],
  )
  const { sun, world, bloom, grade, ground, physics } = settings
  const [bgEffect, setBgEffect] = useState(scene.state.backgroundEffect)

  // Grade: main's full selection model. Drafts and community feed both the
  // quick list and NAME RESOLUTION — a scene applying a community grade must
  // resolve it the way the render will.
  const [gradeLibOpen, setGradeLibOpen] = useState(false)
  const { drafts: gradeDrafts } = useDrafts<GradeItem>("grade")
  const communityGrades = useCommunity<GradeItem>("grade")
  const appliedGradeDraftId = gradeDrafts.find((d) => d.name === grade.preset)?.id ?? null
  const gradeItems = useMemo(
    () => [
      ...quickPickItems(GRADE_PRESETS, gradeDrafts, appliedGradeDraftId).map((g) => ({
        id: g.name,
        label: g.name,
        section: g.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityGrades),
    ],
    [gradeDrafts, appliedGradeDraftId, communityGrades],
  )
  const pickGrade = useCallback(
    (name: string) => patch("grade", { preset: name, intensity: recallIntensity(name) }),
    [patch],
  )
  const appliedGradeSpec = useMemo(
    () => gradeSpec(grade.preset, [...gradeDrafts, ...communityGrades]),
    [grade.preset, gradeDrafts, communityGrades],
  )
  type UploadState =
    { kind: "pick"; files: File[]; paths: string[]; target: ModelTarget } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)

  // ONE background-image slot, filled from TWO rows. Detecting the kind from
  // the aspect ratio (2:1 ⇒ equirect) was tried and pulled: panoramas ship at
  // other ratios and flat art is sometimes exactly 2:1, so the guess was wrong
  // often enough that the user could not tell which mode they were in. Which
  // row you upload from is the answer — and the rows are mutually exclusive
  // because a scene has one background, not two.
  const bgImageInput = useRef<HTMLInputElement | null>(null)
  /** Set before the picker opens: does this upload fill the flat row or the 360 row? */
  const bgImageIsDome = useRef(false)
  const [bgImage, setBgImage] = useState<(BackdropMedia & { dome: boolean }) | null>(null)
  const swapBgImage = (next: (BackdropMedia & { dome: boolean }) | null) =>
    setBgImage((prev) => {
      releaseBackdrop(prev)
      return next
    })
  const pickBgImage = (dome: boolean) => {
    bgImageIsDome.current = dome
    bgImageInput.current?.click()
  }
  const onBgImagePicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const next = await probeBackdrop(file)
        swapBgImage({ ...next, dome: bgImageIsDome.current })
      } catch (e) {
        setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
      }
    },
    [],
  )

  useSceneSync({
    engineRef,
    ready,
    settings,
    gradeSpec: appliedGradeSpec,
    backgroundEffect: bgEffect,
    hasBackdrop: !!bgImage && !bgImage.dome,
    skybox: bgImage?.dome ? bgImage.file : null,
    greenScreen: framing.liveGreenScreen,
  })

  // Effects: the same selection model as grade, one library over.
  const [effectLibOpen, setEffectLibOpen] = useState(false)
  const { drafts: effectDrafts } = useDrafts<EffectItem>("effect")
  const communityEffects = useCommunity<EffectItem>("effect")
  const effectItems = useMemo(
    () => [
      ...quickPickItems(BACKGROUND_EFFECTS, effectDrafts, bgEffect?.id ?? null).map((e) => ({
        id: e.name,
        label: e.name,
        section: e.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityEffects),
    ],
    [effectDrafts, bgEffect, communityEffects],
  )

  const pickEffect = useCallback(
    (name: string) => {
      // Drafts and community rows carry their own shader — they apply by value.
      const own = [...effectDrafts, ...communityEffects].find((e) => e.name === name)
      if (own) {
        setBgEffect({ id: own.id, name: own.name, wgsl: own.payload.wgsl })
        return
      }
      // Straight from the definition — round-tripping a built-in through the
      // by-name lookup with its id is what made every built-in "unknown".
      const def = BACKGROUND_EFFECTS.find((e) => e.name === name)
      if (def) setBgEffect(applyDefaults(def))
    },
    [effectDrafts, communityEffects],
  )

  // Width of the top-right pill cluster, mirrored onto the right panels so the
  // column has ONE edge. Observed rather than hardcoded: the label is
  // translated and the account chip changes with sign-in state.
  const rightRailRef = useRef<HTMLDivElement>(null)
  const [rightRailWidth, setRightRailWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = rightRailRef.current
    if (!el) return
    const measure = () => setRightRailWidth(el.getBoundingClientRect().width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [expanded, setExpanded] = useState(true)
  // The dock joins the desktop stack the libraries already live in: clicking
  // (or tabbing into) it raises it over an open library, clicking the library
  // raises it back. No Escape closer — Escape keeps closing the topmost
  // LIBRARY; the stack walk skips surfaces that never close.
  const dockZ = useZOrder()
  const inspectorZ = useZOrder()

  // ── Inspect a cast member ──
  // Clicking a cast row selects the model and opens the right dock on ITS
  // style groups — the inspector is about what you picked. The real
  // MaterialsPanel mounts, not a lite copy: tree, drag-to-regroup, rename,
  // visibility, hover-highlight, per-group look QuickPick. Its two deep doors
  // (graph library, node editor) stay hidden until those surfaces port.
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const inspected = models.find((m) => m.id === inspectedId) ?? null
  // The inverted-hull outline pass, off by default since 0.25.2 and reachable
  // only by searching for it. Engine-global and not persisted yet; when
  // outlines earn a document field they get size, opacity and colour
  // overrides with it.
  //
  // The live value is a REF and the palette's On/Off hint is separate state,
  // for the same reason the recents order is staged rather than applied (see
  // openPalette): flipping it from the palette would otherwise rewrite the row
  // you just chose while the dialog is still fading out. The engine changes
  // now; the label catches up at the next open.
  const outlineRef = useRef(false)
  const [outlineShown, setOutlineShown] = useState(false)
  const applyOutline = useCallback(
    (on: boolean) => {
      outlineRef.current = on
      engineRef.current?.setOutlineEnabled(on)
    },
    [engineRef],
  )
  /** Open the materials inspector on a model — the cast row's own click, the
   *  row's Materials button and the palette all come through here, so the
   *  one-right-panel-at-a-time rule lives in exactly one place. */
  const openMaterials = useCallback((id: string | null) => {
    if (!id) return
    setExportOpen(false)
    setInspectedId(id)
  }, [])
  const inspectedGroups = useMemo(
    () => (inspectedId ? (groupsByModel[inspectedId] ?? []) : []),
    [groupsByModel, inspectedId],
  )
  const inspectGroupsApply = useCallback(
    (next: StyleGroup[]) => {
      if (inspectedId) void applyGroups(inspectedId, next)
    },
    [applyGroups, inspectedId],
  )
  const inspectCreateGroup = useCallback((): string => {
    const id = newGroupId("group", inspectedGroups)
    const labels = new Set(inspectedGroups.map((g) => g.label ?? g.id))
    let label = "New group"
    for (let n = 2; labels.has(label); n++) label = `New group ${n}`
    inspectGroupsApply([
      ...inspectedGroups,
      { id, label, materials: [], graph: structuredClone(DEFAULT_GRAPH), renderClass: "auto" },
    ])
    return id
  }, [inspectedGroups, inspectGroupsApply])
  const inspectRenameGroup = useCallback(
    (id: string, label: string) =>
      inspectGroupsApply(inspectedGroups.map((g) => (g.id === id ? { ...g, label: label.trim() || id } : g))),
    [inspectedGroups, inspectGroupsApply],
  )
  const inspectDeleteGroup = useCallback(
    (id: string) => {
      const g = inspectedGroups.find((x) => x.id === id)
      if (!g || g.renderClass === "eye" || g.renderClass === "hair") return // Eye/Hair are pinned
      inspectGroupsApply(inspectedGroups.filter((x) => x.id !== id))
    },
    [inspectedGroups, inspectGroupsApply],
  )
  const inspectMoveMaterial = useCallback(
    (material: string, targetId: string | null) => {
      const next = inspectedGroups.map((g) => ({ ...g, materials: g.materials.filter((m) => m !== material) }))
      if (targetId) {
        const target = next.find((g) => g.id === targetId)
        if (target) target.materials = [...target.materials, material]
      }
      inspectGroupsApply(next)
    },
    [inspectedGroups, inspectGroupsApply],
  )
  const inspectPickGraph = useCallback(
    (groupId: string, graphName: string) => {
      if (!inspectedId) return
      const entry = [...loadDrafts().graph, ...communityItems("graph"), ...GRAPH_LIBRARY].find(
        (e) => e.name === graphName,
      ) as GraphItem | undefined
      const group = inspectedGroups.find((g) => g.id === groupId)
      if (!entry || !group) return
      const updated: StyleGroup = { ...group, graph: { ...entry.payload.graph, name: entry.name } }
      // Grouped materials recompile through upsert; an EMPTY group has nothing
      // to compile and just records the choice — main's own split.
      if (updated.materials.length) void upsertGroup(inspectedId, updated)
      else inspectGroupsApply(inspectedGroups.map((x) => (x.id === groupId ? updated : x)))
    },
    [inspectedId, inspectedGroups, inspectGroupsApply, upsertGroup],
  )
  // ── Model upload ──
  // "Replace" is an upload too — same picker, same parsing, only the target
  // differs: a new slot, or an existing one that keeps its position and clip.
  // One path, so the two can never drift.
  type ModelTarget = { mode: "add" } | { mode: "replace"; id: string } | { mode: "stage" }
  const modelTarget = useRef<ModelTarget>({ mode: "add" })
  // Folder only. A zip needs a SECOND input, because an input carrying
  // `webkitdirectory` can only pick a directory — and offering both made add and
  // replace disagree about what an upload is, which no label repairs. One shape
  // everywhere. (The shipped editor does support zips, and must, since mobile
  // has no directory picker at all — that is a decision to make with the mobile
  // layout, not by bolting a second button onto this row.)
  const folderInput = useRef<HTMLInputElement>(null)
  // Same shape the shipped editor uses: one dialog covering "which .pmx?" and
  // "that did not load", because both are the upload failing to resolve to a
  // single model and the user only cares which one they are looking at.

  const pickModel = (target: ModelTarget) => {
    modelTarget.current = target
    folderInput.current?.click()
  }

  const loadPicked = async (files: File[], pmx: File, target: ModelTarget) => {
    setUpload(null)
    try {
      if (target.mode === "stage") {
        await addStageFromFiles(files, pmx)
        setStageTab("stage")
      }
      else if (target.mode === "replace") {
        const newId = await replaceModelFromFiles(target.id, files, pmx)
        adoptReplacedModel(target.id, newId)
      }
      else await addModelFromFiles(files, pmx)
    } catch (e) {
      setUpload({
        kind: "notice",
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const onModelPicked = async (list: File[]) => {
    if (!list.length) return
    const target = modelTarget.current
    let files: File[]
    try {
      // Folder contents arrive as many files; a zip as one. Either way this
      // flattens to the same list.
      files = await expandUploadFiles(list)
    } catch (e) {
      setUpload({
        kind: "notice",
        message: e instanceof Error ? e.message : String(e),
      })
      return
    }
    const pmx = files.filter((f) => f.name.toLowerCase().endsWith(".pmx"))
    if (pmx.length === 0) {
      setUpload({
        kind: "notice",
        message: "No .pmx found — keep the model's folder intact.",
      })
    } else if (pmx.length === 1) {
      await loadPicked(files, pmx[0], target)
    } else {
      // Several models in one folder (a costume pack, a stage set) — ask, do not
      // guess. Paths sorted so the same folder always lists the same way.
      setUpload({
        kind: "pick",
        files,
        paths: pmx.map(relFilePath).sort((a, b) => a.localeCompare(b)),
        target,
      })
    }
  }

  // ── Identity colour per model ──
  // Resolved once a model is in the scene, then cached by id. Async and
  // out-of-band on purpose: the row renders immediately on its name hash and
  // upgrades in place when the answer lands, so nothing waits on decoding
  // textures and nothing moves when it finishes.
  const [palettes, setPalettes] = useState<Record<string, CastPaletteId>>({})
  // Once per model id, tracked in a ref rather than read back from `palettes` —
  // state in the deps made every resolution re-run the effect, and the restart
  // raced its own in-flight pass: N models cost 2N−1 full extractions, the
  // extras discarded. Models kick off in parallel; castColour returns the
  // palette id directly, or null for a model it could not read (a bundled one,
  // say), which resolves to the neutral rather than shimmering forever.
  const castStarted = useRef(new Set<string>())
  /**
   * Replacing a model can mint a NEW id (ids come from the pmx filename), and a
   * fresh id would flash the skeleton while its colour re-extracts. Instead the
   * old id's palette transplants to the new one — the row repaints instantly in
   * the old colour, and a fresh extraction overwrites it in place.
   *
   * The motion transplants too, the way main's slots keep theirs: clips are per
   * engine instance, so the retained SOURCE re-applies to the new one, and the
   * entry is retracted only if that load genuinely fails.
   */
  const adoptReplacedModel = useCallback(
    (oldId: string, newId: string) => {
      castStarted.current.delete(oldId)
      castStarted.current.delete(newId)
      const clip = animRef.current[oldId]
      setAnimByModel((prev) => {
        if (!(oldId in prev) || oldId === newId) return prev
        const next = { ...prev }
        delete next[oldId]
        if (clip) next[newId] = clip
        return next
      })
      if (clip) {
        void (typeof clip.src === "string"
          ? loadVmdUrl(newId, clip.name, clip.src)
          : loadVmdFile(newId, clip.src)
        ).then((loaded) => {
          if (loaded) return
          setAnimByModel((prev) => {
            const next = { ...prev }
            delete next[newId]
            return next
          })
        })
      }
      setPalettes((prev) => {
        const old = prev[oldId]
        if (!old || oldId === newId) return prev
        const next = { ...prev }
        delete next[oldId]
        next[newId] = old
        return next
      })
    },
    [loadVmdFile, loadVmdUrl],
  )
  useEffect(() => {
    for (const m of models) {
      if (castStarted.current.has(m.id)) continue
      castStarted.current.add(m.id)
      const source = castSourceFor(m.id, scene, groupsByModel[m.id])
      void (source ? castColour(source) : Promise.resolve(null)).then((palette) =>
        // Unconditional: the started-set already dedupes, and a re-extraction
        // after a model replace must be able to overwrite the transplanted
        // colour it started from.
        setPalettes((p) => ({ ...p, [m.id]: palette ?? NEUTRAL_PALETTE })),
      )
    }
  }, [models, scene, groupsByModel])

  const [paletteOpen, setPaletteOpen] = useState(false)
  // Suggestions survive the session: what you reached for yesterday is still
  // the best predictor today. Stale ids (a renamed command) are filtered on
  // load rather than trusted.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]")
      return Array.isArray(stored) ? stored.filter((id): id is string => COMMANDS.some((c) => c.id === id)) : []
    } catch {
      return []
    }
  })
  // What the list WILL say next time, held back deliberately — see openPalette.
  const nextRecent = useRef<string[]>([])
  // Bumped on every open so the palette remounts with fresh query/selection.
  // Resetting them on CLOSE instead would re-filter a list that is still on
  // screen, which is the reshuffle-under-the-cursor this whole dance avoids.
  const [paletteSession, setPaletteSession] = useState(0)

  const openPalette = useCallback(() => {
    // Commit the pending order BEFORE the dialog is on screen. Applying it at
    // run time instead makes the item you just chose jump to the top of
    // Suggestions while the palette is still fading out — the list visibly
    // reshuffles under your cursor, which is the worst kind of UI motion:
    // change you did not ask to watch. Batched with the open, so the palette
    // simply appears already correct.
    if (nextRecent.current.length) setRecentIds(nextRecent.current)
    // Same rule for any row that prints its own state: catch the label up here,
    // never at run time.
    setOutlineShown(outlineRef.current)
    setPaletteSession((n) => n + 1)
    setPaletteOpen(true)
  }, [setPaletteOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openPalette()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openPalette])

  // Go-to: expand the dock, open the row, land on the right pane, scroll it
  // into view once the expansion has rendered.
  const gotoSection = useCallback(
    (
      target: string,
      tabs?: {
        stage?: "stage" | "ground" | "background"
        light?: "world" | "sun"
        camera?: "lens" | "focus"
        post?: "grade" | "bloom"
      },
    ) => {
      setExpanded(true)
      // A Scene row opens; a group anchor ("group-cast") only scrolls.
      const isRow = LAYERS.some((l) => l.id === target)
      if (isRow) setOpenRow(target)
      if (tabs?.stage) setStageTab(tabs.stage)
      if (tabs?.light) setLightTab(tabs.light)
      if (tabs?.camera) setCameraTab(tabs.camera)
      if (tabs?.post) setPostTab(tabs.post)
      const domId = isRow ? `layer-${target}` : target
      requestAnimationFrame(() =>
        document.getElementById(domId)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      )
    },
    [],
  )

  // The one row whose hint is state, not description: a toggle you reach only
  // by searching has to say which way it is currently pointing. Reads the
  // deferred copy, so the row never changes while you are looking at it.
  const paletteItems = useMemo(
    () => COMMANDS.map((c) => (c.id === "outline" ? { ...c, hint: outlineShown ? "On" : "Off" } : c)),
    [outlineShown],
  )

  const runCommand = useCallback(
    (item: PaletteItem) => {
      // Most recent first, no duplicates, five deep — enough to be useful
      // without the empty-query list becoming a second menu. Staged in a ref
      // rather than state so nothing re-renders while the dialog closes.
      const base = nextRecent.current.length ? nextRecent.current : recentIds
      nextRecent.current = [item.id, ...base.filter((id) => id !== item.id)].slice(0, 5)
      // Stored immediately even though the STATE commit waits for the next
      // open (the no-reshuffle rule) — a refresh must not lose the last run.
      try {
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecent.current))
      } catch {
        /* storage full or blocked — suggestions just stay session-local */
      }
      // Real commands, by id — the registry will own this table; until then the
      // page is the registry.
      if (item.id === "export") {
        setInspectedId(null)
        setExportOpen(true)
      }
      else if (item.id === "cast") gotoSection("group-cast")
      else if (item.id === "clips") gotoSection("group-clips")
      else if (item.id === "camera") gotoSection("camera")
      else if (item.id === "stage" || item.id === "upload-stage") gotoSection("stage", { stage: "stage" })
      else if (item.id === "ground") gotoSection("stage", { stage: "ground" })
      else if (item.id === "background") gotoSection("stage", { stage: "background" })
      else if (item.id === "effect") gotoSection("effect")
      else if (item.id === "post") gotoSection("post")
      else if (item.id === "light") gotoSection("light")
      else if (item.id === "world") gotoSection("light", { light: "world" })
      else if (item.id === "sun") gotoSection("light", { light: "sun" })
      else if (item.id === "physics") gotoSection("physics")
      // Whichever model is already inspected, else the primary — the panel is
      // per-model and picking one for you beats opening on nothing.
      else if (item.id === "materials") openMaterials(inspectedId ?? models[0]?.id ?? null)
      else if (item.id === "outline") applyOutline(!outlineRef.current)
      else if (item.id.startsWith("ctl-")) {
        const c = DOCK_CONTROLS.find((x) => `ctl-${x.id}` === item.id)
        if (!c) return
        gotoSection(c.row, { stage: c.stageTab, light: c.lightTab, camera: c.cameraTab, post: c.postTab })
      }
      item.run?.()
    },
    [recentIds, gotoSection, openMaterials, inspectedId, models, applyOutline],
  )

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      {/* Full bleed, always. Chrome floats over it; nothing ever shrinks the
          thing you are making. */}
      {bgImage && !bgImage.dome && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bgImage.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}

      {frameRect && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute bg-black/45" style={{ left: 0, right: 0, top: 0, height: frameRect.y }} />
          <div className="absolute bg-black/45" style={{ left: 0, right: 0, bottom: 0, height: frameRect.y }} />
          <div className="absolute bg-black/45" style={{ left: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }} />
          <div className="absolute bg-black/45" style={{ right: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }} />
          {/* Capture-tool convention: amber = framed (composing), red = recording. */}
          <div
            className={cn("absolute rounded-sm border", framing.exporting ? "border-red-500/90" : "border-amber-400/80")}
            style={{ left: frameRect.x, top: frameRect.y, width: frameRect.w, height: frameRect.h }}
          />
        </div>
      )}

      {/* ── Top bar ──
          Right cluster only. The brand belongs to the stack while the stack is
          open — BrandPill's own asHeader/collapsed split, which is also what
          stops a pill and a panel of different widths sitting on top of each
          other. */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-start gap-2">
        {/* Same 17rem as the open panel: this is a DROPDOWN, not a sidebar —
            expanding only grows downward, so nothing ever shifts sideways. */}
        {!expanded && (
          <div className={cn(PILL, "pointer-events-auto flex h-10 w-[18rem] items-center gap-1.5 pr-1.5 pl-2")}>
            <span className="flex size-7 shrink-0 items-center justify-center text-pink-400">
              <WandSparkles className="size-4.5" />
            </span>
            <span className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground">
              Reze Design
            </span>
            {/* Lands exactly where the version badge sits in the expanded header,
                so the slot after the wordmark does not shift as you toggle. The
                badge is gap-1.5 from the wordmark with px-1.5 inside and no
                border; the name box carries a 1px transparent border (that is
                what stops its text jumping when it becomes editable), so it
                needs the same px-1.5 and one pixel back to put the two glyph
                runs in the same place. */}
            <SceneName name={sceneName} onRename={setSceneName} className="-ml-px min-w-0 flex-1 truncate px-1.5" />
            {/* Chevron, not a panel icon: it points where the content will go,
                the same law as the timeline's toggle. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(true)}
              aria-label="Expand panel"
              className="ml-auto size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        )}

        <span className="flex-1" />

        {/* All three pills state h-10 rather than deriving it from contents.
            Derived heights agreed only while every pill happened to hold size-7
            children — one control with a different variant height and they
            silently disagree, which is exactly what happened here. */}
        {/* Two pills, as the study has them: the palette stands on its own, and
            account + Share stay paired the way TopRightCluster already pairs
            them. The palette needs a visible door — keyboard-only would hide it
            from exactly the people most likely to miss it, and it is the only
            route on touch. */}
        {/* The button IS the pill — a wrapper around a single control leaves a
            ring of padding the hover cannot reach. h-10 matches the other pills,
            whose height comes from py-1.5 around size-7 contents. */}
        {/* Measured, not guessed: the right panels take their width from this
            cluster, and the cluster's width is its contents (a localized label
            and a key cap). 18rem was close and therefore wrong — a few pixels
            of overhang reads as a misalignment, which is worse than an obvious
            difference. */}
        <div ref={rightRailRef} className="flex items-start gap-2">
        <Button
          variant="ghost"
          onClick={openPalette}
          className={cn(
            PILL,
            "pointer-events-auto h-10 gap-2 px-3.5 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          Search commands
          {/* A key cap, so it should read as one: fixed height, centred, and the
              two glyphs spaced by a real gap rather than letter-spacing — which
              adds its space AFTER the K and pushes the pair off-centre. */}
          <kbd className="inline-flex h-5 min-w-[1.625rem] items-center justify-center gap-[3px] rounded-md border border-white/15 bg-white/[0.06] px-1 font-mono text-xs leading-none text-muted-foreground">
            <span className="text-sm">⌘</span>
            <span>K</span>
          </kbd>
        </Button>

        <div className={cn(PILL, "pointer-events-auto flex h-10 items-center gap-2 px-1.5")}>
          <AccountButton />
          <Button
            size="sm"
            className="h-7 rounded-lg bg-blue-400 px-3 text-xs font-medium text-white hover:bg-blue-300"
          >
            Share
          </Button>
        </div>
        </div>
      </div>

      {/* Which .pmx, or why it failed — the shipped editor's dialog, reused
          rather than reinvented. */}
      <Dialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)}>
        <DialogContent className="max-w-sm rounded-xl border-line-strong bg-surface-raised backdrop-blur-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {upload?.kind === "pick" ? "Which model?" : "Couldn't load that"}
            </DialogTitle>
          </DialogHeader>
          {upload?.kind === "pick" ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {upload.paths.map((path) => (
                <button
                  key={path}
                  className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 hover:text-foreground"
                  onClick={() => {
                    const pmx = upload.files.find((f) => relFilePath(f) === path)
                    if (pmx) void loadPicked(upload.files, pmx, upload.target)
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{upload?.kind === "notice" ? upload.message : null}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset on change, so picking the same folder twice still fires. */}
      <input
        ref={folderInput}
        type="file"
        multiple
        // @ts-expect-error — non-standard, and the only way to pick a directory.
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          void onModelPicked(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />

      <audio
        ref={audioRef}
        src={musicClip?.url || undefined}
        preload="auto"
        playsInline
        className="hidden"
      />

      <input
        ref={bgImageInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          void onBgImagePicked(file)
        }}
      />

      <input
        ref={musicInput}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          sceneFiles.audio = file
          setMusicClip((prev) => {
            dropMusicUrl(prev)
            return { name: file.name, url: URL.createObjectURL(file) }
          })
        }}
      />

      <input
        ref={cameraInput}
        type="file"
        accept=".vmd"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          void file.arrayBuffer().then((buf) => {
            engineRef.current?.loadCameraVmdFromBuffer(buf)
            setCameraClip(file.name)
          })
        }}
      />

      <input
        ref={vmdInput}
        type="file"
        accept=".vmd"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const id = animTarget.current
          e.target.value = ""
          if (!file || !id) return
          void loadVmdFile(id, file).then((name) => {
            if (name) setAnimByModel((prev) => ({ ...prev, [id]: { name, src: file } }))
          })
        }}
      />

      <GradeLibrary
        open={gradeLibOpen}
        onOpenChange={setGradeLibOpen}
        grade={grade}
        onApplyPreset={pickGrade}
        onRenamed={(oldName, newName) =>
          setSettings((s2) =>
            s2.grade.preset === oldName ? { ...s2, grade: { ...s2.grade, preset: newName } } : s2,
          )
        }
      />

      <BackgroundLibrary
        open={effectLibOpen}
        onOpenChange={setEffectLibOpen}
        applied={bgEffect}
        onApply={setBgEffect}
        onRemove={() => setBgEffect(null)}
        onRenamed={(oldName, newName) =>
          setBgEffect((e) => (e?.name === oldName ? { ...e, name: newName } : e))
        }
      />

      <CommandPalette
        key={paletteSession}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        recentIds={recentIds}
        onRun={runCommand}
      />

      {/* ── The stack ── */}
      {expanded && (
        <Surface
          placement="float"
          // Hugs its rows, capped at the viewport minus its own insets. The old
          // 5.5rem reserve cleared a transport that CENTRED under the dock; the
          // timeline's side insets ended that overlap, so the reserve was only
          // clipping rows short — a half-visible Physics row at the bottom edge.
          className={cn("top-3 left-3 flex max-h-[calc(100%-1.5rem)] w-[18rem] flex-col overflow-hidden")}
          style={{ zIndex: dockZ.z }}
          onPointerDownCapture={dockZ.onPointerDownCapture}
          onFocusCapture={dockZ.onFocusCapture}
        >
          {/* BrandPill's asHeader form: wordmark + version + toggle on one line,
            the scene name under it. Same paddings, so the header reads as part
            of the panel rather than a pill that wandered into it. */}
          {/* -mt-px is not a nudge, it is the border. The collapsed pill states
              h-10, and h-10 is border-box, so its own 1px border eats into the
              40 and leaves 38 for the row — icon top lands 6px below the pill's
              outer edge. Here the row derives 40 from py-1.5 around size-7 with
              the panel's border OUTSIDE it, so the same icon lands at 7. One
              pixel, and the wordmark visibly steps as you toggle. */}
          <div className="-mt-px flex w-full shrink-0 flex-col leading-tight">
            {/* Identical geometry to the collapsed pill's row — same gap-1.5, same
              py-1.5 pl-2, same size-7 logo slot. The slot is what sets the row
              height, so the wordmark lands on the SAME baseline whether the
              panel is open or closed and nothing shifts as you toggle. */}
            <div className="flex items-center gap-1.5 py-1.5 pr-1.5 pl-2">
              <span className="flex size-7 shrink-0 items-center justify-center text-pink-400">
                <WandSparkles className="size-4.5" />
              </span>
              <span className="truncate pb-0.5 text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
              <span className="shrink-0 rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[11px] leading-none font-medium tracking-wide text-blue-400">
                0.4.0 beta
              </span>
              {/* Same as the timeline chevron: the glyph already shows the panel
                  closing, so a tip repeating it is only latency. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpanded(false)}
                aria-label="Collapse panel"
                className="ml-auto size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
              >
                <ChevronUp className="size-4" />
              </Button>
            </div>
            {/* Pulled up under the wordmark past the 6px of bottom padding the
                row above owns and cannot give back — that padding is what makes
                its height match the collapsed pill, so it can only be cancelled
                from here. The extra 2px eats into that row's leading, which it
                has to spare: the wordmark is text-sm in a size-7 slot. */}
            <div className="-mt-2 flex min-w-0 items-center pl-[calc(0.5rem+1.75rem+0.375rem)]">
              {/* -ml-1 cancels the name box's own px-1, so the text still starts
                  exactly under the wordmark while the box keeps the padding its
                  editing state needs. */}
              <SceneName name={sceneName} onRename={setSceneName} className="-ml-1 truncate" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <StackGroup
              label="Cast"
              domId="group-cast"
              action={
                <CastAction
                  icon={Plus}
                  compact
                  label="Add model"
                  onClick={() => pickModel({ mode: "add" })}
                />
              }
            >
              {!ready && <CastRowSkeleton />}
              {/* The row appears WITH the model — same commit as `models`, so
                  the canvas and the dock move as one. Only the swatch pends:
                  extraction takes a few hundred ms, and a whole-row skeleton
                  made every load feel like two arrivals. The square upgrades in
                  place; nothing else moves. */}
              {models.map((m) => (
                  // Two lines, one character, and a hover EACH. The swatch sits
                  // outside both regions and centres against the pair — it
                  // identifies the model, it is not something you act on. Each
                  // line lights up alone with its own action pair, so what the ⟳
                  // will replace is always exactly the thing under the pointer.
                  //
                  // The motion is the subheadline because it is per-model — the
                  // document's own shape ("the model plus ITS motion clip").
                  // Camera and music are scene-wide and live in Clips; in a flat
                  // list, motion rows would bind to their models by row order
                  // alone, which is the kind of invisible convention that breaks
                  // at three models.
                  <div
                    key={m.id}
                    // Not a button: materials open from the palette alone, so a
                    // whole-row click target would promise an edit surface the
                    // row does not own. The tint still marks which model the
                    // open panel is editing.
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-1.5 transition-colors",
                      inspectedId === m.id && "bg-white/[0.06]",
                    )}
                  >
                    {palettes[m.id] ? (
                      <CastSwatch palette={palettes[m.id]} />
                    ) : (
                      <Skeleton className="size-6 shrink-0 rounded-interior" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <CastLine
                        text={
                          <span className="min-w-0 flex-1 truncate text-sm">{displayName(m.file)}</span>
                        }
                        actions={
                          <>
                            <CastAction
                              icon={RefreshCw}
                              label={`Upload model folder to replace ${displayName(m.file)}`}
                              onClick={() => pickModel({ mode: "replace", id: m.id })}
                            />
                            <CastAction
                              icon={X}
                              danger
                              label={`Delete ${displayName(m.file)}`}
                              onClick={() => removeModelById(m.id)}
                            />
                          </>
                        }
                      />
                      <CastLine
                        text={
                          animByModel[m.id] ? (
                            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                              {animByModel[m.id].name}
                            </span>
                          ) : (
                            <UploadInvite
                              label="Upload animation"
                              onClick={() => pickAnimation(m.id)}
                              aria={`Upload animation for ${displayName(m.file)}`}
                            />
                          )
                        }
                        actions={
                          <>
                            <CastAction
                              icon={animByModel[m.id] ? RefreshCw : Upload}
                              label={`${animByModel[m.id] ? "Replace" : "Upload"} animation for ${displayName(m.file)}`}
                              onClick={() => pickAnimation(m.id)}
                            />
                            <CastAction
                              icon={X}
                              danger
                              disabled={!animByModel[m.id]}
                              label={`Delete animation on ${displayName(m.file)}`}
                              onClick={() => removeAnimation(m.id)}
                            />
                          </>
                        }
                      />
                    </span>
                  </div>
                ))}
              {/* Only when there is no cast. With rows on screen the + in the
                  group label is enough, and a standing row for something you use
                  once per scene costs more than it returns. With NOTHING on
                  screen there is nothing to hover, and an affordance you have to
                  find by waving the cursor around an empty panel is not an
                  affordance. */}
              {ready && models.length === 0 && (
                <div className="flex justify-center py-1">
                  <Button
                    variant="ghost"
                    onClick={() => pickModel({ mode: "add" })}
                    className="h-7 gap-1.5 rounded-interior px-2.5 text-xs font-normal text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                  >
                    <Plus className="size-4" />
                    Add model
                  </Button>
                </div>
              )}
            </StackGroup>

            {/* The SCENE-WIDE clips. All five MMD components keep visible
                intakes in the dock — model and motion on the cast rows, stage
                on its Scene row — and the two with no owner land here. The
                timeline lanes show WHEN these play; this is where they load. */}
            <StackGroup label="Clips" domId="group-clips">
              <ClipRow
                icon={Video}
                clip={cameraClip}
                empty="Upload camera motion"
                kind="camera motion"
                onPick={() => cameraInput.current?.click()}
                onRemove={removeCamera}
              />
              <ClipRow
                icon={Music}
                clip={musicClip?.name ?? null}
                empty="Upload music"
                kind="music"
                onPick={() => musicInput.current?.click()}
                onRemove={removeMusic}
              />
            </StackGroup>

            <StackGroup label="Scene">
              {LAYERS.map((l) => (
                <LayerRow
                  key={l.id}
                  domId={`layer-${l.id}`}
                  icon={l.icon}
                  name={l.name}
                  summary={
                    l.id === "camera"
                      ? `${fovDeg}°`
                      : l.id === "stage"
                        ? stageSummary
                        : l.id === "effect"
                          ? (bgEffect?.name ?? "None")
                          : l.id === "post"
                            ? grade.preset
                            : undefined
                  }
                  open={openRow === l.id}
                  onToggle={() => setOpenRow((r) => (r === l.id ? null : l.id))}
                >
                  {l.id === "stage" ? (
                    // Tabs NAVIGATE between the two floors — they never act.
                    // The engine owns the real rule (a stage suppresses the
                    // ground), so the ground pane greys under a stage instead
                    // of a tab click ever deleting anything. Keyed so loading a
                    // stage lands you on its pane.
                    <Tabs value={stageTab} onValueChange={(v) => setStageTab(v as typeof stageTab)}>
                      {/* Full-width and pulled up under the title: it is a badge
                          that switches panes, not a control in the pane. */}
                      <TabsList className="-mt-1 mb-2 w-full">
                        <TabsTrigger value="stage" className="flex-1">Stage</TabsTrigger>
                        <TabsTrigger value="ground" className="flex-1">Ground</TabsTrigger>
                        <TabsTrigger value="background" className="flex-1">Background</TabsTrigger>
                      </TabsList>
                      <TabsContent value="stage">
                        {stage ? (
                          <>
                            <CastLine
                              text={
                                <span className="min-w-0 flex-1 truncate text-[13px]">
                                  {displayName(stage.file)}
                                </span>
                              }
                              actions={
                                <>
                                  <CastAction
                                    icon={RefreshCw}
                                    label={`Upload stage PMX folder to replace ${displayName(stage.file)}`}
                                    onClick={() => pickModel({ mode: "stage" })}
                                  />
                                  <CastAction
                                    icon={X}
                                    danger
                                    label={`Delete stage ${displayName(stage.file)}`}
                                    onClick={() => removeModelById(stage.id)}
                                  />
                                </>
                              }
                            />
                            <SliderRow
                              label="Scale"
                              value={stage.transform.scale}
                              min={0.05}
                              max={10}
                              step={0.05}
                              onChange={(v) => setStageTransform(stage.id, { scale: v })}
                              fmt={(v) => `${v.toFixed(2)}×`}
                            />
                            {(["X", "Y", "Z"] as const).map((axis, i) => (
                              <SliderRow
                                key={axis}
                                label={`Pos ${axis}`}
                                value={stage.transform.position[i]}
                                min={-50}
                                max={50}
                                step={0.5}
                                onChange={(v) => {
                                  const position = [...stage.transform.position] as [number, number, number]
                                  position[i] = v
                                  setStageTransform(stage.id, { position })
                                }}
                                fmt={(v) => v.toFixed(1)}
                              />
                            ))}
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => pickModel({ mode: "stage" })}
                            className="h-8 w-full rounded-interior border border-dashed border-line-strong text-xs font-normal text-muted-foreground hover:border-blue-400/50 hover:bg-transparent hover:text-blue-400"
                          >
                            Upload stage PMX folder
                          </Button>
                        )}
                      </TabsContent>
                      <TabsContent value="ground">
                        {stage && (
                          <p className="mb-2 text-[11px]">The stage overrides the ground while it is loaded.</p>
                        )}
                        <fieldset
                          disabled={!!stage}
                          className={cn(stage && "pointer-events-none opacity-40")}
                        >
                          <ColorRow label="Color" value={ground.color} onChange={(hex) => patch("ground", { color: hex })} />
                          <SliderRow
                            label="Opacity"
                            value={ground.opacity}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) => patch("ground", { opacity: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                          {/* Shadow persists below opacity (shadow catcher) — this
                              turns it off entirely. */}
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className="text-xs">Shadow</span>
                            <Switch size="sm" checked={ground.shadow} onCheckedChange={(v) => patch("ground", { shadow: v })} />
                          </div>
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className="text-xs">Grid lines</span>
                            <div className="flex items-center gap-2">
                              {ground.gridEnabled && (
                                <ColorField value={ground.grid} onChange={(hex) => patch("ground", { grid: hex })} />
                              )}
                              <Switch size="sm" checked={ground.gridEnabled} onCheckedChange={(v) => patch("ground", { gridEnabled: v })} />
                            </div>
                          </div>
                        </fieldset>
                      </TabsContent>
                      {/* Background is stage dressing too — that is the filing
                          rule that puts it in this row. Colour, and ONE image
                          slot that detects its own kind: flat behind the scene,
                          or a 360° dome at 2:1. The WGSL effect moved to its
                          own Effect row — it is no longer background-only. */}
                      <TabsContent value="background">
                        <ColorRow
                          label="Color"
                          value={settings.background.color}
                          onChange={(hex) => patch("background", { color: hex })}
                        />
                        {/* Colour, Image and 360° share one grid: mt-2.5, h-5,
                            value flush at the right edge. The filled row's ✕ is
                            a compact inline action, not a hover reserve — one
                            always-relevant button does not earn 48px of blank
                            right margin that breaks the column.
                            Two rows, one slot: filling either empties the other,
                            so the kind is something you SAY, never something the
                            app guesses from the file. */}
                        {(
                          [
                            { dome: false, label: "Image", kind: "background image" },
                            { dome: true, label: "360°", kind: "360° background" },
                          ] as const
                        ).map((row) => {
                          const filled = bgImage && bgImage.dome === row.dome ? bgImage : null
                          return (
                            <div key={row.label} className="mt-2.5 flex h-5 min-w-0 items-center gap-2">
                              <span className="shrink-0 text-xs">{row.label}</span>
                              {filled ? (
                                <>
                                  <span className="ml-auto min-w-0 truncate text-right text-xs text-muted-foreground">
                                    {filled.name}
                                  </span>
                                  <CastAction
                                    icon={RefreshCw}
                                    compact
                                    label={`Replace ${row.kind}`}
                                    onClick={() => pickBgImage(row.dome)}
                                  />
                                  <CastAction
                                    icon={X}
                                    danger
                                    compact
                                    label={`Remove ${row.kind}`}
                                    onClick={() => swapBgImage(null)}
                                  />
                                </>
                              ) : (
                                <span className="ml-auto flex min-w-0 justify-end">
                                  <UploadInvite
                                    label="Upload image"
                                    onClick={() => pickBgImage(row.dome)}
                                    aria={`Upload ${row.kind}`}
                                    className="text-right text-xs"
                                  />
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </TabsContent>
                    </Tabs>
                  ) : l.id === "effect" ? (
                    // Grade's own body shape: quick-pick on the value text,
                    // the library door as the deliberate final action. "Preset"
                    // as the inner label — the row already says Effect.
                    <>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-xs">Preset</span>
                        <QuickPick
                          value={bgEffect?.name ?? null}
                          items={effectItems}
                          onPick={pickEffect}
                          placeholder="None"
                        />
                      </div>
                      <div className="mt-2.5 flex justify-center">
                        <button
                          onClick={() => setEffectLibOpen(true)}
                          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
                        >
                          <Palette className="size-3.5" />
                          Library
                        </button>
                      </div>
                    </>
                  ) : l.id === "light" ? (
                    <>
                      {/* World | Sun as tabs, the Stage row's own pattern — the
                          two sources stacked ran the dock past the viewport,
                          and a scrolling dock is worse than a second click.
                          World first: the ambient wash is the broader stroke.
                          Glow sits BELOW the tabs — bloom belongs to neither
                          source, and it is Bloom's whole surviving surface. */}
                      <Tabs value={lightTab} onValueChange={(v) => setLightTab(v as typeof lightTab)}>
                        <TabsList className="-mt-1 mb-2 w-full">
                          <TabsTrigger value="world" className="flex-1">World</TabsTrigger>
                          <TabsTrigger value="sun" className="flex-1">Sun</TabsTrigger>
                        </TabsList>
                        <TabsContent value="world">
                          <ColorRow label="Color" value={world.color} onChange={(hex) => patch("world", { color: hex })} />
                          <SliderRow
                            label="Strength"
                            value={world.strength}
                            min={0}
                            max={2}
                            step={0.01}
                            onChange={(v) => patch("world", { strength: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                        </TabsContent>
                        <TabsContent value="sun">
                          <ColorRow label="Color" value={sun.color} onChange={(hex) => patch("sun", { color: hex })} />
                          <SliderRow
                            label="Strength"
                            value={sun.strength}
                            min={0}
                            max={6}
                            step={0.05}
                            onChange={(v) => patch("sun", { strength: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                          <SliderRow
                            label="Azimuth"
                            value={sun.azimuth}
                            min={0}
                            max={360}
                            step={1}
                            onChange={(v) => patch("sun", { azimuth: v })}
                            fmt={(v) => `${v.toFixed(0)}°`}
                          />
                          <SliderRow
                            label="Elevation"
                            value={sun.elevation}
                            min={0}
                            max={90}
                            step={1}
                            onChange={(v) => patch("sun", { elevation: v })}
                            fmt={(v) => `${v.toFixed(0)}°`}
                          />
                        </TabsContent>
                      </Tabs>
                    </>
                  ) : l.id === "post" ? (
                    // The two passes the camera applies to a finished frame,
                    // one per tab — the same shape Environment and Light use.
                    // Grade leads: it is the one every scene touches.
                    <Tabs value={postTab} onValueChange={(v) => setPostTab(v as typeof postTab)}>
                      <TabsList className="-mt-1 mb-2 w-full">
                        <TabsTrigger value="grade" className="flex-1">Grade</TabsTrigger>
                        <TabsTrigger value="bloom" className="flex-1">Bloom</TabsTrigger>
                      </TabsList>
                      <TabsContent value="grade">
                        {/* Main's own selection model, whole: quick-switch on the
                            value text (built-ins · community · your drafts), the
                            full library behind a Browse row at the BOTTOM of the
                            body rather than on the section header — and no
                            "Browse all…" inside the quick list, because a door
                            two lines under another door is clutter. */}
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="shrink-0 text-xs">Preset</span>
                          <QuickPick value={grade.preset} items={gradeItems} onPick={pickGrade} placeholder={grade.preset} />
                        </div>
                        {/* Intensity is remembered PER grade, so switching looks
                            restores the strength you last used. Neutral is
                            identity — nothing to scale. */}
                        <div className={cn("mt-1", grade.preset === "Neutral" && "pointer-events-none opacity-40")}>
                          <SliderRow
                            label="Intensity"
                            value={grade.intensity}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) => {
                              patch("grade", { intensity: v })
                              rememberIntensity(grade.preset, v)
                            }}
                            fmt={(v) => v.toFixed(2)}
                          />
                        </div>
                        {/* Main's own library-door pill, centred as the body's
                            deliberate final action — same mark, same meaning. */}
                        <div className="mt-2.5 flex justify-center">
                          <button
                            onClick={() => setGradeLibOpen(true)}
                            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
                          >
                            <Palette className="size-3.5" />
                            Library
                          </button>
                        </div>
                      </TabsContent>
                      {/* No on/off: intensity 0 IS off — useSceneSync maps it to
                          enabled:false and the pyramid is skipped entirely. The
                          three that change the look, in the order you reach for
                          them: how much, what qualifies, how far it spreads. */}
                      <TabsContent value="bloom">
                        <SliderRow
                          label="Intensity"
                          value={bloom.intensity}
                          min={0}
                          max={1}
                          step={0.005}
                          onChange={(v) => patch("bloom", { intensity: v })}
                          fmt={(v) => v.toFixed(3)}
                        />
                        <SliderRow
                          label="Threshold"
                          value={bloom.threshold}
                          min={0}
                          max={2}
                          step={0.01}
                          onChange={(v) => patch("bloom", { threshold: v })}
                          fmt={(v) => v.toFixed(2)}
                        />
                        {/* Tent-filter sample scale in texels (engine clamps at
                            0.5); 4 is the EEVEE-ish default the scene ships. */}
                        <SliderRow
                          label="Radius"
                          value={bloom.radius}
                          min={0.5}
                          max={8}
                          step={0.1}
                          onChange={(v) => patch("bloom", { radius: v })}
                          fmt={(v) => v.toFixed(1)}
                        />
                      </TabsContent>
                    </Tabs>
                  ) : l.id === "physics" ? (
                    // Always simulating — no on/off. Main's own controls, whole.
                    <>
                      <SliderRow
                        label="Gravity"
                        value={physics.gravity}
                        min={0}
                        max={200}
                        step={1}
                        onChange={(v) => patch("physics", { gravity: v })}
                        fmt={(v) => v.toFixed(0)}
                      />
                      <SliderRow
                        label="Wind"
                        value={physics.wind}
                        min={0}
                        max={WIND_MAX}
                        step={1}
                        onChange={(v) => patch("physics", { wind: v })}
                        fmt={(v) => v.toFixed(0)}
                      />
                      {/* Rendered always, disabled while there is no air to
                          move — main's own rule: mounting rows when wind leaves
                          zero shifts everything under the cursor. Frequency
                          rides the geometric mapping, same as main. */}
                      <SliderRow
                        label="Frequency"
                        value={windSliderFromFreq(physics.windFrequency)}
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={physics.wind === 0}
                        onChange={(v) => patch("physics", { windFrequency: windFreqFromSlider(v) })}
                        fmt={(v) => windFreqFromSlider(v).toFixed(2)}
                      />
                      <SliderRow
                        label="Direction"
                        value={physics.windAzimuth}
                        min={0}
                        max={360}
                        step={1}
                        disabled={physics.wind === 0}
                        onChange={(v) => patch("physics", { windAzimuth: v })}
                        fmt={(v) => `${v.toFixed(0)}°`}
                      />
                    </>
                  ) : (
                    // Camera: Lens (the shot) | Focus (depth of field), the
                    // Environment row's own tab pattern.
                    <Tabs value={cameraTab} onValueChange={(v) => setCameraTab(v as typeof cameraTab)}>
                      <TabsList className="-mt-1 mb-2 w-full">
                        <TabsTrigger value="lens" className="flex-1">Lens</TabsTrigger>
                        <TabsTrigger value="focus" className="flex-1">Focus</TabsTrigger>
                      </TabsList>
                      <TabsContent value="lens">
                        {/* Same shape as the ground-under-stage pane: a loaded
                            camera VMD owns the shot, so the orbit controls grey
                            out under a one-line note instead of fighting it. */}
                        {cameraClip && (
                          <p className="mb-2 text-[11px]">The camera motion drives the view while it is loaded.</p>
                        )}
                        <fieldset disabled={!!cameraClip} className={cn(cameraClip && "pointer-events-none opacity-40")}>
                          {/* Follow first — it decides what the three numbers at
                              the bottom MEAN (offset from a bone vs a point in
                              the world), so each direction re-seeds its own
                              default rather than reinterpreting the other's. */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs">Follow character</span>
                            <Switch
                              size="sm"
                              checked={!!camera.follow}
                              onCheckedChange={(on) =>
                                changeCamera({
                                  ...camera,
                                  follow: on ? FOLLOW_BONE : null,
                                  target: [...(on ? FOLLOW_OFFSET_DEFAULT : TARGET_DEFAULT)] as [
                                    number,
                                    number,
                                    number,
                                  ],
                                })
                              }
                            />
                          </div>
                          <SliderRow
                            label="FOV"
                            value={fovDeg}
                            min={10}
                            max={120}
                            step={1}
                            onChange={applyFov}
                            fmt={(v) => `${Math.round(v)}°`}
                          />
                          <SliderRow
                            label="Distance"
                            value={camera.distance}
                            min={1}
                            max={100}
                            step={0.1}
                            onChange={(v) => changeCamera({ ...camera, distance: v })}
                            fmt={(v) => v.toFixed(1)}
                          />
                          {/* Degrees here, radians in the document. Alpha wraps
                              the full turn; beta stays off the poles. */}
                          <SliderRow
                            label="Angle H"
                            value={Math.round((camera.alpha * 180) / Math.PI)}
                            min={-180}
                            max={180}
                            step={1}
                            onChange={(v) => changeCamera({ ...camera, alpha: (v * Math.PI) / 180 })}
                            fmt={(v) => `${v}°`}
                          />
                          <SliderRow
                            label="Angle V"
                            value={Math.round((camera.beta * 180) / Math.PI)}
                            min={5}
                            max={175}
                            step={1}
                            onChange={(v) => changeCamera({ ...camera, beta: (v * Math.PI) / 180 })}
                            fmt={(v) => `${v}°`}
                          />
                          {(["X", "Y", "Z"] as const).map((axis, i) => (
                            <SliderRow
                              key={axis}
                              label={`${camera.follow ? "Offset" : "Target"} ${axis}`}
                              value={camera.target[i]}
                              min={i === 1 ? -10 : -50}
                              max={50}
                              step={0.1}
                              onChange={(v) => {
                                const target = [...camera.target] as [number, number, number]
                                target[i] = v
                                changeCamera({ ...camera, target })
                              }}
                              fmt={(v) => v.toFixed(1)}
                            />
                          ))}
                        </fieldset>
                      </TabsContent>
                      <TabsContent value="focus">
                        {/* Focus is automatic — the engine tracks the character's
                            depth span every frame. Strength is the whole dial. */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs">Depth of field</span>
                          <Switch size="sm" checked={dof.enabled} onCheckedChange={(v) => applyDof({ enabled: v })} />
                        </div>
                        {/* mt-2.5 on the fieldset, not the row: SliderRow zeroes
                            its own top margin as a first child, which pinned
                            Strength against the switch. */}
                        <fieldset
                          disabled={!dof.enabled}
                          className={cn("mt-2.5", !dof.enabled && "pointer-events-none opacity-40")}
                        >
                          <SliderRow
                            label="Strength"
                            value={dof.aperture}
                            min={0.2}
                            max={3}
                            step={0.05}
                            onChange={(v) => applyDof({ aperture: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                        </fieldset>
                      </TabsContent>
                    </Tabs>
                  )}
                </LayerRow>
              ))}
            </StackGroup>
          </div>
        </Surface>
      )}

      {/* ── Inspector: the selected cast member's materials ── */}
      {inspected && (
        <Surface
          placement="side"
          // Starts BELOW the top-right pills (top-3 + their h-10 + 8px) and hugs
          // its content like the left dock, capped above the transport: 100%
          // minus 3.75rem top minus 4rem transport reserve. 18rem, symmetric
          // with the left dock, sized to MEET the pill cluster's natural width
          // — the pills stay content-hugging; the docks come to them.
          className="top-[3.75rem] bottom-auto max-h-[calc(100%-7.75rem)] w-[18rem] animate-[panel-in_0.2s_cubic-bezier(0.32,0.72,0,1)]"
          style={{ zIndex: inspectorZ.z, width: rightRailWidth ?? undefined }}
          onPointerDownCapture={inspectorZ.onPointerDownCapture}
          onFocusCapture={inspectorZ.onFocusCapture}
        >
          {/* The command's own name, not the model's: the cast row already says
              which character this is, the panel's model tabs say which one is
              being edited, and a third copy with stats was the same fact three
              times. One title, matching the palette entry that opened it. */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5">
            <MaterialSphereIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Edit material presets</span>
            <CastAction icon={X} label="Close material presets" onClick={() => setInspectedId(null)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MaterialsPanel
              dense
              modelTabs={models.map((m) => ({ id: m.id, file: m.file, active: m.id === inspected.id }))}
              onSelectModel={setInspectedId}
              materials={inspected.materials}
              groups={inspectedGroups}
              activeGroupId={null}
              onHover={(name) => highlight(inspected.id, name)}
              onToggleVisible={(name) => toggleVisible(inspected.id, name)}
              onCreateGroup={inspectCreateGroup}
              onRenameGroup={inspectRenameGroup}
              onDeleteGroup={inspectDeleteGroup}
              onMoveMaterial={inspectMoveMaterial}
              onPickGraph={inspectPickGraph}
            />
          </div>
        </Surface>
      )}

      {/* ── Export ──
          MOUNTED even while closed: the export runs inside RenderPanel, and
          unmounting would kill a render in flight. Close hides; the pill below
          carries the progress; completion downloads by itself (iMovie-quiet),
          so nothing reopens. */}
      {(
        <Surface
          placement="side"
          // Starts BELOW the top-right pills (top-3 + their h-10 + 8px) and hugs
          // its content like the left dock, capped above the transport: 100%
          // minus 3.75rem top minus 4rem transport reserve.
          className={cn(
            "top-[3.75rem] bottom-auto max-h-[calc(100%-7.75rem)] w-[18rem]",
            "transition-[opacity,transform,visibility] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
            !exportOpen && "invisible translate-x-2 opacity-0",
          )}
          style={{ zIndex: exportZ.z, width: rightRailWidth ?? undefined }}
          onPointerDownCapture={exportZ.onPointerDownCapture}
          onFocusCapture={exportZ.onFocusCapture}
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Export</span>
            <CastAction icon={X} label="Close export" onClick={() => setExportOpen(false)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RenderPanel
              active={exportOpen}
              engineRef={engineRef}
              canvasRef={canvasRef}
              modelName={masterId ?? (models[0]?.id ?? "")}
              extraModelNames={models.filter((m) => animByModel[m.id] && m.id !== masterId).map((m) => m.id)}
              sceneName={sceneName}
              animName={masterClipName}
              animDuration={animDuration}
              backdrop={bgImage && !bgImage.dome ? bgImage : null}
              backgroundColor={settings.background.color}
              musicUrl={musicClip?.url ?? null}
              greenScreen={framing.greenScreen}
              onGreenScreenChange={framing.setGreenScreen}
              onExportingChange={framing.setExporting}
              onFramePreviewChange={framing.handleFramePreview}
              onProgressChange={setExportProgress}
            />
          </div>
        </Surface>
      )}

      {/* A running export, folded to a pill while its panel is hidden. Click
          reopens; no cancel here — destructive actions stay in the panel they
          belong to, and the pill simply vanishes when the download lands. */}
      {framing.exporting && !exportOpen && (
        <button
          onClick={() => setExportOpen(true)}
          className={cn(PILL, "absolute right-3 bottom-3 flex h-10 cursor-pointer items-center gap-2 px-4 text-[13px] text-foreground")}
        >
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          Exporting{exportPct !== null ? ` ${exportPct}%` : "…"}
        </button>
      )}

      {/* ── Transport ──
          The real AnimPlayer, not a mock of one. It already plays, scrubs, loops
          and follows a camera VMD, and it already looks the way the app looks —
          so a copy of it could only be a worse version that drifts. The layout
          is what this route is testing; the controls inside it are not.

          Collapsed it centres on the VIEWPORT, as a pill that clears everything
          has always done. Open it spans the working area instead, stopping clear
          of the stack — a timeline that runs under the panel you are reading is
          a timeline you cannot see the end of. The right edge will take the same
          treatment when the inspector lands. */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 flex justify-center",
          WORKSPACE,
        )}
      >
        {/* max-w-fit is what returns the collapsed pill to the ORIGINAL slider
            length: the track is flex-1 with min-w-[min(16rem,30vw)], and a
            fit-content pill resolves a flex-1 child at its min-content size —
            which IS that floor, the shipped transport's exact track width. Open
            swaps the cap to 100% and flex-1 absorbs the growth, so the track is
            the only thing that stretches.

            interpolate-size lets the keyword cap animate (Chrome; Safari snaps
            between correct layouts, which this dev route accepts). The open cap
            is 100% and not some large rem, because a cap past the container
            keeps "animating" after the element has stopped growing — dead time
            that reads as a snap at the start of the close. */}
        <div
          className={cn(
            "pointer-events-auto w-full transition-[max-width] [interpolate-size:allow-keywords]",
            FOLD,
            timelineOpen ? "max-w-full" : "max-w-fit",
          )}
        >
          <AnimPlayer
            engineRef={engineRef}
            modelNames={modelNames}
            hasCamera={cameraClip !== null}
            // No tooltip. A chevron pointing at where the thing will go is the
            // whole explanation, and a tip that only repeats the arrow delays a
            // control people press repeatedly. aria-label still carries it for
            // anyone not seeing the arrow.
            trailing={
              <Button
                variant="ghost"
                size="icon"
                aria-expanded={timelineOpen}
                aria-label={timelineOpen ? "Hide timeline" : "Show timeline"}
                onClick={() => setTimelineOpen((v) => !v)}
                className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              >
                {timelineOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </Button>
            }
            unfolded={timelineOpen}
            below={
              // grid-rows 0fr→1fr is the one way to animate to CONTENT height
              // without measuring it. The inner element owns overflow-hidden;
              // the row itself is what animates.
              <div className={cn("grid transition-[grid-template-rows]", FOLD, timelineOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden" inert={!timelineOpen}>
                  {/* Border on the INNER element, so it folds away with the
                      lanes instead of drawing a line under a closed pill.

                      The fade is asymmetric on purpose. The fold only CLIPS the
                      lanes — they stay fully opaque under the shrinking edge, so
                      the last visible strip vanished in one frame, a flash right
                      at the end of the close. Fading out at half the fold's
                      duration means the fold closes over content that is already
                      gone; opening gets the full duration, since content
                      arriving with the fold is what a fold should look like. */}
                  <div
                    className={cn(
                      "border-t border-line px-4 pt-3 pb-4 transition-opacity ease-out",
                      timelineOpen ? "opacity-100 duration-300" : "opacity-0 duration-150",
                    )}
                  >
                    {/* One lane per cast member, then the scene-wide slots.
                        Camera and music always show even with an empty cast: the
                        timeline's shape should not depend on what happens to be
                        loaded into it. */}
                    {/* The label names the KIND of lane, so a lone cast member's
                        motion row is "Animation" and not their name — the name is
                        already the row above it in the stack, and CAMERA / MUSIC
                        beside it are kinds too. Whose motion it is only becomes a
                        question once there are several, and then the name earns
                        the slot. Same rule the shipped assets panel uses for its
                        motion rows. */}
                    {models.map((m) => (
                      <Lane key={m.id} label={models.length > 1 ? displayName(m.file) : "Animation"}>
                        {animByModel[m.id] ? (
                          <LaneBlock>{animByModel[m.id].name}</LaneBlock>
                        ) : (
                          <LaneSlot label="Drop a motion" onClick={() => pickAnimation(m.id)} />
                        )}
                      </Lane>
                    ))}
                    <Lane label="Camera">
                      {cameraClip ? (
                        <LaneBlock>{cameraClip}</LaneBlock>
                      ) : (
                        <LaneSlot label="Drop a camera motion" onClick={() => cameraInput.current?.click()} />
                      )}
                    </Lane>
                    {/* The audio clock is still to come, so a loaded track will
                        not PLAY yet — but the slot is a real intake (it lands in
                        sceneFiles.audio), so it behaves like one. */}
                    <Lane label="Music">
                      {musicClip ? (
                        <LaneBlock>{musicClip.name}</LaneBlock>
                      ) : (
                        <LaneSlot label="Drop music" onClick={() => musicInput.current?.click()} />
                      )}
                    </Lane>
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>
    </main>
  )
}
