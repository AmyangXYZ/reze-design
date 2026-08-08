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
  Camera,
  Clapperboard,
  Code2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Contrast,
  Music,
  Mountain,
  Plus,
  RefreshCw,
  PanelLeftClose,
  PanelLeft,
  Share2,
  Sparkles,
  Sun,
  Workflow,
  Upload,
  WandSparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AccountButton } from "@/components/editor/account-panel"
import { AnimPlayer } from "@/components/scene/anim-player"
import { CastSwatch } from "@/components/editor/cast-swatch"
import { CommandPalette } from "@/components/editor/command-palette"
import type { PaletteItem } from "@/lib/command-search"
import { SceneName } from "@/components/editor/scene-name"
import { Surface } from "@/components/editor/surface"
import { LayerRow, PresetChips, StackGroup } from "@/components/editor/layer-row"
import { SliderRow } from "@/components/scene/scene-sidebar"
import { useEngine } from "@/hooks/use-engine"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import { hydrateScene } from "@/lib/scene"
import { expandUploadFiles } from "@/lib/uploads"
import { castColour } from "@/lib/model-colour"
import { castSourceFor } from "@/lib/cast-source"
import { NEUTRAL_PALETTE, type CastPaletteId } from "@/lib/cast-palette"
import { relFilePath } from "@/lib/scene-files"
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
const WORKSPACE = "left-[calc(17rem+1.5rem)] right-[calc(17rem+1.5rem)]"

/** Each layer's presets. Static here — the real stack reads these from the
 *  document and the libraries; the shell only needs them to have names. */
const LAYERS = [
  {
    id: "camera",
    name: "Camera",
    icon: Camera,
    presets: ["Wide", "Portrait", "Low angle", "Follow"],
  },
  { id: "stage", name: "Stage", icon: Mountain, presets: [] },
  {
    id: "background",
    name: "Background",
    icon: Cloud,
    presets: ["Shining Stars", "Aurora", "Rain", "None"],
  },
  {
    id: "light",
    name: "Light",
    icon: Sun,
    presets: ["Soft key", "Golden hour", "Stage", "Rim only"],
  },
  {
    id: "bloom",
    name: "Bloom",
    icon: Sparkles,
    presets: ["Gentle", "Dreamy", "Hard", "Off"],
  },
  {
    id: "grade",
    name: "Grade",
    icon: Contrast,
    presets: ["Neutral", "Warm film", "Cool night", "Bleach"],
  },
  { id: "music", name: "Music", icon: Music, presets: [] },
] as const

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
    altLabels: ["编辑着色器图", "シェーダーグラフを編集"],
    keywords: ["wgsl", "material", "node", "しぇーだー"],
  },
  {
    id: "wgsl",
    repeatable: true,
    nextLikely: ["export"],
    section: "command",
    deep: true,
    icon: Code2,
    label: "Write a WGSL background effect",
    altLabels: ["编写 WGSL 背景特效", "WGSL 背景エフェクトを書く"],
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
    altLabels: ["导出视频", "動画を書き出す"],
    keywords: ["mp4", "4k", "render", "encode"],
  },
  {
    id: "publish",
    suggested: true,
    section: "command",
    icon: Share2,
    label: "Publish scene",
    altLabels: ["发布场景", "シーンを公開"],
    keywords: ["share", "upload", "link"],
  },
  {
    id: "stage",
    nextLikely: ["light", "grade"],
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
    altLabels: ["上传音乐", "音楽をアップロード"],
    keywords: ["bgm", "audio", "mp3", "song"],
  },
  {
    id: "camera",
    repeatable: true,
    nextLikely: ["light"],
    section: "goto",
    icon: Camera,
    label: "Camera",
    altLabels: ["镜头", "カメラ"],
  },
  {
    id: "light",
    repeatable: true,
    nextLikely: ["grade", "bloom-int"],
    section: "goto",
    icon: Sun,
    label: "Light",
    altLabels: ["灯光", "ライト"],
  },
  {
    id: "grade",
    repeatable: true,
    nextLikely: ["export"],
    section: "goto",
    icon: Contrast,
    label: "Grade",
    hint: "Neutral",
    altLabels: ["调色", "グレード"],
  },
  {
    id: "bloom-int",
    repeatable: true,
    section: "setting",
    icon: Sparkles,
    label: "Bloom intensity",
    hint: "0.05",
    altLabels: ["泛光强度"],
  },
  {
    id: "sun-elev",
    repeatable: true,
    section: "setting",
    icon: Sun,
    label: "Sun elevation",
    hint: "21°",
    altLabels: ["太阳高度"],
  },
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
 * One actionable line in a cast row — the model, or its motion.
 *
 * Plain `group`, not a named one: the two lines are siblings rather than nested,
 * so each `group-hover` resolves to its own line and nothing else.
 *
 * The action slot keeps its width whether or not it is visible, so the name
 * beside it does not re-truncate the moment the pointer arrives — the ellipsis
 * lands in the same place hovered or not.
 *
 * gap-2 between the name and the slot, not the gap-0.5 the buttons use among
 * themselves: a name that truncates flush against the first button reads as
 * having been cut off BY it. The space is what makes the ellipsis look chosen.
 */
