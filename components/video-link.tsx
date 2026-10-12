"use client"

import Link from "next/link"
import { Play } from "lucide-react"
import { parseVideoLink, VIDEO_PLATFORM_NAMES, type VideoPlatform } from "@/lib/video-link"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Each site in its own colour — a soft fill of it, the label in it — so the
 *  link reads as that site at a glance. Lightened where the brand's own is too
 *  dark or too harsh on the chrome's dark ground (YouTube's red, X's black). A deliberate palette: see scripts/check-chrome.mjs. */
const SITE_COLOR: Record<VideoPlatform, string> = {
  bilibili: "bg-[#FB7299]/15 text-[#FB7299] hover:bg-[#FB7299]/25",
  youtube: "bg-[#FF4E45]/15 text-[#FF4E45] hover:bg-[#FF4E45]/25",
  tiktok: "bg-[#25F4EE]/15 text-[#25F4EE] hover:bg-[#25F4EE]/25",
  douyin: "bg-[#FE2C55]/15 text-[#FE2C55] hover:bg-[#FE2C55]/25",
  x: "bg-[#1D9BF0]/15 text-[#1D9BF0] hover:bg-[#1D9BF0]/25",
}

/**
 * A scene's video, as a link named for the site it goes to. Nothing for an
 * empty or unrecognised link, so a scene without one looks as it always did.
 * Re-checked here as well as at publish: what is shown is only ever one of the
 * allowed sites.
 */
export function VideoLink({ url, className }: { url: string | null | undefined; className?: string }) {
  const t = useT()
  const video = url ? parseVideoLink(url) : null
  if (!video) return null
  return (
    <Link
      href={video.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className={cn(
        // A tag's height, but wider than one: a scene has one link, so it has
        // room to say where it goes.
        // A fixed height and no leading, so the label's line box is the glyphs
        // themselves and centres on the icon — a line-height taller than the
        // text sat it below the icon's middle.
        "inline-flex h-5 max-w-full items-center gap-1.5 rounded-chip px-3 text-2xs leading-none font-medium transition-colors",
        SITE_COLOR[video.platform],
        className,
      )}
    >
      <Play className="size-2.5 shrink-0 fill-current" />
      <span className="truncate">{t.share.watchOn(VIDEO_PLATFORM_NAMES[video.platform])}</span>
    </Link>
  )
}
