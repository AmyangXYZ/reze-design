"use client"

// A document's media slots — the sky that LIGHTS it, the picture behind it, and
// its music — resolved the one way every page that shows a scene resolves them.
//
// Lifted out of the editor because the viewer had grown its own copy, and the
// two drifted: the viewer never fell back to a served URL, never probed a
// backdrop (so it could not tell a still plate from footage), and — the other
// way round — the editor's copy was the one a swap starved of its bundle. One
// loader means a slot added here reaches a published scene without anyone
// remembering to add it there.

import { useCallback, useEffect, useRef, useState } from "react"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import type { Scene } from "@/lib/scene"

/** Which seat the scene's one background picture is in. `plate` and `flat` take
 *  the same files and differ only in the claim; `dome` is the 360 skybox. */
export type BgSlot = "flat" | "dome" | "plate"
export type BgMedia = BackdropMedia & { slot: BgSlot }
export type MusicClip = { name: string; url: string }

/** A URL any deployment can fetch, as opposed to a path inside the bundle. */
export const servedUrl = (url: string) => /^[/]|^https?:/.test(url)

export const dropMusicUrl = (clip: { url: string } | null) => {
  if (clip?.url.startsWith("blob:")) URL.revokeObjectURL(clip.url)
}

/** The music row before a byte has loaded. The NAME is always known; a served
 *  track plays straight off its URL, while a packed one has no playable URL until
 *  the loader below pulls it out of the bundle — so the row fills in first and
 *  the audio element follows. */
export const seedMusic = (scene: Scene): MusicClip | null =>
  scene.assets.audio
    ? {
        name: scene.assets.audio.name,
        url: servedUrl(scene.assets.audio.url) ? scene.assets.audio.url : "",
      }
    : null