function CastLine({ text, actions }: { text: ReactNode; actions: ReactNode }) {
  return (
    // -mx-1 px-1: the highlight breathes past the text without moving it.
    <span className="group -mx-1 flex h-5 items-center gap-2 rounded-interior px-1 transition-colors hover:bg-white/[0.05]">
      {text}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </span>
    </span>
  )
}

/** Icon-only, so it always carries a tooltip. size-5 fits the line exactly —
 *  anything taller sets the row height from the buttons rather than the text. */
function CastAction({
  icon: Icon,
  tip,
  label,
  onClick,
  danger,
  disabled,
  compact,
  side = "bottom",
}: {
  icon: ComponentType<{ className?: string }>
  /** Shown on hover. */
  tip: string
  /** Names the model too, since a screen reader hears these out of context. */
  label: string
  onClick: () => void
  danger?: boolean
  /** size-4 instead of size-5, to sit in a text-xs line box without setting the
   *  row's height from the button. The icon does NOT shrink with it — a 16px
   *  target only needs a smaller box, not a smaller mark. */
  compact?: boolean
  /** Rendered, dimmed and inert. Dropping the button instead would let the pair
   *  reflow between states, and a control that moves is worse than one that is
   *  visibly unavailable — the position is what you aim at. */
  disabled?: boolean
  /** The model line opens UPWARD. A tooltip below it lands on the motion line
   *  and takes the pointer, so hovering one row's actions made the row under it
   *  unreachable — the tip has to open away from its sibling, not over it. */
  side?: "top" | "bottom"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "shrink-0 rounded-chip text-muted-foreground hover:bg-white/10",
            compact ? "size-4" : "size-5",
            danger ? "hover:text-red-400" : "hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tip}</TooltipContent>
    </Tooltip>
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

// The same two lines at the same heights — a skeleton that is not the shape of
// what replaces it is just a differently-timed layout shift.
function CastRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-1">
      <Skeleton className="size-6 shrink-0 rounded-interior" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-28 rounded-chip" />
        </span>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-20 rounded-chip" />
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
  } = useEngine(scene)

  // Motion names by model id. One clip per character is already the document's
  // shape (lib/scene.ts: "the model plus ITS motion clip"), so this holds the
  // name to show and nothing more — the engine owns the clip itself.
  const [animByModel, setAnimByModel] = useState<Record<string, string>>({})
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
        await (packed ? loadVmdFile(entry.model.id, packed) : loadVmdUrl(entry.model.id, clip.name, clip.url))
        if (cancelled) return
        setAnimByModel((prev) => ({ ...prev, [entry.model.id]: clip.name }))
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

  // Only one row open at a time — that is what lets presets-then-parameters sit
  // inside a row without the stack becoming a wall of sliders.
  // The transport IS the timeline, collapsed. Same surface, same controls in the
  // same place — unfolding it must never feel like a different panel appeared.
  const [timelineOpen, setTimelineOpen] = useState(false)
  // The scene document already has cameraAnimation and audio slots. The camera
  // one the engine can load today, so it is wired rather than drawn.
  const [cameraClip, setCameraClip] = useState<string | null>(null)
  const cameraInput = useRef<HTMLInputElement | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({
    camera: "Wide",
    background: "Shining Stars",
    light: "Soft key",
    bloom: "Gentle",
    grade: "Neutral",
  })
  const [expanded, setExpanded] = useState(true)
  // ── Model upload ──
  // "Replace" is an upload too — same picker, same parsing, only the target
  // differs: a new slot, or an existing one that keeps its position and clip.
  // One path, so the two can never drift.
  type ModelTarget = { mode: "add" } | { mode: "replace"; id: string }
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
  type UploadState =
    { kind: "pick"; files: File[]; paths: string[]; target: ModelTarget } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)

  const pickModel = (target: ModelTarget) => {
    modelTarget.current = target
    folderInput.current?.click()
  }

  const loadPicked = async (files: File[], pmx: File, target: ModelTarget) => {
    setUpload(null)
    try {
      if (target.mode === "replace") await replaceModelFromFiles(target.id, files, pmx)
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
  useEffect(() => {
    for (const m of models) {
      if (castStarted.current.has(m.id)) continue
      castStarted.current.add(m.id)
      const source = castSourceFor(m.id, scene, groupsByModel[m.id])
      void (source ? castColour(source) : Promise.resolve(null)).then((palette) =>
        setPalettes((p) => (p[m.id] ? p : { ...p, [m.id]: palette ?? NEUTRAL_PALETTE })),
      )
    }
  }, [models, scene, groupsByModel])

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [recentIds, setRecentIds] = useState<string[]>([])
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
    setPaletteSession((n) => n + 1)
    setPaletteOpen(true)
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

  const runCommand = useCallback(
    (item: PaletteItem) => {
      // Most recent first, no duplicates, five deep — enough to be useful
      // without the empty-query list becoming a second menu. Staged in a ref
      // rather than state so nothing re-renders while the dialog closes.
      const base = nextRecent.current.length ? nextRecent.current : recentIds
      nextRecent.current = [item.id, ...base.filter((id) => id !== item.id)].slice(0, 5)
      item.run?.()
    },
    [recentIds],
  )

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      {/* Full bleed, always. Chrome floats over it; nothing ever shrinks the
          thing you are making. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}

      {/* ── Top bar ──
          Right cluster only. The brand belongs to the stack while the stack is
          open — BrandPill's own asHeader/collapsed split, which is also what
          stops a pill and a panel of different widths sitting on top of each
          other. */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-start gap-2">
        {!expanded && (
          <div className={cn(PILL, "pointer-events-auto flex h-10 items-center gap-1.5 pr-1.5 pl-2")}>
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
            <SceneName name={sceneName} onRename={setSceneName} className="-ml-px truncate px-1.5" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(true)}
              aria-label="Show panels"
              className="ml-1 size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <PanelLeft className="size-4" />
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
        <Button
          variant="ghost"
          onClick={openPalette}
          className={cn(
            PILL,
            "pointer-events-auto h-10 gap-2 px-3.5 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          Search or run
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
            if (name) setAnimByModel((prev) => ({ ...prev, [id]: name }))
          })
        }}
      />

      <CommandPalette
        key={paletteSession}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={COMMANDS}
        recentIds={recentIds}
        onRun={runCommand}
      />

      {/* ── The stack ── */}
      {expanded && (
        <Surface
          placement="float"
          className={cn("top-3 left-3 flex max-h-[calc(100%-5.5rem)] w-[17rem] flex-col overflow-hidden")}
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
                aria-label="Hide panels"
                className="ml-auto size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
              >
                <PanelLeftClose className="size-4" />
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
              action={
                <CastAction
                  icon={Plus}
                  compact
                  tip="Add model"
                  label="Add model"
                  onClick={() => pickModel({ mode: "add" })}
                />
              }
            >
              {!ready && <CastRowSkeleton />}
              {models.map((m) =>
                !palettes[m.id] ? (
                  <CastRowSkeleton key={m.id} />
                ) : (
                  // Two lines, one character. The swatch sits OUTSIDE both hover
                  // regions and centres against the pair: it identifies the model,
                  // it is not something you act on, and a highlight that lit up
                  // from touching it would promise an action it does not have.
                  //
                  // Each line is its own hover target with its own actions, so you
                  // are always pointing at the exact thing the buttons will change
                  // — the model, or its motion.
                  <div key={m.id} className="flex items-center gap-2.5 px-4 py-1">
                    <CastSwatch palette={palettes[m.id]} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* Icon-only controls get tooltips; anything with a visible
                      label does not — a tooltip repeating the word already on the
                      button is noise that delays the pointer. Collapse toggles are
                      the other exception: a chevron pointing where the thing will
                      go has already said it. */}
                      <CastLine
                        text={<span className="min-w-0 flex-1 truncate text-sm">{displayName(m.file)}</span>}
                        actions={
                          <>
                            <CastAction
                              icon={RefreshCw}
                              side="top"
                              tip="Upload model folder"
                              label={`Upload model folder to replace ${displayName(m.file)}`}
                              onClick={() => pickModel({ mode: "replace", id: m.id })}
                            />
                            <CastAction
                              icon={X}
                              side="top"
                              tip="Delete model"
                              label={`Delete ${displayName(m.file)}`}
                              danger
                              onClick={() => removeModelById(m.id)}
                            />
                          </>
                        }
                      />
                      {/* A motion is a DECISION the model carries, not a fact about
                          it — the same reason LayerRow summarises "Golden hour"
                          rather than "205° · 21°".

                          13px against the name's 14: half a step, which is as
                          far as it can go before it stops reading as part of the
                          same row. Colour carries the hierarchy — bright name,
                          muted value — and the size only softens it. */}
                      <CastLine
                        text={
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {animByModel[m.id] ?? "No animation"}
                          </span>
                        }
                        actions={
                          <>
                            {/* The icon states which it is: an empty slot takes a
                                motion, a filled one swaps it. Same button, same
                                place, two different jobs. */}
                            <CastAction
                              icon={animByModel[m.id] ? RefreshCw : Upload}
                              tip={animByModel[m.id] ? "Replace animation" : "Upload animation"}
                              label={`${animByModel[m.id] ? "Replace" : "Upload"} animation for ${displayName(m.file)}`}
                              onClick={() => pickAnimation(m.id)}
                            />
                            <CastAction
                              icon={X}
                              danger
                              disabled={!animByModel[m.id]}
                              tip="Delete animation"
                              label={`Delete animation on ${displayName(m.file)}`}
                              onClick={() => removeAnimation(m.id)}
                            />
                          </>
                        }
                      />
                    </span>
                  </div>
                ),
              )}
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

            <StackGroup label="Scene">
              {LAYERS.map((l) => (
                <LayerRow
                  key={l.id}
                  icon={l.icon}
                  name={l.name}
                  summary={picked[l.id] ?? "—"}
                  open={openRow === l.id}
                  onToggle={() => setOpenRow((r) => (r === l.id ? null : l.id))}
                >
                  {l.presets.length > 0 && (
                    <PresetChips
                      options={[...l.presets]}
                      value={picked[l.id] ?? null}
                      onPick={(name) => setPicked((p) => ({ ...p, [l.id]: name }))}
                    />
                  )}
                  {/* Placeholder parameters — the shell is judging the row, not
                    the controls, and these are wired to nothing. */}
                  <SliderRow
                    label="Amount"
                    value={0.5}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={() => {}}
                    fmt={(v) => v.toFixed(2)}
                  />
                </LayerRow>
              ))}
            </StackGroup>
          </div>
        </Surface>
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
                          <LaneBlock>{animByModel[m.id]}</LaneBlock>
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
                    {/* Disabled, not omitted. scene.assets.audio is a real slot,
                        but nothing on this route mirrors the animation clock onto
                        an audio element yet — so the lane says it exists and stays
                        inert until it can keep the promise. */}
                    <Lane label="Music">
                      <LaneSlot label="Music arrives with the audio clock" disabled />
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
