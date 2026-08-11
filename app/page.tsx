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
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  Check,
  FilePlus2,
  GalleryThumbnails,
  Globe,
  Grid3x3,
  Clapperboard,
  Code2,
  ChevronDown,
  ChevronUp,
  Contrast,
  Image,
  ImageDown,
  Lightbulb,
  Music,
  Mountain,
  PersonStanding,
  Plus,
  RefreshCw,
  Languages,
  Palette,
  PenLine,
  RotateCcw,
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
import { AccountButton, HandleDialog } from "@/components/editor/account-panel"
import { SceneGallery, prefetchGallery } from "@/components/editor/scene-gallery"
import { prefetchLibraryStats } from "@/hooks/use-library-stats"
import { AnimPlayer } from "@/components/scene/anim-player"
import { MaterialsPanel } from "@/components/scene/material-sidebar"
import { GithubMark, MaterialSphereIcon } from "@/components/scene/slot-icons"
import { RenderPanel } from "@/components/editor/render-panel"
import { CastSwatch } from "@/components/editor/cast-swatch"
import { CommandPalette } from "@/components/editor/command-palette"
import { RECENT_DEPTH, type PaletteItem, type SceneGap } from "@/lib/command-search"
import { SceneFileMenu } from "@/components/editor/scene-file-menu"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GradeLibrary } from "@/components/editor/grade-library"
import { GradeEditorPanel, type GradeEditorSubject } from "@/components/editor/grade-editor"
import { BackgroundLibrary } from "@/components/editor/background-library"
import { NodeLibrary } from "@/components/editor/node-library"
import { GraphEditor } from "@/components/graph/graph-editor"
import { WgslEditorPanel } from "@/components/editor/wgsl-editor"
import { SaveCloseDialog } from "@/components/editor/save-close"
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
import { ColorField } from "@/components/color-picker"
import { useAudioClock } from "@/hooks/use-audio-clock"
import { useEngine } from "@/hooks/use-engine"
import { useRenderFraming } from "@/hooks/use-render-framing"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { useBrowseSurface } from "@/hooks/use-browse-surface"
import { useStoredRect } from "@/hooks/use-stored-rect"
import { useZOrder } from "@/hooks/use-z-order"
import { DEFAULT_SCENE, EMPTY_SCENE } from "@/lib/default-scene"
import {
  assetsDocOf,
  CAMERA_DEFAULT_FOV,
  hydrateScene,
  idbBundleOf,
  newSceneId,
  parseSceneDoc,
  saveSceneAssets,
  saveSceneState,
  serializeSceneDoc,
  type Scene,
  type SceneCamera,
  type SceneDoc,
  type SceneState,
} from "@/lib/scene"
import { collectSceneSlots as collectSlots, type CollectedAnim, type SceneSlots } from "@/lib/scene-collect"
import { downloadBlob, sceneZipFileName } from "@/lib/scene-file"
import { buildZip } from "@/lib/bundle"
import { resolveSceneRefs } from "@/lib/resolve-refs"
import { effectRef, gradeRef, graphRef, unpublishedUses } from "@/lib/refs"
import { ShareSceneDialog, type ScenePublishSource } from "@/components/editor/share-scene"
import { clearLocalBundle, saveLocalBundle } from "@/lib/asset-store"
import { dictionaries, LOCALES, LOCALE_LABELS, useI18n, useT, type Dictionary, type Locale } from "@/lib/i18n"
import { expandUploadFiles, unzipToFiles } from "@/lib/uploads"
import { GRADE_PRESETS, gradeSpec, NEUTRAL_SPEC, NEW_GRADE_SPEC, recallIntensity, rememberIntensity } from "@/lib/grade"
import {
  communityQuickPickItems,
  nameKey,
  quickPickItems,
  type EffectItem,
  type GradeItem,
  type GraphItem,
} from "@/lib/library"
import { communityItems, useCommunity } from "@/hooks/use-community"
import { useDrafts } from "@/hooks/use-drafts"
import { useSession } from "@/lib/auth-client"
import { freeName } from "@/lib/names"
import {
  applyDefaults,
  BACKGROUND_EFFECTS,
  builtinEffect,
  NEW_EFFECT_TEMPLATE,
  type AppliedBackgroundEffect,
} from "@/lib/background-effects"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import type { ExportProgress } from "@/lib/video-export"
import { castColour } from "@/lib/model-colour"
import { castSourceFor } from "@/lib/cast-source"
import { NEUTRAL_PALETTE, type CastPaletteId } from "@/lib/cast-palette"
import { relFilePath, sceneFiles } from "@/lib/scene-files"
import { cancelDraftWrites, createDraft, isDraft, loadDrafts, updateDraft, updateDraftSoon } from "@/lib/drafts"
import { saveLookPref } from "@/lib/look-pref"
import { activeLookPack, graphRole, groupLabel, GRAPH_LIBRARY, libraryGraph, LOOK_PACK_ORDER, LOOK_PACKS, packGraph, sameGraphLook, SLOT_GRAPHS, type LookPack } from "@/lib/materials"
import { stageStyleGroups } from "@/lib/stage-style"
import {
  compileGraph,
  DEFAULT_GRAPH,
  type CompileOptions,
  type Diagnostic,
  type MaterialPreset,
  type ShaderGraph,
  type StyleGroup,
} from "reze-engine"
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
 * The working area — what the canvas has left between the docks — is 40.5rem
 * narrower than the window: the dock (18rem) plus 2.25rem either side, which is
 * its own 0.75rem inset plus a 1.5rem gap. One rem of clear canvas either side,
 * rather than the 0.75 the docks themselves sit at: at that width the open
 * timeline read as touching them, and an edge that nearly meets another edge
 * looks like a mistake in a way a plain gap never does. The right inset assumes
 * the inspector matching the stack at 17rem, which does not exist on this route
 * yet — sizing against where it WILL be stops the geometry changing the day it
 * lands, and matching widths keeps the timeline centred on the canvas.
 *
 * It is a max-WIDTH on the timeline (see the transport, below) and not insets on
 * its container, because the collapsed pill must not be squeezed by docks it
 * floats over — that is what made its track a few pixels wide on any window
 * under ~1080px. The number lives there, written out literally: Tailwind scans
 * source for whole class names, so a constant interpolated into one produces no
 * CSS at all.
 *
 * Both insets hold whether the stack is open or not. Collapsing it must NOT let
 * the timeline widen: the transport would then resize every time you hid a panel
 * you were not even looking at, and a timeline whose scale changes underneath you
 * is worse than one that leaves a strip of canvas unused.
 */

/**
 * The expanded timeline is OFF, and its code is deliberately still here.
 *
 * The lanes are a picture, not an editor: no shared time axis, no playhead, no
 * trim — so a fold that opens onto them promises an editor that does not exist,
 * and a control whose only outcome is disappointment is worse than no control.
 * The transport is the timeline meanwhile, which was always the design.
 *
 * One boolean, not a deletion: what is missing is the axis (every lane
 * proportional to the longest clip), a playhead drawn across all three, and
 * per-track in/out — and the first two want a camera-VMD duration the engine
 * does not expose yet. Everything below survives to be built on.
 */
const TIMELINE_EDITOR = false

/** A viewport a hair narrower than the target still counts as matching it. */
const FRAME_ASPECT_TOL = 1.03

/** Palette recents, persisted — Suggestions should remember across sessions. */
const RECENTS_KEY = "reze-design.palette-recents"

/**
 * Whether this person has ever opened the gallery.
 *
 * Persisted, unlike every other suggestion signal, because it is a fact about
 * THEM rather than about the scene: the point of offering it is that someone who
 * has not found the gallery has no way to know it exists, and a reminder that
 * resets every session is a reminder that never stops.
 */
const GALLERY_SEEN_KEY = "reze-design.gallerySeen"

/** The repository. It is also where the manuals live, linked from the README —
 *  so the app carries ONE outbound link rather than a help menu that has to be
 *  kept in step with the docs. */
const REPO_URL = "https://github.com/AmyangXYZ/reze-design"

/** How long edits settle before the working scene is written to localStorage. */
const SAVE_SETTLE_MS = 1000

/** A path the site serves, as opposed to one that only means something inside
 *  this scene's asset bundle. */
const servedUrl = (url: string) => /^[/]|^https?:/.test(url)

/** Release a track's object URL. Uploads become blob: URLs; a served path is not
 *  ours to revoke. */
const dropMusicUrl = (clip: { url: string } | null) => {
  if (clip?.url.startsWith("blob:")) URL.revokeObjectURL(clip.url)
}

/**
 * A document's motion rows before a byte of VMD has parsed — the claim the boot
 * loader later confirms or retracts (see animByModel). Hoisted out of the state
 * initializer because a scene SWAP has to seed the same rows the same way: two
 * seeds is two answers to "what is this cast doing", and only one can be right.
 */
function seedAnims(scene: Scene): Record<string, { name: string; src: File | string }> {
  const seed: Record<string, { name: string; src: File | string }> = {}
  for (const entry of scene.assets.models)
    if (entry.animation) seed[entry.model.id] = { name: entry.animation.name, src: entry.animation.url }
  return seed
}

/** The music row's seed, hoisted for the same reason. A served track plays straight
 *  off its URL; a packed one has no playable URL until the extras loader pulls it
 *  out of the bundle, so the row fills in first and the audio element follows. */
const TRANSFORM_LABEL: Record<SceneSettings["view"]["transform"], string> = {
  standard: "Standard",
  filmic: "Filmic",
  agx: "AgX", // not offered in the picker; a document could still carry it
}

const seedMusic = (scene: Scene): { name: string; url: string } | null =>
  scene.assets.audio
    ? { name: scene.assets.audio.name, url: servedUrl(scene.assets.audio.url) ? scene.assets.audio.url : "" }
    : null

/** The dictionary the UI is NOT showing. Every palette row carries its labels
 *  as altLabels, which is what keeps the search bag bilingual while the list on
 *  screen is not. */
const otherThan = (t: Dictionary): Dictionary => (t === dictionaries.zh ? dictionaries.en : dictionaries.zh)

/** Each layer's presets. Static here — the real stack reads these from the
 *  document and the libraries; the shell only needs them to have names. */
function layersFor(t: Dictionary) {
  return [
    { id: "camera", name: t.lab.rows.camera, icon: Camera, presets: [] },
    // "Environment", not "Stage": the row holds Stage | Ground | Background, and
    // a container named after one of its tabs read as filing confusion.
    { id: "stage", name: t.lab.rows.stage, icon: Mountain, presets: [] },
    // Its own row, not a Background line: an effect can sit in front of the
    // scene as well as behind it (the layer flag is coming with the engine's
    // global mount), so it is scene dressing like Grade, not part of the
    // backdrop.
    { id: "effect", name: t.lab.rows.effect, icon: Sparkles, presets: [] },
    // Post, not Grade: the row is the whole after-the-render pass — the colour
    // grade and the glow the camera adds to bright pixels. Lighting (including a
    // future character rim) stays in Light; those change how surfaces respond,
    // not what happens to the finished frame.
    { id: "post", name: t.lab.rows.post, icon: Contrast, presets: [] },
    // A lamp, not the sun: Sun is the SUN — one of the two things this row
    // holds, and a row wearing the icon of its own tab claims to be that tab.
    { id: "light", name: t.lab.rows.light, icon: Lightbulb, presets: [] },
    { id: "physics", name: t.lab.rows.physics, icon: Atom, presets: [] },
  ] as const
}

/**
 * What a palette row can PRINT: the live scene, in the shape the value functions
 * below read it. A snapshot, committed when the palette opens — see openPalette
 * for why nothing here is read live.
 *
 * `t` rides along because half of these values are words (On, Off, None) and a
 * value function has no other way to reach the dictionary.
 */
/**
 * What to call a .pmx in the picker: its filename, since the folders above it
 * are the archive's business rather than the reader's.
 *
 * Falls back to the full path for a name that appears twice — a variant pack
 * ships the same filename in several folders, and two identical rows is a choice
 * nobody can make.
 */
function pmxLabel(path: string, all: string[]): string {
  const name = path.split("/").pop() ?? path
  return all.filter((p) => (p.split("/").pop() ?? p) === name).length > 1 ? path : name
}

type PaletteValues = {
  t: Dictionary
  settings: SceneSettings
  camera: SceneCamera
  locale: Locale
  /** The loaded stage's placement, or null when there is none. */
  stage: { scale: number; position: [number, number, number] } | null
  /** Applied names, already resolved — a value function must not have to look
   *  anything up. */
  effect: string | null
  gradeName: string
  backdrop: string | null
  dome: string | null
  /** The rendering style the scene is wearing, or null when it wears neither
   *  set whole. */
  pack: LookPack | null
}

/**
 * One formatter per shape, shared with the dock's own sliders below.
 *
 * The dock has always formatted its numbers inline; the palette printing the
 * same numbers is the second reader, and two copies of `toFixed(2)` is how a
 * value ends up reading 0.35 in one place and 0.4 in the other.
 */
const deg = (v: number) => `${Math.round(v)}°`
const dec1 = (v: number) => v.toFixed(1)
const dec2 = (v: number) => v.toFixed(2)
const xyz = (v: readonly [number, number, number]) => v.map(dec1).join(", ")
/** A switch, in the reader's language. */
const sw = (on: boolean, t: Dictionary) => (on ? t.lab.on : t.lab.off)
const rad2deg = (r: number) => (r * 180) / Math.PI

/**
 * Every CONTROL in the dock, as data: where it lives (row, pane), what it is
 * called in both search languages, and what it is SET TO.
 *
 * The palette's Settings section is generated from this, so "shadow" or 阴影
 * lands on Environment · Ground — searching a knob by name navigates to the
 * knob, not to a guess — and the row says what the knob currently reads, so the
 * search results answer the question as often as they navigate to it.
 */
// prettier-ignore
const DOCK_CONTROLS: {
  id: string
  en: string
  zh: string
  row: string
  stageTab?: "stage" | "ground" | "background"
  lightTab?: "world" | "sun"
  cameraTab?: "lens" | "focus"
  postTab?: "grade" | "tone" | "bloom" | "outline"
  keywords?: string[]
  /** What this control is set to, for the right end of its palette row. Omitted
   *  where there is nothing honest to print — the export panel owns its own
   *  settings and they do not exist until it opens. Returning "" says the same
   *  thing dynamically: a stage transform with no stage loaded. */
  value?: (v: PaletteValues) => string
}[] = [
  { id: "camera-fov", en: "Camera FOV", zh: "相机视场角", row: "camera", cameraTab: "lens", keywords: ["fov", "field of view", "视野"], value: (v) => deg(rad2deg(v.camera.fov ?? CAMERA_DEFAULT_FOV)) },
  { id: "camera-follow", en: "Follow character", zh: "跟随角色", row: "camera", cameraTab: "lens", keywords: ["follow", "center", "センター"], value: (v) => sw(!!v.camera.follow, v.t) },
  { id: "camera-distance", en: "Camera distance", zh: "相机距离", row: "camera", cameraTab: "lens", keywords: ["zoom", "距离"], value: (v) => dec1(v.camera.distance) },
  { id: "camera-azimuth", en: "Camera azimuth", zh: "相机方位角", row: "camera", cameraTab: "lens", keywords: ["orbit", "angle", "方位"], value: (v) => deg(rad2deg(v.camera.alpha)) },
  { id: "camera-elevation", en: "Camera elevation", zh: "相机仰角", row: "camera", cameraTab: "lens", keywords: ["orbit", "height", "俯仰"], value: (v) => deg(90 - rad2deg(v.camera.beta)) },
  { id: "camera-target", en: "Camera target", zh: "相机目标", row: "camera", cameraTab: "lens", keywords: ["offset", "look at", "偏移"], value: (v) => xyz(v.camera.target) },
  { id: "camera-dof", en: "Depth of field", zh: "景深", row: "camera", cameraTab: "focus", keywords: ["dof", "bokeh", "blur", "focus", "虚化"], value: (v) => sw(v.settings.dof.enabled, v.t) },
  { id: "stage-scale", en: "Stage scale", zh: "舞台缩放", row: "stage", stageTab: "stage", value: (v) => (v.stage ? `${dec2(v.stage.scale)}×` : "") },
  { id: "stage-position", en: "Stage position", zh: "舞台位置", row: "stage", stageTab: "stage", value: (v) => (v.stage ? xyz(v.stage.position) : "") },
  { id: "ground-color", en: "Ground color", zh: "地面颜色", row: "stage", stageTab: "ground", value: (v) => v.settings.ground.color },
  { id: "ground-opacity", en: "Ground opacity", zh: "地面不透明度", row: "stage", stageTab: "ground", value: (v) => dec2(v.settings.ground.opacity) },
  { id: "shadow", en: "Shadow", zh: "阴影", row: "stage", stageTab: "ground", value: (v) => sw(v.settings.ground.shadow, v.t) },
  { id: "grid", en: "Grid lines", zh: "网格", row: "stage", stageTab: "ground", value: (v) => sw(v.settings.ground.gridEnabled, v.t) },
  { id: "bg-color", en: "Background color", zh: "背景颜色", row: "stage", stageTab: "background", value: (v) => v.settings.background.color },
  { id: "bg-image", en: "Background image", zh: "背景图片", row: "stage", stageTab: "background", keywords: ["backdrop", "photo"], value: (v) => v.backdrop ?? v.t.lab.ctl.none },
  { id: "bg-360", en: "360° background", zh: "360 全景背景", row: "stage", stageTab: "background", keywords: ["360", "skybox", "panorama", "equirect", "全景"], value: (v) => v.dome ?? v.t.lab.ctl.none },
  { id: "effect", en: "Effect", zh: "特效", row: "effect", keywords: ["wgsl", "stars", "shader", "背景特效"], value: (v) => v.effect ?? v.t.lab.ctl.none },
  { id: "grade-preset", en: "Grade preset", zh: "调色预设", row: "post", postTab: "grade", keywords: ["color", "look", "后期"], value: (v) => v.gradeName },
  { id: "grade-intensity", en: "Grade intensity", zh: "调色强度", row: "post", postTab: "grade", value: (v) => dec2(v.settings.grade.intensity) },
  { id: "view-transform", en: "View transform", zh: "视图变换", row: "post", postTab: "tone", keywords: ["tonemap", "tone map", "filmic", "agx", "standard", "color management", "色调映射", "色彩管理"], value: (v) => TRANSFORM_LABEL[v.settings.view.transform] },
  { id: "exposure", en: "Exposure", zh: "曝光", row: "post", postTab: "tone", keywords: ["brightness", "ev", "亮度"], value: (v) => dec2(v.settings.view.exposure) },
  { id: "bloom-intensity", en: "Bloom intensity", zh: "泛光强度", row: "post", postTab: "bloom", keywords: ["glow", "辉光"], value: (v) => v.settings.bloom.intensity.toFixed(3) },
  { id: "bloom-threshold", en: "Bloom threshold", zh: "泛光阈值", row: "post", postTab: "bloom", keywords: ["cutoff"], value: (v) => dec2(v.settings.bloom.threshold) },
  { id: "bloom-radius", en: "Bloom radius", zh: "泛光半径", row: "post", postTab: "bloom", keywords: ["spread", "扩散"], value: (v) => dec1(v.settings.bloom.radius) },
  { id: "outline-toggle", en: "Outline", zh: "描边", row: "post", postTab: "outline", keywords: ["edge", "rim", "线稿", "轮廓"], value: (v) => sw(v.settings.outline.enabled, v.t) },
  { id: "world-strength", en: "World strength", zh: "环境光强度", row: "light", lightTab: "world", keywords: ["ambient"], value: (v) => dec2(v.settings.world.strength) },
  { id: "sun-strength", en: "Sun strength", zh: "太阳强度", row: "light", lightTab: "sun", value: (v) => dec2(v.settings.sun.strength) },
  { id: "sun-azimuth", en: "Sun azimuth", zh: "太阳方位", row: "light", lightTab: "sun", value: (v) => deg(v.settings.sun.azimuth) },
  { id: "sun-elevation", en: "Sun elevation", zh: "太阳高度", row: "light", lightTab: "sun", value: (v) => deg(v.settings.sun.elevation) },
  { id: "resolution", en: "Resolution", zh: "分辨率", row: "export", keywords: ["1080", "4k", "size", "quality"] },
  { id: "aspect", en: "Aspect ratio", zh: "画面比例", row: "export", keywords: ["16:9", "9:16", "square", "vertical"] },
  { id: "duration", en: "Export duration", zh: "导出时长", row: "export", keywords: ["length", "range", "seconds"] },
  { id: "green-screen", en: "Green screen", zh: "绿幕", row: "export", keywords: ["chroma", "key", "transparent", "抠像"] },
  { id: "watermark", en: "Watermark", zh: "水印", row: "export", keywords: ["logo", "brand"] },
  { id: "gravity", en: "Gravity", zh: "重力", row: "physics", value: (v) => v.settings.physics.gravity.toFixed(0) },
  { id: "wind", en: "Wind", zh: "风", row: "physics", value: (v) => v.settings.physics.wind.toFixed(0) },
  { id: "wind-frequency", en: "Wind frequency", zh: "风频率", row: "physics", value: (v) => dec2(v.settings.physics.windFrequency) },
  { id: "wind-direction", en: "Wind direction", zh: "风向", row: "physics", value: (v) => deg(v.settings.physics.windAzimuth) },
]

