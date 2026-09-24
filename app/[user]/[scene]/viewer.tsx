"use client"

// The published-scene viewer: the same engine, the same document, none of the
// editing. Assets come out of the scene's zip (models, motions, audio) — which is
// why publishing bundles them in the first place.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, GalleryThumbnails, GitFork, Heart, WandSparkles } from "lucide-react"
import { LogoMenu, Row as MenuRow } from "@/components/editor/scene-file-menu"
import { SceneGallery } from "@/components/editor/scene-gallery"
import { AnimPlayer } from "@/components/scene/anim-player"
import { builtinEffect } from "@/lib/effects"
import { useEngine } from "@/hooks/use-engine"
import { useSceneCast, useSceneSync } from "@/hooks/use-scene-sync"
import { useSceneMedia } from "@/hooks/use-scene-media"
import { useSceneClips } from "@/hooks/use-scene-clips"
import { useAudioClock, useTrackAudio } from "@/hooks/use-audio-clock"
import { useMediaBackdrop } from "@/hooks/use-media-backdrop"
import { SceneBackdrop } from "@/components/scene/scene-backdrop"
import { specOf } from "@/lib/grade"
import { libraryGraph } from "@/lib/materials"
import { newSceneId, parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import type { VisibilityWindow } from "@/lib/visibility"
import { saveLocalBundle } from "@/lib/asset-store"
import { setForkTarget } from "@/lib/fork"
import { LoadingPill, useLoadingLabel } from "@/components/editor/loading-pill"
import { resolveSceneRefs, resolveSceneRefsSync } from "@/lib/resolve-refs"
import { useSession } from "@/lib/auth-client"
import { useI18n, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type ViewerProps = {
  doc: SceneDoc
  sceneId: string
  title: string
  author: string
  description: string
  /** 借物表 — who the model, motion and music came from. Required at publish, so
   *  it should be readable here rather than only enforced there. */
  credits: string
  likeCount: number
  /** When it was published, ISO. Printed under the author. */
  publishedAt: string
}

/**
 * The page: everything that is already known, plus the scene once it can boot.
 *
 * The engine takes its scene at construction, so the document's pins have to be
 * content before it starts — which is why the canvas lives in a child with an
 * unconditional `useEngine(scene)`. Everything ELSE is here, because everything
 * else was known before the request was made: the title, the author, the
 * description, the credits, the brand. This component's first render IS the
 * server's HTML, so all of that paints before a line of JavaScript has run,
 * before WebGPU exists and long before the first model byte arrives. It used to
 * return a loading pill on black — the whole page waited on the last asset to
 * show text the server had all along.
 */
/** True once the page runs in a browser; false while it renders on the server.
 *  What a server cannot know — the visitor's clock and timezone — waits for it. */
const noSubscription = () => () => {}

/** When this was published: the plain date from the server, then the visitor's
 *  own full date and time once there is a browser to ask. Same shape the maker
 *  page uses; a `<time>` so the machine-readable value is the ISO either way. */
function PublishedAt({ iso }: { iso: string }) {
  const { locale } = useI18n()
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false)
  return (
    <time dateTime={iso} className="mt-0.5 block font-mono text-[11px] text-white/40 tabular-nums">
      {inBrowser ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : iso.slice(0, 10)}
    </time>
  )
}

export function SceneViewer(props: ViewerProps) {
  const t = useT()
  const router = useRouter()
  const like = useLike(props.sceneId, props.likeCount)
  // Synchronously when every pin is bundled — the common case. Then the canvas
  // is in the first render and the engine starts on mount, instead of after a
  // resolve round trip and a second pass.
  const [scene, setScene] = useState<Scene | null>(() => {
    const resolve = resolveSceneRefsSync(props.doc)
    return resolve ? parseSceneDoc(props.doc, builtinEffect, libraryGraph, resolve) : null
  })
  useEffect(() => {
    if (scene) return
    let stale = false
    void resolveSceneRefs(props.doc).then((resolve) => {
      if (!stale) setScene(parseSceneDoc(props.doc, builtinEffect, libraryGraph, resolve))
    })
    return () => {
      stale = true
    }
  }, [props.doc, scene])

  // The unzipped bundle, reached up from the stage below. The engine holds it
  // because it is rendering it; Fork hands the same Files to the editor rather
  // than sending it back to the network for a zip this tab already has.
  const bundleFilesRef = useRef<() => File[]>(() => [])
  const [forking, setForking] = useState(false)
  const [logoMenu, setLogoMenu] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

  /**
   * Park the assets, then go.
   *
   * The write is awaited: the editor looks for the record the moment it boots,
   * and a fork that navigated first would race it and quietly fall back to
   * downloading. If there is nothing to park — the bundle is still loading, the
   * scene has no assets, storage is full — the fork carries no bundle id and the
   * editor opens the scene the ordinary way.
   */
  const openInEditor = async () => {
    if (forking) return
    setForking(true)
    try {
      const files = bundleFilesRef.current()
      if (files.length) {
        const bundleId = newSceneId()
        const entries = files.map((file) => ({ path: file.name, file }))
        if (await saveLocalBundle(bundleId, entries)) {
          setForkTarget(props.sceneId, bundleId)
          router.push("/")
          return
        }
      }
      setForkTarget(props.sceneId)
      router.push("/")
    } finally {
      setForking(false)
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-zinc-950 select-none">
      {/* The scene, under the chrome — its own component so `useEngine` never
          runs conditionally. Until it exists there is a pill, and the text
          around it is already readable. */}
      {scene ? <SceneStage {...props} scene={scene} bundleFilesRef={bundleFilesRef} /> : <LoadingPill />}

      {/* Top left: whose site this is. A shared link is often someone's first
          contact with the product, and nothing else on the page says its name.
          The logo is a menu, as in the editor: back to it, or on to another
          scene without going through it. */}
      <div
        // The editor's collapsed brand pill, box model and all: same top-3/left-3
        // origin, same 1px border, same pl-2/pr-1.5, same size-7 icon well. Only
        // the pill's surface is missing, so the mark and wordmark land on the exact
        // pixels they occupy in the editor and nothing shifts between the two.
        //
        // h-10, NOT py-1.5. The editor's pill states its height, and h-10 is
        // border-box: its own 1px border eats into the 40, leaving 38 to centre
        // a size-7 well in. Built from padding instead, this box came out 42 tall
        // and put the mark one pixel lower — a step you see the moment you open a
        // scene from the editor, which is the one journey this pill exists for.
        className="absolute top-3 left-3 flex h-10 items-center gap-1.5 rounded-xl border border-transparent pr-1.5 pl-2"
      >
        {/* The editor's trigger exactly — the mark is the menu, not the pill —
            so the panel opens on the same pixels on both pages. */}
        <LogoMenu
          open={logoMenu}
          onOpenChange={setLogoMenu}
          trigger={
            <span className="flex size-7 shrink-0 items-center justify-center text-pink-400">
              <WandSparkles className="size-4.5" />
            </span>
          }
        >
          <MenuRow
            icon={ArrowLeft}
            label={t.share.backToEditor}
            onClick={() => {
              setLogoMenu(false)
              router.push("/")
            }}
          />
          <div className="mt-1 border-t border-white/10 pt-1">
            <MenuRow
              icon={GalleryThumbnails}
              label={t.gallery.door}
              onClick={() => {
                setLogoMenu(false)
                setGalleryOpen(true)
              }}
            />
          </div>
        </LogoMenu>
        <Link
          href="/"
          className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-white"
        >
          Reze Design
        </Link>
      </div>
      <SceneGallery open={galleryOpen} onOpenChange={setGalleryOpen} />

      {/* Bottom left, above the transport: title, author, caption — TikTok's
          arrangement, where the text hugs itself and the scene stays the page. */}
      {/* Desktop: top-3/right-3, the editor's own inset for its top-right
          cluster — so the scene panel here and the pills there sit on one line
          and one right edge. It was top-4/right-4, four pixels off in both,
          which reads as a slip rather than a difference. Mobile keeps its
          bottom-left home above the transport. */}
      <div className="absolute bottom-16 left-4 w-[min(10.5rem,44vw)] overflow-hidden rounded-xl bg-zinc-950/50 backdrop-blur-md md:top-3 md:right-3 md:bottom-auto md:left-auto md:w-60">
        {/* Desktop header: the two actions, pushed apart, over the panel they act on. */}
        <div className="hidden items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 md:flex">
          <button
            onClick={() => void openInEditor()}
            disabled={forking}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-blue-400 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-300 disabled:cursor-default disabled:opacity-60"
          >
            <GitFork className="size-3.5" />
            {t.share.fork}
          </button>
          <LikeButton like={like} compact />
        </div>
        {/* Everything, always: crediting only counts if people can read it without
            knowing to ask. Long text scrolls inside the panel. */}
        <div className="max-h-[50dvh] w-full overflow-y-auto px-2.5 py-2 md:max-h-[calc(100dvh-7rem)] md:px-3 md:py-2.5">
          <div className="truncate text-sm font-semibold tracking-tight text-white">{props.title}</div>
          <Link
            href={`/${props.author}`}
            className="block w-fit max-w-full truncate font-mono text-xs text-white/55 transition-colors hover:text-white hover:underline"
          >
            @{props.author}
          </Link>
          <PublishedAt iso={props.publishedAt} />
          {props.description && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-white/75">{props.description}</p>
          )}
          {props.credits && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="text-[10px] font-medium tracking-[0.14em] text-white/40 uppercase">{t.share.credits}</div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-white/70">{props.credits}</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile keeps TikTok's standalone rail, thumb-reachable and clear of the
          transport; desktop shows it inside the card instead. */}
      <LikeButton like={like} className="absolute right-5 bottom-16 flex-col md:hidden" />
    </main>
  )
}

function useLike(sceneId: string, initial: number) {
  const { data: session } = useSession()
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initial)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    if (!session || busy) return
    setBusy(true)
    // Optimistic: a heart that waits on the database feels broken.
    setLiked((v) => !v)
    setCount((c) => c + (liked ? -1 : 1))
    try {
      const res = await fetch(`/api/library/${sceneId}/like`, { method: "POST" })
      if (!res.ok) throw new Error(String(res.status))
      const next = (await res.json()) as { liked: boolean; likeCount: number }
      setLiked(next.liked)
      setCount(next.likeCount)
    } catch {
      // Roll back rather than leave a count the server disagrees with.
      setLiked((v) => !v)
      setCount((c) => c + (liked ? 1 : -1))
    } finally {
      setBusy(false)
    }
  }
  return { liked, count, toggle, canLike: !!session }
}

