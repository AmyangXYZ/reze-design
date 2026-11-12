"use client"

// A scene's overlays: restored out of its bundle on load, edited in the
// editor, read by the live layer and the export. The editor and the viewer
// both hold one, so a published scene shows what its author placed.

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchMedia } from "@/lib/net"
import { NEW_OVERLAY, probeOverlay, type LiveOverlay, type OverlayOrder } from "@/lib/overlays"
import { newSceneId, type Scene } from "@/lib/scene"
import type { OverlayPlacement } from "@/lib/scene-history"
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

  /** Restacked, as a slide's objects are: the list runs back to front, so the
   *  last one drawn is on top. */
  /** `to` is a step, or the place in the pile, 0 at the back. */
  const reorderOverlay = useCallback((id: string, to: OverlayOrder | number) => {
    setOverlays((list) => {
      const i = list.findIndex((o) => o.id === id)
      if (i < 0) return list
      const last = list.length - 1
      const j =
        typeof to === "number"
          ? Math.min(last, Math.max(0, Math.round(to)))
          : to === "back"
            ? 0
            : to === "front"
              ? last
              : to === "backward"
                ? Math.max(0, i - 1)
                : Math.min(last, i + 1)
      if (j === i) return list
      const next = list.slice()
      const [o] = next.splice(i, 1)
      next.splice(j, 0, o)
      return next
    })
  }, [])

  /** Placements put back, an undo's step: each overlay still here takes its
   *  remembered fields and place in the pile; one added since keeps its own,
   *  on top. */
  const placeOverlays = useCallback((placed: OverlayPlacement[]) => {
    setOverlays((list) => {
      const byId = new Map(list.map((o) => [o.id, o]))
      const kept = placed.flatMap((p) => {
        const o = byId.get(p.id)
        // Every placement field, absent ones included: a key or a lane the
        // step did not have comes off.
        return o ? [{ ...o, visibility: undefined, keys: undefined, ...p }] : []
      })
      const ids = new Set(placed.map((p) => p.id))
      return [...kept, ...list.filter((o) => !ids.has(o.id))]
    })
  }, [])

  return { overlays, addOverlay, updateOverlay, removeOverlay, reorderOverlay, placeOverlays }
}
