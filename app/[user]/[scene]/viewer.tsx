"use client"

// The published-scene viewer: the same engine, the same document, none of the
// editing. Assets come out of the scene's zip (models, motions, audio) — which is
// why publishing bundles them in the first place.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronsLeft, GitFork, Heart, ScrollText } from "lucide-react"
import { DisplayOnlyTag } from "@/components/editor/scene-gallery"
import { AnimPlayer } from "@/components/scene/anim-player"
import { stockEffect } from "@/lib/effects"
import { useEngine } from "@/hooks/use-engine"
import { useSceneCast, useSceneSync } from "@/hooks/use-scene-sync"
import { useSceneMedia } from "@/hooks/use-scene-media"
import { useSceneClips } from "@/hooks/use-scene-clips"
import { useAudioClock, useTrackAudio } from "@/hooks/use-audio-clock"
import { useFootstepSource, useFootsteps } from "@/hooks/use-footsteps"
import { useMediaBackdrop } from "@/hooks/use-media-backdrop"
import { SceneBackdrop } from "@/components/scene/scene-backdrop"
import { ShowUiButton, useHideUi } from "@/components/scene/hide-ui"
import { specOf } from "@/lib/grade"
import { libraryGraph } from "@/lib/materials"
import { newSceneId, parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { timelineOf } from "@/lib/timeline"
import { saveLocalBundle } from "@/lib/asset-store"
import type { BundleFile } from "@/lib/uploads"
import { setForkTarget } from "@/lib/fork"
import { LoadError, LoadingPill, useLoadingLabel } from "@/components/editor/loading-pill"
import { resolveSceneRefs, resolveSceneRefsSync } from "@/lib/resolve-refs"
import { installStock } from "@/lib/stock"
import type { LibraryItem } from "@/lib/library"
import { useSession } from "@/lib/auth-client"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SignInDialog } from "@/components/editor/account-panel"
import { useI18n, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useCompact, usePhone } from "@/lib/device"
import { useCoverInk } from "@/hooks/use-cover-ink"
import { WORDMARK } from "@/components/wordmark"
import { SITE_SOLID, SiteLogo, VideoLink } from "@/components/video-link"
import { parseVideoLink, VIDEO_PLATFORM_NAMES } from "@/lib/video-link"
import { Button } from "@/components/ui/button"
import { VerifiedBadge } from "@/components/verified-badge"

type ViewerProps = {
  doc: SceneDoc
  /** The built-ins the document names (lib/stock-rows stockRowsFor). */
  stock: LibraryItem[]
  sceneId: string
  title: string
  author: string
  /** A maker we vouch for: a check beside their name. */
  verified: boolean
  description: string
  /** 借物表 — who the model, motion and music came from. Required at publish, so
   *  it should be readable here rather than only enforced there. */
  credits: string
  /** The video its maker posted, or empty. */
  video?: string
  likeCount: number
  /** Other people's published scenes made from this one (lib/forks). */
  forkCount: number
  /** When it was published, ISO. Printed under the author. */
  publishedAt: string
  /** The author asked that it be watched, not forked: no Open in editor. */
  displayOnly?: boolean
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
    <time dateTime={iso} className="tabular-nums">
      {inBrowser ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : iso.slice(0, 10)}
    </time>
  )
}