type LikeState = ReturnType<typeof useLike>

/** Rendered twice — as a standalone rail on mobile, inside the card on desktop —
 *  but only ever one is visible, and both read the same state. */
function LikeButton({ like, compact, className }: { like: LikeState; compact?: boolean; className?: string }) {
  const t = useT()
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        onClick={() => void like.toggle()}
        disabled={!like.canLike}
        title={like.canLike ? undefined : t.library.signInToLike}
        className={cn(
          "flex items-center justify-center transition-transform",
          like.canLike ? "cursor-pointer hover:scale-110 active:scale-90" : "opacity-60",
        )}
      >
        {/* Bare glyph, no button chrome — a drop shadow is enough to hold it
            against a bright scene, and the scene stays the page. */}
        <Heart
          className={cn(
            "text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] transition-colors",
            // In the card header it sits beside a button; on the mobile rail it is
            // the only thing there and needs the presence.
            compact ? "size-5" : "size-7",
            like.liked && "fill-red-400 text-red-400",
          )}
        />
      </button>
      <span className={cn("font-semibold text-white tabular-nums drop-shadow", compact ? "text-xs" : "text-sm")}>
        {like.count}
      </span>
    </div>
  )
}

/** The scene layer: canvas, backdrop, transport, audio. Everything that has to
 *  wait on bytes — and nothing that doesn't, which all lives in the page above. */