export function useSceneMedia({
  scene,
  bundleReady,
  bundleFile,
  onPacked,
}: {
  scene: Scene
  bundleReady: boolean
  bundleFile: (path: string) => File | null
  /**
   * The editor's hook for keeping the bytes behind a packed slot, so its next
   * save re-packs them instead of dropping them. Only the editor saves; a
   * viewer leaves it out. `audio` REPLACES the default handling — the editor's
   * music row does its own bookkeeping — and must call setMusicClip itself.
   */
  onPacked?: { camera?: (file: File) => void; audio?: (file: File) => void }
}) {
  const [bgImage, setBgImage] = useState<BgMedia | null>(null)
  const swapBgImage = useCallback(
    (next: BgMedia | null) =>
      setBgImage((prev) => {
        releaseBackdrop(prev)
        return next
      }),
    [],
  )
  /**
   * The HDRI — its own slot, beside the background rather than inside it.
   *
   * Backdrop and skybox are two answers to "what is behind the scene" and only
   * one can be. This answers "what is lighting it", which is true at the same
   * time as either — so it does not go through swapBgImage and setting it
   * clears nothing.
   */
  const [hdri, setHdri] = useState<BackdropMedia | null>(null)
  /** Also takes an updater, for a caller that decides from the sky it is
   *  replacing — a stage leaving takes back only the sky it brought. The one
   *  replaced is released; one handed back unchanged is kept. */
  const swapHdri = useCallback(
    (next: BackdropMedia | null | ((prev: BackdropMedia | null) => BackdropMedia | null)) =>
      setHdri((prev) => {
        const out = typeof next === "function" ? next(prev) : next
        if (out !== prev) releaseBackdrop(prev)
        return out
      }),
    [],
  )

  const [musicClip, setMusicClip] = useState<MusicClip | null>(() => seedMusic(scene))
  // One owner for every blob URL the row mints: the cleanup runs with the URL
  // that is being replaced, after React has committed the one replacing it, so
  // the element never points at a revoked blob. NOT in an updater — React may
  // call one twice and hand it the clip it just created as `prev`.
  useEffect(() => {
    const clip = musicClip
    return () => dropMusicUrl(clip)
  }, [musicClip])

  // Read at run time, so a caller passing a fresh object each render does not
  // re-run the loader — which would re-probe every slot on every keystroke.
  // Declared before the loader, so this runs first in the same commit.
  const packedRef = useRef(onPacked)
  useEffect(() => {
    packedRef.current = onPacked
  })

  // ── The loader ──
  //
  // The cast's clips load with the models; these are the slots nobody owns —
  // music, the background image, the sky, and the camera clip's identity. Each
  // resolves out of the scene's BUNDLE first (a published zip and the local
  // IndexedDB bundle look identical through bundleFile) and out of its URL
  // otherwise. A slot that fails to resolve is simply empty; nothing here may
  // take the scene down.
  //
  // Boot and swap both arrive here: one loader per slot, or a reset would
  // quietly keep the music the scene it replaced was playing.
  useEffect(() => {
    // ON `bundleReady`, NOT `ready`. Every slot below comes out of the bundle,
    // and the bundle is unzipped long before the last model has finished — so
    // waiting for the whole scene meant the world image was fetched and parsed
    // AFTER the loading pill had gone, and the scene visibly re-lit itself in
    // front of someone who had been told it was ready.
    if (!bundleReady) return
    let cancelled = false
    void (async () => {
      // The engine already loaded the camera VMD inside loadSceneInto. What is
      // left is the File behind it, for whoever re-packs the scene.
      const cam = scene.assets.cameraAnimation
      if (cam) {
        const packed = bundleFile(cam.url)
        if (packed) packedRef.current?.camera?.(packed)
      }
      const track = scene.assets.audio
      // A served track plays straight off its URL and was seeded above; only a
      // packed one has to be pulled out of the bundle and given an object URL.
      if (track) {
        const packed = bundleFile(track.url)
        if (packed) {
          const own = packedRef.current?.audio
          if (own) own(packed)
          else setMusicClip({ name: packed.name, url: URL.createObjectURL(packed) })
        }
      }
      // THE HDRI, BEFORE the background — that block ends in an early return,
      // and anything restored after it would simply not be, for every scene
      // that happens to have no background image.
      const sky = scene.assets.hdri
      if (sky) {
        try {
          const file = await resolveFile(sky, bundleFile)
          if (file) {
            const media = await probeBackdrop(file)
            if (cancelled) releaseBackdrop(media)
            else swapHdri(media)
          }
        } catch {
          // A missing or undecodable HDRI degrades to a flat world, not a dead
          // scene — the same bargain the background makes below.
        }
      }
      const bg = scene.assets.background
      if (!bg) return
      // A LOCAL SCENE SAVED BEFORE THE SPLIT put its HDRI in the skybox slot,
      // because that slot took either. Nothing central can patch those — they
      // live in one browser — so they are moved on the way in, once: the next
      // save writes it to `hdri` and this never fires for that scene again.
      // Without it the sky simply disappears, since createImageBitmap cannot
      // decode Radiance.
      if (bg.kind === "skybox" && /\.hdr$/i.test(bg.asset.name)) {
        try {
          const file = await resolveFile(bg.asset, bundleFile)
          if (file) {
            const media = await probeBackdrop(file)
            if (cancelled) releaseBackdrop(media)
            else swapHdri(media)
          }
        } catch {
          // Same bargain as below: a slot that will not resolve is empty.
        }
        return
      }
      try {
        const file = await resolveFile(bg.asset, bundleFile)
        if (!file) return
        const media = await probeBackdrop(file)
        // Probing minted an object URL; a superseded pass has to give it back.
        if (cancelled) {
          releaseBackdrop(media)
          return
        }
        swapBgImage({ ...media, slot: bg.kind === "skybox" ? "dome" : bg.kind === "plate" ? "plate" : "flat" })
      } catch {
        // a missing or undecodable image degrades to no background, not a dead scene
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bundleReady, scene, bundleFile, swapBgImage, swapHdri])

  return { bgImage, swapBgImage, hdri, swapHdri, musicClip, setMusicClip }
}

/** Out of the bundle, else off its URL when it has one that is served. */
async function resolveFile(
  ref: { url: string; name: string },
  bundleFile: (path: string) => File | null,
): Promise<File | null> {
  const packed = bundleFile(ref.url)
  if (packed) return packed
  if (!servedUrl(ref.url)) return null
  const blob = await (await fetch(ref.url)).blob()
  return new File([blob], ref.name, { type: blob.type })
}
