"use client"

import Link from "next/link"
import { parseVideoLink, VIDEO_PLATFORM_NAMES, type VideoPlatform } from "@/lib/video-link"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Each site in its own colour — a soft fill of it, the label in it — so the
 *  link reads as that site at a glance. Lightened where the brand's own is too
 *  dark or too harsh on the chrome's dark ground (YouTube's red, X's black),
 *  and no two sites share a hue but TikTok and its Chinese app Douyin. A deliberate palette: see scripts/check-chrome.mjs. */
const SITE_COLOR: Record<VideoPlatform, string> = {
  // Bilibili's logo blue, not its pink: as soft tints the pink and YouTube's
  // red read as the same chip.
  bilibili: "bg-[#00AEEC]/15 text-[#00AEEC] hover:bg-[#00AEEC]/25",
  youtube: "bg-[#FF4E45]/15 text-[#FF4E45] hover:bg-[#FF4E45]/25",
  // One brand, one colour: Douyin is TikTok's Chinese app, and its red-pink
  // was YouTube's red again.
  tiktok: "bg-[#25F4EE]/15 text-[#25F4EE] hover:bg-[#25F4EE]/25",
  douyin: "bg-[#25F4EE]/15 text-[#25F4EE] hover:bg-[#25F4EE]/25",
  // X's own black and white, as light grey: Twitter's blue was Bilibili's.
  x: "bg-[#E7E9EA]/15 text-[#E7E9EA] hover:bg-[#E7E9EA]/25",
}

/** A video link's own fill: the site's colour, solid, its words in white or
 *  black, whichever that colour carries. A soft tint washed out over a cover. */
export const SITE_SOLID: Record<VideoPlatform, string> = {
  bilibili: "bg-[#00AEEC] text-white hover:bg-[#00AEEC]/90",
  youtube: "bg-[#FF4E45] text-white hover:bg-[#FF4E45]/90",
  // Its mark's own ground: white on black (the cyan and red are the mark's).
  tiktok: "bg-black text-white hover:bg-black/85",
  douyin: "bg-black text-white hover:bg-black/85",
  x: "bg-[#E7E9EA] text-black hover:bg-[#E7E9EA]/90",
}

/** Each site's mark, from Simple Icons (simpleicons.org, CC0), on a 24-unit
 *  box. Douyin wears TikTok's: one brand. */
const SITE_LOGO: Record<VideoPlatform, string> = {
  bilibili: "M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z",
  youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  douyin: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
}

/** TikTok's note wears its two offset echoes, cyan above and red below, as
 *  the brand draws it. Inline, so it stands over any shadow the type around
 *  it would lend; every other mark is drawn plain. */
const SITE_LOGO_FILTER: Partial<Record<VideoPlatform, string>> = {
  tiktok: "drop-shadow(-1px -1px 0 #25F4EE) drop-shadow(1px 1px 0 #FE2C55)",
  douyin: "drop-shadow(-1px -1px 0 #25F4EE) drop-shadow(1px 1px 0 #FE2C55)",
}

/** A site's mark at the size of the text beside it, in that text's colour. */
export function SiteLogo({ site, className }: { site: VideoPlatform; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-3 shrink-0", className)}
      style={{ filter: SITE_LOGO_FILTER[site] ?? "none" }}
    >
      <path d={SITE_LOGO[site]} />
    </svg>
  )
}

/** A link to one of our own pages about a site, worn in that site's colours:
 *  the gallery's way to the Bilibili dashboard. */
export function SiteChip({ site, href, children, className }: { site: VideoPlatform; href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 rounded-chip font-medium transition-colors", SITE_COLOR[site], className)}>
      <SiteLogo site={site} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  )
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
        // themselves and centres on the logo — a line-height taller than the
        // text sat it below the logo's middle.
        // Its own ground, so no ink shadow from the type around it.
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-chip px-2.5 text-2xs leading-none font-medium transition-colors [text-shadow:none]!",
        SITE_SOLID[video.platform],
        className,
      )}
    >
      <SiteLogo site={video.platform} />
      <span className="truncate">{t.share.watchOn(VIDEO_PLATFORM_NAMES[video.platform])}</span>
    </Link>
  )
}