function SceneStage({
  scene,
  bundleFilesRef,
}: ViewerProps & { scene: Scene; bundleFilesRef: RefObject<() => File[]> }) {
  const t = useT()
  const {
    canvasRef,
    engineRef,
    ready,
    stageReady,
    engineReady,
    styling,
    bundleReady,
    bundleProgress,
    error,
    models,
    bundleFile,
    bundleFiles,
    tickPlanes,
    stages,
    props,
    loadVmdFile,
    loadVmdUrl,
    loadMorphFile,
    loadMorphUrl,
    syncLyricsTo,
  } = useEngine(scene)
  // Published upward so Fork can hand the unzipped assets to the editor. A ref,
  // not state: nothing renders differently for it, and the getter is stable.
  useEffect(() => {
    bundleFilesRef.current = bundleFiles
  }, [bundleFilesRef, bundleFiles])

  const loadingLabel = useLoadingLabel({
    scene,
    bundleProgress,
    bundleReady,
    engineReady,
    styling,
    loaded: models.length,
  })

  // The scene's media slots — the sky that lights it, the picture behind it, its
  // music — through the SAME loader the editor uses (hooks/use-scene-media), so
  // what a document holds is resolved one way wherever it is shown. This page
  // used to resolve them itself, and the two copies drifted apart in both
  // directions: a slot one of them learned, the other never heard about.
  const { bgImage, hdri, musicClip } = useSceneMedia({ scene, bundleReady, bundleFile })
  /** A flat backdrop or a plate: a DOM layer BEHIND the canvas, which only shows
   *  if the canvas stays transparent — that is what `hasBackdrop` buys. A skybox
   *  is the engine's own dome, uploaded by useSceneSync. */
  const backdrop = bgImage && bgImage.slot !== "dome" ? bgImage : null
  /** Footage the scene stands in, rather than wallpaper behind it. Everything
   *  about getting the picture on screen is identical — same file, same layer,
   *  same element — so only the two things the claim changes read this: the
   *  ground drops to a shadow catcher, and the plate's shape frames the shot. */
  const isPlate = bgImage?.slot === "plate"
  /** A gif/webp/apng backdrop, drawn per frame from the clip's clock. */
  const drawnBackdrop = useMediaBackdrop(backdrop)
  /** A video backdrop, which plays natively and follows the same clock. */
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  /**
   * A PLATE FRAMES THE SHOT, so every visitor sees the alignment the author made.
   *
   * A backdrop is wallpaper and cover-cropping it to the window is right — it
   * has nothing to agree with. A plate does: the author lined the cast up
   * against a floor in the picture, and cropping that picture to whatever shape
   * the visitor's window happens to be moves the floor out from under her. The
   * one thing a published composite must not do is depend on the window.
   *
   * Read off the file (the loader probed it) rather than stored in the
   * document: a second copy of the shape in the doc could only ever disagree
   * with the picture it describes.
   */
  const plateAspect = isPlate && bgImage && bgImage.height > 0 ? bgImage.width / bgImage.height : null
  /** `inset-0` + `margin:auto` + a max on both axes letterboxes without any
   *  measuring — the box takes the largest size of that shape which fits, and
   *  centres in what is left. Inline rather than an arbitrary Tailwind value:
   *  v4 mangles a shorthand holding min()/calc(). */
  const plateBox =
    isPlate && plateAspect
      ? { aspectRatio: String(plateAspect), maxWidth: "100%", maxHeight: "100%", margin: "auto" }
      : undefined
  /** The layers follow the box together or not at all — a canvas at the window's
   *  shape over a letterboxed plate is the same misalignment, mirrored. */
  const layerClass = plateBox ? "absolute inset-0" : "absolute inset-0 h-full w-full"

  // The cast — everything that is not a stage or a prop — for the settings
  // that apply per character: the same list the editor hands over.
  const { castIds, stageSuns } = useSceneCast(models, stages, props)
  // Eyes on the camera start where the author left them and are the visitor's to
  // switch — a property of watching, like following the camera. Never saved. Every
  // other section keeps its identity, so the sync re-applies only the eyes.
  /**
   * Who is on stage when, by model id.
   *
   * A published scene has to EVALUATE these, not merely load them. The boot
   * seeds each model at frame 0, and without this the scene then stood still at
   * that answer for its whole length — the clips were in the document and
   * inert, so a costume change composed in the editor never happened for anyone
   * following the link. The rows carry the windows because infoFor puts them
   * there at load, and AnimPlayer's tick is the same evaluator the editor and
   * the export already run.
   */
  const visibilityTracks = useMemo(() => {
    const out: Record<string, VisibilityWindow[]> = {}
    for (const m of models) if (m.visibility?.length) out[m.id] = m.visibility
    return out
  }, [models])
  const [eyes, setEyes] = useState(scene.state.settings.eyes.enabled)
  const settings = useMemo(() => ({ ...scene.state.settings, eyes: { enabled: eyes } }), [scene.state.settings, eyes])
  useSceneSync({
    engineRef,
    ready: stageReady,
    castIds,
    stageSuns,
    settings,
    camera: scene.state.camera,
    cameraVmd: !!scene.assets.cameraAnimation,
    gradeSpec: specOf(scene.state.settings.grade),
    backgroundEffects: scene.state.backgroundEffects,
    lights: scene.state.lights,
    // Derived exactly as the editor derives them from the same slots.
    hasBackdrop: !!backdrop,
    plate: isPlate,
    plateStill: isPlate && bgImage?.kind === "image",
    skybox: bgImage?.slot === "dome" ? bgImage.file : null,
    hdri: hdri?.file ?? null,
  })

  // Motions and morph tracks, through the SAME loader the editor uses
  // (hooks/use-scene-clips): per model as each one lands, morphs merged after
  // their motion, and each model revealed on its clip's first pose. `animated`
  // is the cast whose motion is on, in document order — [0] is the master the
  // audio clock reads.
  const { animated } = useSceneClips({
    engineRef,
    scene,
    bundleReady,
    models,
    bundleFile,
    loadVmdFile,
    loadVmdUrl,
    loadMorphFile,
    loadMorphUrl,
  })

  // The track, as the shared loader resolved it: a served URL straight away, a
  // packed one once the bundle is out. Empty until then.
  const audioSrc = musicClip?.url || null

  const audioElRef = useRef<HTMLAudioElement>(null)
  // The clock — the SAME one the editor runs (hooks/use-audio-clock): the first
  // animated model's clip is the master, and the track, the rzAudio*/MIDI
  // clocks, the lyric pages, moving cards and the backdrop all follow it. The
  // one difference is stated rather than forked: a published scene plays on
  // arrival, so sound may not wait for a press of play.
  useAudioClock({
    engineRef,
    masterId: animated[0] ?? null,
    audioRef: audioElRef,
    drawBackdrop: drawnBackdrop.draw,
    videoRef: bgVideoRef,
    syncLyricsTo,
    tickPlanes,
    autoplay: true,
  })
  useTrackAudio({ engineRef, audioRef: audioElRef, ready, url: audioSrc, volume: scene.state.settings.audio.volume })

  return (
    // A fragment: the page above owns <main> and the chrome, so nothing here has
    // to wait for anything here.
    <>
      {/* Backdrop layer: page bg colour → picture → transparent canvas. The
          same layer the editor renders; only where it sits is this page's. */}
      <SceneBackdrop
        media={backdrop}
        moving={drawnBackdrop.moving}
        canvasRef={drawnBackdrop.canvasRef}
        videoRef={bgVideoRef}
        className={cn(layerClass, "object-cover")}
        style={plateBox}
      />
      <canvas ref={canvasRef} className={cn(layerClass, "touch-none object-contain")} style={plateBox} />

      {!ready && !error && <LoadingPill label={loadingLabel} />}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-red-400">
          {t.editor.engineError(error)}
        </div>
      )}

      {ready && models.length > 0 && (
        // Centred by a bounded row, not by a translate off the midpoint: an
        // absolutely positioned pill has nothing to size against, so on a phone
        // it ran off both edges. inset-x-3 gives it the viewport minus the same
        // gutter the bottom uses, and the transport shrinks into it.
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
          <div className="pointer-events-auto max-w-full">
            <AnimPlayer
              engineRef={engineRef}
              modelNames={animated}
              visibility={visibilityTracks}
              hasCamera={!!scene.assets.cameraAnimation}
              eyes={eyes}
              onEyes={setEyes}
            />
          </div>
        </div>
      )}

      <audio ref={audioElRef} src={audioSrc ?? undefined} preload="auto" playsInline className="hidden" />
    </>
  )
}
