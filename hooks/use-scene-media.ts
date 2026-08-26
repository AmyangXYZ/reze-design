"use client"

// The scene's media slots: camera motion, backdrop, skybox, music.
//
// Four slots that behave the same way — one file each, uploaded or removed, with
// the engine told and `sceneFiles` kept in step so publishing can re-pack the
// bytes. In page.tsx they were spread across five hundred lines with unrelated
// state between them, so the shared shape was invisible and each slot's cleanup
// (revoke the object URL, release the bitmap, clear the engine) had to be
// remembered separately.
//
// Layout-independent on purpose: the docked editor and the floating one need the
// same slots, and neither should own them.

import { useCallback, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import type { Scene } from "@/lib/scene"
import { sceneFiles } from "@/lib/scene-files"
import type { ExportAudioSource } from "@/lib/video-export"
import { useT } from "@/lib/i18n"

export type SceneMedia = ReturnType<typeof useSceneMedia>

export function useSceneMedia({
  engineRef,
  bootScene,
  onNotice,
}: {
  engineRef: RefObject<Engine | null>
  /** Only read for its initial audio slot — this hook owns the slot after boot. */
  bootScene: Scene
  /** Surface a failed upload to the user. */
  onNotice: (message: string) => void
}) {
  const t = useT()

  // ── Camera motion ──
  // Drives target/rotation/distance/fov. `following` is the live drive state from
  // the transport toggle, not merely whether a file is loaded: the camera controls
  // disable on what the shot is ACTUALLY doing.
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [cameraName, setCameraName] = useState<string | null>(null)
  const [camVmdFollowing, setCamVmdFollowing] = useState(true)

  const loadCameraBuffer = useCallback(
    async (buffer: ArrayBuffer, name: string) => {
      const engine = engineRef.current
      if (!engine) return
      try {
        await engine.loadCameraVmdFromBuffer(buffer)
        setCameraName(name)
      } catch (e) {
        onNotice(t.upload.cantLoadCamera(e instanceof Error ? e.message : String(e)))
      }
    },
    [engineRef, onNotice, t],
  )

  const onCameraPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      sceneFiles.camera = file
      await loadCameraBuffer(await file.arrayBuffer(), file.name)
    },
    [loadCameraBuffer],
  )

  const removeCamera = useCallback(() => {
    sceneFiles.camera = null
    engineRef.current?.clearCameraVmd()
    setCameraName(null)
  }, [engineRef])

  // ── Backdrop and skybox ──
  // Mutually exclusive: a flat image behind the scene, or a 360° equirect dome the
  // engine renders and the camera turns inside. Setting one clears the other,
  // which is what the Assets panel's replace behaviour already implied.
  const backdropInputRef = useRef<HTMLInputElement | null>(null)
  const [backdrop, setBackdrop] = useState<BackdropMedia | null>(null)
  const skyboxInputRef = useRef<HTMLInputElement | null>(null)
  const [skybox, setSkybox] = useState<BackdropMedia | null>(null)

  // ── The HDRI ──
  // NOT one of the pair, and that is the point. Those two are both answers to
  // "what is behind the scene" and only one can be; an HDRI answers "what is
  // lighting it", which is a different question and can be true at the same
  // time. They shared the skybox slot and were told apart by file extension, so
  // a studio HDRI and a chosen sky were mutually exclusive for no reason but
  // the plumbing.
  const hdriInputRef = useRef<HTMLInputElement | null>(null)
  const [hdri, setHdri] = useState<BackdropMedia | null>(null)

  /** Swap a slot's media, releasing whatever it held. */
  const swap = (set: typeof setBackdrop, next: BackdropMedia | null) =>
    set((prev) => {
      releaseBackdrop(prev)
      return next
    })

  const onBackdropPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const next = await probeBackdrop(file)
        engineRef.current?.setBackdropEquirect(null)
        swap(setBackdrop, next)
        swap(setSkybox, null)
      } catch (e) {
        onNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [engineRef, onNotice],
  )

  const onSkyboxPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const next = await probeBackdrop(file)
        engineRef.current?.setBackdropEquirect(await createImageBitmap(file))
        swap(setSkybox, next)
        swap(setBackdrop, null)
      } catch (e) {
        onNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [engineRef, onNotice],
  )

  /** The HDRI. Clears neither of the other two — it is not behind the scene,
   *  it is the light in it. */
  const onHdriPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const next = await probeBackdrop(file)
        // Radiance goes through the engine's parser: createImageBitmap cannot
        // decode it, and flattening to 8 bits throws away the range that makes
        // it an HDRI in the first place.
        const { parseHDR } = await import("reze-engine")
        engineRef.current?.setWorldEquirect(parseHDR(await file.arrayBuffer()))
        swap(setHdri, next)
      } catch (e) {
        onNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [engineRef, onNotice],
  )

  const removeBackdrop = useCallback(() => swap(setBackdrop, null), [])
  const removeSkybox = useCallback(() => {
    engineRef.current?.setBackdropEquirect(null)
    swap(setSkybox, null)
  }, [engineRef])
  const removeHdri = useCallback(() => {
    engineRef.current?.setWorldEquirect(null)
    swap(setHdri, null)
  }, [engineRef])

  // ── Music ──
  // One routing choice drives both live playback and export, so the two can never
  // disagree about what the scene sounds like.
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const [audioName, setAudioName] = useState<string | null>(bootScene.assets.audio?.name ?? null)
  const [audioSrc, setAudioSrc] = useState<string>(bootScene.assets.audio?.url ?? "")
  const [audioSource, setAudioSource] = useState<ExportAudioSource>("music")

  const setMusicFile = useCallback((f: File) => {
    sceneFiles.audio = f
    setAudioName(f.name)
    setAudioSrc((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
    // A track arriving un-mutes the export: "none" was a consequence of silence.
    setAudioSource((s) => (s === "none" ? "music" : s))
  }, [])

  const removeAudio = useCallback(() => {
    sceneFiles.audio = null
    setAudioName(null)
    // Revoke OUTSIDE the updater — a setState callback can run twice.
    setAudioSrc((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
      return ""
    })
    // No source left for "music"; exports fall back to silent.
    setAudioSource((s) => (s === "music" ? "none" : s))
  }, [])

  // ── Pickers ──
  const pickCamera = useCallback(() => cameraInputRef.current?.click(), [])
  const pickMusic = useCallback(() => audioInputRef.current?.click(), [])
  const pickBackdrop = useCallback(() => backdropInputRef.current?.click(), [])
  const pickSkybox = useCallback(() => skyboxInputRef.current?.click(), [])

  return {
    // camera motion
    cameraInputRef,
    cameraName,
    setCameraName,
    camVmdFollowing,
    setCamVmdFollowing,
    loadCameraBuffer,
    onCameraPicked,
    pickCamera,
    removeCamera,
    // backdrop / skybox
    backdropInputRef,
    backdrop,
    setBackdrop,
    onBackdropPicked,
    pickBackdrop,
    removeBackdrop,
    skyboxInputRef,
    skybox,
    hdri,
    hdriInputRef,
    onHdriPicked,
    removeHdri,
    setSkybox,
    onSkyboxPicked,
    pickSkybox,
    removeSkybox,
    // music
    audioInputRef,
    audioElRef,
    audioName,
    setAudioName,
    audioSrc,
    setAudioSrc,
    audioSource,
    setAudioSource,
    setMusicFile,
    pickMusic,
    removeAudio,
  }
}