function rowMetaFor(t: Dictionary): Record<string, { icon: ComponentType<{ className?: string }>; name: string }> {
  return {
    camera: { icon: Camera, name: t.lab.rows.camera },
    stage: { icon: Mountain, name: t.lab.rows.stage },
    effect: { icon: Sparkles, name: t.lab.rows.effect },
    post: { icon: Contrast, name: t.lab.rows.post },
    light: { icon: Lightbulb, name: t.lab.rows.light },
    physics: { icon: Atom, name: t.lab.rows.physics },
    // Not a dock row — a summoned panel. Its controls are searchable all the same.
    export: { icon: Clapperboard, name: t.lab.rows.export },
  }
}
function tabNameFor(t: Dictionary): Record<string, string> {
  return {
    stage: t.lab.tabs.stage,
    ground: t.lab.tabs.ground,
    background: t.lab.tabs.background,
    world: t.lab.tabs.world,
    sun: t.lab.tabs.sun,
  }
}

/** The generated Settings entries — the breadcrumb hint says where it lives.
 *  The label is the current locale's column and the alt is the other one, so a
 *  knob stays findable by either name whichever language the dock is in. */
function controlItemsFor(t: Dictionary): PaletteItem[] {
  const rowMeta = rowMetaFor(t)
  const tabName = tabNameFor(t)
  const zhUi = t === dictionaries.zh
  return DOCK_CONTROLS.map((c) => ({
    id: `ctl-${c.id}`,
    repeatable: true,
    section: "setting" as const,
    icon: rowMeta[c.row].icon,
    label: zhUi ? c.zh : c.en,
    hint: rowMeta[c.row].name + ((c.stageTab ?? c.lightTab) ? ` · ${tabName[(c.stageTab ?? c.lightTab)!]}` : ""),
    altLabels: [zhUi ? c.en : c.zh],
    keywords: c.keywords,
  }))
}

/**
 * Verb families, spread into the keyword bags below.
 *
 * A command's own keywords say what it IS. These say what someone might CALL the
 * act: the app writes "New grade", and half the people looking for it will type
 * "create". Labels already match in both locales, so what these add is the verbs
 * NEITHER label uses — and they are shared consts rather than copied lists so a
 * family cannot end up meaning "create" on three rows and "make" on a fourth.
 */
const MAKE = ["create", "make", "创建"]
const LOAD = ["upload", "import", "load", "add", "上传", "导入", "加载"]
const SAVE = ["save", "download", "保存", "下载"]

/** A stand-in command set — enough to judge ranking, sections and the ">" mode.
 *  The real one comes from the registry, where each entry owns its `when` and
 *  `run`; these deliberately carry altLabels and keywords so folding and the
 *  keyword bag can be exercised (try "着色", "しぇーだー", "mp4", "bgm"). The
 *  hints show what each row acts on; rows with nothing to say leave it blank.
 *
 *  `nextLikely` and `repeatable` drive Suggestions — finish a look and Publish
 *  rises, export once and Export drops out. See suggestionsFor. */
function commandsFor(t: Dictionary): PaletteItem[] {
  const l = t.lab
  const alt = otherThan(t).lab
  return [
    // Three honest pairs: a NEW command starts a draft from a template, a
    // LIBRARY command browses. Neither needs a subject, which is why neither can
    // guess wrong. There is deliberately no "edit shader graph" — a scene has as
    // many graphs as it has groups, so choosing one is the materials panel's job,
    // not a command's.
    {
      id: "graph-new",
      suggested: true,
      repeatable: true,
      nextLikely: ["export", "publish"],
      section: "command",
      deep: true,
      icon: Workflow,
      label: l.cmd.graphNew,
      altLabels: [alt.cmd.graphNew],
      keywords: [...MAKE, "wgsl", "material", "node", "shader", "着色器"],
    },
    {
      id: "graph-lib",
      repeatable: true,
      section: "command",
      icon: Workflow,
      label: l.cmd.graphLib,
      altLabels: [alt.cmd.graphLib],
      keywords: ["shader", "browse", "着色器", "库"],
    },
    {
      id: "wgsl-new",
      repeatable: true,
      nextLikely: ["export"],
      section: "command",
      deep: true,
      icon: Code2,
      label: l.cmd.wgslNew,
      altLabels: [alt.cmd.wgslNew],
      keywords: [...MAKE, "shader", "effect", "background", "特效"],
    },
    {
      id: "effect-lib",
      repeatable: true,
      section: "command",
      icon: Sparkles,
      label: l.cmd.effectLib,
      altLabels: [alt.cmd.effectLib],
      keywords: ["background", "wgsl", "browse", "特效", "库"],
    },
    {
      id: "grade-new",
      repeatable: true,
      section: "command",
      deep: true,
      icon: Palette,
      label: l.cmd.gradeNew,
      altLabels: [alt.cmd.gradeNew],
      keywords: [...MAKE, "color", "look", "调色"],
    },
    {
      id: "grade-lib",
      repeatable: true,
      section: "command",
      icon: Palette,
      label: l.cmd.gradeLib,
      altLabels: [alt.cmd.gradeLib],
      keywords: ["color", "browse", "调色", "库"],
    },
    {
      id: "export",
      // No `suggested` — the SCENE says when this matters. It rises once there
      // is something watchable and stops the moment you have rendered it.
      fills: "render",
      nextLikely: ["publish"],
      section: "command",
      icon: Clapperboard,
      label: l.cmd.exportVideo,
      // No hint: the resolution lives in the export panel and changes there, so
      // a number printed here is one nobody updated. A hint that can be wrong is
      // worse than a row with nothing to add.
      altLabels: [alt.cmd.exportVideo],
      keywords: [...SAVE, "mp4", "4k", "render", "encode"],
    },
    // Not a goto — goto means a place in the dock. This LEAVES what you are
    // making to look at what other people made, which is why it never became a
    // library tab either.
    {
      id: "gallery",
      // Offered while you have no history of your own: someone who has done
      // nothing yet is exactly who needs to see that other people's scenes
      // exist. It stops being offered the moment they have.
      fills: "discover",
      repeatable: true,
      section: "command",
      icon: GalleryThumbnails,
      label: t.gallery.door,
      altLabels: [otherThan(t).gallery.door, t.gallery.title, otherThan(t).gallery.title],
      keywords: ["browse", "explore", "discover", "scenes", "community", "浏览", "发现", "场景", "作品"],
    },
    {
      id: "publish",
      suggested: true,
      section: "command",
      icon: Share2,
      label: l.cmd.publish,
      altLabels: [alt.cmd.publish],
      keywords: ["share", "upload", "link", "url", "发布", "分享", "链接"],
    },
    // The logo menu's four operations, searchable. Same handlers, same labels —
    // a second door to one function, which is the whole point of the palette.
    {
      id: "scene-new",
      repeatable: true,
      section: "command",
      icon: FilePlus2,
      label: t.sceneFile.newScene,
      altLabels: [otherThan(t).sceneFile.newScene],
      keywords: [...MAKE, "clear", "empty", "新建", "清空"],
    },
    {
      id: "scene-reset",
      repeatable: true,
      section: "command",
      icon: RotateCcw,
      label: t.sceneFile.reset,
      altLabels: [otherThan(t).sceneFile.reset],
      keywords: ["default", "demo", "重置", "恢复"],
    },
    {
      id: "scene-export",
      repeatable: true,
      section: "command",
      icon: ArrowUpFromLine,
      label: t.sceneFile.export,
      altLabels: [otherThan(t).sceneFile.export],
      keywords: [...SAVE, "zip", "导出", "备份"],
    },
    {
      id: "scene-import",
      repeatable: true,
      section: "command",
      icon: ArrowDownToLine,
      label: t.sceneFile.import,
      altLabels: [otherThan(t).sceneFile.import],
      keywords: [...LOAD, "open", "zip", "导入"],
    },
    {
      id: "upload-animation",
      fills: "motion",
      repeatable: true,
      section: "command",
      // A BODY performing, not a film slate: Clapperboard is the rendered video,
      // and a motion is the thing a character does.
      icon: PersonStanding,
      label: l.uploadAnimation,
      altLabels: [alt.uploadAnimation],
      keywords: [...LOAD, "vmd", "motion", "dance", "动作", "舞蹈"],
    },
    {
      id: "upload-stage",
      nextLikely: ["light", "post"],
      section: "command",
      icon: Mountain,
      label: l.uploadStagePmx,
      altLabels: [alt.uploadStagePmx],
      keywords: [...LOAD, "environment", "floor", "舞台"],
    },
    {
      id: "camera",
      repeatable: true,
      nextLikely: ["light"],
      section: "goto",
      icon: Camera,
      label: l.cmd.camera,
      altLabels: [alt.cmd.camera],
    },
    {
      id: "stage",
      repeatable: true,
      section: "goto",
      icon: Mountain,
      label: l.cmd.stage,
      altLabels: [alt.cmd.stage],
      keywords: ["environment", "环境"],
    },
    {
      id: "ground",
      repeatable: true,
      section: "goto",
      icon: Grid3x3,
      label: l.cmd.ground,
      altLabels: [alt.cmd.ground],
      keywords: ["floor", "grid", "shadow"],
    },
    {
      id: "background",
      repeatable: true,
      section: "goto",
      icon: Image,
      label: l.cmd.background,
      altLabels: [alt.cmd.background],
      keywords: ["backdrop", "skybox", "360"],
    },
    {
      id: "effect",
      repeatable: true,
      section: "goto",
      icon: Sparkles,
      label: l.cmd.effect,
      altLabels: [alt.cmd.effect],
      keywords: ["wgsl", "stars", "shader"],
    },
    {
      id: "post",
      repeatable: true,
      nextLikely: ["export"],
      section: "goto",
      icon: Contrast,
      label: l.cmd.post,
      altLabels: [alt.cmd.post],
      keywords: ["grade", "color", "调色", "bloom", "glow", "泛光"],
    },
    {
      id: "light",
      repeatable: true,
      nextLikely: ["post"],
      section: "goto",
      // The ROW's icon, always: a goto is that row, said in the palette. Sun is
      // the tab one level in, and having both wear it made the search result and
      // the thing it scrolls to look like two different places.
      icon: Lightbulb,
      label: l.cmd.light,
      altLabels: [alt.cmd.light],
    },
    {
      id: "world",
      repeatable: true,
      section: "goto",
      icon: Globe,
      label: l.cmd.world,
      altLabels: [alt.cmd.world],
      keywords: ["ambient"],
    },
    {
      id: "sun",
      repeatable: true,
      section: "goto",
      icon: Sun,
      label: l.cmd.sun,
      altLabels: [alt.cmd.sun],
      keywords: ["azimuth", "elevation"],
    },
    {
      id: "physics",
      repeatable: true,
      section: "goto",
      icon: Atom,
      label: l.cmd.physics,
      altLabels: [alt.cmd.physics],
      keywords: ["gravity", "wind", "重力", "风"],
    },
    // A command, not a goto: it opens a panel to work in, the way Export does —
    // the goto section is for places in the dock.
    {
      id: "materials",
      // The palette is materials' only door — the cast row deliberately does not
      // open it — so the row has to be there without typing, not just findable.
      suggested: "key",
      // Rises to the TOP the moment something is uploaded — a fresh model wears
      // an auto-grouping nobody chose, and the look is the first thing anyone
      // changes. Falls back to its standing slot once you have opened it.
      fills: "look",
      repeatable: true,
      section: "command",
      icon: MaterialSphereIcon,
      label: l.editMaterials,
      altLabels: [alt.editMaterials],
      keywords: ["style groups", "shader", "look", "材质", "材料"],
    },
    // The cast/clips GROUPS left the palette — they never collapse, so "go to"
    // them means nothing. Their actions did not: these are the functions those
    // rows run, reachable without knowing where the row is.
    {
      id: "add-model",
      // The blocking gap: an empty scene has no other "what now?".
      fills: "cast",
      repeatable: true,
      section: "command",
      icon: Plus,
      label: l.addModel,
      altLabels: [alt.addModel],
      keywords: [...LOAD, "pmx", "character", "模型", "角色"],
    },
    {
      id: "upload-camera",
      repeatable: true,
      section: "command",
      icon: Video,
      label: l.uploadCameraMotion,
      altLabels: [alt.uploadCameraMotion],
      keywords: [...LOAD, "vmd", "camera", "镜头"],
    },
    {
      id: "upload-music",
      fills: "music",
      repeatable: true,
      section: "command",
      icon: Music,
      label: l.uploadMusic,
      altLabels: [alt.uploadMusic],
      keywords: [...LOAD, "audio", "bgm", "wav", "mp3", "音乐"],
    },
    {
      id: "capture",
      repeatable: true,
      section: "command",
      // A picture coming down, not a camera: Camera is the SHOT you are
      // composing, this is the file it lands in.
      icon: ImageDown,
      label: l.cmd.capture,
      altLabels: [alt.cmd.capture],
      keywords: [...SAVE, "png", "screenshot", "still", "photo", "截图", "图片"],
    },
    // Searchable in BOTH languages by design: whoever needs this is looking at a
    // UI they cannot read, and they will type the language they WANT. English
    // and 中文 are their own labels, so they work as queries in either direction.
    {
      id: "language",
      repeatable: true,
      section: "command",
      icon: Languages,
      label: l.cmd.language,
      altLabels: [alt.cmd.language],
      keywords: ["english", "中文", "chinese", "translate", "locale", "切换语言"],
    },
    // Deliberately palette-only: outlines are a preference most scenes never
    // touch, and a dock row for them would cost every user attention to serve a
    // few. Searchable, not shelved.
    {
      id: "outline",
      repeatable: true,
      section: "command",
      icon: PenLine,
      // Label filled in by paletteItems: a row that says what it WILL do beats
      // one that names a switch and leaves you to guess which way it points.
      label: l.cmd.outlineOn,
      altLabels: [alt.cmd.outlineOn, l.cmd.outlineOff, alt.cmd.outlineOff],
      keywords: ["edge", "rim", "outline", "描边", "线稿", "轮廓"],
    },
    // Palette-only, like outline above: switching the whole scene's rendering
    // style is something you reach for by name a few times, not a control worth
    // a permanent row in the dock.
    {
      id: "look",
      // The palette is this one's only door, same as materials — it is
      // deliberately not a dock row — so it has to be there without typing
      // rather than merely findable.
      suggested: "key",
      repeatable: true,
      section: "command",
      icon: Sparkles,
      label: l.cmd.look,
      altLabels: [alt.cmd.look],
      // Both packs' names in both languages: someone reaching for this is
      // thinking "wuwa", not "rendering style".
      keywords: ["wuwa", "wuthering", "鸣潮", "ag", "aether", "gazer", "深空之眼", "style", "look", "preset", "风格", "渲染"],
    },
    ...controlItemsFor(t),
  ]
}

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
  const base =
    material
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group"
  const ids = new Set(groups.map((g) => g.id))
  if (!ids.has(base)) return base
  let i = 1
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * How a new draft relates to whatever it was edited from: your own published
 * item (publishing updates it) or someone else's (publishing forks it). Neither,
 * for a built-in or a from-scratch creation — those simply become new items.
 */
function draftOriginOf(community: { id: string; mine: boolean }[], editedId: string) {
  const hit = community.find((i) => i.id === editedId)
  if (!hit) return {}
  return hit.mine ? { sourceId: hit.id } : { forkedFromId: hit.id }
}

// Where the three floating editors sit, remembered across sessions. The SAME
// keys the shipped editor writes: it is one panel per kind, and dragging the
// node editor somewhere on one route only to find it back in the middle on the
// other would be the layout forgetting something it plainly knows.
const GRAPH_PANEL_KEY = "reze-design.graphPanel"
const GRADE_PANEL_KEY = "reze-design.gradePanel"
const WGSL_PANEL_KEY = "reze-design.wgslPanel"

