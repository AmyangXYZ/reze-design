"use client"

// The transport's clock when no model carries a clip.
//
// The engine keeps time on its models: the camera VMD, the audio, the effects
// and the export all follow the first cast member's clip. A scene with a camera
// VMD or a song but no motion and no morph track had no clock, so its duration
// read 0. This gives the first cast member a blank clip — no keys, so its pose
// does not change — as long as the camera VMD, or else the music, and makes it
// the master. A motion or morph track loaded later takes over as usual.

import { useEffect, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { FPS } from "@/lib/clip"

/** The blank clip's name. */
export const FALLBACK_CLIP = "reze-design:clock"

export function useFallbackClock({
  engineRef,
  modelId,
  clocked,
  camera,
  audioRef,
  musicUrl,
}: {
  engineRef: RefObject<Engine | null>
  /** The first cast member, who carries the blank clip. */
  modelId: string | null
  /** Some model already has a clip of its own. */
  clocked: boolean
  /** The scene has a camera VMD (its length is read from the engine once it lands). */
  camera: boolean
  audioRef: RefObject<HTMLAudioElement | null>
  musicUrl: string | null
}): string | null {
  const key = !clocked && modelId && (camera || musicUrl) ? `${modelId}\0${camera}\0${musicUrl ?? ""}` : null
  const [held, setHeld] = useState<string | null>(null)

  useEffect(() => {
    if (!key || !modelId) return
    // Polled: the camera VMD and the track's metadata both arrive on their own time.
    const timer = setInterval(() => {
      const engine = engineRef.current
      const model = engine?.getModel(modelId)
      if (!engine || !model) return
      const cameraSeconds = engine.getCameraVmdDuration()
      // The element's length counts once it holds this track, not the one before.
      const el = audioRef.current
      const current = !!el && !!musicUrl && el.src === new URL(musicUrl, location.href).href
      const musicSeconds = current && Number.isFinite(el.duration) ? el.duration : 0
      // A scene with a camera waits for it: the camera outranks the music.
      const seconds = camera ? cameraSeconds : musicSeconds
      if (seconds <= 0) return
      model.loadClip(FALLBACK_CLIP, { boneTracks: new Map(), morphTracks: new Map(), frameCount: Math.ceil(seconds * FPS) + 1 })
      model.show(FALLBACK_CLIP)
      setHeld(key)
      clearInterval(timer)
    }, 300)
    return () => clearInterval(timer)
  }, [key, modelId, camera, musicUrl, engineRef, audioRef])

  return key !== null && held === key ? modelId : null
}
