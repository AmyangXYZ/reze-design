"use client"

// The published-scene viewer: the same engine, the same document, none of the
// editing. Assets come out of the scene's zip (models, motions, audio) — which is
// why publishing bundles them in the first place.

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Heart, WandSparkles } from "lucide-react"
import { AnimPlayer } from "@/components/scene/anim-player"
import { builtinEffect } from "@/lib/background-effects"
import { useEngine } from "@/hooks/use-engine"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { specOf } from "@/lib/grade"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { resolveSceneRefs } from "@/lib/resolve-refs"
import { useT } from "@/lib/i18n"

type ViewerProps = { doc: SceneDoc; title: string; author: string; description: string; likeCount: number }

/**
 * Resolve first, boot once.
 *
 * The engine takes its scene at construction, so the document's pins have to be
 * content before it starts — built-ins from the bundle, the rest in one request.
 * Splitting the component is what lets the inner one keep an unconditional
 * `useEngine(scene)`.
 */
export function SceneViewer(props: ViewerProps) {
  const t = useT()
  const [scene, setScene] = useState<Scene | null>(null)
  useEffect(() => {
    let stale = false
    void resolveSceneRefs(props.doc).then((resolve) => {
      if (!stale) setScene(parseSceneDoc(props.doc, builtinEffect, libraryGraph, resolve as never))
    })
    return () => {
      stale = true
    }
  }, [props.doc])

  if (!scene) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-zinc-950 text-xs text-muted-foreground">
        {t.editor.loadingModel}
      </main>
    )
  }
  return <SceneStage {...props} scene={scene} />
}

function SceneStage({ scene, title, author, description, likeCount }: ViewerProps & { scene: Scene }) {
  const t = useT()
  const { canvasRef, engineRef, ready, error, models, bundleFile } = useEngine(scene)

  useSceneSync({
    engineRef,
    ready,
    settings: scene.state.settings,
    gradeSpec: specOf(scene.state.settings.grade),
    backgroundEffect: scene.state.backgroundEffect,
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {/* Scene identity, top left — the viewer's only chrome besides transport. */}
      <div className="absolute top-3 left-3 max-w-[min(22rem,70vw)] rounded-xl border border-white/10 bg-zinc-950/80 px-3.5 py-2.5 shadow-float backdrop-blur-xs">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-mono">{author}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Heart className="size-3" />
            {likeCount}
          </span>
        </div>
        {description && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>

      <Link
        href="/"
        className="absolute top-3 right-3 flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs font-semibold shadow-float backdrop-blur-xs transition-colors hover:bg-zinc-900/80"
      >
        <WandSparkles className="size-4 text-blue-400" />
        Reze Design
      </Link>

      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {t.editor.loadingModel}
        </div>
      )}
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

      <audio ref={audioElRef} src={audioSrc ?? undefined} preload="auto" playsInline className="hidden" />
    </main>
  )
}
