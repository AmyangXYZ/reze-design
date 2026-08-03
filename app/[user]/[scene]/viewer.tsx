"use client"

// The published-scene viewer: the same engine, the same document, none of the
// editing. Assets come out of the scene's zip (models, motions, audio) — which is
// why publishing bundles them in the first place.

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { GitFork, Heart, WandSparkles } from "lucide-react"
import { AnimPlayer } from "@/components/scene/anim-player"
import { builtinEffect } from "@/lib/background-effects"
import { useEngine } from "@/hooks/use-engine"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { specOf } from "@/lib/grade"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { setForkTarget } from "@/lib/fork"
import { LoadingPill } from "@/components/editor/loading-pill"
import { resolveSceneRefs } from "@/lib/resolve-refs"
import { useSession } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"
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
}

/**
 * Resolve first, boot once.
 *
 * The engine takes its scene at construction, so the document's pins have to be
 * content before it starts — built-ins from the bundle, the rest in one request.
 * Splitting the component is what lets the inner one keep an unconditional
 * `useEngine(scene)`.
 */
export function SceneViewer(props: ViewerProps) {
  const [scene, setScene] = useState<Scene | null>(null)
  useEffect(() => {
    let stale = false
    void resolveSceneRefs(props.doc).then((resolve) => {
      if (!stale) setScene(parseSceneDoc(props.doc, builtinEffect, libraryGraph, resolve))
    })
    return () => {
      stale = true
    }
  }, [props.doc])

  if (!scene) {
    return (
      <main className="fixed inset-0 bg-zinc-950">
        <LoadingPill />
      </main>
    )
  }
  return <SceneStage {...props} scene={scene} />
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

function SceneStage({ scene, sceneId, title, author, description, credits, likeCount }: ViewerProps & { scene: Scene }) {
  const t = useT()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const like = useLike(sceneId, likeCount)
  const { canvasRef, engineRef, ready, stageReady, error, models, bundleFile } = useEngine(scene)

  // Background. A published scene packs its image, so both kinds resolve out of
  // the bundle synchronously. A flat backdrop is a DOM layer BEHIND the canvas,
  // which only shows if the canvas stays transparent — that is what `hasBackdrop`
  // buys, and without it the engine painted the background colour straight over
  // the image. A skybox is the engine's own dome, uploaded by the same hook.
  const background = ready ? scene.assets.background : null
  const backdropFile = useMemo(
    () => (background?.kind === "backdrop" ? bundleFile(background.asset.url) : null),
    [background, bundleFile],
  )
  const skyboxFile = useMemo(
    () => (background?.kind === "skybox" ? bundleFile(background.asset.url) : null),
    [background, bundleFile],
  )
  const backdropUrl = useMemo(() => (backdropFile ? URL.createObjectURL(backdropFile) : null), [backdropFile])
  useEffect(() => {
    if (!backdropUrl) return
    return () => URL.revokeObjectURL(backdropUrl)
  }, [backdropUrl])

  useSceneSync({
    engineRef,
    ready: stageReady,
    settings: scene.state.settings,
    gradeSpec: specOf(scene.state.settings.grade),
    backgroundEffect: scene.state.backgroundEffect,
    hasBackdrop: !!backdropFile,
    skybox: skyboxFile,
  })

  // Motions: the engine has the bundle by now, so a clip resolves out of it.
  const [animated, setAnimated] = useState<string[]>([])
  const clipsLoaded = useRef(false)
  useEffect(() => {
    if (!ready || clipsLoaded.current) return
    clipsLoaded.current = true
    const engine = engineRef.current
    if (!engine) return
    const loaded: string[] = []
    void (async () => {
      for (const entry of scene.assets.models) {
        const clip = entry.animation
        const model = engine.getModel(entry.model.id)
        if (!clip || !model) continue
        const file = bundleFile(clip.url)
        const url = file ? URL.createObjectURL(file) : clip.url
        try {
          await model.loadVmd(clip.name, url)
          model.show(clip.name)
          loaded.push(entry.model.id)
        } finally {
          if (file) URL.revokeObjectURL(url)
          // Hidden since load so bind pose never shows — reveal on the clip's
          // first pose (or reveal anyway if the clip failed).
          engine.setModelTransform(entry.model.id, { visible: true })
        }
      }
      engine.resetPhysics()
      setAnimated(loaded)
    })()
  }, [ready, engineRef, scene, bundleFile])

  // Audio: a bundled track needs an object URL; a site-served one already is one.
  // Derived rather than stored — the document never changes under us.
  const audioSrc = useMemo(() => {
    const track = ready ? scene.assets.audio : null
    if (!track) return null
    const file = bundleFile(track.url)
    return file ? URL.createObjectURL(file) : track.url
  }, [ready, scene, bundleFile])
  useEffect(() => {
    if (!audioSrc?.startsWith("blob:")) return
    return () => URL.revokeObjectURL(audioSrc)
  }, [audioSrc])

  const audioElRef = useRef<HTMLAudioElement>(null)
  // The animation clock is the master, exactly as in the editor.
  useEffect(() => {
    const audio = audioElRef.current
    const engine = engineRef.current
    if (!audio || !engine || !ready) return
    let raf = 0
    const tick = () => {
      // Progress lives on the model (the animation clock's owner); the first
      // animated model is the master, as in the editor.
      const master = animated[0] ? engine.getModel(animated[0]) : null
      const p = master?.getAnimationProgress()
      if (p?.playing && audio.paused) void audio.play().catch(() => {})
      if (!p?.playing && !audio.paused) audio.pause()
      // Seeking (loop restart, scrub) must carry the track with it.
      if (p && Math.abs(audio.currentTime - p.current) > 0.25) audio.currentTime = p.current
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ready, engineRef, audioSrc, animated])

  return (
    <main className="fixed inset-0 overflow-hidden bg-zinc-950">
      {/* Backdrop layer: page bg colour → image (cover) → transparent canvas. */}
      {backdropUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {/* Top left: whose site this is. A shared link is often someone's first
          contact with the product, and nothing else on the page says its name. */}
      <Link
        href="/"
        // The editor's collapsed BrandPill, box model and all: same top-3/left-3
        // origin, same 1px border, same py-1.5/pl-2, same size-7 icon well. Only
        // the pill's surface is missing, so the mark and wordmark land on the exact
        // pixels they occupy in the editor and nothing shifts between the two.
        className="group absolute top-3 left-3 flex items-center gap-1.5 rounded-lg border border-transparent py-1.5 pr-1.5 pl-2"
      >
        <span className="flex size-7 items-center justify-center text-pink-400" aria-hidden>
          <WandSparkles className="size-4.5" />
        </span>
        <span className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-white">
          Reze Design
        </span>
      </Link>

      {/* Bottom left, above the transport: title, author, caption — TikTok's
          arrangement, where the text hugs itself and the scene stays the page. */}
      <div className="absolute bottom-16 left-4 w-[min(10.5rem,44vw)] overflow-hidden rounded-xl bg-zinc-950/50 backdrop-blur-md md:top-4 md:right-4 md:bottom-auto md:left-auto md:w-60">
        {/* Desktop header: the two actions, pushed apart, over the panel they act on. */}
        <div className="hidden items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 md:flex">
          <button
            onClick={() => {
              setForkTarget(sceneId)
              router.push("/")
            }}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-blue-400 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-300"
          >
            <GitFork className="size-3.5" />
            {t.share.fork}
          </button>
          <LikeButton like={like} compact />
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "w-full px-2.5 py-2 text-left transition-colors md:px-3 md:py-2.5",
            (description || credits) && "cursor-pointer hover:bg-white/5",
          )}
        >
          <div className="truncate text-sm font-semibold tracking-tight text-white">{title}</div>
          <div className="truncate font-mono text-xs text-white/55">@{author}</div>
          {description && (
            <p className={cn("mt-1 text-xs leading-snug text-white/75", !expanded && "line-clamp-2")}>{description}</p>
          )}
          {/* Always present, truncated until asked for: crediting only counts if
              people can see it without knowing to look. */}
          {credits && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="text-[10px] font-medium tracking-[0.14em] text-white/40 uppercase">
                {t.share.credits}
              </div>
              <p
                className={cn(
                  "mt-1 whitespace-pre-wrap text-xs leading-snug text-white/70",
                  expanded ? "max-h-48 overflow-y-auto" : "line-clamp-2",
                )}
              >
                {credits}
              </p>
            </div>
          )}
        </button>
      </div>

      {!ready && !error && <LoadingPill />}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-red-400">
          {t.editor.engineError(error)}
        </div>
      )}

      {ready && models.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <AnimPlayer engineRef={engineRef} modelNames={animated} hasCamera={!!scene.assets.cameraAnimation} />
        </div>
      )}

      {/* Mobile keeps TikTok's standalone rail, thumb-reachable and clear of the
          transport; desktop shows it inside the card instead. */}
      <LikeButton like={like} className="absolute right-5 bottom-16 flex-col md:hidden" />

      <audio ref={audioElRef} src={audioSrc ?? undefined} preload="auto" playsInline className="hidden" />
    </main>
  )
}
