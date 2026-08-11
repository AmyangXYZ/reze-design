"use client"

// The app's one loading indicator.
//
// Every wait in this product is "the scene isn't ready yet" — booting the engine,
// fetching a bundle, resolving a route. Showing a different shape for each would
// suggest they are different kinds of wait, which they are not.

import { useMemo } from "react"
import type { BundleProgress } from "@/hooks/use-engine"
import { useT } from "@/lib/i18n"
import type { Scene } from "@/lib/scene"

export function LoadingPill({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      {/* Sized to its content — "Loading scene…" gets a short pill — but the
          digits inside it must not resize it: the download stats repaint four
          times a second, and a pill twitching on every tick pulls the eye to the
          movement instead of the words. `tabular-nums` makes every digit the
          same width; useLoadingLabel pads the volatile numbers so their digit
          COUNT cannot change the width either. */}
      <div className="flex max-w-[90vw] items-center justify-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs text-muted-foreground tabular-nums">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-blue-400" />
        <span className="truncate">{label ?? t.editor.loadingScene}</span>
      </div>
    </div>
  )
}

/** Megabytes to one decimal: the number is read by someone waiting, and it
 *  repaints four times a second. */
const mbNum = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/**
 * Right-align a number into a fixed-width field.
 *
 * U+2007 FIGURE SPACE is defined as one digit wide, so under `tabular-nums` this
 * holds the field steady as the value crosses 9.9 → 10.0 → 100.0 without
 * printing leading zeros at anyone. Padding, not a fixed pill: the phases that
 * carry no numbers still size to their own text.
 */
const pad = (text: string, width: number) => text.padStart(width, "\u2007")

/**
 * The wait, named — one line, in phase order.
 *
 * Lives here rather than in either host because both show the same pill for the
 * same load: the editor boots a scene exactly the way the viewer does, and two
 * copies of this would drift the moment one of them gained a phase.
 *
 * Only the phases with real numbers behind them quote any: the download is
 * measured, and the model count comes off the document, which knew it before a
 * byte arrived. Everything else says what it is doing and nothing more.
 */
export function useLoadingLabel(args: {
  scene: Scene
  bundleProgress: BundleProgress | null
  bundleReady: boolean
  /** Models that have reported in so far. */
  loaded: number
}): string {
  const t = useT()
  const { scene, bundleProgress, bundleReady, loaded } = args
  return useMemo(() => {
    if (bundleProgress && !bundleProgress.done) {
      // Every volatile number gets a field wide enough for the largest value it
      // can reach, so the line stays exactly as wide from the first byte to the
      // last: received against the total it is climbing to, speed against a
      // two-digit rate (a faster link widens the pill once and then holds).
      const total = mbNum(bundleProgress.total)
      const received = pad(mbNum(bundleProgress.received), total.length)
      const speed = `${pad(mbNum(bundleProgress.bytesPerSecond), 4)} MB/s`
      return bundleProgress.total > 0
        ? t.editor.downloadingAssets(`${received} MB`, `${total} MB`, speed)
        : t.editor.downloadingAssetsUnsized(`${mbNum(bundleProgress.received)} MB`, speed)
    }
    // The bytes are in and the zip is being walked — its own visible pause on a
    // bundle this size, and not the same wait as the download.
    if (bundleProgress?.done && !bundleReady) return t.editor.unpackingAssets
    const total = scene.assets.models.length
    // Nothing specific to say yet: the engine is still booting, or a local
    // bundle is coming out of IndexedDB, which reports no bytes because it
    // never crossed a network.
    if (!bundleReady || total === 0) return t.editor.loadingScene
    // Models resolve in document order, so the one in flight is the next that
    // has not reported in. Clamped: the last one is still "of total" while it
    // finishes.
    const index = Math.min(loaded, total - 1)
    return t.editor.loadingModels(index + 1, total, scene.assets.models[index]?.model.file ?? "")
  }, [scene, bundleProgress, bundleReady, loaded, t])
}
