"use client"

// The published-scene viewer: the same engine, the same document, none of the
// editing. Assets come out of the scene's zip (models, motions, audio) — which is
// why publishing bundles them in the first place.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { primeAudioAnalysis } from "@/lib/audio-analysis"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { GitFork, Heart, WandSparkles } from "lucide-react"
import { AnimPlayer } from "@/components/scene/anim-player"
import { builtinEffect } from "@/lib/effects"
import { useEngine } from "@/hooks/use-engine"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { specOf } from "@/lib/grade"
import { libraryGraph } from "@/lib/materials"
import { newSceneId, parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { saveLocalBundle } from "@/lib/asset-store"
import { setForkTarget } from "@/lib/fork"
import { LoadingPill, useLoadingLabel } from "@/components/editor/loading-pill"
import { resolveSceneRefs, resolveSceneRefsSync } from "@/lib/resolve-refs"
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
export function SceneViewer(props: ViewerProps) {
  const t = useT()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
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
          contact with the product, and nothing else on the page says its name. */}
      <Link
        href="/"
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
        className="group absolute top-3 left-3 flex h-10 items-center gap-1.5 rounded-xl border border-transparent pr-1.5 pl-2"
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
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "w-full px-2.5 py-2 text-left transition-colors md:px-3 md:py-2.5",
            (props.description || props.credits) && "cursor-pointer hover:bg-white/5",
          )}
        >
          <div className="truncate text-sm font-semibold tracking-tight text-white">{props.title}</div>
          <div className="truncate font-mono text-xs text-white/55">@{props.author}</div>
          {props.description && (
            <p className={cn("mt-1 text-xs leading-snug text-white/75", !expanded && "line-clamp-2")}>
              {props.description}
            </p>
          )}
          {/* Always present, truncated until asked for: crediting only counts if
              people can see it without knowing to look. */}
          {props.credits && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="text-[10px] font-medium tracking-[0.14em] text-white/40 uppercase">{t.share.credits}</div>
              <p
                className={cn(
                  "mt-1 whitespace-pre-wrap text-xs leading-snug text-white/70",
                  expanded ? "max-h-48 overflow-y-auto" : "line-clamp-2",
                )}
              >
                {props.credits}
              </p>
            </div>
          )}
        </button>
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
  const { canvasRef, engineRef, ready, stageReady, bundleReady, bundleProgress, error, models, bundleFile, bundleFiles } =
    useEngine(scene)
  // Published upward so Fork can hand the unzipped assets to the editor. A ref,
  // not state: nothing renders differently for it, and the getter is stable.
  useEffect(() => {
    bundleFilesRef.current = bundleFiles
  }, [bundleFilesRef, bundleFiles])

  const loadingLabel = useLoadingLabel({ scene, bundleProgress, bundleReady, loaded: models.length })

  // Background. A published scene packs its image, so both kinds resolve out of
  // the bundle synchronously. A flat backdrop is a DOM layer BEHIND the canvas,
  // which only shows if the canvas stays transparent — that is what `hasBackdrop`
  // buys, and without it the engine painted the background colour straight over
  // the image. A skybox is the engine's own dome, uploaded by the same hook.
  //
  // On `bundleReady`, not `ready`: the image is beside the models in the zip and
  // owes them nothing, so it appears with the stage rather than after the last
  // character has loaded.
  const background = bundleReady ? scene.assets.background : null
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
    camera: scene.state.camera,
    cameraVmd: !!scene.assets.cameraAnimation,
    gradeSpec: specOf(scene.state.settings.grade),
    backgroundEffects: scene.state.backgroundEffects,
    hasBackdrop: !!backdropFile,
    skybox: skyboxFile,
  })

  // Motions, PER MODEL as each one lands — not one pass after the last of them.
  // A character is hidden from load until its clip poses it, so waiting for the
  // whole cast meant the first one stood invisible behind the second one's
  // download. The bundle arrives before any of them, so a clip is resolvable the
  // moment its model is.
  const [animated, setAnimated] = useState<string[]>([])
  const clipped = useRef(new Set<string>())
  // One clip at a time, appended to whatever is still in flight: models arrive in
  // their own time and each pass must not start a load the previous one is doing.
  const clipQueue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!bundleReady) return
    const engine = engineRef.current
    if (!engine) return
    const fresh = models.filter((m) => !clipped.current.has(m.id))
    if (fresh.length === 0) return
    for (const m of fresh) clipped.current.add(m.id)
    clipQueue.current = clipQueue.current.then(async () => {
      for (const m of fresh) {
        const entry = scene.assets.models.find((e) => e.model.id === m.id)
        const clip = entry?.animation
        const model = engine.getModel(m.id)
        if (!clip || !model) continue
        const file = bundleFile(clip.url)
        const url = file ? URL.createObjectURL(file) : clip.url
        try {
          await model.loadVmd(clip.name, url)
          model.show(clip.name)
          // Appended in arrival order, which is document order — so animated[0]
          // stays the master the audio clock reads.
          setAnimated((prev) => [...prev, m.id])
        } finally {
          if (file) URL.revokeObjectURL(url)
          // Hidden since load so bind pose never shows — reveal on the clip's
          // first pose (or reveal anyway if the clip failed).
          engine.setModelTransform(m.id, { visible: true })
        }
      }
      // The morph VMDs (表情モーション), AFTER every motion in this batch — the
      // editor's rule, and the same reason: a morph merges INTO the motion's
      // clip, and loading the motion afterwards rebuilds that clip and drops the
      // merge. Without this pass the viewer played a published scene's dance
      // with the motion's own face, which is what the editor never shows.
      for (const m of fresh) {
        const entry = scene.assets.models.find((e) => e.model.id === m.id)
        const expr = entry?.morph
        const model = engine.getModel(m.id)
        if (!expr || !model || entry?.stage) continue
        const file = bundleFile(expr.url)
        const url = file ? URL.createObjectURL(file) : expr.url
        // ASK THE MODEL which clip is playing rather than naming one ourselves:
        // a bundled clip keeps its bundle PATH as its engine key, so the
        // document's display name is not the key. Naming it from the document
        // merges the morphs into a clip nothing plays — indistinguishable from
        // a file with no morphs in it.
        const playing = model.getAnimationProgress().animationName
        const target = playing ?? expr.name
        try {
          await model.loadVmd(target, url, { tracks: "morphs" })
          // Only when the morph IS the clip. With a motion playing, showing it
          // again would restart the dance from frame 0.
          if (!playing) model.show(target)
        } catch (e) {
          console.warn(`[scene] morph failed to load for ${m.id}:`, expr.name, e)
        } finally {
          if (file) URL.revokeObjectURL(url)
          // A morph-only model is still hidden if loadSceneInto left it so.
          engine.setModelTransform(m.id, { visible: true })
        }
      }
      engine.resetPhysics()
    })
  }, [models, bundleReady, engineRef, scene, bundleFile])

  // Audio: a bundled track needs an object URL; a site-served one already is one.
  // Derived rather than stored — the document never changes under us.
  const audioSrc = useMemo(() => {
    // Same rule as the backdrop: the track is in the bundle, so it is ready when
    // the bundle is — the models are not its business.
    const track = bundleReady ? scene.assets.audio : null
    if (!track) return null
    const file = bundleFile(track.url)
    return file ? URL.createObjectURL(file) : track.url
  }, [bundleReady, scene, bundleFile])
  useEffect(() => {
    if (!audioSrc?.startsWith("blob:")) return
    return () => URL.revokeObjectURL(audioSrc)
  }, [audioSrc])

  const audioElRef = useRef<HTMLAudioElement>(null)
  // Whether the animation clock currently wants sound. Written by the tick
  // below, read by the gesture handler above it — a ref rather than state
  // because the handler is registered once, at mount, and must see the CURRENT
  // answer rather than the one that was true when it was created.
  const wantAudioRef = useRef(false)
  /**
   * iOS: take the element's autoplay blessing from the FIRST gesture, whenever
   * that turns out to be.
   *
   * The viewer autoplays, so its first play() comes from the rAF tick with no
   * user gesture behind it — WebKit rejects it, and rejects every retry too,
   * none of them being gestures either. The standing fix was to listen for a tap
   * and join the audio in from inside it, and the fix is still below. What broke
   * is WHEN it starts listening: it lives in the tick's effect, which is gated on
   * `ready`, and `ready` does not arrive until the last model of the scene has
   * loaded. On a phone that is most of a minute, and the one tap a reader gives a
   * loading page lands on the loading pill, where nothing is listening. The track
   * then stays silent until they happen to touch the screen a second time — which
   * on desktop never shows, because desktop autoplay needs no gesture at all.
   *
   * So this listens from mount. play() called inside a user gesture clears the
   * element's autoplay restriction in WebKit BEFORE it looks at the source, so
   * the blessing can be taken while the bundle is still downloading and the
   * element still has no src — which is exactly when the tap arrives. The
   * restriction stays cleared for the life of the element, across the src React
   * sets later, so the tick's own play() is allowed when the scene finally runs.
   *
   * Three things this gets wrong if written casually, all learned the hard way:
   *
   * NOT MUTED. Priming a muted element does not buy the AUDIO permission —
   * WebKit tracks the video and audio rate-change restrictions separately, and a
   * silent prime lifts the wrong one. An earlier version muted across the call
   * to avoid a blip and bought nothing at all.
   *
   * PAUSED SYNCHRONOUSLY, not in the promise. pause() on the next line runs
   * before the element has produced a sample, so there is no blip to mute in the
   * first place; waiting for the promise means waiting until sound has already
   * started. The play() then rejects with AbortError, which is the expected
   * outcome and not a failure — the restriction was lifted on the way in.
   *
   * NOT ONCE. A prime taken before the element has a src may not stick, so this
   * keeps listening and primes again on a later gesture once there is a source
   * to prime with. Cheap, and the alternative is a reader whose only tap landed
   * on the loading pill hearing nothing for the rest of the scene.
   */
  useEffect(() => {
    const audio = audioElRef.current
    if (!audio) return
    let primedWithSource = false
    const bless = () => {
      // The clock is already running: this tap is the reader asking for the
      // track, so join it in and leave it playing.
      if (wantAudioRef.current) {
        if (audio.paused) void audio.play().catch(() => {})
        return
      }
      if (primedWithSource) return
      void audio.play().catch(() => {})
      audio.pause()
      // Only a prime that had a source to load counts as the one that stuck.
      if (audio.src) primedWithSource = true
    }
    // Capture, so a handler that stops propagation on its way up cannot quietly
    // take the one gesture this depends on.
    const opts = { capture: true } as const
    window.addEventListener("pointerdown", bless, opts)
    window.addEventListener("keydown", bless, opts)
    return () => {
      window.removeEventListener("pointerdown", bless, opts)
      window.removeEventListener("keydown", bless, opts)
    }
  }, [])
  // The track's analysis for rzAudio* — same contract as the editor: primed on
  // load, sampled by the tick's setAudioTime, so a published scene's reactive
  // effects run identically to where they were authored.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (!audioSrc) {
      engine.setAudioData(null, 0, 0)
      return
    }
    let stale = false
    void primeAudioAnalysis(audioSrc).then((a) => {
      if (stale || !a) return
      engineRef.current?.setAudioData(a.data, a.bands, a.secondsPerFrame)
    })
    return () => {
      stale = true
    }
  }, [audioSrc, ready, engineRef])
  // The animation clock is the master, exactly as in the editor.
  useEffect(() => {
    const audio = audioElRef.current
    const engine = engineRef.current
    if (!audio || !engine || !ready) return
    let raf = 0
    let lastCurrent = -1
    // One correction at ACTUAL sound start (decode can lag play() on a cold
    // cache; free-run would keep that offset forever). Never fires mid-playback.
    // Armed ONLY after an explicit stamp (start/loop): corrects decode latency
    // once at true sound onset. Plain resumes never arm it — a seek there
    // flushes the decoder and mutes the first beat.
    let stampArmed = false
    /** A play() is already in flight; asking again would abort it. */
    let playPending = false
    const onPlaying = () => {
      if (!stampArmed) return
      stampArmed = false
      const master = animated[0] ? engine.getModel(animated[0]) : null
      const p = master?.getAnimationProgress()
      if (p?.playing && Math.abs(audio.currentTime - p.current) > 0.05) audio.currentTime = p.current
    }
    audio.addEventListener("playing", onPlaying)
    // No gesture listener here any more. The blessing effect above owns every
    // gesture: it registers at mount rather than waiting for `ready`, and it
    // already joins the track in when the clock is running — which is all this
    // one did. Two listeners for one tap meant two play() calls racing, and the
    // second aborts the first, which is the very failure the latch below exists
    // to prevent. Buffer warming is the blessing's too: its play() starts the
    // fetch from inside the gesture, so a separate load() only reset an element
    // that was already loading.
    const tick = () => {
      // Progress lives on the model (the animation clock's owner); the first
      // animated model is the master, as in the editor.
      const master = animated[0] ? engine.getModel(animated[0]) : null
      const p = master?.getAnimationProgress()
      // Both per-frame clocks an effect reads. The score's has three owners —
      // this tick, the editor's, and the export loop — and an effect is frozen
      // in whichever one forgets it.
      if (p) engine.setAudioTime(p.current, p.playing)
      if (p) engine.setMidiTime(p.current, p.playing)
      // What the blessing handler reads to decide whether to pause straight back
      // out of the play() it just made.
      wantAudioRef.current = !!p?.playing
      const wasPaused = audio.paused
      // One play() in flight at a time — see the editor's audio clock for what
      // asking every frame does to an element that is merely still loading.
      if (p?.playing && audio.paused && !playPending) {
        playPending = true
        void audio
          .play()
          .catch(() => {})
          .finally(() => {
            playPending = false
          })
      }
      if (!p?.playing && !audio.paused) audio.pause()
      if (p) {
        // Free-running audio, like the reze.one demo: set the clock when
        // playback (re)starts or the animation clock jumps (loop wrap, seek),
        // then leave it alone — no drift lock, no rate bending. Continuous
        // correction is what stuttered on mobile Safari.
        const jumped = lastCurrent >= 0 && Math.abs(p.current - lastCurrent) > 0.35
        lastCurrent = p.current
        if (((p.playing && wasPaused) && Math.abs(audio.currentTime - p.current) > 0.15) || jumped) {
          audio.currentTime = p.current
          stampArmed = true
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener("playing", onPlaying)
    }
  }, [ready, engineRef, audioSrc, animated])

  return (
    // A fragment: the page above owns <main> and the chrome, so nothing here has
    // to wait for anything here.
    <>
      {/* Backdrop layer: page bg colour → image (cover) → transparent canvas. */}
      {backdropUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

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
            <AnimPlayer engineRef={engineRef} modelNames={animated} hasCamera={!!scene.assets.cameraAnimation} />
          </div>
        </div>
      )}

      <audio ref={audioElRef} src={audioSrc ?? undefined} preload="auto" playsInline className="hidden" />
    </>
  )
}
