// A published scene's video: the one link its maker posted the render to.
//
// Only the sites MMD videos are posted to, so a link on a scene page is always
// a video and never anywhere else — no spam, no phishing page wearing a scene's
// credibility — and the page can name the site it goes to. Checked in the
// publish dialog as it is typed, and again by the server, which stores what
// this returns rather than what was sent.

export type VideoPlatform = "bilibili" | "youtube" | "tiktok" | "douyin" | "x"

const HOSTS: Record<string, VideoPlatform> = {
  "bilibili.com": "bilibili",
  "b23.tv": "bilibili",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "tiktok.com": "tiktok",
  "douyin.com": "douyin",
  "iesdouyin.com": "douyin",
  "x.com": "x",
  "twitter.com": "x",
}

/** The name each site goes by, the same in every language. */
export const VIDEO_PLATFORM_NAMES: Record<VideoPlatform, string> = {
  bilibili: "Bilibili",
  youtube: "YouTube",
  tiktok: "TikTok",
  douyin: "抖音",
  x: "X",
}

export const MAX_VIDEO_URL = 500

/**
 * The link as it will be stored and shown, with the site it is on — or null
 * when it is not a link to one of those sites. Pasted text often comes with a
 * caption around the URL (Bilibili's and Douyin's share buttons copy one), so
 * the first URL in it is the one read. Always https.
 */
export function parseVideoLink(raw: string): { url: string; platform: VideoPlatform } | null {
  const found = raw.trim().match(/https?:\/\/[^\s<>"'，。]+/i)?.[0] ?? (/^[\w.-]+\.[a-z]{2,}\//i.test(raw.trim()) ? `https://${raw.trim()}` : null)
  if (!found || found.length > MAX_VIDEO_URL) return null
  let url: URL
  try {
    url = new URL(found)
  } catch {
    return null
  }
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const site = Object.keys(HOSTS).find((h) => host === h || host.endsWith(`.${h}`))
  if (!site) return null
  url.protocol = "https:"
  return { url: url.toString(), platform: HOSTS[site] }
}
