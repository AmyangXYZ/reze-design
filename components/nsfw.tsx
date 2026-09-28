"use client"

import { useT } from "@/lib/i18n"
import { useShowNsfw } from "@/lib/nsfw-pref"
import { cn } from "@/lib/utils"

/**
 * A scene cover that blurs when the scene is flagged and the viewer has not
 * turned NSFW on in the gallery's header. The label says why.
 */
export function SceneCover({
  src,
  nsfw,
  loading,
  className,
}: {
  src: string
  nsfw?: boolean
  loading?: "lazy" | "eager"
  className?: string
}) {
  const t = useT()
  const show = useShowNsfw()
  const hidden = !!nsfw && !show
  return (
    <span className={cn("relative block overflow-hidden", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading={loading}
        // Scaled just past its box so the blur's soft rim falls outside it rather
        // than fading the card's edge to the background.
        className={cn("h-full w-full object-cover", hidden && "scale-105 blur-md")}
      />
      {hidden && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-chip border border-amber-400/40 bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-amber-400">
            {t.nsfw.label}
          </span>
        </span>
      )}
    </span>
  )
}