export function SceneViewer(props: ViewerProps) {
  const t = useT()
  const router = useRouter()
  const like = useLike(props.sceneId, props.likeCount)
  /** The maker's own render of it, for the phone's rail. */
  const video = props.video ? parseVideoLink(props.video) : null
  // Phone only: the caption and the 借物表 start folded to one line each, as
  // TikTok's overlay does, and a tap opens them in place. Desktop has the room
  // and shows both, each scrolling past five lines.
  const [captionOpen, setCaptionOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)
  // Synchronously when every pin is a built-in — the common case. The server
  // sent those rows, so the canvas is in the first render and the engine starts
  // on mount, instead of after a resolve round trip and a second pass.
  const [scene, setScene] = useState<Scene | null>(() => {
    installStock(props.stock, { whole: false })
    const resolve = resolveSceneRefsSync(props.doc)
    return resolve ? parseSceneDoc(props.doc, stockEffect, libraryGraph, resolve) : null
  })
  useEffect(() => {
    if (scene) return
    let stale = false
    void resolveSceneRefs(props.doc).then((resolve) => {
      if (!stale) setScene(parseSceneDoc(props.doc, stockEffect, libraryGraph, resolve))
    })
    return () => {
      stale = true
    }
  }, [props.doc, scene])

  // The open bundle, reached up from the stage below. The engine holds it
  // because it is rendering it; Fork hands the same Files to the editor rather
  // than sending it back to the network for a zip this tab already has.
  const bundleFilesRef = useRef<() => BundleFile[]>(() => [])
  const [forking, setForking] = useState(false)
  // Opening someone's scene in the editor is where its files become yours to
  // export, so it asks for an account and says whose files they are.
  const { data: session } = useSession()
  const [signInOpen, setSignInOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Signing in by email code happens in place, and carries on to the editor.
  const forkAfterSignIn = useRef(false)
  const requestFork = () => {
    if (session) return setConfirmOpen(true)
    forkAfterSignIn.current = true
    setSignInOpen(true)
  }
  // The editor's switch: everything but the scene, off and back.
  const [uiHidden, setUiHidden] = useHideUi()
  // Off a phone the page is the editor's cover: type set straight on the
  // scene, its ink read off the frame (hooks/use-cover-ink). A phone keeps the
  // card, as the editor keeps its sheet.
  const compact = useCompact()
  // A phone watches; nothing on it edits, so it has no Fork.
  const phone = usePhone()
  const mainRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    if (!session || !forkAfterSignIn.current) return
    forkAfterSignIn.current = false
    void openInEditor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  return (
    <main
      ref={mainRef}
      className="cover fixed inset-0 overflow-hidden bg-background select-none"
      data-ink="dark"
      data-ui-hidden={uiHidden || undefined}
      // The ground the cover's ink mixes into (globals.css, "The cover").
      style={{ ["--scene-bg" as string]: scene?.state.settings.background.color ?? "#000" }}
    >
      {/* The scene, under the chrome — its own component so `useEngine` never
          runs conditionally. Until it exists there is a pill, and the text
          around it is already readable. */}
      {scene ? (
        <SceneStage {...props} scene={scene} bundleFilesRef={bundleFilesRef} mainRef={mainRef} />
      ) : (
        <LoadingPill />
      )}

      {!compact && (
        <>
          {/* The editor's top row, to the pixel: the wordmark home to the
              editor, and the gallery. */}
          <div data-edge="top" data-ink-zone className="cover-type pointer-events-none absolute top-5 right-6 left-7 flex h-8 items-center gap-7 text-xs">
            <Link href="/" className={`pointer-events-auto ${WORDMARK}`}>
              Reze Design
            </Link>
            <Link href="/gallery" className="pointer-events-auto text-foreground hover:text-muted-foreground">
              {t.gallery.title}
            </Link>
          </div>

          {/* The scene's cover, where the editor sets its own: the name in the
              display serif, whose and when, what its maker wrote, the 借物表,
              then what you can do with it. */}
          <aside data-edge="left" className="cover-type pointer-events-none absolute top-0 bottom-16 left-0 flex w-[25rem] flex-col pt-5 pr-7 pl-7 text-xs">
            <div data-ink-zone className="pointer-events-auto mt-14">
              <h1 className="font-display text-display italic select-text">{props.title}</h1>
              <p className="mt-2 flex min-w-0 items-center gap-2 font-mono text-2xs tracking-wide text-muted-foreground uppercase">
                <Link href={`/${props.author}`} className="truncate text-foreground normal-case hover:underline">
                  @{props.author}
                </Link>
                {props.verified && <VerifiedBadge />}
                <span>·</span>
                <PublishedAt iso={props.publishedAt} />
              </p>
            </div>
            <div data-ink-zone className="no-scrollbar pointer-events-auto mt-8 flex min-h-0 flex-col overflow-y-auto">
              {props.description && (
                <p className="leading-relaxed whitespace-pre-wrap text-foreground select-text [overflow-wrap:anywhere]">{props.description}</p>
              )}
              <VideoLink url={props.video} className="mt-3 w-fit" />
              {props.credits && (
                <div className="mt-5">
                  <div className="font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">{t.share.credits}</div>
                  <p className="mt-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted-foreground select-text [overflow-wrap:anywhere]">
                    {props.credits}
                  </p>
                </div>
              )}
              <div className="mt-6 flex items-center gap-5">
                {props.displayOnly ? (
                  <DisplayOnlyTag />
                ) : phone ? null : (
                  <Button
                    variant="bare"
                    onClick={requestFork}
                    disabled={forking}
                    className="h-7 rounded-chip border border-foreground/60 px-4 text-xs font-medium text-foreground hover:bg-white/10"
                  >
                    {t.share.fork}
                    {props.forkCount > 0 && <span className="ml-1.5 font-mono tabular-nums">{props.forkCount}</span>}
                  </Button>
                )}
                <Button
                  variant="bare"
                  onClick={() => void like.toggle()}
                  aria-disabled={!like.canLike}
                  className={cn(
                    "flex h-8 items-center gap-1.5 font-mono text-xs",
                    like.liked ? "text-red-400" : "text-foreground",
                    like.canLike ? "hover:text-red-400" : "cursor-default",
                  )}
                >
                  <Heart className={cn("size-4", like.liked && "fill-current")} />
                  {like.count}
                </Button>
              </div>
            </div>
          </aside>

          <Button
            variant="bare"
            data-edge="left"
            onClick={() => setUiHidden(true)}
            className="cover-type absolute bottom-5 left-7 flex h-8 items-center text-xs"
          >
            <span data-ink-zone className="flex items-center gap-1.5 text-foreground">
              <ChevronsLeft className="size-3.5" />
              {t.transport.hide}
            </span>
          </Button>
        </>
      )}

      {/* A phone, TikTok's way: the wordmark where the editor sets it and the
          gallery at the row's other end; a soft shade up from the foot; the
          scene's words at the bottom left in white whatever the picture; and
          the rail of what you can do on the right, within the thumb's reach. */}
      {compact && (
      <>
      <div
        data-edge="top"
        data-ink-zone
        className="cover-type pointer-events-none absolute top-5 right-6 left-7 flex h-8 items-center justify-between gap-4 text-xs"
      >
        <Link href="/" className={`pointer-events-auto flex h-8 items-center whitespace-nowrap ${WORDMARK}`}>
          Reze Design
        </Link>
        <Link href="/gallery" className="pointer-events-auto flex h-8 items-center text-foreground hover:text-muted-foreground">
          {t.gallery.title}
        </Link>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-linear-to-t from-black/60 via-black/25 to-transparent" />
      <div
        data-edge="left"
        data-paper="dark"
        className="pointer-events-none absolute right-20 bottom-20 left-4 text-xs [text-shadow:var(--white-ink-shadow)]! [&_button]:[text-shadow:inherit]!"
      >
        <div className="no-scrollbar pointer-events-auto flex max-h-[45dvh] flex-col overflow-y-auto">
          <p className="flex min-w-0 items-center gap-1.5">
            <Link href={`/${props.author}`} className="truncate text-sm font-semibold text-foreground">
              @{props.author}
            </Link>
            {props.verified && <VerifiedBadge />}
            <span className="shrink-0 font-mono text-2xs text-foreground">
              · <PublishedAt iso={props.publishedAt} />
            </span>
          </p>
          <h1 className="mt-1 line-clamp-2 text-sm text-foreground select-text">{props.title}</h1>
          {props.description && (
            <Button
              variant="bare"
              onClick={() => setCaptionOpen((v) => !v)}
              aria-expanded={captionOpen}
              className="mt-1 block w-full text-left font-normal whitespace-normal"
            >
              <span className={cn("block leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]", !captionOpen && "line-clamp-2")}>
                {props.description}
              </span>
            </Button>
          )}
          {/* The 借物表: whole on its sheet on a computer, which has the room; on
              a phone TikTok's sound line, one credit, and the list at a tap. */}
          {props.credits &&
            (creditsOpen ? (
              <Button
                variant="bare"
                data-paper-at="pop"
                onClick={() => setCreditsOpen(false)}
                aria-expanded
                className="mt-2.5 block w-full rounded-interior border border-line-strong bg-surface px-3 py-2.5 text-left font-normal whitespace-normal [text-shadow:none]!"
              >
                <span className="flex items-center gap-1.5 font-mono text-2xs font-medium tracking-wide text-foreground uppercase">
                  <ScrollText className="size-3.5" />
                  {t.share.credits}
                </span>
                <span className="mt-1.5 block font-mono text-2xs leading-relaxed whitespace-pre-wrap text-foreground select-text [overflow-wrap:anywhere]">
                  {props.credits}
                </span>
              </Button>
            ) : (
              <Button
                variant="bare"
                onClick={() => setCreditsOpen(true)}
                aria-expanded={false}
                className="mt-2 flex w-full min-w-0 items-center gap-1.5 text-left font-normal text-foreground"
              >
                <ScrollText className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{props.credits.split("\n").find((l) => l.trim()) ?? ""}</span>
              </Button>
            ))}
          {props.displayOnly && <DisplayOnlyTag className="mt-2.5 w-fit" />}
        </div>
      </div>
      <div
        data-paper="dark"
        className="absolute right-3 bottom-24 flex flex-col items-center gap-5 text-foreground [&_svg]:[filter:var(--white-ink-line-shadow)] [text-shadow:var(--white-ink-shadow)]!"
      >
        <Button
          variant="bare"
          onClick={() => void like.toggle()}
          aria-pressed={like.liked}
          aria-disabled={!like.canLike}
          className="flex flex-col items-center gap-1 text-xs font-medium [text-shadow:inherit]!"
        >
          <Heart className={cn("size-8", like.liked ? "fill-red-400 text-red-400" : "fill-white text-white")} />
          {like.count}
        </Button>
        {/* Fork on a computer; a phone watches. */}
        {!props.displayOnly && !phone && (
          <Button
            variant="bare"
            onClick={requestFork}
            disabled={forking}
            className="flex flex-col items-center gap-1 text-xs font-medium [text-shadow:inherit]!"
          >
            <span className="flex size-7 items-center justify-center rounded-full border-[1.5px] border-white">
              <GitFork className="size-3.5" />
            </span>
            {props.forkCount > 0 ? props.forkCount : t.share.fork}
          </Button>
        )}
        {video && (
          <Link
            href={video.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            aria-label={VIDEO_PLATFORM_NAMES[video.platform]}
            // The heart's drawn size, not its box: a glyph fills about 5/6 of it.
            className={cn("flex size-7 items-center justify-center rounded-full", SITE_SOLID[video.platform])}
          >
            <SiteLogo site={video.platform} className="size-3.5" />
          </Link>
        )}
      </div>
      </>
      )}

      <SignInDialog
        open={signInOpen && !session}
        onOpenChange={(o) => {
          setSignInOpen(o)
          if (!o) forkAfterSignIn.current = false
        }}
        title={t.share.forkSignIn}
        blurb={t.share.forkNotice}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.share.fork}
        body={t.share.forkNotice}
        confirmLabel={t.share.fork}
        cancelLabel={t.library.cancel}
        tone="accent"
        onConfirm={() => void openInEditor()}
      />
      {uiHidden && <ShowUiButton corner={!compact} onShow={() => setUiHidden(false)} />}
    </main>
  )
}

function useLike(sceneId: string, initial: number) {
  const { data: session } = useSession()
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initial)
  const [busy, setBusy] = useState(false)

  // The page is cached for everyone, so it cannot know whether YOU like this
  // scene — asked once a session exists, so the heart comes back red after a
  // refresh and the count is the live one. Never for an anonymous visit: that
  // would wake the database for a page that is otherwise served from cache.
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let stale = false
    fetch(`/api/library/${sceneId}/like`)
      .then((r) => (r.ok ? (r.json() as Promise<{ liked: boolean; likeCount: number | null }>) : null))
      .then((s) => {
        if (stale || !s) return
        setLiked(s.liked)
        if (s.likeCount !== null) setCount(s.likeCount)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [sceneId, userId])

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

/** The scene layer: canvas, backdrop, transport, audio. Everything that has to
 *  wait on bytes — and nothing that doesn't, which all lives in the page above. */
function SceneStage({
  scene,
  bundleFilesRef,
  mainRef,
}: ViewerProps & {
  scene: Scene
  bundleFilesRef: RefObject<() => BundleFile[]>
  /** The page, whose type takes its ink from this canvas. */
  mainRef: RefObject<HTMLElement | null>
}) {
  const {
    canvasRef,
    engineRef,
    ready,
    stageReady,
    engineReady,
    styling,
    nativeStageLoad,
    bundleReady,
    bundleProgress,
    error,
    downloadFailure,
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
    footstepFile,
  } = useEngine(scene)
  // Published upward so Fork can hand the unzipped assets to the editor. A ref,
  // not state: nothing renders differently for it, and the getter is stable.
  useEffect(() => {
    bundleFilesRef.current = bundleFiles
  }, [bundleFilesRef, bundleFiles])

  // The cover's ink, from what this stage draws (the page's type sits over it).
  useCoverInk(mainRef, canvasRef, true, [ready, stageReady, bundleReady, stages.length, models.length].join("|"))

  const loadingLabel = useLoadingLabel({
    scene,
    bundleProgress,
    bundleReady,
    engineReady,
    styling,
    loaded: models.length,
    nativeStage: nativeStageLoad,
  })

  // The scene's media slots — the sky that lights it, the picture behind it, its
  // music — through the SAME loader the editor uses (hooks/use-scene-media), so
  // what a document holds is resolved one way wherever it is shown. This page
  // used to resolve them itself, and the two copies drifted apart in both
  // directions: a slot one of them learned, the other never heard about.
  const { bgImage, hdri, musicClip } = useSceneMedia({ scene, bundleReady, bundleFile })
  /** A flat backdrop: a DOM layer BEHIND the canvas, which only shows if the
   *  canvas stays transparent — that is what `hasBackdrop` buys. A skybox is the
   *  engine's own dome, uploaded by useSceneSync. */
  const backdrop = bgImage && bgImage.slot !== "dome" ? bgImage : null
  /** A gif/webp/apng backdrop, drawn per frame from the clip's clock. */
  const drawnBackdrop = useMediaBackdrop(backdrop)
  /** A video backdrop, which plays natively and follows the same clock. */
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  // The cast — everything that is not a stage or a prop — for the settings
  // that apply per character: the same list the editor hands over.
  const { castIds, stageSuns } = useSceneCast(models, stages, props)
  /**
   * The scene's timeline — who is on stage when, among the rest.
   *
   * A published scene has to EVALUATE its lanes, not merely load them. The boot
   * seeds each model at frame 0, and without this the scene then stood still at
   * that answer for its whole length — the clips were in the document and
   * inert, so a costume change composed in the editor never happened for anyone
   * following the link. The rows carry the windows because infoFor puts them
   * there at load, and AnimPlayer's tick is the same evaluator the editor and
   * the export already run.
   */
  const timeline = useMemo(
    () => timelineOf({ models, props, effects: scene.state.backgroundEffects }),
    [models, props, scene.state.backgroundEffects],
  )
  // The scene as its maker published it, eyes included: the viewer plays it.
  const settings = scene.state.settings
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
  // Footstep sounds, when the author turned them on — the same hooks the editor
  // runs, found from the same clips, playing the sound the scene chose.
  const footstepsSource = useFootstepSource(scene.state.settings.audio.footstepsSound, footstepFile)
  useFootsteps({
    engineRef,
    ids: animated,
    enabled: scene.state.settings.audio.footsteps === true && ready,
    source: footstepsSource,
    volume: scene.state.settings.audio.footstepsVolume ?? 1,
    lanes: timeline.visibility,
  })

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
        className="frame-layer absolute inset-0 h-full w-full object-cover"
      />
      <canvas data-keep ref={canvasRef} className="frame-layer absolute inset-0 h-full w-full touch-none object-contain" />

      {!ready && !error && <LoadingPill label={loadingLabel} />}
      {error && <LoadError error={error} failure={downloadFailure} onRetry={() => window.location.reload()} />}

      {ready && models.length > 0 && (
        // Centred by a bounded row, not by a translate off the midpoint: an
        // absolutely positioned pill has nothing to size against, so on a phone
        // it ran off both edges. inset-x-3 gives it the viewport minus the same
        // gutter the bottom uses, and the transport shrinks into it.
        // Above the phone's shade, which darkens the scene and not the controls.
        <div data-edge="bottom" data-ink-zone className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center">
          <div className="pointer-events-auto max-w-full compact:w-full compact:max-w-xs">
            <AnimPlayer
              engineRef={engineRef}
              modelNames={animated}
              timeline={timeline}
              // No camera switch: the scene plays as its maker shot it.
              hasCamera={false}
            />
          </div>
        </div>
      )}

      <audio ref={audioElRef} src={audioSrc ?? undefined} preload="auto" playsInline className="hidden" />
    </>
  )
}