/** First-open default: bottom-centred, clear of both docks and the transport. */
function defaultPanelRect(): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(360, Math.min(vw - 648, 1200, vw - 48))
  const h = Math.min(460, vh - 96)
  return { x: Math.round((vw - w) / 2), y: Math.max(8, vh - h - 76), w, h }
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
  const t = useT()
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
              <UploadInvite label={empty} onClick={onPick} aria={t.lab.aria.upload(kind, of)} />
            )
          }
          actions={
            <>
              <CastAction
                icon={clip ? RefreshCw : Upload}
                label={clip ? t.lab.aria.replace(kind, of) : t.lab.aria.upload(kind, of)}
                onClick={onPick}
              />
              <CastAction icon={X} danger disabled={!clip} label={t.lab.aria.delete(kind, of)} onClick={onRemove} />
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
  const t = useT()
  // The dock's tables in the reader's language. Rebuilt only when the locale
  // does — the ids inside them never move, so everything keyed on an id
  // (recents, go-to, the control lookup) is untouched by a language switch.
  const layers = useMemo(() => layersFor(t), [t])
  const commands = useMemo(() => commandsFor(t), [t])
  // The boot document: the bundled demo with the user's stored values merged over
  // it, and their stored ASSETS replacing its cast outright when there are any.
  // Presence is the signal — hydrateScene decides, so this route, the shipped
  // editor and a fork all open on the same rules.
  //
  // STATE, not a frozen initializer: New, Reset and Import replace it (see
  // applyLabScene), and it is the identity the whole persistence layer keys on —
  // the assets record, the IndexedDB bundle and the autosave all write under
  // `scene.state.id`. Frozen, a new scene would quietly persist under the identity
  // of the one it replaced and only misbehave on the NEXT refresh.
  const [scene, setScene] = useState(() => hydrateScene(DEFAULT_SCENE))
  const [sceneName, setSceneName] = useState(scene.state.name)
  const {
    canvasRef,
    engineRef,
    models,
    ready,
    bundleFile,
    bundleFiles,
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
    swapScene,
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
  const [animByModel, setAnimByModel] = useState<Record<string, { name: string; src: File | string }>>(() =>
    seedAnims(scene),
  )
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
  //
  // Keyed on `scene`, so this is the loader for EVERY document, not just the
  // first: a swap replaces the state and the clips of the incoming cast stream in
  // through exactly this path. See applyLabScene.
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
  /**
   * The CAST: everything loaded that is not scenery.
   *
   * Stages ride in `models` because their materials take the same style-group
   * path — that is the whole reason a pure-PMX stage is worth supporting — and
   * the Environment row already owns them, name, replace and delete. Listing one
   * here would give it two homes and two delete buttons. The shipped editor
   * filters by exactly this set.
   */
  const stageIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages])
  const cast = useMemo(() => models.filter((m) => !stageIds.has(m.id)), [models, stageIds])
  /**
   * Cast rows still ON THE WAY — one skeleton each.
   *
   * Two conditions, and both are load-bearing. WHILE LOADING, because that is
   * the only time a row can be owed: the document is what promised it, and the
   * live list is what has arrived. Models stream in one at a time and a scene
   * swap keeps the outgoing cast until the incoming one lands, so "the engine is
   * busy" alone would put a skeleton above rows that are already on screen.
   *
   * And ONLY while loading, because the document is the BOOT document and never
   * hears about a deletion — once the engine is ready, everything it promised
   * has either arrived or failed, and a scene you deleted a model from would
   * otherwise keep a skeleton standing where it used to be, forever.
   */
  const pendingCast = ready ? 0 : Math.max(0, scene.assets.models.filter((m) => !m.stage).length - cast.length)
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
  /**
   * Bumped every time a right panel is SUMMONED, which is what raises it.
   *
   * The newest window goes to the front — desktop's oldest rule, and the one
   * useZOrder already applies on mount. Two panels here do not mount when they
   * open, so they never got it: export is mounted while closed (a render in
   * flight must survive its panel being hidden) and so it only ever raised at
   * boot, and the inspector, already open on one model, does not remount when
   * you summon it again. Both surfaced UNDER a library or an editor opened
   * since.
   */
  const [exportRaise, setExportRaise] = useState(0)
  // The Escape closer only while OPEN: registered permanently, a hidden panel
  // sitting at the top of the stack ate the key that should have closed the
  // library underneath it.
  const exportZ = useZOrder(exportRaise, exportOpen ? () => setExportOpen(false) : undefined)
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
  // The scene document's cameraAnimation slot. Seeded from the document like the
  // motion rows: useEngine has already handed the clip to the engine by the time
  // the chrome renders, so the name is known and there is nothing to wait for.
  const [cameraClip, setCameraClip] = useState<string | null>(scene.assets.cameraAnimation?.name ?? null)
  const cameraInput = useRef<HTMLInputElement | null>(null)
  const removeCamera = () => {
    sceneFiles.camera = null
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
  // The file lands in sceneFiles.audio — the same slot the shipped editor reads —
  // so the upload is real and the next persist packs its bytes.
  // Seeded from the scene document, exactly as main does — the default scene
  // ships with a track, and an empty music row under a dancing model would be
  // the chrome contradicting the scene. The NAME is always known here; a track
  // living in the asset bundle has no playable URL until the boot loader below
  // pulls the file out, so the row fills in first and the audio element follows.
  // Uploads become object URLs, revoked on the way out so replaced tracks do not
  // pin their bytes for the session.
  const [musicClip, setMusicClip] = useState<{ name: string; url: string } | null>(() => seedMusic(scene))
  const musicInput = useRef<HTMLInputElement | null>(null)
  const setMusicFile = useCallback((file: File) => {
    sceneFiles.audio = file
    setMusicClip((prev) => {
      dropMusicUrl(prev)
      return { name: file.name, url: URL.createObjectURL(file) }
    })
  }, [])
  const removeMusic = () => {
    sceneFiles.audio = null
    setMusicClip((prev) => {
      dropMusicUrl(prev)
      return null
    })
  }
  // Not restored. Which row is unfolded and which pane it was showing is where
  // you happened to stop, not where you want to start — reopening the editor
  // inside someone's half-finished chrome reads as a stuck panel rather than as
  // a memory. Every session opens on the same, closed, posture.
  const [openRow, setOpenRow] = useState<string | null>(null)

  const stage = stages[0] ?? null
  const stageSummary = stage ? displayName(stage.file) : t.lab.tabs.ground
  // Controlled (not key-remounted): go-to deep-links need to land on a pane —
  // "Background" opens this row on its background tab. Where you left each one
  // is UI state, so it comes back from the same store the stack's own shape does.
  const [stageTab, setStageTab] = useState<"stage" | "ground" | "background">("ground")
  const [cameraTab, setCameraTab] = useState<"lens" | "focus">("lens")
  const [postTab, setPostTab] = useState<"grade" | "tone" | "bloom" | "outline">("grade")
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
  const { sun, world, bloom, dof, grade, ground, physics, view } = settings
  const [bgEffect, setBgEffect] = useState(scene.state.backgroundEffect)

  // ONE slot for the three libraries — see useBrowseSurface. They were three
  // independent booleans here, so opening one left the others up: a second
  // library over the first, the same size and position, and the swap read as a
  // flash. Exclusion is now structural rather than something each opener has to
  // remember, which is also what makes LIBRARY_SHELL's suppressed animations
  // land as one panel changing contents.
  const {
    facet: libraryFacet,
    open: openBrowse,
    close: closeBrowse,
    closeIf: closeBrowseIf,
    graphLibrary: graphLib,
    gradesOpen: gradeLibOpen,
    effectsOpen: effectLibOpen,
    galleryOpen,
  } = useBrowseSurface()

  // Grade: main's full selection model. Drafts and community feed both the
  // quick list and NAME RESOLUTION — a scene applying a community grade must
  // resolve it the way the render will.
  const { drafts: gradeDrafts } = useDrafts<GradeItem>("grade")
  const communityGrades = useCommunity<GradeItem>("grade")
  // Whose name a saved draft carries. Signed out it is simply "you" — a draft
  // never leaves this device until it is published, and publishing is where an
  // account becomes the answer.
  const { data: authSession } = useSession()
  const authorName = authSession?.user.username ?? t.bgLibrary.you
  // The grade editor is a floating SCRATCHPAD, the shipped editor's own:
  // `subject` is the working copy — live on the render, written nowhere. Only
  // the save-on-close dialog creates or updates a draft, so closing clean, or
  // discarding, leaves no trace.
  const [gradeEditor, setGradeEditor] = useState<{
    sessionId: number
    subject: GradeEditorSubject
    opened: GradeEditorSubject
    savePrompt: boolean
  } | null>(null)
  // Lazy: the rect resolves on first OPEN — an event handler, so a panel this
  // session never uses costs no storage read and no second render.
  const {
    rect: gradePanelRect,
    update: updateGradePanelRect,
    ensure: ensureGradePanelRect,
  } = useStoredRect(GRADE_PANEL_KEY, defaultPanelRect)
  const appliedGradeDraftId = gradeDrafts.find((d) => d.name === grade.preset)?.id ?? null
  // A built-in grade's name is its ID in the document and a TRANSLATION on
  // screen — the same split main uses. Drafts and community grades are user
  // strings, so they show exactly as authored.
  const gradeLabel = useCallback(
    (name: string) => t.scene.gradePresets[name as keyof typeof t.scene.gradePresets] ?? name,
    [t],
  )
  const pickGrade = useCallback(
    (name: string) => patch("grade", { preset: name, intensity: recallIntensity(name) }),
    [patch],
  )
  // An open session OVERRIDES the document's grade: the editor's working spec is
  // what the render resolves to, which is the whole reason dragging a slider is
  // visible on the canvas. The document is untouched until the session saves.
  const appliedGradeSpec = useMemo(
    () => (gradeEditor ? gradeEditor.subject.spec : gradeSpec(grade.preset, [...gradeDrafts, ...communityGrades])),
    [gradeEditor, grade.preset, gradeDrafts, communityGrades],
  )
  // Same three parts as the effect list, in the same order: the rows, an
  // "edited" hint when what is applied has drifted from the entry it came from,
  // and a transient row for a look no list holds. Both lists say the same thing
  // the same way — otherwise an unsaved grade edit reads as though the preset
  // itself had changed.
  const gradeItems = useMemo(() => {
    const items = [
      // Sorted by the LABEL, which is the grade library's own ordering (it sorts
      // its built-in rows the same way, through the same translation). The two
      // lists hold the same set, so a different order between them means hunting
      // for a name in a place it was not a moment ago.
      ...quickPickItems([...GRADE_PRESETS].sort((a, b) => gradeLabel(a.name).localeCompare(gradeLabel(b.name))), gradeDrafts, appliedGradeDraftId).map((g) => ({
        id: g.name,
        label: gradeLabel(g.name),
        section: g.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityGrades),
    ]
    const preset = settings.grade.preset
    const source = gradeSpec(preset, [...gradeDrafts, ...communityGrades])
    if (JSON.stringify(appliedGradeSpec) === JSON.stringify(source)) return items
    const known = items.some((i) => i.id === preset)
    const withOwn = known ? items : [...items, { id: preset, label: preset, section: "local" as const }]
    return withOwn.map((i) => (i.id === preset ? { ...i, hint: t.scene.edited } : i))
  }, [gradeDrafts, appliedGradeDraftId, communityGrades, gradeLabel, settings.grade.preset, appliedGradeSpec, t])
  // Plain functions, the shipped editor's own call: they feed dialogs that are
  // not memoized, so memoizing buys nothing.
  const openGradeEditor = (subject: GradeEditorSubject) => {
    ensureGradePanelRect()
    setGradeEditor((prev) => ({ sessionId: (prev?.sessionId ?? 0) + 1, subject, opened: subject, savePrompt: false }))
  }
  /**
   * Edit the grade the scene is WEARING — the quick list's own door, and the
   * shipped editor's `editCurrentGrade` unchanged.
   *
   * The subject is the applied look resolved back to a library row: your draft
   * or a community item when the name belongs to one (so the session saves back
   * into it), the preset name itself when it is a built-in — and only then is
   * there an `origin`, because only a built-in is something "back to preset" can
   * revert to. Everything after that is the flow the editors already share:
   * the session PREVIEWS through appliedGradeSpec and never writes
   * settings.grade, so nothing is saved until the close prompt says so.
   */
  const editCurrentGrade = () => {
    const preset = settings.grade.preset
    const own = [...gradeDrafts, ...communityGrades].find((g) => nameKey(g.name) === nameKey(preset))
    openGradeEditor({
      id: own?.id ?? preset,
      name: preset,
      spec: appliedGradeSpec,
      origin: own ? undefined : preset,
    })
  }
  const editGrade = (next: GradeEditorSubject) => {
    setGradeEditor((prev) => (prev ? { ...prev, subject: next } : prev))
    // Your own draft saves as you go. Only drafts: a built-in or someone else's
    // published work has no local home to write to until the close prompt gives
    // it one.
    if (isDraft("grade", next.id)) updateDraftSoon("grade", next.id, { payload: { spec: next.spec } })
  }
  const freeGradeName = (wanted: string, editingId?: string) => freeName("grade", wanted, editingId)
  /** The BUILT-IN spec an edit descends from — what "back to preset" reverts to.
   *  Neutral, never the authoring starting point: revert means back to no grade. */
  const gradeAncestor = (subject?: GradeEditorSubject) =>
    GRADE_PRESETS.find((g) => g.name === (subject?.origin ?? subject?.name))?.payload.spec ?? NEUTRAL_SPEC
  const requestCloseGradeEditor = () => {
    if (!gradeEditor) return
    const { subject, opened } = gradeEditor
    const dirty = subject.name !== opened.name || JSON.stringify(subject.spec) !== JSON.stringify(opened.spec)
    if (!dirty) {
      setGradeEditor(null)
      return
    }
    // An existing draft has a home — save in place, no questions.
    if (isDraft("grade", subject.id)) {
      updateDraft("grade", subject.id, { payload: { spec: subject.spec } })
      setGradeEditor(null)
      return
    }
    setGradeEditor({ ...gradeEditor, savePrompt: true })
  }
  const saveGradeEdit = (wanted: string): string | null => {
    if (!gradeEditor) return null
    const { subject } = gradeEditor
    const keep = isDraft("grade", subject.id) ? subject.id : undefined
    const name = freeGradeName(wanted, subject.id)
    if (keep) updateDraft("grade", keep, { name, payload: { spec: subject.spec } })
    else
      createDraft("grade", {
        name,
        payload: { spec: subject.spec },
        author: authorName,
        // Editing your OWN published preset makes a working copy of it, so
        // publishing writes that item's next version instead of a second item.
        ...draftOriginOf(communityGrades, subject.id),
      })
    // Applying is what puts the result in the DOCUMENT — the session previewed
    // through appliedGradeSpec and never touched settings.grade, so without this
    // the saved scene would still be wearing whatever it wore before.
    pickGrade(name)
    setGradeEditor(null)
    return null
  }
  /** A draft that saved as you went goes back to what the session opened on —
   *  otherwise "discard" would keep everything except the last few hundred ms. */
  const discardGradeEdit = () => {
    if (!gradeEditor) return
    const { subject, opened } = gradeEditor
    if (isDraft("grade", subject.id)) {
      cancelDraftWrites("grade", subject.id)
      updateDraft("grade", subject.id, { payload: { spec: opened.spec } })
    }
    setGradeEditor(null)
  }
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
  const swapBgImage = useCallback(
    (next: (BackdropMedia & { dome: boolean }) | null) =>
      setBgImage((prev) => {
        releaseBackdrop(prev)
        return next
      }),
    [],
  )
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
    [swapBgImage],
  )

  // ── The rest of the document ──
  //
  // The cast's clips load with the models above; these are the slots nobody owns
  // — music, the background image, and the camera clip's identity. Each resolves
  // out of the scene's BUNDLE first (a published zip and the local IndexedDB
  // bundle look identical through bundleFile) and out of its URL otherwise, so a
  // stored scene comes back with the same files it was saved with. A slot that
  // fails to resolve is simply empty; nothing here may take the scene down.
  //
  // Boot and swap both arrive here, for the same reason the clip loader above
  // does: one loader per slot, or a reset would quietly keep the music the scene
  // it replaced was playing.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // ONE pass over the slots, in document order — the shipped editor's
    // loadDocExtras, which is async because resolving a slot to a File is.
    void (async () => {
      // The engine already loaded the camera VMD inside loadSceneInto. What is
      // left is the File behind it, so the next persist re-packs the same bytes
      // instead of dropping the clip on the first save.
      const cam = scene.assets.cameraAnimation
      if (cam) {
        const packed = bundleFile(cam.url)
        if (packed) sceneFiles.camera = packed
      }
      const track = scene.assets.audio
      // A served track plays straight off its URL and was seeded at boot; only a
      // packed one has to be pulled out of the bundle and given an object URL.
      if (track) {
        const packed = bundleFile(track.url)
        if (packed) setMusicFile(packed)
      }
      const bg = scene.assets.background
      if (!bg) return
      try {
        const packed = bundleFile(bg.asset.url)
        let file = packed
        if (!file && servedUrl(bg.asset.url)) {
          const blob = await (await fetch(bg.asset.url)).blob()
          file = new File([blob], bg.asset.name, { type: blob.type })
        }
        if (!file) return
        const media = await probeBackdrop(file)
        // Probing minted an object URL; a superseded pass has to give it back.
        if (cancelled) {
          releaseBackdrop(media)
          return
        }
        swapBgImage({ ...media, dome: bg.kind === "skybox" })
      } catch {
        // a missing or undecodable image degrades to no background, not a dead scene
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, scene, bundleFile, setMusicFile, swapBgImage])

  // noteAppliedWgsl is the WGSL editor's half of the bargain: the editor
  // compiles straight to the engine for its live preview, and telling the sync
  // pass what is already on screen keeps it from compiling the same shader a
  // second time when the applied effect lands in state.
  const { noteAppliedWgsl } = useSceneSync({
    engineRef,
    ready,
    settings,
    camera,
    cameraVmd: cameraClip !== null,
    gradeSpec: appliedGradeSpec,
    backgroundEffect: bgEffect,
    hasBackdrop: !!bgImage && !bgImage.dome,
    skybox: bgImage?.dome ? bgImage.file : null,
    greenScreen: framing.liveGreenScreen,
  })

  // Effects: the same selection model as grade, one library over.
  const { drafts: effectDrafts } = useDrafts<EffectItem>("effect")
  const communityEffects = useCommunity<EffectItem>("effect")
  // "Edited" means the APPLIED shader differs from its saved source, built-in or
  // draft. An editor session applies as you type, so the row says so while the
  // session runs and stops saying it the moment you save or discard — the list
  // and the canvas never disagree about what is on screen. An unsaved NEW effect
  // is in no list at all, so it gets a transient row: without one the trigger
  // falls through to its placeholder and the dock reads "None" while an effect
  // is plainly running.
  const effectItems = useMemo(() => {
    const items = [
      // By name, matching the effect library's own ordering — see the grade list.
      ...quickPickItems([...BACKGROUND_EFFECTS].sort((a, b) => a.name.localeCompare(b.name)), effectDrafts, bgEffect?.id ?? null).map((e) => ({
        id: e.name,
        label: e.name,
        section: e.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityEffects),
    ]
    if (!bgEffect?.name) return items
    const pristine = [...BACKGROUND_EFFECTS, ...effectDrafts, ...communityEffects].some(
      (e) => e.name === bgEffect.name && e.payload.wgsl === bgEffect.wgsl,
    )
    if (pristine) return items
    const known = items.some((i) => i.id === bgEffect.name)
    const withOwn = known ? items : [...items, { id: bgEffect.name, label: bgEffect.name, section: "local" as const }]
    return withOwn.map((i) => (i.id === bgEffect.name ? { ...i, hint: t.scene.edited } : i))
  }, [effectDrafts, bgEffect, communityEffects, t])

  const pickEffect = useCallback(
    (name: string) => {
      // Picking what is ALREADY applied takes it off. An effect is the one thing
      // in this dock a scene is routinely better without, and the alternative was
      // a "None" row sitting permanently at the top of a list of effects. The
      // ticked row is the affordance: a tick you can click off.
      if (bgEffect?.name === name) {
        setBgEffect(null)
        return
      }
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
    [effectDrafts, communityEffects, bgEffect],
  )

  // ── The WGSL effect editor ──
  //
  // The same scratchpad one library over: `subject` is what opened (its wgsl is
  // the dirty baseline), `prior` is what the scene showed before — restored on
  // discard, and on any close that saved nothing. Compiles preview live; drafts
  // are written only by the save-on-close dialog.
  const [effectEditor, setEffectEditor] = useState<{
    sessionId: number
    subject: AppliedBackgroundEffect
    prior: AppliedBackgroundEffect | null
    savePrompt: string | null
  } | null>(null)
  const effectSessionRef = useRef(0)
  const {
    rect: effectPanelRect,
    update: updateEffectPanelRect,
    ensure: ensureEffectPanelRect,
  } = useStoredRect(WGSL_PANEL_KEY, defaultPanelRect)
  /** Compile + apply in one step — the scene mirrors the buffer. */
  const commitEffectCode = useCallback(
    async (subject: AppliedBackgroundEffect, wgsl: string) => {
      const engine = engineRef.current
      if (!engine) return { ok: false, diagnostics: [t.lab.engineNotReady] }
      const r = await engine.setEffect(wgsl)
      if (r.ok) {
        noteAppliedWgsl(wgsl)
        setBgEffect({ ...subject, wgsl })
        // Same rule as grades: your own draft saves as you go.
        if (isDraft("effect", subject.id)) updateDraftSoon("effect", subject.id, { payload: { wgsl } })
      }
      return r
    },
    [engineRef, noteAppliedWgsl, t],
  )
  // Memoized (unlike the grade editor's opener) because the command palette runs
  // it: a plain function in runCommand's dependency array is something the
  // compiler cannot keep memoized.
  const openEffectEditor = useCallback(
    (subject: AppliedBackgroundEffect) => {
      effectSessionRef.current += 1
      // Opening AUTO-APPLIES the subject, which is what makes the canvas behind
      // the panel the preview rather than a separate thing to keep in sync.
      setEffectEditor({ sessionId: effectSessionRef.current, subject, prior: bgEffect, savePrompt: null })
      ensureEffectPanelRect()
      void commitEffectCode(subject, subject.wgsl)
    },
    [bgEffect, ensureEffectPanelRect, commitEffectCode],
  )
  /** Edit the effect the scene is wearing. No subject to resolve — an applied
   *  effect already IS its row, carried by value. */
  const editCurrentEffect = () => {
    if (bgEffect) openEffectEditor(bgEffect)
  }
  /** Close request from the editor. Dirty → prompt; clean → the preview simply
   *  ends, and whatever was applied before the session comes back. */
  const requestCloseEffectEditor = async (code: string) => {
    if (!effectEditor) return
    if (code === effectEditor.subject.wgsl) {
      setBgEffect(effectEditor.prior)
      setEffectEditor(null)
      return
    }
    // An existing draft saves in place when it compiles; a refusal (or a nameless
    // new effect) goes through the dialog.
    if (isDraft("effect", effectEditor.subject.id)) {
      const engine = engineRef.current
      const r = engine ? await engine.setEffect(code) : { ok: false }
      if (r.ok) {
        noteAppliedWgsl(code)
        const { id, name } = effectEditor.subject
        updateDraft("effect", id, { payload: { wgsl: code } })
        setBgEffect({ id, name, wgsl: code })
        setEffectEditor(null)
        return
      }
    }
    setEffectEditor({ ...effectEditor, savePrompt: code })
  }
  const discardEffectEdit = () => {
    if (!effectEditor) return
    // Discard UNDOES the as-you-go writes, not just stops them.
    if (isDraft("effect", effectEditor.subject.id)) {
      cancelDraftWrites("effect", effectEditor.subject.id)
      updateDraft("effect", effectEditor.subject.id, { payload: { wgsl: effectEditor.subject.wgsl } })
    }
    setBgEffect(effectEditor.prior)
    setEffectEditor(null)
  }
  const freeEffectName = (wanted: string, editingId?: string) => freeName("effect", wanted, editingId)
  const saveEffectEdit = async (wanted: string): Promise<string | null> => {
    if (!effectEditor?.savePrompt) return null
    const { subject, savePrompt: code } = effectEditor
    // A broken shader must not land in the library — it would be auto-applied on
    // every future pick. Compiling IS applying, which is also what save wants.
    const isExisting = isDraft("effect", subject.id)
    const engine = engineRef.current
    const r = engine ? await engine.setEffect(code) : { ok: false, diagnostics: [t.lab.engineNotReady] }
    if (!r.ok) return r.diagnostics[0] ?? t.lab.compileFailed
    noteAppliedWgsl(code)
    const keep = isExisting ? subject.id : undefined
    const name = freeEffectName(wanted, subject.id)
    let id = keep
    if (keep) updateDraft("effect", keep, { name, payload: { wgsl: code } })
    else
      id = createDraft("effect", {
        name,
        payload: { wgsl: code },
        author: authorName,
        ...draftOriginOf(communityEffects, subject.id),
      }).id
    setBgEffect({ id: id!, name, wgsl: code })
    setEffectEditor(null)
    return null
  }

  // The chrome waits one tick before it exists, which is main's own gate
  // (app/page.tsx `mounted`). Two things need it: values read from
  // localStorage cannot be read while rendering on the server, and the LOCALE
  // is detected in an effect — so anything drawn on the first pass is drawn in
  // English and then rewritten, which is exactly the flash. The canvas, the
  // file inputs and the audio element stay outside the gate: they hold refs
  // other effects reach for, and none of them render a word. The audio element's
  // SRC is still gated on this, though — see the element. An attribute fed by
  // restored state is exactly the storage-during-render problem, whether or not
  // the element draws a word.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(id)
  }, [])
  // Deliberately NOT restored from storage, unlike the row and tab selections
  // below: collapsed is a way of LOOKING at the scene, not a piece of work in
  // progress. Reopening to a collapsed dock reads as chrome that failed to
  // load, and the person who likes it collapsed pays one click — the person who
  // does not would be staring at an empty screen wondering where the app went.
  // The device rule still applies: a coarse pointer starts collapsed.
  const [expanded, setExpanded] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches,
  )
  // The dock joins the desktop stack the libraries already live in: clicking
  // (or tabbing into) it raises it over an open library, clicking the library
  // raises it back. No Escape closer — Escape keeps closing the topmost
  // LIBRARY; the stack walk skips surfaces that never close.
  const dockZ = useZOrder()
  const [inspectorRaise, setInspectorRaise] = useState(0)
  const inspectorZ = useZOrder(inspectorRaise)

  // ── Inspect a cast member ──
  // Clicking a cast row selects the model and opens the right dock on ITS
  // style groups — the inspector is about what you picked. The real
  // MaterialsPanel mounts, not a lite copy: tree, drag-to-regroup, rename,
  // visibility, hover-highlight, per-group look QuickPick. Both deep doors hang
  // off it too — the shader-graph library and the node editor — and they are
  // FLOATING panels rather than right-dock ones, so they join the z-order stack
  // the libraries already live in instead of evicting the inspector that opened
  // them. Editing a look while you cannot see the group you are editing is not
  // a workflow.
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const inspected = models.find((m) => m.id === inspectedId) ?? null
  // Which group the node editor is bound to. Per MODEL, which is why moving the
  // inspector to another character clears it: group ids are per model ("hair"
  // exists on both), so a kept id would silently rebind the open editor to a
  // different character's group of the same name.
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // The inverted-hull outline pass, off by default since 0.25.2 and reachable
  // only by searching for it. It lives in the document (settings.outline) like
  // every other look setting; when outlines earn size, opacity and colour
  // overrides they join it there.
  //
  // The ref MIRRORS the document, and the palette's On/Off hint is separate
  // state, for the same reason the recents order is staged rather than applied
  // (see openPalette): flipping it from the palette would otherwise rewrite the
  // row you just chose while the dialog is still fading out. The scene changes
  // now; the label catches up at the next open.
  const outlineRef = useRef(settings.outline.enabled)
  useEffect(() => {
    outlineRef.current = settings.outline.enabled
  })
  /** Open the materials inspector on a model — the cast row's own click, the
   *  row's Materials button and the palette all come through here, so the
   *  one-right-panel-at-a-time rule lives in exactly one place. */
  /** The export panel, from anywhere. Capture and every export setting land
   *  here — the panel IS the surface for all of them. */
  const openExport = useCallback(() => {
    setInspectedId(null)
    setExportOpen(true)
    setExportRaise((n) => n + 1)
  }, [])
  /**
   * Uploaded this session and not styled yet.
   *
   * Uploads happen from the DOCK, so the palette's history never sees them —
   * without this, "I just added a model" is invisible to Suggestions. Ids go in
   * when a model or stage arrives and come out when you open its materials,
   * which is the act the suggestion was pointing at. Stages count: they are
   * deliberately NOT auto-grouped, so a fresh one has no look at all.
   */
  const [unstyled, setUnstyled] = useState<string[]>([])
  const noteArrival = useCallback((id: string) => setUnstyled((prev) => (prev.includes(id) ? prev : [...prev, id])), [])
  const noteStyled = useCallback((id: string) => setUnstyled((prev) => prev.filter((x) => x !== id)), [])

  const openMaterials = useCallback(
    (id: string | null) => {
      if (!id) return
      setExportOpen(false)
      // Summoned, so it comes forward — even when it was already open on this
      // model and nothing remounts.
      setInspectorRaise((n) => n + 1)
      // Only on a genuine change: re-opening the panel on the model you are
      // already editing must not unbind the node editor you have open on it.
      if (id !== inspectedId) setActiveGroupId(null)
      setInspectedId(id)
      // You came and looked — the suggestion has been taken.
      noteStyled(id)
    },
    [inspectedId, noteStyled],
  )
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
    let label = t.lab.newGroup
    for (let n = 2; labels.has(label); n++) label = t.lab.newGroupN(n)
    inspectGroupsApply([
      ...inspectedGroups,
      { id, label, materials: [], graph: structuredClone(DEFAULT_GRAPH), renderClass: "auto" },
    ])
    return id
  }, [inspectedGroups, inspectGroupsApply, t])
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
  /**
   * Switch the whole scene to a rendering style.
   *
   * Role for role, across every model: a body group takes the pack's body graph,
   * a hair group its hair graph. A group whose look belongs to neither pack — a
   * community graph, or the neutral default — is left alone, because the user
   * chose it and a style switch is not a reset.
   *
   * The view transform comes with it. That is not a preference the pack is
   * overreaching into: WuWa is authored under Standard and reads washed under
   * Filmic, so applying the graphs without it delivers a look nobody tuned.
   * World and sun stay untouched — those are the scene's art direction.
   */
  /** Which style the scene is wearing, for the shelf's tick. Null when it wears
   *  neither whole — a half-switched scene is genuinely neither. */
  const activePack = useMemo(
    () => activeLookPack(Object.values(groupsByModel).flat().map((g) => g.graph)),
    [groupsByModel],
  )
  const applyLookPack = useCallback(
    (pack: LookPack) => {
      for (const [modelId, list] of Object.entries(groupsByModel)) {
        const next = list.map((g) => {
          const graph = packGraph(pack, graphRole(g.graph))
          return graph ? { ...g, graph: structuredClone(graph) } : g
        })
        if (next.some((g, i) => g !== list[i])) void applyGroups(modelId, next)
      }
      const { transform, exposure, world } = LOOK_PACKS[pack]
      setSettings((prev) => ({ ...prev, view: { transform, exposure }, world: { ...prev.world, ...world } }))
      // Remembered for the NEXT model, not for this scene — the scene already
      // carries what it is wearing.
      saveLookPref(pack)
    },
    [groupsByModel, applyGroups],
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

  // ── The shader-graph library and the node editor ──
  //
  // The panel's two deep doors, mechanism and all: a floating window whose rect
  // persists, a session id that raises it, and a SCRATCHPAD contract on both
  // sides. Editing a group's graph previews by WRITING the group — that is the
  // preview — so closing has to either keep the result in the library or put the
  // group back, or a look built here could only ever live in this one scene:
  // invisible in the library, unusable on another group, impossible to publish.
  const communityGraphs = useCommunity<GraphItem>("graph")
  // Eager, unlike the other two editors': this panel stays MOUNTED while closed
  // (see the JSX), so it needs its rect on the first render it appears in.
  const { rect: graphPanelRect, update: updateGraphPanelRect } = useStoredRect(GRAPH_PANEL_KEY, defaultPanelRect, {
    eager: true,
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Bumped per open so the panel RAISES each time. It stays mounted while
  // closed, so without this it would only ever surface on first mount, and
  // opening the editor from the library would leave the library on top of it.
  const [graphSession, setGraphSession] = useState(0)
  // An export has run this session. Not persisted: it answers "have you seen
  // this rendered yet", which is a question about the sitting, not the document.
  const [exportedOnce, setExportedOnce] = useState(false)
  // Publishing. A scrimmed dialog, not a panel: this is the one task where the
  // canvas is NOT what you are working on — you are naming and describing the
  // thing you already made.
  const [shareOpen, setShareOpen] = useState(false)
  // Graph editor filling the screen. Session state, not stored with the rect:
  // the rect is where your window LIVES and is worth remembering, while filling
  // the screen is something you do for one dense graph and leave behind.
  const [graphFull, setGraphFull] = useState(false)
  // A standalone graph-editing session: a library act, never bound to a group.
  const [graphLibEdit, setGraphLibEdit] = useState<{
    sessionId: number
    id: string
    name: string
    opened: ShaderGraph
    savePrompt: boolean
  } | null>(null)
  const graphLibLatest = useRef<ShaderGraph | null>(null)
  // What the group's graph was when the session opened, and WHOSE group it is.
  // The model travels with it because the inspector can move to another
  // character mid-session, and a discard has to reach the group it started on.
  const groupGraphBaseline = useRef<{ modelId: string; groupId: string; graph: ShaderGraph } | null>(null)
  const [groupGraphPrompt, setGroupGraphPrompt] = useState(false)
  // Remounts the editor when the library swaps the bound group's graph underneath it.
  const [libVersion, setLibVersion] = useState(0)

  const activeGroup = inspectedGroups.find((g) => g.id === activeGroupId) ?? null
  // The factory preset the editor's Reset returns to: the LIBRARY entry this
  // group's graph came from, never the group's live graph — which would make
  // Reset restore the state you were trying to leave.
  const presetGraph = activeGroup
    ? (GRAPH_LIBRARY.find((e) => e.name === activeGroup.graph?.name)?.payload.graph ??
      SLOT_GRAPHS[activeGroup.id as MaterialPreset] ??
      DEFAULT_GRAPH)
    : null
  /** The editor's onApply: compile the edited graph onto the bound group. This
   *  goes through the same upsertGroup the QuickPick does, so the edit reaches
   *  groupsByModel — which is what the debounced document save reads. */
  const applyActiveGraph = useCallback(
    (graph: ShaderGraph, opts?: CompileOptions): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> =>
      inspectedId && activeGroup
        ? upsertGroup(inspectedId, { ...activeGroup, graph }, opts)
        : Promise.resolve({ ok: false, diagnostics: [] }),
    [inspectedId, activeGroup, upsertGroup],
  )
  /** Focus a group and open the node editor on it (snapshotting a baseline). */
  const editGroupGraph = useCallback(
    (id: string) => {
      const g = inspectedGroups.find((x) => x.id === id)
      if (!inspectedId || !g) return
      groupGraphBaseline.current = { modelId: inspectedId, groupId: id, graph: structuredClone(g.graph) }
      setActiveGroupId(id)
      setGraphLibEdit(null)
      setGraphSession((v) => v + 1)
      setDrawerOpen(true)
    },
    [inspectedId, inspectedGroups],
  )
  const openGraphLibrary = useCallback(
    (groupId: string | null) => openBrowse({ kind: "graph", groupId }),
    [openBrowse],
  )

  const [gallerySeen, setGallerySeen] = useState(
    () => typeof window !== "undefined" && !!window.localStorage.getItem(GALLERY_SEEN_KEY),
  )
  /** Every entrance to the gallery goes through here — the logo menu, the
   *  palette, the account panel's scene count — so "they have been" cannot be
   *  true through one door and false through another. */
  const openGallery = useCallback(() => {
    try {
      window.localStorage.setItem(GALLERY_SEEN_KEY, "1")
    } catch {
      // private mode — the suggestion simply keeps offering, which is harmless
    }
    setGallerySeen(true)
    openBrowse({ kind: "gallery" })
  }, [openBrowse])

  /** The account panel's stat rows are doors: your scenes open the gallery, your
   *  looks open their own library already filtered to yours — which is the whole
   *  reason the slot carries a facet. Written out per kind rather than passed
   *  through: each variant of the union is a different shape (a graph library
   *  knows what group it applies to), and one of them is not a library at all. */
  const openForAccount = useCallback(
    (kind: "grade" | "effect" | "graph" | "scene") => {
      if (kind === "scene") openGallery()
      else if (kind === "graph") openBrowse({ kind: "graph", groupId: null }, "yours")
      else openBrowse(kind === "grade" ? { kind: "grade" } : { kind: "effect" }, "yours")
    },
    [openBrowse, openGallery],
  )

  // The session handlers are plain functions: nothing takes them as a
  // dependency, and the compiler cannot preserve a manual memo across the async
  // bodies among them anyway.

  /** Your local draft that a graph name refers to — the thing an edit made from
   *  the quick switch saves back into. */
  const draftGraphNamed = (name: string) => loadDrafts().graph.find((d) => nameKey(d.name) === nameKey(name))
  const freeGraphName = (wanted: string, editingId?: string) => freeName("graph", wanted, editingId)
  /** The group a group-session is bound to, resolved through the BASELINE's
   *  model rather than the inspector's — the inspector may have moved on. */
  const baselineGroup = () => {
    const base = groupGraphBaseline.current
    const group = base ? (groupsByModel[base.modelId] ?? []).find((x) => x.id === base.groupId) : null
    return base && group ? { base, group } : null
  }
  /**
   * Closing a GROUP graph session.
   *
   * Unchanged closes silently. Changed asks to keep it. Editing one of YOUR
   * drafts is not that situation — it already has a home, so it saves in place
   * and closes; asking where to put it would mint another copy of the draft you
   * were already editing every time you closed.
   */
  const closeGraphEdit = () => {
    const hit = baselineGroup()
    // Compared by LOOK, not bytes: merely opening the editor round-trips the
    // graph through ReactFlow and stamps node layout onto it, so a raw compare
    // calls every session dirty and asks to save a graph nobody touched.
    if (!hit || sameGraphLook(hit.group.graph, hit.base.graph)) {
      groupGraphBaseline.current = null
      setDrawerOpen(false)
      return
    }
    // By name, which IS the identity a group holds a look by.
    const draft = draftGraphNamed(hit.group.graph.name)
    // A save that does not compile is refused everywhere else; surfacing that
    // needs the dialog, so fall through to it rather than keeping a dud.
    if (draft && compileGraph(hit.group.graph).ok) {
      updateDraft("graph", draft.id, { payload: { graph: hit.group.graph } })
      groupGraphBaseline.current = null
      setDrawerOpen(false)
      return
    }
    setGroupGraphPrompt(true)
  }
  const saveGroupGraph = (wanted: string): string | null => {
    const hit = baselineGroup()
    if (!hit) return null
    // Your own draft keeps its identity and its name — this is the same save the
    // silent path does, reached only because a compile error had to be shown.
    const keep = draftGraphNamed(hit.group.graph.name)
    const name = keep?.name ?? freeGraphName(wanted)
    const graph = { ...hit.group.graph, name }
    const r = compileGraph(graph)
    if (!r.ok) return r.diagnostics.find((d) => d.severity === "error")?.message ?? t.lab.compileFailed
    if (keep) updateDraft("graph", keep.id, { payload: { graph } })
    else createDraft("graph", { name, payload: { graph }, author: authorName })
    // The group keeps it too, now under the saved name, so the scene and the
    // library agree about what this look is called.
    void upsertGroup(hit.base.modelId, { ...hit.group, graph })
    groupGraphBaseline.current = null
    setGroupGraphPrompt(false)
    setDrawerOpen(false)
    return null
  }
  const discardGroupGraph = () => {
    const hit = baselineGroup()
    if (hit) void upsertGroup(hit.base.modelId, { ...hit.group, graph: hit.base.graph })
    groupGraphBaseline.current = null
    setGroupGraphPrompt(false)
    setDrawerOpen(false)
  }

  /** Standalone graph editing — the library's Edit. Same contract, except edits
   *  compile PURELY: compileGraph needs no engine and no group. */
  const openGraphLibEdit = (id: string, name: string, graph: ShaderGraph) => {
    graphLibLatest.current = null
    setGraphLibEdit((prev) => ({ sessionId: (prev?.sessionId ?? 0) + 1, id, name, opened: graph, savePrompt: false }))
    setGraphSession((v) => v + 1) // raiseKey: the editor must surface above the library
    setDrawerOpen(true)
  }
  const compileStandalone = (graph: ShaderGraph): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> => {
    graphLibLatest.current = graph
    const r = compileGraph(graph)
    // Editing your own draft saves as you go — closing it is then just closing,
    // and a crash or a stray reload costs nothing. Only drafts: a built-in or
    // someone else's published work has no local home to write to yet.
    if (graphLibEdit && isDraft("graph", graphLibEdit.id))
      updateDraftSoon("graph", graphLibEdit.id, { payload: { graph: { ...graph, name: graphLibEdit.name } } })
    return Promise.resolve({ ok: r.ok, diagnostics: r.diagnostics })
  }
  const requestCloseGraphDrawer = () => {
    if (!graphLibEdit) {
      setDrawerOpen(false)
      return
    }
    const latest = graphLibLatest.current ?? graphLibEdit.opened
    // By LOOK, not bytes — the same compare the group path makes.
    if (sameGraphLook(latest, graphLibEdit.opened)) {
      setGraphLibEdit(null)
      setDrawerOpen(false)
      return
    }
    // An existing draft saves in place — unless it stopped compiling, in which
    // case the dialog surfaces the refusal.
    if (isDraft("graph", graphLibEdit.id) && saveGraphLibEdit(graphLibEdit.name) === null) return
    setGraphLibEdit({ ...graphLibEdit, savePrompt: true })
  }
  const saveGraphLibEdit = (wanted: string): string | null => {
    if (!graphLibEdit) return null
    const keep = isDraft("graph", graphLibEdit.id) ? graphLibEdit.id : undefined
    const name = freeGraphName(wanted, graphLibEdit.id)
    const graph = { ...(graphLibLatest.current ?? graphLibEdit.opened), name }
    const r = compileGraph(graph)
    if (!r.ok) return r.diagnostics.find((d) => d.severity === "error")?.message ?? t.lab.compileFailed
    if (keep) updateDraft("graph", keep, { name, payload: { graph } })
    else
      createDraft("graph", {
        name,
        payload: { graph },
        author: authorName,
        ...draftOriginOf(communityGraphs, graphLibEdit.id),
      })
    setGraphLibEdit(null)
    setDrawerOpen(false)
    return null
  }
  const discardGraphLibEdit = () => {
    // Discard has to undo save-as-you-go, not just stop it — see discardGradeEdit.
    if (graphLibEdit && isDraft("graph", graphLibEdit.id)) {
      cancelDraftWrites("graph", graphLibEdit.id)
      updateDraft("graph", graphLibEdit.id, { payload: { graph: { ...graphLibEdit.opened, name: graphLibEdit.name } } })
    }
    setGraphLibEdit(null)
    setDrawerOpen(false)
  }
  /** Apply a library graph to the group the library was opened from. */
  const applyGraphLibrary = (graph: ShaderGraph, name: string) => {
    const group = inspectedGroups.find((g) => g.id === graphLib?.groupId)
    if (!inspectedId || !group) return
    const updated: StyleGroup = { ...group, graph: { ...graph, name } }
    // The same split inspectPickGraph makes: grouped materials recompile through
    // upsert, an empty group just records the choice.
    if (updated.materials.length) void upsertGroup(inspectedId, updated)
    else inspectGroupsApply(inspectedGroups.map((x) => (x.id === group.id ? updated : x)))
    setActiveGroupId(group.id)
    setLibVersion((v) => v + 1)
    closeBrowseIf("graph")
  }
  // A draft renamed in the library takes the groups wearing it along. A group
  // holds its look BY VALUE, so without this the scene goes on calling the look
  // by a name no library has — which then reads as "not in use" and lets the
  // draft be deleted out from under it.
  const renameGroupLooks = useCallback(
    (oldName: string, newName: string) => {
      for (const [modelId, list] of Object.entries(groupsByModel)) {
        let changed = false
        const next = list.map((g) => {
          if (!g.graph || nameKey(g.graph.name) !== nameKey(oldName)) return g
          changed = true
          return { ...g, graph: { ...g.graph, name: newName } }
        })
        if (changed) void applyGroups(modelId, next)
      }
    },
    [groupsByModel, applyGroups],
  )
  // Every look the scene is wearing, across ALL models — not just the group the
  // library was opened from. A draft one of these is built on is in use.
  const usedLookNames = useMemo(
    () =>
      [
        ...new Set(Object.values(groupsByModel).flatMap((list) => list.map((g) => g.graph?.name).filter(Boolean))),
      ] as string[],
    [groupsByModel],
  )
  const libGroup = inspectedGroups.find((g) => g.id === graphLib?.groupId) ?? null
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
  const sceneImportInput = useRef<HTMLInputElement>(null)
  // Same shape the shipped editor uses: one dialog covering "which .pmx?" and
  // "that did not load", because both are the upload failing to resolve to a
  // single model and the user only cares which one they are looking at.

  const pickModel = (target: ModelTarget) => {
    modelTarget.current = target
    folderInput.current?.click()
  }

  /**
   * Classify a stage's materials into style groups and apply them.
   *
   * Read from the ENGINE rather than from `models`: a stage that arrived a
   * moment ago is still a queued state update here, and the list this needs is
   * already sitting on the loaded model.
   *
   * Silent when nothing matches — a stage whose materials are named Material1..9
   * gets no groups and no notice, which is the same thing the engine's own
   * refusal to auto-group scenery says.
   */
  const autoStyleStage = useCallback(
    (id: string) => {
      const names = engineRef.current?.getModel(id)?.getMaterials().map((m) => m.name) ?? []
      const next = stageStyleGroups(names, groupsByModel[id] ?? [])
      if (next) void applyGroups(id, next)
    },
    [engineRef, groupsByModel, applyGroups],
  )

  /**
   * A stage classifies itself, once, the moment it has materials — uploaded now
   * or restored from a document written before this existed.
   *
   * Quiet and automatic, the way a MODEL is: the engine auto-groups a character
   * on load and nobody presses a button for it. This is the same act for
   * scenery, held out of the engine only because a keyword table is taste and
   * must never reach the render classes.
   *
   * Skips a stage that already carries a real grouping — the document said so,
   * or you did — where "real" means a group with materials in it, since a fresh
   * stage arrives with empty eye/hair seeds it will never use.
   */
  const styled = useRef(new Set<string>())
  useEffect(() => {
    if (!ready) return
    for (const stage of stages) {
      if (styled.current.has(stage.id)) continue
      styled.current.add(stage.id)
      if ((groupsByModel[stage.id] ?? []).some((g) => g.materials.length > 0)) continue
      autoStyleStage(stage.id)
    }
  }, [ready, stages, groupsByModel, autoStyleStage])

  const loadPicked = async (files: File[], pmx: File, target: ModelTarget) => {
    setUpload(null)
    try {
      if (target.mode === "stage") {
        noteArrival(await addStageFromFiles(files, pmx))
        setStageTab("stage")
      } else if (target.mode === "replace") {
        const newId = await replaceModelFromFiles(target.id, files, pmx)
        adoptReplacedModel(target.id, newId)
        noteStyled(target.id)
        noteArrival(newId)
      } else noteArrival(await addModelFromFiles(files, pmx))
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
        message: t.lab.noPmx,
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
        void (
          typeof clip.src === "string" ? loadVmdUrl(newId, clip.name, clip.src) : loadVmdFile(newId, clip.src)
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
      // The inspector follows the slot, not the file. Replacing the model you
      // had open is a continuation of editing THAT cast member, so the panel
      // should be looking at what replaced it — and leaving the old id behind
      // would strand the panel on a model that no longer exists.
      setInspectedId((prev) => (prev === oldId ? newId : prev))
    },
    [loadVmdFile, loadVmdUrl],
  )
  useEffect(() => {
    for (const m of models) {
      if (castStarted.current.has(m.id)) continue
      castStarted.current.add(m.id)
      const source = castSourceFor(m.id, scene, groupsByModel[m.id], bundleFiles())
      void (source ? castColour(source) : Promise.resolve(null)).then((palette) =>
        // Unconditional: the started-set already dedupes, and a re-extraction
        // after a model replace must be able to overwrite the transplanted
        // colour it started from.
        setPalettes((p) => ({ ...p, [m.id]: palette ?? NEUTRAL_PALETTE })),
      )
    }
  }, [models, scene, groupsByModel, bundleFiles])

  // A dialog rather than a toggle: two locales fit in a switch, but "Toggle
  // language" says a switch exists without saying where it lands. The picker
  // shows both, each written in its own script, with the current one ticked —
  // the same shape as "Which model?" in the upload flow.
  const { locale, setLocale } = useI18n()
  const [langOpen, setLangOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const pendingLocale = useRef<Locale | null>(null)
  useEffect(() => {
    if (langOpen || !pendingLocale.current) return
    // After the exit animation, not merely after the state flip: Radix keeps the
    // content mounted while it animates out, so applying on the next tick would
    // still repaint a visible dialog.
    const next = pendingLocale.current
    pendingLocale.current = null
    const id = setTimeout(() => setLocale(next), 200)
    return () => clearTimeout(id)
  }, [langOpen, setLocale])
  /**
   * Everything a palette row PRINTS, live — and the copy it prints FROM.
   *
   * The law (generalised from the recents order): a value the palette shows is
   * committed when the palette opens, never read live. The dock changes these
   * constantly and running a command changes them by definition, so a live read
   * would rewrite the row under your cursor as it fades. The ref carries the
   * truth for anything that acts; the state carries what is on screen.
   *
   * ONE snapshot rather than a "shown" state per printed thing — outline and the
   * locale each had their own, and the third would have made a pattern out of an
   * accident.
   */
  const paletteValues: PaletteValues = {
    t,
    locale,
    settings,
    camera,
    stage: stage ? { scale: stage.transform.scale, position: stage.transform.position } : null,
    effect: bgEffect?.name ?? null,
    gradeName: gradeLabel(settings.grade.preset),
    backdrop: bgImage && !bgImage.dome ? bgImage.name : null,
    dome: bgImage?.dome ? bgImage.name : null,
    pack: activePack,
  }
  const valuesRef = useRef(paletteValues)
  useEffect(() => {
    valuesRef.current = paletteValues
  })
  const [valuesShown, setValuesShown] = useState(paletteValues)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Suggestions survive the session: what you reached for yesterday is still
  // the best predictor today. Stale ids (a renamed command) are filtered on
  // load rather than trusted.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]")
      return Array.isArray(stored) ? stored.filter((id): id is string => commands.some((c) => c.id === id)) : []
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
    setValuesShown(valuesRef.current)
    setPaletteSession((n) => n + 1)
    setPaletteOpen(true)
  }, [setPaletteOpen])

  // Like counts and the gallery's first page, warmed during idle after boot —
  // opening either should be a render, not a fetch. A short timeout as well as
  // idle: the render loop keeps this thread busy enough that idle may never
  // arrive on its own, and the cost of these GETs is starting them.
  useEffect(() => {
    const warm = () => {
      prefetchLibraryStats()
      prefetchGallery()
    }
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(warm, { timeout: 1000 })
        : window.setTimeout(warm, 800)
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle as number)
      else clearTimeout(idle as number)
    }
  }, [])

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
        post?: "grade" | "tone" | "bloom" | "outline"
      },
    ) => {
      setExpanded(true)
      // A Scene row opens; a group anchor ("group-cast") only scrolls.
      const isRow = layers.some((l) => l.id === target)
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
    [layers],
  )

  /**
   * What this scene is MISSING, for the palette's Suggestions.
   *
   * Read live rather than committed at open like the printed values: a gap only
   * changes when the scene does, running a command closes the palette, and a
   * suggestion that describes the scene as it was is worse than no suggestion.
   */
  const paletteGaps = useMemo<SceneGap[]>(() => {
    const list: SceneGap[] = []
    // Anything that arrived and has not been looked at — a model OR a stage,
    // which is why this reads the engine's list and not just the cast.
    if (unstyled.some((id) => models.some((m) => m.id === id))) list.push("look")
    if (cast.length === 0) list.push("cast")
    else {
      // PER MEMBER, not "no clips anywhere": with two characters and one
      // motion, the scene still has someone standing still in it.
      if (cast.some((m) => !animByModel[m.id])) list.push("motion")
      if (!musicClip) list.push("music")
      // Only once there is something to watch — offering to render a still
      // model is offering a video of nothing.
      if (cast.some((m) => animByModel[m.id]) && !exportedOnce) list.push("render")
    }
    // Not a scene gap but a user one: open until they have been to the gallery
    // once, whichever door they used.
    if (!gallerySeen) list.push("discover")
    return list
  }, [cast, models, unstyled, animByModel, musicClip, exportedOnce, gallerySeen])

  // The one row whose hint is state, not description: a toggle you reach only
  // by searching has to say which way it is currently pointing. Reads the
  // deferred copy, so the row never changes while you are looking at it.
  const paletteItems = useMemo(
    () =>
      commands.map((c) => {
        // A switch you reach only by searching has to say which way it points,
        // and it says it in the LABEL — "Turn on outline" beats a row that names
        // a switch and leaves you to guess.
        if (c.id === "outline")
          return { ...c, label: valuesShown.settings.outline.enabled ? t.lab.cmd.outlineOff : t.lab.cmd.outlineOn }
        if (c.id === "language") return { ...c, hint: LOCALE_LABELS[valuesShown.locale] }
        // Same as language: the row says what it is SET TO, so the palette
        // answers "which style am I on" without opening anything.
        if (c.id === "look")
          return { ...c, hint: valuesShown.pack ? valuesShown.t.brand.styles[valuesShown.pack] : valuesShown.t.lab.ctl.none }
        if (!c.id.startsWith("ctl-")) return c
        // Settings print what they are SET TO, beside the breadcrumb that says
        // where they live. An empty string means the control has nothing to
        // report — a stage transform with no stage — and prints nothing rather
        // than a placeholder.
        const value = DOCK_CONTROLS.find((x) => `ctl-${x.id}` === c.id)?.value?.(valuesShown)
        return value ? { ...c, value } : c
      }),
    [commands, valuesShown, t],
  )

  // ── Persistence ──
  //
  // Two halves, the shipped editor's own: saveSceneState stores how the scene
  // LOOKS — settings, camera, grade, effect, style groups, hidden materials —
  // and saveSceneAssets plus the IndexedDB bundle store what it is MADE OF. Both
  // carry the scene id, and hydrateScene believes neither unless they agree.

  // The last payload, held for the exit flush until it is actually written.
  const pendingSave = useRef<SceneState | null>(null)
  useEffect(() => {
    const flush = () => {
      if (!pendingSave.current) return
      saveSceneState(pendingSave.current)
      pendingSave.current = null
    }
    const onHidden = () => document.visibilityState === "hidden" && flush()
    // pagehide covers reload/navigation
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onHidden)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let idle = 0
    const payload: SceneState = {
      id: scene.state.id,
      name: sceneName,
      // The DOCUMENT's camera, never the live one. Orbiting is how you look at a
      // scene, not how you edit it: it changes no React state, so it never saves
      // on its own, and the next unrelated edit must not bake wherever the mouse
      // left the camera into the stored scene. The sliders write this; only they
      // persist.
      camera,
      settings,
      backgroundEffect: bgEffect,
      groups: groupsByModel,
      // DERIVED from the live model list rather than tracked separately.
      // Empty lists are WRITTEN, not filtered: saveSceneState's retain() merges
      // over the previous save, so a dropped key would leave the old hidden
      // list in place — un-hiding the last material could never persist.
      hidden: Object.fromEntries(
        models.map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)]),
      ),
    }
    pendingSave.current = payload
    const timer = setTimeout(() => {
      const write = () => {
        saveSceneState(payload)
        pendingSave.current = null
      }
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(write, { timeout: 2000 })
          : (setTimeout(write, 0) as unknown as number)
    }, SAVE_SETTLE_MS)
    return () => {
      clearTimeout(timer)
      if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle)
    }
  }, [ready, scene, sceneName, camera, settings, bgEffect, groupsByModel, models])

  // What changes the BYTES: the set of files the scene points at. Placement and
  // switches are not on this list — they change the doc, never the bundle, and
  // repacking tens of megabytes of PMX every time a slider settles is what a
  // stage drag used to cost.
  const assetFingerprint = [
    models.map((m) => m.id).join("|"),
    Object.entries(animByModel)
      .map(([k, v]) => `${k}:${v.name}`)
      .join("|"),
    musicClip?.name ?? "",
    // One slot, two kinds: swapping a flat image for a 360 of the same name is
    // still a different scene, so the kind travels in the fingerprint.
    bgImage ? `${bgImage.dome ? "skybox" : "backdrop"}:${bgImage.name}` : "",
    cameraClip ?? "",
  ].join("//")

  // The fingerprint the bundle in IndexedDB was written for, and the URL it got.
  // Refs, not state: they record what already happened on disk and must not
  // themselves trigger the effect that writes it.
  const bundleWrittenFor = useRef<string | null>(null)
  const bundleWrittenRef = useRef<string | null>(null)

  /**
   * This route's slots, normalised for the shared collector (lib/scene-collect) —
   * the motion union and the single image slot are what differ from the shipped
   * editor's shape. ONE collector behind both destinations, exactly as main has it:
   * the persist effect writes the entries to IndexedDB, Export zips the same ones to
   * disk, so a refresh and an exported file can never disagree about what the scene
   * is made of.
   *
   * Memoized because the persist effect takes it as a dependency: an identity that
   * changed every render would re-run the write on every render.
   */
  const collectLabSlots = useCallback(
    () =>
      collectSlots({
        models,
        stages,
        booted: scene.assets.models,
        bundleFiles: bundleFiles(),
        // This route keeps a motion as {name, src} where src is the File or the
        // URL it came from; the collector wants the tagged form.
        anims: Object.fromEntries(
          Object.entries(animByModel).map(([id2, a]): [string, CollectedAnim] => [
            id2,
            {
              name: a.name,
              source:
                typeof a.src === "string" ? { kind: "url", name: a.name, url: a.src } : { kind: "file", file: a.src },
            },
          ]),
        ),
        camera: { name: cameraClip, booted: scene.assets.cameraAnimation },
        audio: { name: musicClip?.name ?? null, url: musicClip?.url ?? null },
        // ONE image slot here against main's two: which row it was uploaded from
        // is what makes it a dome.
        background: bgImage
          ? { kind: bgImage.dome ? "skybox" : "backdrop", name: bgImage.name, file: bgImage.file }
          : null,
      }),
    [models, stages, scene, bundleFiles, animByModel, cameraClip, musicClip, bgImage],
  )

  // Bytes land FIRST, then the doc: a doc pointing at a bundle that never finished
  // writing would boot half a scene, so the record only ever describes what is down.
  // When the byte write fails (quota), the doc records no bundle and boot degrades to
  // the slots that still resolve — the lenient path in loadSceneInto.
  // 150ms: just enough to coalesce one upload's burst of state commits (model list,
  // groups, clip entry) into a single bundle write, while keeping upload→refresh a
  // window a human hand cannot beat. The write order is the real guarantee — bytes,
  // then the record — so a refresh that does land mid-write boots the previous state,
  // never a broken one.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      const id = scene.state.id
      const slots = collectLabSlots()
      void (async () => {
        // Only repack when the file set moved; otherwise keep pointing at the
        // bundle already in IndexedDB.
        let bundleUrl: string | null = bundleWrittenRef.current
        if (bundleWrittenFor.current !== assetFingerprint) {
          bundleUrl = slots.entries.length && (await saveLocalBundle(id, slots.entries)) ? idbBundleOf(id) : null
          bundleWrittenFor.current = assetFingerprint
          bundleWrittenRef.current = bundleUrl
        }
        saveSceneAssets(
          id,
          assetsDocOf({
            models: slots.models,
            cameraAnimation: slots.cameraAnimation,
            audio: slots.audio,
            background: slots.background,
            bundle: bundleUrl,
          }),
        )
      })()
    }, 150)
    return () => clearTimeout(timer)
    // The collector carries the slot state: it re-identifies whenever any of them
    // moves, `stages` included, so moving a stage or flipping a switch still
    // reaches the DOC — the bundle write above is gated separately on
    // assetFingerprint.
  }, [ready, scene, collectLabSlots, assetFingerprint])

  // ── Scene file operations ──
  //
  // New, Export, Import, Reset — the shipped editor's four, off the logo. None of
  // them is memoized, main's own call: the compiler cannot preserve a manual memo
  // across an async body, and nothing takes these as a dependency.

  /**
   * Swap the whole document in place.
   *
   * The engine's `swapScene` runs the same `loadSceneInto` that first boot does — so a
   * swapped scene and a booted one can never mean different things — and it keeps the
   * WebGPU device, its pipelines and every compiled shader. A page reload would have
   * thrown all of that away and flashed the DOM on the way.
   */
  const applyLabScene = async (next: Scene) => {
    // STARTED, not awaited yet. swapScene turns `ready` off synchronously, before its
    // first await, so every re-seed below lands in the SAME commit as ready:false —
    // which is what keeps the two document loaders from ever running against a
    // half-swapped scene. They wake exactly once, on the new document, when the
    // engine says ready again; that is why nothing here re-implements them.
    const swapping = swapScene(next)

    // Every local mirror of the document, re-seeded from the incoming one. The
    // retained upload files (sceneFiles) are swapScene's own to clear.
    setScene(next)
    setSceneName(next.state.name)
    setSettings(next.state.settings)
    // The React mirror only: pushing the framing at the engine is swapScene's job,
    // and it does it once the new cast is in and can be followed.
    setCamera(next.state.camera)
    setBgEffect(next.state.backgroundEffect)
    // The per-preset intensity memory is keyed by NAME and outlives documents, so a
    // swapped scene has to restate its own strength — otherwise the first switch away
    // and back would overwrite what this document says with whatever the last scene
    // happened to use that grade at.
    rememberIntensity(next.state.settings.grade.preset, next.state.settings.grade.intensity)
    setAnimByModel(seedAnims(next))
    setCameraClip(next.assets.cameraAnimation?.name ?? null)
    setMusicClip((prev) => {
      dropMusicUrl(prev)
      return seedMusic(next)
    })
    // Empty until the extras loader resolves the new document's image out of its
    // bundle — the old one's would otherwise sit behind an unrelated scene.
    swapBgImage(null)
    // Both halves of the cast-colour bookkeeping. Clearing only the palettes would
    // leave the started-set claiming every id was already extracted, and a new cast
    // would shimmer forever; clearing only the set would leave a reused id (the same
    // .pmx under a different document) wearing the colour it had in the old scene.
    castStarted.current.clear()
    setPalettes({})
    // The transient surfaces are all ABOUT something the swap just removed. The
    // editors go too, baselines included: a session's "put it back" points at a
    // group, a grade or a shader belonging to the document being replaced, and
    // an open scratchpad would write the outgoing scene's work into the incoming
    // one on its next close.
    setInspectedId(null)
    setExportOpen(false)
    closeBrowse()
    setDrawerOpen(false)
    setGraphLibEdit(null)
    setActiveGroupId(null)
    setGroupGraphPrompt(false)
    groupGraphBaseline.current = null
    graphLibLatest.current = null
    setGradeEditor(null)
    setEffectEditor(null)

    await swapping

    // Persisted NOW rather than left to the debounced effects: Reset and New are the
    // user stating what the scene is, and a refresh inside the debounce window must
    // not resurrect what they just discarded. One exception in the record: a blob:
    // bundle (an imported zip) dies with this session, so it is stored as no bundle —
    // a refresh in the window boots what resolves, and the persist effect re-points
    // the record at the IndexedDB copy moments later.
    const transient = !!next.assets.bundle && next.assets.bundle.startsWith("blob:")
    saveSceneState(next.state)
    saveSceneAssets(next.state.id, assetsDocOf({ ...next.assets, bundle: transient ? null : next.assets.bundle }))
    if (!next.assets.bundle) void clearLocalBundle()
  }

  /** The curated first-open scene, assets included — under the id this scene already
   *  has, because Reset restates what THIS document is rather than starting another. */
  const resetSceneDefaults = () =>
    void applyLabScene({ ...DEFAULT_SCENE, state: { ...DEFAULT_SCENE.state, id: scene.state.id } })

  /** Blank: no assets, no effect, no grade, neutral settings — and a NEW identity, so the
   *  uploads just cleared can never be re-adopted by it. */
  const newScene = () => void applyLabScene({ ...EMPTY_SCENE, state: { ...EMPTY_SCENE.state, id: newSceneId() } })

  /**
   * The whole scene as one file: the publish pipeline aimed at disk. The same collector
   * gathers the doc and the uploaded bytes, and the same zip format R2 receives is what
   * the user downloads — `scene.json` beside the asset entries, so import, fork and boot
   * all read one shape. Served assets stay URLs (they exist on every deployment);
   * uploaded ones travel in the zip.
   */
  /**
   * The scene as a document, however it is leaving: `bundle` is the published
   * bundle's URL when publishing, and null when the assets ship beside the doc.
   *
   * ONE builder for both doors. They were the same thirty lines twice in the
   * shipped editor, which is how a field ends up in the published scene and
   * missing from the exported one.
   */
  const makeSceneDoc = (slots: SceneSlots, bundle: string | null) =>
    serializeSceneDoc(
      {
        models: slots.models,
        cameraAnimation: slots.cameraAnimation,
        audio: slots.audio,
        background: slots.background,
        bundle,
        name: sceneName,
        camera,
        // A published grade pins; anything else carries its spec. `preset` is the
        // label either way.
        settings: {
          ...settings,
          grade: (() => {
            const ref = gradeRef(appliedGradeSpec)
            return ref
              ? { preset: settings.grade.preset, intensity: settings.grade.intensity, from: ref }
              : { ...settings.grade, spec: appliedGradeSpec }
          })(),
        },
        backgroundEffect: bgEffect,
        groups: groupsByModel,
        hidden: slots.hidden,
      },
      { graph: graphRef, effect: effectRef },
    )

  /** What the publish dialog packs and uploads: the same slots the save path
   *  collects, with the doc deferred until the bundle has a URL. */
  const collectScenePublish = (): ScenePublishSource => {
    const slots = collectLabSlots()
    return { entries: slots.entries, makeDoc: (bundle) => makeSceneDoc(slots, bundle) }
  }

  const exportScene = async () => {
    const slots = collectLabSlots()
    // bundle: null — the assets travel BESIDE the doc in the same zip, and
    // import points the parsed scene at the zip it came from.
    const doc = makeSceneDoc(slots, null)
    const zip = await buildZip([
      ...slots.entries,
      { path: "scene.json", file: new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }) },
    ])
    downloadBlob(zip, sceneZipFileName(sceneName))
  }

  /**
   * A zip with `scene.json` beside its assets. Loaded exactly like a fork — parse the
   * doc, point the scene at its bundle, swap — and then owned like one: the persist
   * effect re-packs the zip's files into the IndexedDB bundle, so the import survives
   * refresh with no dependence on the original file.
   *
   * Anything that is not one of those zips fails through unzipToFiles or the parse and
   * lands in the upload notice, which is where every other file failure on this route
   * is already read. (The shipped editor also still reads the legacy config-only
   * `.reze.json`; this route never wrote one.)
   */
  const importScene = async (file: File) => {
    try {
      const files = await unzipToFiles(file)
      const docFile = files.find((f) => f.name === "scene.json")
      if (!docFile) throw new Error("no scene.json")
      const doc = JSON.parse(await docFile.text()) as SceneDoc
      const resolve = await resolveSceneRefs(doc)
      const imported = parseSceneDoc(doc, builtinEffect, libraryGraph, resolve)
      // A blob URL, so loadSceneInto's bundle fetch reads the zip we already hold.
      const url = URL.createObjectURL(file)
      try {
        await applyLabScene({
          ...imported,
          assets: { ...imported.assets, bundle: url },
          // Its own identity: an imported file may be shared around, and two people's
          // working scenes must not collide on one id.
          state: { ...imported.state, id: newSceneId() },
        })
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      setUpload({ kind: "notice", message: t.sceneFile.badFile })
    }
  }

  // runCommand is ONE callback over the whole command table, so naming every
  // handler it can reach would mean memoizing half the page — applyLabScene
  // alone closes over a dozen setters, and a useCallback chain that deep is
  // more places to get a dependency wrong, not fewer. The latest handlers live
  // in a ref and are read at call time instead: the same trick use-z-order
  // plays with its Escape closers, and for the same reason — the callback is
  // long-lived, the functions are not.
  const cmdRef = useRef({ newScene, resetSceneDefaults, exportScene, openGradeEditor })
  useEffect(() => {
    cmdRef.current = { newScene, resetSceneDefaults, exportScene, openGradeEditor }
  })

  const runCommand = useCallback(
    (item: PaletteItem) => {
      // Most recent first, no duplicates, five deep — enough to be useful
      // without the empty-query list becoming a second menu. Staged in a ref
      // rather than state so nothing re-renders while the dialog closes.
      const base = nextRecent.current.length ? nextRecent.current : recentIds
      nextRecent.current = [item.id, ...base.filter((id) => id !== item.id)].slice(0, RECENT_DEPTH)
      // Stored immediately even though the STATE commit waits for the next
      // open (the no-reshuffle rule) — a refresh must not lose the last run.
      try {
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecent.current))
      } catch {
        /* storage full or blocked — suggestions just stay session-local */
      }
      // Real commands, by id — the registry will own this table; until then the
      // page is the registry.
      if (item.id === "export" || item.id === "capture") openExport()
      else if (item.id === "add-model") {
        // The refs directly, not pickModel: a plain function in the dep
        // array is something the compiler cannot keep memoized.
        modelTarget.current = { mode: "add" }
        folderInput.current?.click()
      } else if (item.id === "upload-camera") cameraInput.current?.click()
      else if (item.id === "upload-music") musicInput.current?.click()
      else if (item.id === "camera") gotoSection("camera")
      else if (item.id === "scene-new") cmdRef.current.newScene()
      else if (item.id === "scene-reset") cmdRef.current.resetSceneDefaults()
      else if (item.id === "scene-export") void cmdRef.current.exportScene()
      else if (item.id === "scene-import") sceneImportInput.current?.click()
      else if (item.id === "stage") gotoSection("stage", { stage: "stage" })
      // Named "upload", so it uploads. Routing it to the pane and leaving the
      // user to find the button again is what makes a palette feel like a
      // table of contents instead of a set of verbs.
      else if (item.id === "upload-stage") {
        modelTarget.current = { mode: "stage" }
        folderInput.current?.click()
      }
      // The primary model, always — not "whichever is inspected". A motion has
      // to land somewhere and the palette cannot ask; a rule you can state in
      // one sentence beats one that depends on what panel happens to be open.
      // Per-model uploads live on the cast rows, where the target is visible.
      else if (item.id === "upload-animation") {
        const target = models[0]?.id
        if (target) {
          animTarget.current = target
          vmdInput.current?.click()
        }
      } else if (item.id === "ground") gotoSection("stage", { stage: "ground" })
      else if (item.id === "background") gotoSection("stage", { stage: "background" })
      else if (item.id === "effect") gotoSection("effect")
      else if (item.id === "post") gotoSection("post")
      else if (item.id === "light") gotoSection("light")
      else if (item.id === "world") gotoSection("light", { light: "world" })
      else if (item.id === "sun") gotoSection("light", { light: "sun" })
      else if (item.id === "physics") gotoSection("physics")
      // Whichever model is already inspected, else the primary — the panel is
      // per-model and picking one for you beats opening on nothing.
      // `inspected?.id`, NOT inspectedId: a replaced model leaves the raw id
      // naming something that is gone, and openMaterials short-circuits when the
      // id it is handed is the one already held — so passing the stale one back
      // in set it to itself, resolved to no model, and the panel could never be
      // opened again. Going through the RESOLVED model means a stale id falls
      // through to the first cast member instead of wedging.
      else if (item.id === "materials") openMaterials(inspected?.id ?? models[0]?.id ?? null)
      // Each opens exactly what it says. A new draft starts from the same
      // template the library's own New button uses, so the two doors lead to
      // one place.
      else if (item.id === "graph-new") openGraphLibEdit("", t.library.newGraph, structuredClone(DEFAULT_GRAPH))
      else if (item.id === "graph-lib") openGraphLibrary(activeGroupId)
      else if (item.id === "wgsl-new")
        openEffectEditor({ id: "", name: t.bgLibrary.newEffect, wgsl: NEW_EFFECT_TEMPLATE })
      else if (item.id === "effect-lib") openBrowse({ kind: "effect" })
      else if (item.id === "grade-new")
        cmdRef.current.openGradeEditor({ id: "", name: t.gradeLibrary.newGrade, spec: NEW_GRADE_SPEC })
      else if (item.id === "grade-lib") openBrowse({ kind: "grade" })
      else if (item.id === "outline") patch("outline", { enabled: !outlineRef.current })
      else if (item.id === "language") setLangOpen(true)
      else if (item.id === "look") setStyleOpen(true)
      // The same dialog the Share pill opens — one publish surface, two doors.
      else if (item.id === "publish") setShareOpen(true)
      else if (item.id === "gallery") openGallery()
      else if (item.id.startsWith("ctl-")) {
        const c = DOCK_CONTROLS.find((x) => `ctl-${x.id}` === item.id)
        if (!c) return
        if (c.row === "export") openExport()
        else gotoSection(c.row, { stage: c.stageTab, light: c.lightTab, camera: c.cameraTab, post: c.postTab })
      }
      item.run?.()
    },
    [
      // `t` whole, not three leaf paths: the dictionary is one object that
      // changes only with the locale, and listing leaves invites the next
      // string to be forgotten.
      t,
      recentIds,
      gotoSection,
      openMaterials,
      // The RESOLVED id, not the raw one — the raw id can name a model that has
      // been replaced away, and this callback must re-make itself when the
      // resolution changes, not when the stale string happens to.
      inspected?.id,
      models,
      patch,
      setLangOpen,
      openExport,
      openGraphLibrary,
      openBrowse,
      openGallery,
      activeGroupId,
      openEffectEditor,
    ],
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
          <div
            className="absolute bg-black/45"
            style={{ left: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }}
          />
          <div
            className="absolute bg-black/45"
            style={{ right: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }}
          />
          {/* Capture-tool convention: amber = framed (composing), red = recording. */}
          <div
            className={cn(
              "absolute rounded-sm border",
              framing.exporting ? "border-red-500/90" : "border-amber-400/80",
            )}
            style={{ left: frameRect.x, top: frameRect.y, width: frameRect.w, height: frameRect.h }}
          />
        </div>
      )}

      {/* ── Top bar ──
          Right cluster only. The brand belongs to the stack while the stack is
          open — BrandPill's own asHeader/collapsed split, which is also what
          stops a pill and a panel of different widths sitting on top of each
          other. */}
      {mounted && (
        <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-start gap-2">
          {/* Same 17rem as the open panel: this is a DROPDOWN, not a sidebar —
            expanding only grows downward, so nothing ever shifts sideways. */}
          {!expanded && (
            <div className={cn(PILL, "pointer-events-auto flex h-10 w-[18rem] items-center gap-1.5 pr-1.5 pl-2")}>
              {/* The logo is the menu, in both of its homes — scene-file-menu.tsx
                  for why. The stack is not on screen here, so this pill's logo is
                  the only door to the file operations. */}
              <SceneFileMenu
                onNew={newScene}
                onGallery={openGallery}
                onExport={exportScene}
                onImport={importScene}
                onReset={resetSceneDefaults}
                trigger={
                  <span className="flex size-7 shrink-0 items-center justify-center text-pink-400">
                    <WandSparkles className="size-4.5" />
                  </span>
                }
              />
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
                aria-label={t.lab.expandPanel}
                className="ml-auto size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
          )}

          {/* ── The right cluster ──
              EXACTLY 18rem, the width of the panels below it. Both are anchored
              to the same right inset, so the two left edges are the same edge by
              construction — where a ResizeObserver used to measure the pills and
              hand the panels a pixel value. Fixing the column and letting the
              pills fill it is the same alignment with none of the arithmetic,
              and nothing to re-derive when a label is translated or the account
              chip changes with sign-in state.

              The palette takes the slack (flex-1) rather than the account pill:
              slack inside that pill would open a hole between the avatar and
              Share, while a wider search pill is just a wider search pill. It
              lands at 10.75rem, a quarter of a rem off the width it was hand-set
              to — which is the check that the number was right.

              All pills state h-10 rather than deriving it from contents. Derived
              heights agreed only while every pill happened to hold size-7
              children — one control with a different variant height and they
              silently disagree, which is exactly what happened here. */}
          <div className="ml-auto flex w-[18rem] items-start gap-2">
            {/* The palette needs a visible door — keyboard-only would hide it
                from exactly the people most likely to miss it, and it is the
                only route on touch. The button IS the pill: a wrapper around a
                single control leaves a ring of padding the hover cannot reach. */}
            <Button
              variant="ghost"
              onClick={openPalette}
              className={cn(
                PILL,
                // Left-aligned, so the words start in the same place whatever
                // their length. The zh label is written TO this width rather
                // than translated literally: CJK glyphs run ~12px at this size,
                // so 搜索命令、设置等 (8) lands within a few pixels of the English
                // label where a literal 搜索命令 (4) would sit in a half-empty box.
                "pointer-events-auto h-10 flex-1 justify-start gap-2 px-3.5 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              {t.lab.searchCommands}
              {/* A key cap, so it should read as one: fixed height, centred, and the
              two glyphs spaced by a real gap rather than letter-spacing — which
              adds its space AFTER the K and pushes the pair off-centre. */}
              <kbd className="ml-auto inline-flex h-5 min-w-[1.625rem] shrink-0 items-center justify-center gap-[3px] rounded-md border border-white/15 bg-white/[0.06] px-1 font-mono text-xs leading-none text-muted-foreground">
                <span className="text-sm">⌘</span>
                <span>K</span>
              </kbd>
            </Button>

            <div className={cn(PILL, "pointer-events-auto flex h-10 shrink-0 items-center gap-2 px-1.5")}>
              <AccountButton onOpenLibrary={openForAccount} />
              <Button
                size="sm"
                onClick={() => setShareOpen(true)}
                className="h-7 w-[3.75rem] rounded-lg bg-blue-400 px-3 text-xs font-medium text-white hover:bg-blue-300"
              >
                {t.lab.share}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Which .pmx, or why it failed — the shipped editor's dialog, reused
          rather than reinvented. */}
      <Dialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)}>
        <DialogContent
          // A picker opens with nothing chosen. Radix focuses the first item
          // otherwise, which rings the first row and arms Enter on it — an
          // answer the dialog just finished asking you for.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="max-w-sm rounded-xl border-line-strong bg-surface-raised backdrop-blur-xs"
        >
          <DialogHeader>
            <DialogTitle className="text-sm">{upload?.kind === "pick" ? t.lab.whichModel : t.lab.cantLoad}</DialogTitle>
          </DialogHeader>
          {upload?.kind === "pick" ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain">
              {upload.paths.map((path) => (
                <button
                  key={path}
                  className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 hover:text-foreground"
                  onClick={() => {
                    const pmx = upload.files.find((f) => relFilePath(f) === path)
                    if (pmx) void loadPicked(upload.files, pmx, upload.target)
                  }}
                  // The path is still the identity and still the tooltip: two
                  // .pmx in one archive can share a filename, and a picker that
                  // shows the same word twice is worse than a long one.
                  title={path}
                >
                  {pmxLabel(path, upload.paths)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{upload?.kind === "notice" ? upload.message : null}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* A shelf, not a switch: the same shape as the language dialog because it
          is the same act — pick one of a short curated list — and a third pack
          costs a row here and nothing else. */}
      <Dialog open={styleOpen} onOpenChange={setStyleOpen}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="max-w-sm rounded-xl border-line-strong bg-surface-raised backdrop-blur-xs"
        >
          <DialogHeader>
            <DialogTitle className="text-sm">{t.brand.style}</DialogTitle>
          </DialogHeader>
          <div className="space-y-0.5">
            {LOOK_PACK_ORDER.map((pack) => (
              <button
                key={pack}
                onClick={() => {
                  // Close first, apply after — the same law the language dialog
                  // follows, and it matters more here: applying recompiles every
                  // group, and doing that under a dialog still fading reads as a
                  // stutter rather than as the change you asked for.
                  setStyleOpen(false)
                  applyLookPack(pack)
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                  pack === activePack ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.brand.styles[pack]}
                {pack === activePack && <Check className="size-3.5 shrink-0 text-pink-400" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={langOpen} onOpenChange={setLangOpen}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="max-w-sm rounded-xl border-line-strong bg-surface-raised backdrop-blur-xs"
        >
          <DialogHeader>
            {/* Both languages in the title, so the dialog identifies itself to
                whichever reader opened it. */}
            <DialogTitle className="text-sm">Language · 语言</DialogTitle>
          </DialogHeader>
          <div className="space-y-0.5">
            {LOCALES.map((code) => (
              <button
                key={code}
                onClick={() => {
                  // Close FIRST, apply after — the same law the palette follows.
                  // Switching language while the dialog is still fading rewrites
                  // every word behind it mid-animation, which reads as a glitch
                  // rather than as the change you asked for. Staged in a ref so
                  // the closing frame renders exactly what you clicked on.
                  pendingLocale.current = code
                  setLangOpen(false)
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                  code === locale ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {LOCALE_LABELS[code]}
                {code === locale && <Check className="size-3.5 text-blue-400" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset on change, so picking the same folder twice still fires. */}
      {/* The logo menu owns its own picker; the palette needs one too, since the
          command cannot reach inside that component. Same handler either way. */}
      <input
        ref={sceneImportInput}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) void importScene(file)
        }}
      />

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

      {/* The element stays outside the `mounted` gate because effects reach for its
          ref, but the SRC has to wait: it comes from the restored scene, and the
          server has no storage to restore from. Rendering it on the first pass made
          the server emit the demo's served track while the client emitted the
          restored one — a hydration mismatch on the only attribute that differed. */}
      <audio
        ref={audioRef}
        src={mounted ? musicClip?.url || undefined : undefined}
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
          if (file) setMusicFile(file)
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
          // Kept for the persist/publish repack, like every other upload.
          sceneFiles.camera = file
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

      {/* All three take `initialFacet` from the slot, so an entrance that means
          "show me mine" arrives on that shelf. closeIf, never close: a stale
          onOpenChange(false) from the library that just LOST the slot would
          otherwise close its replacement. */}
      <GradeLibrary
        open={gradeLibOpen}
        initialFacet={libraryFacet}
        onOpenChange={(o) => !o && closeBrowseIf("grade")}
        grade={grade}
        onApplyPreset={pickGrade}
        onRenamed={(oldName, newName) =>
          setSettings((s2) => (s2.grade.preset === oldName ? { ...s2, grade: { ...s2.grade, preset: newName } } : s2))
        }
        onEdit={openGradeEditor}
      />

      <BackgroundLibrary
        open={effectLibOpen}
        initialFacet={libraryFacet}
        onOpenChange={(o) => !o && closeBrowseIf("effect")}
        applied={bgEffect}
        onApply={setBgEffect}
        onRemove={() => setBgEffect(null)}
        onRenamed={(oldName, newName) => setBgEffect((e) => (e?.name === oldName ? { ...e, name: newName } : e))}
        onEdit={openEffectEditor}
      />

      {/* ── Shader-graph library ──
          Non-modal and no scrim, like the other two: the canvas behind it is
          the preview for everything it applies. */}
      <NodeLibrary
        open={graphLib !== null}
        initialFacet={libraryFacet}
        onOpenChange={(o) => !o && closeBrowseIf("graph")}
        canApply={libGroup !== null}
        targetLabel={libGroup ? groupLabel(libGroup) : null}
        currentGraphName={libGroup?.graph.name ?? null}
        usedNames={usedLookNames}
        onRenamed={renameGroupLooks}
        onApply={applyGraphLibrary}
        onEdit={openGraphLibEdit}
      />

      {/* ── Node editor ──
          MOUNTED while closed, the shipped editor's own call: the panel owns its
          rect and its place in the stack, and remounting it per open would drop
          both. The BODY is what unmounts, so a session never resumes on the
          previous graph's nodes. */}
      {mounted && graphPanelRect && (
        <FloatingPanel
          rect={graphPanelRect}
          onRectChange={updateGraphPanelRect}
          raiseKey={graphSession}
          // Gated on open: an ungated closer would sit at the top of the stack
          // while invisible and swallow Escape from the libraries beneath it.
          onEscape={drawerOpen ? requestCloseGraphDrawer : undefined}
          fullscreen={graphFull}
          className={cn(
            // The raised surface, opaque: this floats over an animating canvas,
            // which is exactly when a backdrop-filter costs the most frames.
            "overflow-hidden rounded-surface border border-line-strong bg-surface-raised shadow-float transition-opacity duration-300",
            !drawerOpen && "pointer-events-none opacity-0",
          )}
        >
          {!drawerOpen ? null : graphLibEdit ? (
            <GraphEditor
              key={`lib-${graphLibEdit.sessionId}`}
              slotLabel={graphLibEdit.name}
              presetGraph={graphLibEdit.opened}
              getInitialGraph={() => graphLibEdit.opened}
              onApply={compileStandalone}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={requestCloseGraphDrawer}
              fullscreen={graphFull}
              onToggleFullscreen={() => setGraphFull((v) => !v)}
            />
          ) : activeGroup && presetGraph ? (
            <GraphEditor
              key={`${activeGroup.id}-${libVersion}`}
              slotLabel={activeGroup.graph.name || groupLabel(activeGroup)}
              presetGraph={presetGraph}
              getInitialGraph={() => activeGroup.graph ?? presetGraph}
              onApply={applyActiveGraph}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={closeGraphEdit}
              fullscreen={graphFull}
              onToggleFullscreen={() => setGraphFull((v) => !v)}
            />
          ) : (
            // Reachable by moving the inspector to another character mid-session
            // — the binding is released, and the panel says so rather than
            // vanishing under the cursor.
            <div className="relative flex h-full items-center justify-center text-xs text-muted-foreground">
              {t.editor.selectMaterial}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.library.close}
                className="absolute top-1 right-2 size-7 text-muted-foreground hover:text-foreground"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </FloatingPanel>
      )}

      {/* ── Floating WGSL editor (drag it aside; the scene is the preview) ── */}
      {mounted && effectEditor && (
        <WgslEditorPanel
          open
          sessionId={effectEditor.sessionId}
          rect={effectPanelRect}
          onRectChange={updateEffectPanelRect}
          title={effectEditor.subject.name}
          initial={effectEditor.subject.wgsl}
          onCompile={(wgsl) => commitEffectCode(effectEditor.subject, wgsl)}
          onClose={(code) => void requestCloseEffectEditor(code)}
        />
      )}

      {/* ── Floating grade editor (drag it aside; the scene is the preview) ── */}
      {mounted && gradeEditor && (
        <GradeEditorPanel
          open
          sessionId={gradeEditor.sessionId}
          rect={gradePanelRect}
          onRectChange={updateGradePanelRect}
          subject={gradeEditor.subject}
          origin={gradeAncestor(gradeEditor.subject)}
          onChange={editGrade}
          onClose={requestCloseGradeEditor}
        />
      )}

      {/* ── Save-on-close, one per editor. All three read the same at a glance:
              a draft is being saved back and is not renamed; anything else is
              becoming a new item and gets a free name to confirm. ── */}
      {mounted && effectEditor?.savePrompt != null && (
        <SaveCloseDialog
          defaultName={freeEffectName(effectEditor.subject.name, effectEditor.subject.id)}
          askName={!isDraft("effect", effectEditor.subject.id)}
          onSave={saveEffectEdit}
          onDiscard={discardEffectEdit}
          onCancel={() => setEffectEditor((prev) => (prev ? { ...prev, savePrompt: null } : prev))}
        />
      )}
      {mounted && gradeEditor?.savePrompt && (
        <SaveCloseDialog
          askName={!isDraft("grade", gradeEditor.subject.id)}
          defaultName={freeGradeName(gradeEditor.subject.name, gradeEditor.subject.id)}
          onSave={saveGradeEdit}
          onDiscard={discardGradeEdit}
          onCancel={() => setGradeEditor((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}
      {mounted && groupGraphPrompt && (
        <SaveCloseDialog
          // Your own draft is not being named, it is being saved back — this
          // dialog is here only because the compile failed.
          askName={!draftGraphNamed(activeGroup?.graph.name ?? "")}
          defaultName={
            draftGraphNamed(activeGroup?.graph.name ?? "")?.name ??
            freeGraphName(activeGroup?.graph.name ?? t.lab.newGroup)
          }
          onSave={saveGroupGraph}
          onDiscard={discardGroupGraph}
          onCancel={() => setGroupGraphPrompt(false)}
        />
      )}
      {mounted && graphLibEdit?.savePrompt && (
        <SaveCloseDialog
          defaultName={freeGraphName(graphLibEdit.name, graphLibEdit.id)}
          askName={!isDraft("graph", graphLibEdit.id)}
          onSave={saveGraphLibEdit}
          onDiscard={discardGraphLibEdit}
          onCancel={() => setGraphLibEdit((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}

      {/* ── Publishing ──
          Mounted under `mounted` like the rest of the chrome: it reads drafts
          and the session, both client-only. The handle dialog opens itself the
          first time a signed-in user has a handle they have not claimed —
          which publishing is exactly when they need to. */}
      {mounted && (
        <ShareSceneDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          sceneId={scene.state.id}
          sceneName={sceneName}
          onRename={setSceneName}
          collect={collectScenePublish}
          // Looks worn by this scene that exist in no library: publishing is
          // blocked while any remain, since a published scene cannot point at a
          // draft that only exists on this device.
          unpublished={() =>
            unpublishedUses({
              gradeSpec: appliedGradeSpec,
              gradeName: settings.grade.preset,
              effect: bgEffect,
              groups: groupsByModel,
            })
          }
        />
      )}
      {mounted && <HandleDialog />}

      {/* ── The gallery ──
          In the same slot as the libraries, deliberately: it is a full-window
          browse surface too, and it must never sit behind one. It is NOT a tab
          among them, though — a library lends a look to the scene you are
          making, the gallery leaves it for someone else's. */}
      <SceneGallery open={galleryOpen} onOpenChange={(o) => !o && closeBrowseIf("gallery")} />

      <CommandPalette
        key={paletteSession}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        recentIds={recentIds}
        gaps={paletteGaps}
        onRun={runCommand}
      />

      {/* ── The stack ── */}
      {mounted && expanded && (
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
              <SceneFileMenu
                onNew={newScene}
                onGallery={openGallery}
                onExport={exportScene}
                onImport={importScene}
                onReset={resetSceneDefaults}
                trigger={
                  <span className="flex size-7 shrink-0 items-center justify-center text-pink-400">
                    <WandSparkles className="size-4.5" />
                  </span>
                }
              />
              <span className="truncate pb-0.5 text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
              <span className="shrink-0 rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[11px] leading-none font-medium tracking-wide text-blue-400">
                0.4.0 beta
              </span>
              {/* The repository, and through its README the manuals — which is
                  why there is no separate Help entry: one link that stays
                  current beats a second one to keep in step. Beside the version
                  because that is the same subject — what this build is — and
                  only in the OPEN header: collapsed is what a share link
                  renders, and a viewer came for the scene. */}
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="size-7 shrink-0 rounded-lg text-foreground hover:bg-white/5 hover:text-foreground"
              >
                <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub">
                  <GithubMark className="size-4" />
                </a>
              </Button>
              {/* Same as the timeline chevron: the glyph already shows the panel
                  closing, so a tip repeating it is only latency. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpanded(false)}
                aria-label={t.lab.collapsePanel}
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

          {/* pb-2 so the last row can clear the rounded bottom edge when you
              scroll to the end. With a tall row open (Camera's Lens is eight
              controls) the stack is genuinely taller than the viewport, and
              without the pad Physics sat flush in the corner radius and read as
              broken rather than as scrollable. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <StackGroup label={t.lab.groups.cast} domId="group-cast">
              {/* The row appears WITH the model — same commit as `models`, so
                  the canvas and the dock move as one. Only the swatch pends:
                  extraction takes a few hundred ms, and a whole-row skeleton
                  made every load feel like two arrivals. The square upgrades in
                  place; nothing else moves. */}
              {cast.map((m) => (
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
                      text={<span className="min-w-0 flex-1 truncate text-sm">{displayName(m.file)}</span>}
                      actions={
                        <>
                          <CastAction
                            icon={RefreshCw}
                            label={t.lab.aria.replaceModel(displayName(m.file))}
                            onClick={() => pickModel({ mode: "replace", id: m.id })}
                          />
                          <CastAction
                            icon={X}
                            danger
                            label={t.lab.aria.deleteModel(displayName(m.file))}
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
                            label={t.lab.uploadAnimation}
                            onClick={() => pickAnimation(m.id)}
                            aria={t.lab.aria.uploadAnimationFor(displayName(m.file))}
                          />
                        )
                      }
                      actions={
                        <>
                          <CastAction
                            icon={animByModel[m.id] ? RefreshCw : Upload}
                            label={
                              animByModel[m.id]
                                ? t.lab.aria.replaceAnimationFor(displayName(m.file))
                                : t.lab.aria.uploadAnimationFor(displayName(m.file))
                            }
                            onClick={() => pickAnimation(m.id)}
                          />
                          <CastAction
                            icon={X}
                            danger
                            disabled={!animByModel[m.id]}
                            label={t.lab.aria.deleteAnimationOn(displayName(m.file))}
                            onClick={() => removeAnimation(m.id)}
                          />
                        </>
                      }
                    />
                  </span>
                </div>
              ))}
              {/* AFTER the rows, because that is where the missing ones are:
                  models arrive in document order, so what is outstanding is
                  always the tail of the list. */}
              {Array.from({ length: pendingCast }, (_, i) => (
                <CastRowSkeleton key={`pending-${i}`} />
              ))}
              {/* Always standing, under the rows. It was a hover-only + on the
                  group label back when one model was the normal scene; a cast is
                  something people keep adding to, and the button you use again
                  and again cannot be one you have to go looking for. */}
              {/* Rendered unconditionally, disabled until the engine can take a
                  model. Gating it on `ready` made the row appear a beat after
                  boot and shoved everything under it down — the drift the
                  skeleton above exists to prevent. */}
              <div className="flex justify-center pt-0.5 pb-1">
                {/* The dashed border is the app's word for an empty slot — the
                    stage pane and the clip rows already say "there could be
                    something here" that way. This is the same offer for a cast
                    that can always take one more, so it wears the same outline
                    and the same blue hover rather than inventing a third
                    treatment for the same idea. */}
                <Button
                  variant="ghost"
                  disabled={!ready}
                  onClick={() => pickModel({ mode: "add" })}
                  className="h-7 gap-1.5 rounded-interior border border-dashed border-line-strong px-2.5 text-xs font-normal text-muted-foreground hover:border-blue-400/50 hover:bg-transparent hover:text-blue-400"
                >
                  <Plus className="size-4" />
                  {t.lab.addModel}
                </Button>
              </div>
            </StackGroup>

            {/* The SCENE-WIDE clips. All five MMD components keep visible
                intakes in the dock — model and motion on the cast rows, stage
                on its Scene row — and the two with no owner land here. The
                timeline lanes show WHEN these play; this is where they load. */}
            <StackGroup label={t.lab.groups.clips} domId="group-clips" gap="tight">
              <ClipRow
                icon={Video}
                clip={cameraClip}
                empty={t.lab.uploadCameraMotion}
                kind={t.lab.kinds.cameraMotion}
                onPick={() => cameraInput.current?.click()}
                onRemove={removeCamera}
              />
              <ClipRow
                icon={Music}
                clip={musicClip?.name ?? null}
                empty={t.lab.uploadMusic}
                kind={t.lab.kinds.music}
                onPick={() => musicInput.current?.click()}
                onRemove={removeMusic}
              />
            </StackGroup>

            <StackGroup label={t.lab.groups.scene} gap="loose">
              {layers.map((l) => (
                <LayerRow
                  key={l.id}
                  domId={`layer-${l.id}`}
                  icon={l.icon}
                  name={l.name}
                  summary={
                    l.id === "camera"
                      ? // The DECISION, not a number: which thing is driving the
                        // shot. A camera VMD outranks both — it is literally in
                        // control — then whether the orbit rides a bone.
                        (cameraClip ?? (camera.follow ? t.lab.summary.follow : t.lab.summary.orbit))
                      : l.id === "stage"
                        ? stageSummary
                        : l.id === "effect"
                          ? (bgEffect?.name ?? t.lab.ctl.none)
                          : l.id === "post"
                            ? gradeLabel(grade.preset)
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
                        <TabsTrigger value="stage" className="flex-1">
                          {t.lab.tabs.stage}
                        </TabsTrigger>
                        <TabsTrigger value="ground" className="flex-1">
                          {t.lab.tabs.ground}
                        </TabsTrigger>
                        <TabsTrigger value="background" className="flex-1">
                          {t.lab.tabs.background}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="stage">
                        {stage ? (
                          <>
                            <CastLine
                              text={
                                <span className="min-w-0 flex-1 truncate text-[13px]">{displayName(stage.file)}</span>
                              }
                              actions={
                                <>
                                  <CastAction
                                    icon={RefreshCw}
                                    label={t.lab.aria.replaceStage(displayName(stage.file))}
                                    onClick={() => pickModel({ mode: "stage" })}
                                  />
                                  <CastAction
                                    icon={X}
                                    danger
                                    label={t.lab.aria.deleteStage(displayName(stage.file))}
                                    onClick={() => removeModelById(stage.id)}
                                  />
                                </>
                              }
                            />
                            <SliderRow
                              label={t.lab.ctl.scale}
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
                                label={t.lab.ctl.pos(axis)}
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
                            {t.lab.uploadStageFolder}
                          </Button>
                        )}
                      </TabsContent>
                      <TabsContent value="ground">
                        {stage && <p className="mb-2 text-[11px]">{t.lab.stageOverridesGround}</p>}
                        <fieldset disabled={!!stage} className={cn(stage && "pointer-events-none opacity-40")}>
                          <ColorRow
                            label={t.lab.ctl.color}
                            value={ground.color}
                            onChange={(hex) => patch("ground", { color: hex })}
                          />
                          <SliderRow
                            label={t.lab.ctl.opacity}
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
                            <span className="text-xs">{t.lab.ctl.shadow}</span>
                            <Switch
                              size="sm"
                              checked={ground.shadow}
                              onCheckedChange={(v) => patch("ground", { shadow: v })}
                            />
                          </div>
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className="text-xs">{t.lab.ctl.grid}</span>
                            <div className="flex items-center gap-2">
                              {ground.gridEnabled && (
                                <ColorField value={ground.grid} onChange={(hex) => patch("ground", { grid: hex })} />
                              )}
                              <Switch
                                size="sm"
                                checked={ground.gridEnabled}
                                onCheckedChange={(v) => patch("ground", { gridEnabled: v })}
                              />
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
                          label={t.lab.ctl.color}
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
                            { dome: false, label: t.lab.ctl.image, kind: t.lab.kinds.backgroundImage },
                            { dome: true, label: t.lab.ctl.dome, kind: t.lab.kinds.background360 },
                          ] as const
                        ).map((row) => {
                          const filled = bgImage && bgImage.dome === row.dome ? bgImage : null
                          return (
                            <div key={row.label} className="mt-2.5 flex h-5 min-w-0 items-center gap-2">
                              <span className="shrink-0 text-xs">{row.label}</span>
                              {filled ? (
                                <>
                                  {/* Capped rather than merely min-w-0: left to
                                      itself the name ran up against the two
                                      buttons, and a filename crowding a control
                                      reads as a collision. It truncates early
                                      and keeps the gap. */}
                                  <span className="ml-auto max-w-[7.5rem] min-w-0 truncate text-right text-xs text-muted-foreground">
                                    {filled.name}
                                  </span>
                                  <CastAction
                                    icon={RefreshCw}
                                    compact
                                    label={t.lab.aria.replace(row.kind)}
                                    onClick={() => pickBgImage(row.dome)}
                                  />
                                  <CastAction
                                    icon={X}
                                    danger
                                    compact
                                    label={t.lab.aria.remove(row.kind)}
                                    onClick={() => swapBgImage(null)}
                                  />
                                </>
                              ) : (
                                <span className="ml-auto flex min-w-0 justify-end">
                                  <UploadInvite
                                    label={t.lab.uploadImage}
                                    onClick={() => pickBgImage(row.dome)}
                                    aria={t.lab.aria.upload(row.kind)}
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
                        {/* "Shader", not "Preset": the row's own Edit button says
                            Edit shader, the library is WGSL, and every entry in
                            this list IS one — a preset is what the Grade row
                            below picks, where the thing being chosen is a set of
                            values rather than code. */}
                        <span className="shrink-0 text-xs">{t.lab.ctl.shader}</span>
                        <QuickPick
                          value={bgEffect?.name ?? null}
                          items={effectItems}
                          onPick={pickEffect}
                          // Only when something is applied: "Edit shader" with
                          // nothing to edit would open the editor on a subject
                          // the scene is not wearing, and the session's whole
                          // premise is that the canvas behind it IS the preview.
                          onEdit={bgEffect ? editCurrentEffect : undefined}
                          editLabel={t.bgLibrary.editShader}
                          onBrowse={() => openBrowse({ kind: "effect" })}
                          placeholder={t.lab.ctl.none}
                        />
                      </div>
                      {/* Both doors on purpose. "Browse all" inside the menu is
                          where you look once you have opened the picker and not
                          found what you wanted; the pill is how you get to the
                          library without opening the picker at all. Removing it
                          in favour of the menu row hid the library behind a
                          click that only makes sense after you have decided the
                          shortlist is not enough. */}
                      <div className="mt-2.5 flex justify-center">
                        <button
                          onClick={() => openBrowse({ kind: "effect" })}
                          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
                        >
                          <Sparkles className="size-3.5" />
                          {t.lab.cmd.effectLib}
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
                          <TabsTrigger value="world" className="flex-1">
                            {t.lab.tabs.world}
                          </TabsTrigger>
                          <TabsTrigger value="sun" className="flex-1">
                            {t.lab.tabs.sun}
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="world">
                          <ColorRow
                            label={t.lab.ctl.color}
                            value={world.color}
                            onChange={(hex) => patch("world", { color: hex })}
                          />
                          <SliderRow
                            label={t.lab.ctl.strength}
                            value={world.strength}
                            min={0}
                            max={2}
                            step={0.01}
                            onChange={(v) => patch("world", { strength: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                        </TabsContent>
                        <TabsContent value="sun">
                          <ColorRow
                            label={t.lab.ctl.color}
                            value={sun.color}
                            onChange={(hex) => patch("sun", { color: hex })}
                          />
                          <SliderRow
                            label={t.lab.ctl.strength}
                            value={sun.strength}
                            min={0}
                            max={6}
                            step={0.05}
                            onChange={(v) => patch("sun", { strength: v })}
                            fmt={(v) => v.toFixed(2)}
                          />
                          <SliderRow
                            label={t.lab.ctl.azimuth}
                            value={sun.azimuth}
                            min={0}
                            max={360}
                            step={1}
                            onChange={(v) => patch("sun", { azimuth: v })}
                            fmt={(v) => `${v.toFixed(0)}°`}
                          />
                          <SliderRow
                            label={t.lab.ctl.elevation}
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
                        <TabsTrigger value="grade" className="flex-1">
                          {t.lab.tabs.grade}
                        </TabsTrigger>
                        <TabsTrigger value="tone" className="flex-1">
                          {t.lab.tabs.tone}
                        </TabsTrigger>
                        <TabsTrigger value="bloom" className="flex-1">
                          {t.lab.tabs.bloom}
                        </TabsTrigger>
                        <TabsTrigger value="outline" className="flex-1">
                          {t.lab.tabs.outline}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="grade">
                        {/* Main's own selection model, whole: quick-switch on the
                            value text (built-ins · community · your drafts), the
                            full library behind a Browse row at the BOTTOM of the
                            body rather than on the section header — and no
                            "Browse all…" inside the quick list, because a door
                            two lines under another door is clutter. */}
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="shrink-0 text-xs">{t.lab.ctl.preset}</span>
                          <QuickPick
                            // The RAW name, not the translated one: QuickPick
                            // marks the active row with id === value, and ids
                            // are the document's names. The trigger still shows
                            // the translation — it renders the matched item's
                            // label, with the placeholder covering a grade the
                            // list does not hold.
                            value={grade.preset}
                            items={gradeItems}
                            onPick={pickGrade}
                            // Always available: a scene is always wearing SOME
                            // grade, Neutral included, and editing Neutral is
                            // how a look gets made from nothing.
                            onEdit={editCurrentGrade}
                            editLabel={t.gradeLibrary.edit}
                            onBrowse={() => openBrowse({ kind: "grade" })}
                            placeholder={gradeLabel(grade.preset)}
                          />
                        </div>
                        {/* Intensity is remembered PER grade, so switching looks
                            restores the strength you last used. Neutral is
                            identity — nothing to scale. */}
                        <div className={cn("mt-1", grade.preset === "Neutral" && "pointer-events-none opacity-40")}>
                          <SliderRow
                            label={t.lab.ctl.intensity}
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
                            deliberate final action. It NAMES the library it
                            opens, in the palette's words: three doors that all
                            said "Library" left position as the only thing
                            telling them apart, and a door you identify by where
                            you are standing is one you can open by mistake. */}
                        <div className="mt-2.5 flex justify-center">
                          <button
                            onClick={() => openBrowse({ kind: "grade" })}
                            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
                          >
                            <Palette className="size-3.5" />
                            {t.lab.cmd.gradeLib}
                          </button>
                        </div>
                      </TabsContent>
                      <TabsContent value="tone">
                        {/* The view transform is its own tab, next to Grade and in front
                            of it: the transform maps the render to the display, the
                            grade then works on its result. It is a LOOK
                            decision, not a preference: Filmic rolls highlights off
                            and desaturates doing it, Standard passes through what
                            the shader computed, which is what NPR work expects and
                            what the Wuthering Waves references render under. */}
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
                          <span className="shrink-0 text-xs">{t.lab.ctl.transform}</span>
                          <Select
                            value={view.transform}
                            onValueChange={(v) => patch("view", { transform: v as SceneSettings["view"]["transform"] })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Blender's own names — translating them would make
                                  the preset they were authored against harder to find. */}
                              {/* AgX is not offered. It is built for photographic
                                  HDR — it rolls highlights off and desaturates
                                  doing it, which is exactly the colour an anime
                                  look is made of, and neither reference project
                                  renders under it. The engine still supports it;
                                  nothing here asks for it. */}
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="filmic">Filmic</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <SliderRow
                          label={t.lab.ctl.exposure}
                          value={view.exposure}
                          min={-2}
                          max={2}
                          step={0.05}
                          onChange={(v) => patch("view", { exposure: v })}
                          fmt={(v) => v.toFixed(2)}
                        />
                      </TabsContent>
                      {/* No on/off: intensity 0 IS off — useSceneSync maps it to
                          enabled:false and the pyramid is skipped entirely. The
                          three that change the look, in the order you reach for
                          them: how much, what qualifies, how far it spreads. */}
                      <TabsContent value="bloom">
                        <SliderRow
                          label={t.lab.ctl.intensity}
                          value={bloom.intensity}
                          min={0}
                          max={1}
                          step={0.005}
                          onChange={(v) => patch("bloom", { intensity: v })}
                          fmt={(v) => v.toFixed(3)}
                        />
                        <SliderRow
                          label={t.lab.ctl.threshold}
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
                          label={t.lab.ctl.radius}
                          value={bloom.radius}
                          min={0.5}
                          max={8}
                          step={0.1}
                          onChange={(v) => patch("bloom", { radius: v })}
                          fmt={(v) => v.toFixed(1)}
                        />
                      </TabsContent>
                      {/* One switch, and a pane of its own — outline is a third
                          pass, not a corner of grade or bloom, and the fork's
                          size/opacity/colour overrides land here when they do. */}
                      <TabsContent value="outline">
                        <div className="flex items-center justify-between">
                          <span className="text-xs">{t.lab.ctl.outline}</span>
                          <Switch
                            size="sm"
                            checked={settings.outline.enabled}
                            onCheckedChange={(v) => patch("outline", { enabled: v })}
                          />
                        </div>
                      </TabsContent>
                    </Tabs>
                  ) : l.id === "physics" ? (
                    // Always simulating — no on/off. Main's own controls, whole.
                    <>
                      <SliderRow
                        label={t.lab.ctl.gravity}
                        value={physics.gravity}
                        min={0}
                        max={200}
                        step={1}
                        onChange={(v) => patch("physics", { gravity: v })}
                        fmt={(v) => v.toFixed(0)}
                      />
                      <SliderRow
                        label={t.lab.ctl.wind}
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
                        label={t.lab.ctl.frequency}
                        value={windSliderFromFreq(physics.windFrequency)}
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={physics.wind === 0}
                        onChange={(v) => patch("physics", { windFrequency: windFreqFromSlider(v) })}
                        fmt={(v) => windFreqFromSlider(v).toFixed(2)}
                      />
                      <SliderRow
                        label={t.lab.ctl.direction}
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
                        <TabsTrigger value="lens" className="flex-1">
                          {t.lab.tabs.lens}
                        </TabsTrigger>
                        <TabsTrigger value="focus" className="flex-1">
                          {t.lab.tabs.focus}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="lens">
                        {/* Same shape as the ground-under-stage pane: a loaded
                            camera VMD owns the shot, so the orbit controls grey
                            out under a one-line note instead of fighting it. */}
                        {cameraClip && <p className="mb-2 text-[11px]">{t.lab.cameraDrivesView}</p>}
                        <fieldset
                          disabled={!!cameraClip}
                          className={cn(cameraClip && "pointer-events-none opacity-40")}
                        >
                          {/* Follow first — it decides what the three numbers at
                              the bottom MEAN (offset from a bone vs a point in
                              the world), so each direction re-seeds its own
                              default rather than reinterpreting the other's. */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs">{t.lab.ctl.follow}</span>
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
                          {/* Degrees on the slider, radians in the document —
                              the same boundary conversion azimuth and elevation
                              make two rows down. A camera VMD animates fov
                              itself, which is what the fieldset above greys the
                              whole pane for. */}
                          <SliderRow
                            label={t.lab.ctl.fov}
                            value={Math.round(((camera.fov ?? CAMERA_DEFAULT_FOV) * 180) / Math.PI)}
                            min={10}
                            max={120}
                            step={1}
                            onChange={(v) => changeCamera({ ...camera, fov: (v * Math.PI) / 180 })}
                            fmt={(v) => `${Math.round(v)}°`}
                          />
                          <SliderRow
                            label={t.lab.ctl.distance}
                            value={camera.distance}
                            min={1}
                            max={100}
                            step={0.1}
                            onChange={(v) => changeCamera({ ...camera, distance: v })}
                            fmt={(v) => v.toFixed(1)}
                          />
                          {/* Azimuth and Elevation, the same pair the Sun uses —
                              both are a direction, so they answer to one set of
                              words. Alpha/beta are Babylon's internal names and
                              mean nothing to anyone else; degrees here, radians
                              in the document.
                              Elevation is NOT beta: beta is polar, measured from
                              straight overhead, so 90 is eye level and small
                              numbers are a bird's-eye view — the reverse of what
                              "elevation" says. Converted at the boundary, so the
                              slider reads 0 at the horizon and + from above. */}
                          <SliderRow
                            label={t.lab.ctl.azimuth}
                            value={Math.round((camera.alpha * 180) / Math.PI)}
                            min={-180}
                            max={180}
                            step={1}
                            onChange={(v) => changeCamera({ ...camera, alpha: (v * Math.PI) / 180 })}
                            fmt={(v) => `${v}°`}
                          />
                          <SliderRow
                            label={t.lab.ctl.elevation}
                            value={Math.round(90 - (camera.beta * 180) / Math.PI)}
                            min={-85}
                            max={85}
                            step={1}
                            onChange={(v) => changeCamera({ ...camera, beta: ((90 - v) * Math.PI) / 180 })}
                            fmt={(v) => `${v}°`}
                          />
                          {(["X", "Y", "Z"] as const).map((axis, i) => (
                            <SliderRow
                              key={axis}
                              label={camera.follow ? t.lab.ctl.offset(axis) : t.lab.ctl.target(axis)}
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
                          <span className="text-xs">{t.lab.ctl.dof}</span>
                          <Switch
                            size="sm"
                            checked={dof.enabled}
                            onCheckedChange={(v) => patch("dof", { enabled: v })}
                          />
                        </div>
                        {/* mt-2.5 on the fieldset, not the row: SliderRow zeroes
                            its own top margin as a first child, which pinned
                            Strength against the switch. */}
                        <fieldset
                          disabled={!dof.enabled}
                          className={cn("mt-2.5", !dof.enabled && "pointer-events-none opacity-40")}
                        >
                          <SliderRow
                            label={t.lab.ctl.strength}
                            value={dof.aperture}
                            min={0.2}
                            max={3}
                            step={0.05}
                            onChange={(v) => patch("dof", { aperture: v })}
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
      {mounted && inspected && (
        <Surface
          placement="side"
          // Starts BELOW the top-right pills (top-3 + their h-10 + 8px), capped
          // above the transport: 100% minus 3.75rem top minus 4rem transport
          // reserve. 18rem, symmetric with the left dock — and the same 18rem
          // the pill cluster above states, both anchored to the same right
          // inset, so the two left edges coincide without either measuring the
          // other. The pills come to the column now, not the other way round.
          className="top-[3.75rem] bottom-auto max-h-[calc(100%-7.75rem)] animate-[panel-in_0.2s_cubic-bezier(0.32,0.72,0,1)]"
          style={{ zIndex: inspectorZ.z }}
          onPointerDownCapture={inspectorZ.onPointerDownCapture}
          onFocusCapture={inspectorZ.onFocusCapture}
        >
          {/* The command's own name, not the model's: the cast row already says
              which character this is, the panel's model tabs say which one is
              being edited, and a third copy with stats was the same fact three
              times. One title, matching the palette entry that opened it. */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5">
            <MaterialSphereIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.lab.editMaterials}</span>
            <CastAction icon={X} label={t.lab.closeMaterials} onClick={() => setInspectedId(null)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <MaterialsPanel
              dense
              modelTabs={models.map((m) => ({ id: m.id, file: m.file, active: m.id === inspected.id }))}
              // Through openMaterials, not setInspectedId: switching model here
              // is the same act as opening the panel on another one, and the
              // node editor's binding has to be released either way.
              onSelectModel={openMaterials}
              materials={inspected.materials}
              groups={inspectedGroups}
              activeGroupId={activeGroupId}
              onHover={(name) => highlight(inspected.id, name)}
              onToggleVisible={(name) => toggleVisible(inspected.id, name)}
              onOpenLibrary={openGraphLibrary}
              onCreateGroup={inspectCreateGroup}
              onRenameGroup={inspectRenameGroup}
              onDeleteGroup={inspectDeleteGroup}
              onEditGroupGraph={editGroupGraph}
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
      {mounted && (
        <Surface
          placement="side"
          // Starts BELOW the top-right pills (top-3 + their h-10 + 8px) and hugs
          // its content like the left dock, capped above the transport: 100%
          // minus 3.75rem top minus 4rem transport reserve.
          className={cn(
            "top-[3.75rem] bottom-auto max-h-[calc(100%-7.75rem)]",
            // Fade only. It used to slide 8px right on the way out, and against
            // a panel whose left edge is the column's edge that reads as the
            // panel resizing rather than leaving — the eye tracks the moving
            // edge, not the fading one. Nothing else in this chrome translates
            // to dismiss; the inspector simply unmounts.
            "transition-[opacity,visibility] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
            !exportOpen && "invisible opacity-0",
          )}
          style={{ zIndex: exportZ.z }}
          onPointerDownCapture={exportZ.onPointerDownCapture}
          onFocusCapture={exportZ.onFocusCapture}
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.lab.exportPanel}</span>
            <CastAction icon={X} label={t.lab.closeExport} onClick={() => setExportOpen(false)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <RenderPanel
              active={exportOpen}
              engineRef={engineRef}
              canvasRef={canvasRef}
              modelName={masterId ?? models[0]?.id ?? ""}
              extraModelNames={models.filter((m) => animByModel[m.id] && m.id !== masterId).map((m) => m.id)}
              sceneName={sceneName}
              animName={masterClipName}
              animDuration={animDuration}
              backdrop={bgImage && !bgImage.dome ? bgImage : null}
              backgroundColor={settings.background.color}
              musicUrl={musicClip?.url ?? null}
              greenScreen={framing.greenScreen}
              onGreenScreenChange={framing.setGreenScreen}
              onExportingChange={(v) => {
                framing.setExporting(v)
                // Closes the "render" gap for the rest of the session. Set when
                // the export STARTS: the suggestion has done its job by then,
                // and a failed render is not a reason to keep nagging.
                if (v) setExportedOnce(true)
              }}
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
          className={cn(
            PILL,
            "absolute right-3 bottom-3 flex h-10 cursor-pointer items-center gap-2 px-4 text-[13px] text-foreground",
          )}
        >
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          {t.lab.exporting}
          {exportPct !== null ? ` ${exportPct}%` : "…"}
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
      {mounted && (
        // The container is the VIEWPORT, in both states, and the working area is
        // expressed as a max-width instead (below). Insetting the container by
        // the docks is what squeezed the collapsed pill: it needs ~434px, and
        // WORKSPACE leaves only window − 40.5rem, so anything under a ~1080px
        // window ate into the track until it was a few pixels wide. A pill
        // floating over the canvas has never needed to clear the docks — it is
        // centred, and they are not.
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
          {/* max-w-fit is what returns the collapsed pill to the ORIGINAL slider
            length: the track is flex-1 with min-w-[min(16rem,30vw)], and a
            fit-content pill resolves a flex-1 child at its min-content size —
            which IS that floor, the shipped transport's exact track width. Open
            swaps the cap to 100% and flex-1 absorbs the growth, so the track is
            the only thing that stretches.

            interpolate-size lets the keyword cap animate (Chrome; Safari snaps
            between correct layouts, which this dev route accepts).

            Open caps at the WORKING AREA rather than at 100%, because the
            container is now the viewport: 39rem is WORKSPACE's 40.5rem of dock
            insets less the 1.5rem of gutter the container already spends, so
            the opened panel lands exactly where WORKSPACE used to put it, and
            stops clear of the stack. Expressing it against a container that
            never resizes is what keeps the fold honest in both directions — a
            cap measured against a box that jumps at the same moment would grow
            the panel on its way closed. The max() floor only matters on a
            window too narrow for the editor anyway; it keeps the open timeline
            from resolving to zero width there. */}
          <div
            className={cn(
              "pointer-events-auto w-full transition-[max-width] [interpolate-size:allow-keywords]",
              FOLD,
              timelineOpen ? "max-w-[max(18rem,calc(100%_-_39rem))]" : "max-w-fit",
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
                TIMELINE_EDITOR ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-expanded={timelineOpen}
                    aria-label={timelineOpen ? t.lab.hideTimeline : t.lab.showTimeline}
                    onClick={() => setTimelineOpen((v) => !v)}
                    className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    {timelineOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                  </Button>
                ) : undefined
              }
              unfolded={timelineOpen}
              below={
                // grid-rows 0fr→1fr is the one way to animate to CONTENT height
                // without measuring it. The inner element owns overflow-hidden;
                // the row itself is what animates.
                <div
                  className={cn(
                    "grid transition-[grid-template-rows]",
                    FOLD,
                    timelineOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
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
                        <Lane key={m.id} label={models.length > 1 ? displayName(m.file) : t.lab.lanes.animation}>
                          {animByModel[m.id] ? (
                            <LaneBlock>{animByModel[m.id].name}</LaneBlock>
                          ) : (
                            <LaneSlot label={t.lab.drop.motion} onClick={() => pickAnimation(m.id)} />
                          )}
                        </Lane>
                      ))}
                      <Lane label={t.lab.lanes.camera}>
                        {cameraClip ? (
                          <LaneBlock>{cameraClip}</LaneBlock>
                        ) : (
                          <LaneSlot label={t.lab.drop.camera} onClick={() => cameraInput.current?.click()} />
                        )}
                      </Lane>
                      {/* The audio clock is still to come, so a loaded track will
                        not PLAY yet — but the slot is a real intake (it lands in
                        sceneFiles.audio), so it behaves like one. */}
                      <Lane label={t.lab.lanes.music}>
                        {musicClip ? (
                          <LaneBlock>{musicClip.name}</LaneBlock>
                        ) : (
                          <LaneSlot label={t.lab.drop.music} onClick={() => musicInput.current?.click()} />
                        )}
                      </Lane>
                    </div>
                  </div>
                </div>
              }
            />
          </div>
        </div>
      )}
    </main>
  )
}
