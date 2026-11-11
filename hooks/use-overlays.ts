"use client"

// A scene's overlays: restored out of its bundle on load, edited in the
// editor, read by the live layer and the export. The editor and the viewer
// both hold one, so a published scene shows what its author placed.

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchMedia } from "@/lib/net"
import { NEW_OVERLAY, probeOverlay, type LiveOverlay } from "@/lib/overlays"
import { newSceneId, type Scene } from "@/lib/scene"
import { servedUrl } from "@/hooks/use-scene-media"

const release = (list: LiveOverlay[]) => list.forEach((o) => URL.revokeObjectURL(o.url))

export function useOverlays({
  scene,
  bundleReady,
  bundleFile,
}: {
  scene: Scene
  bundleReady: boolean
  bundleFile: (path: string) => Promise<File | null>
}) {
  const [overlays, setOverlays] = useState<LiveOverlay[]>([])
  // Every URL this hook minted and has not given back, revoked once when the
  // page goes: a list replaced releases what it replaced, an item removed its own.
  const live = useRef<LiveOverlay[]>([])
  useEffect(() => {
    live.current = overlays
  })
  // Given back when the page goes. Run again on the same state — a hot reload,
  // React's dev double mount — the URLs it revoked are minted afresh, or a
  // surviving overlay points at a dead file and vanishes.
  const revoked = useRef(false)
  useEffect(() => {
    if (revoked.current) {
      revoked.current = false
      setOverlays((list) => list.map((o) => ({ ...o, url: URL.createObjectURL(o.file) })))
    }
    return () => {
      release(live.current)
      revoked.current = true
    }
  }, [])

  // The scene whose overlays the list holds. Restored once per scene: an
  // effect that runs again on the same one (a hot reload) must not put back
  // the overlays it opened with over the ones added since.
  const restoredFor = useRef<Scene | null>(null)

  // A scene arriving replaces the list, overlays or none: a swap must not keep
  // the logo the last scene wore.
  useEffect(() => {
    if (!bundleReady || restoredFor.current === scene) return
    restoredFor.current = scene
    let cancelled = false
    let done = false
    void (async () => {
      const docs = scene.assets.overlays ?? []
      const loaded = await Promise.all(
        docs.map(async (o): Promise<LiveOverlay | null> => {
          try {
            let file = await bundleFile(o.asset.url)
            if (!file && servedUrl(o.asset.url)) {
              const blob = await fetchMedia(o.asset.url)
              file = new File([blob], o.asset.name, { type: blob.type })
            }
            if (!file) return null
            const probed = await probeOverlay(file)
            const { asset, ...placed } = o
            return { ...placed, name: asset.name, file: probed.file, url: probed.url, kind: probed.kind }
          } catch {
            // A missing or undecodable picture is an overlay gone, not a dead scene.
            return null
          }
        }),
      )
      const kept = loaded.filter((o): o is LiveOverlay => o !== null)
      if (cancelled) return release(kept)
      done = true
      setOverlays((prev) => {
        release(prev)
        return kept
      })
    })()
    return () => {
      cancelled = true
      // Cut off mid-load: the run after this one restores the scene again.
      if (!done && restoredFor.current === scene) restoredFor.current = null
    }
  }, [bundleReady, scene, bundleFile])

  /** An upload, on top. A picture lands in the middle of the frame; a video
   *  fills it, as the backdrop does — `frameAspect` is the frame's width over
   *  its height, what filling it takes. */
  const addOverlay = useCallback(async (file: File, frameAspect = 16 / 9): Promise<string> => {
    const probed = await probeOverlay(file)
    const id = newSceneId()
    const fill = probed.kind === "video" ? { size: Math.max(1, frameAspect / probed.aspect) } : {}
    setOverlays((list) => [
      ...list,
      { id, name: probed.file.name, file: probed.file, url: probed.url, kind: probed.kind, aspect: probed.aspect, ...NEW_OVERLAY, ...fill },
    ])
    return id
  }, [])

  const updateOverlay = useCallback((id: string, patch: Partial<Omit<LiveOverlay, "id" | "file" | "url" | "kind">>) => {
    setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }, [])

  const removeOverlay = useCallback((id: string) => {
    setOverlays((list) => {
      const gone = list.find((o) => o.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return list.filter((o) => o.id !== id)
    })
  }, [])

  return { overlays, addOverlay, updateOverlay, removeOverlay }
}
