// Videos on Bilibili made with Reze Design, found by the credit their makers
// write: "渲染：Reze Design", "MME：WebGPU/Reze Design/黯灭小羊", a link to
// reze.design.
//
// Finding a video and counting it are separate jobs. A video's id, maker,
// title and date never change, so it is found once and kept
// (schema.biliVideos); only its counts move.
//
// FINDING reads uploads and checks each one's title, description and tags
// against the credit, from two directions:
//
// - Makers' channels. Once someone has credited Reze Design, their channel is
//   walked for new uploads. This is where nearly every video comes from: a
//   keyword search misses a credit at the end of a long description, and most
//   credits are there (Aileen_71's 44 videos, none found by searching "reze
//   design").
// - Every MMD upload in a time window, newest first, through search's date
//   filter. This is what finds a maker nobody knew about. Search returns at
//   most 1000 results a query, and a day holds more MMD uploads than that, so a
//   window that fills up is halved until it fits.
//
// Both run as the owner's Bilibili account (BILIBILI_SESSDATA): signed out, the
// channel API answers 412 after a few requests. It can still answer 412 to a
// burst; a pass that keeps hitting it, or runs out of time, stops and keeps
// what it found.
//
// COUNTING goes through the batch endpoint behind Bilibili's playlists, which
// takes 20 videos a request.

import { createHash } from "node:crypto"

/** Accounts whose credits are about Reze Design rather than made with it: 溺疼
 *  posts their mobile port of the source. */
const EXCLUDED_MIDS = new Set([2011395850])

/** "Reze Design" or the site's address, or the owner credited by name for the
 *  render or the effects ("渲染：黯灭小羊", "MME：黯灭小羊"). */
const CREDIT = /reze[\s._-]*design|reze\.one|(?:渲染|MME)\s*[:：][^\n]*黯灭小羊/i

/** Reze Design's first release; nothing before it can credit it. */
export const LAUNCH = Date.UTC(2026, 6, 1)

const PAUSE_MS = 1000
const BATCH = 20
/** Waits after a 412, in turn, before the pass gives up. */
const BACKOFF_MS = [15_000, 45_000]

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

/** What a video is. Written once. */
export type BiliFound = {
  bvid: string
  aid: number
  mid: number
  author: string
  title: string
  published: Date
}

/** What a video has collected so far. */
export type BiliCounts = {
  plays: number
  likes: number
  coins: number
  favorites: number
  shares: number
  danmaku: number
  comments: number
}

class Blocked extends Error {}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const unescape = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")

function credited(v: { bvid: string; aid: number; mid: number; author: string; title: string; description?: string; tag?: string }, at: number): BiliFound | null {
  const title = unescape(v.title)
  if (EXCLUDED_MIDS.has(v.mid) || !CREDIT.test(`${title}\n${v.description ?? ""}\n${v.tag ?? ""}`)) return null
  return { bvid: v.bvid, aid: v.aid, mid: v.mid, author: v.author, title, published: new Date(at * 1000) }
}

/** A session against Bilibili's web API: the visitor cookie, the owner's login
 *  when there is one, and the keys that sign channel requests. Past
 *  `deadline` (epoch ms) every request stops the pass, as a 412 would. */
async function session(deadline = Infinity) {
  const home = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA }, cache: "no-store" })
  const visitor = home.headers.getSetCookie().map((c) => c.split(";")[0])
  const sessdata = process.env.BILIBILI_SESSDATA
  const cookie = [...visitor, ...(sessdata ? [`SESSDATA=${sessdata}`] : [])].join("; ")

  async function get<T>(url: string, referer: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() > deadline) throw new Blocked()
      // A dropped connection is waited out like a 412.
      const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie, Referer: referer }, cache: "no-store" }).catch(() => null)
      if (!res || res.status === 412) {
        if (attempt === BACKOFF_MS.length || Date.now() + BACKOFF_MS[attempt] > deadline) throw new Blocked()
        await pause(BACKOFF_MS[attempt])
        continue
      }
      if (!res.ok) throw new Error(`Bilibili answered HTTP ${res.status}`)
      const body = (await res.json()) as { code: number; message: string; data: T }
      if (body.code !== 0) throw new Error(`Bilibili: ${body.message} (${body.code})`)
      return body.data
    }
  }

  // WBI: the channel API wants its query signed with keys the nav endpoint
  // hands out (bilibili-API-collect, docs/misc/sign/wbi.md). Read raw: signed
  // out, nav answers -101 and still carries the keys.
  const navRes = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://www.bilibili.com/" },
    cache: "no-store",
  })
  if (!navRes.ok) throw new Error(`Bilibili answered HTTP ${navRes.status}`)
  const navData = ((await navRes.json()) as { data: { isLogin: boolean; wbi_img: { img_url: string; sub_url: string } } }).data
  const key = (u: string) => u.split("/").pop()!.split(".")[0]
  const raw = key(navData.wbi_img.img_url) + key(navData.wbi_img.sub_url)
  const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
  const mixin = MIXIN.map((i) => raw[i])
    .join("")
    .slice(0, 32)
  const sign = (params: Record<string, string | number>) => {
    const p: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) }
    const q = Object.keys(p)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ""))}`)
      .join("&")
    return `${q}&w_rid=${createHash("md5")
      .update(q + mixin)
      .digest("hex")}`
  }

  return { get, sign, loggedIn: navData.isLogin }
}

type Session = Awaited<ReturnType<typeof session>>

/** A video's whole description; listings and search carry only its start. */
async function fullDescription(s: Session, bvid: string): Promise<string> {
  const d = await s.get<string>(`https://api.bilibili.com/x/web-interface/archive/desc?bvid=${bvid}`, `https://www.bilibili.com/video/${bvid}`)
  await pause(PAUSE_MS)
  return d
}

type Upload = { bvid: string; aid: number; mid: number; author: string; title: string; description: string; created: number }

/** A maker's credited uploads published at or after `since`, newest first. */
/** Called once per credited video, as soon as it is seen. */
export type OnFound = (v: BiliFound) => Promise<void>

async function walkMaker(s: Session, mid: number, since: number, keep: OnFound) {
  for (let pn = 1; pn <= 20; pn++) {
    const query = s.sign({
      mid,
      ps: 50,
      pn,
      order: "pubdate",
      platform: "web",
      web_location: 1550101,
      // The browser fingerprint fields a real channel page sends; without them
      // the endpoint answers 412 after a request or two.
      dm_img_list: "[]",
      dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
      dm_cover_img_str: "QU5HTEUgKEFwcGxlLCBBTkdMRSBNZXRhbCBSZW5kZXJlcjogQXBwbGUgTTEgUHJvLCBVbnNwZWNpZmllZCBWZXJzaW9uKUdvb2dsZSBJbmMuIChBcHBsZS",
      dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
    })
    const data = await s.get<{ list: { vlist: Upload[] } }>(`https://api.bilibili.com/x/space/wbi/arc/search?${query}`, `https://space.bilibili.com/${mid}/video`)
    const list = data.list.vlist
    for (const v of list) {
      if (v.created * 1000 < since) continue
      // The listing cuts descriptions short, and a credit usually sits at the
      // end of one; an upload that does not match yet is read in full.
      const f = credited(v, v.created) ?? credited({ ...v, description: await fullDescription(s, v.bvid) }, v.created)
      if (f) await keep(f)
    }
    await pause(PAUSE_MS)
    if (list.length < 50 || list[list.length - 1].created * 1000 < since) return
  }
}

/** Where search cuts a description, and the lines that name a renderer. */
const CUT = 250
const CREDIT_LINE = /渲染|MME|render|特效|效果/i

type SearchHit = { bvid: string; aid: number; mid: number; author: string; title: string; description?: string; tag?: string; pubdate: number }

/** Every upload matching "MMD" published in [from, to], in seconds. */
async function scanWindow(s: Session, from: number, to: number, keep: OnFound): Promise<void> {
  const page = (pn: number) =>
    s.get<{ numResults: number; numPages: number; result?: SearchHit[] }>(
      `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=MMD&order=pubdate&page=${pn}&pubtime_begin_s=${from}&pubtime_end_s=${to}`,
      "https://search.bilibili.com/",
    )
  const first = await page(1)
  await pause(PAUSE_MS)
  // Search stops at 1000 results; a full window is halved until it fits.
  if (first.numResults >= 1000 && to - from > 1800) {
    const mid = Math.floor((from + to) / 2)
    await scanWindow(s, mid + 1, to, keep)
    await scanWindow(s, from, mid, keep)
    return
  }
  for (let pn = 1, data = first; ; pn++) {
    const hits = data.result ?? []
    for (const h of hits) {
      const short = h.description ?? ""
      // Search cuts descriptions at 255 characters. One cut before any render
      // or effects line could show is read in full (about 7% of uploads,
      // measured 2026-10-14); one that shows them and names someone else is not.
      const f = credited(h, h.pubdate) ?? (short.length >= CUT && !CREDIT_LINE.test(short) ? credited({ ...h, description: await fullDescription(s, h.bvid) }, h.pubdate) : null)
      if (f) await keep(f)
    }
    if (hits.length < 20 || pn >= data.numPages) return
    data = await page(pn + 1)
    await pause(PAUSE_MS)
  }
}

export type FindResult = { found: number; blocked: boolean; loggedIn: boolean }

/** Every credited MMD upload published in [from, to] (epoch ms), handed to
 *  `onFound` as it is seen. For a backfill that runs window by window. */
export async function scanUploads(from: number, to: number, deadline: number, onFound: OnFound): Promise<FindResult> {
  const s = await session(deadline)
  let found = 0
  try {
    await scanWindow(s, Math.floor(from / 1000), Math.floor(to / 1000), async (v) => {
      found++
      await onFound(v)
    })
  } catch (e) {
    if (!(e instanceof Blocked)) throw e
    return { found, blocked: true, loggedIn: s.loggedIn }
  }
  return { found, blocked: false, loggedIn: s.loggedIn }
}

/**
 * Walk the makers' channels back to `since`, then every MMD upload since
 * `scanSince` (both epoch ms), stopping at `deadline`. Makers come first
 * because nearly every video comes from them; the scan only adds people. A
 * maker the scan finds is walked back to the launch. Every credited video goes
 * to `onFound` the moment it is seen, so a pass cut short has already kept
 * what it found. Returns how many it saw and whether it stopped early
 * (blocked or out of time).
 */
export async function findVideos(makers: Map<number, string>, since: number, scanSince: number, deadline: number, onFound: OnFound): Promise<FindResult> {
  const s = await session(deadline)
  const seen = new Set<string>()
  const todo = new Map(makers)
  const keep: OnFound = async (v) => {
    if (seen.has(v.bvid)) return
    seen.add(v.bvid)
    if (!todo.has(v.mid)) todo.set(v.mid, v.author)
    await onFound(v)
  }
  const walked = new Set<number>()
  const walk = async () => {
    for (const mid of todo.keys()) {
      if (walked.has(mid)) continue
      walked.add(mid)
      await walkMaker(s, mid, makers.has(mid) ? since : LAUNCH, keep)
    }
  }
  try {
    await walk()
    await scanWindow(s, Math.floor(scanSince / 1000), Math.floor(Date.now() / 1000), keep)
    await walk()
  } catch (e) {
    if (!(e instanceof Blocked)) throw e
    return { found: seen.size, blocked: true, loggedIn: s.loggedIn }
  }
  return { found: seen.size, blocked: false, loggedIn: s.loggedIn }
}

type ResourceInfo = {
  id: number
  cnt_info: { play: number; thumb_up: number; coin: number; collect: number; share: number; danmaku: number; reply: number }
}

/** Current counts for these videos, by aid. A video Bilibili no longer
 *  returns (deleted, made private) is absent. */
export async function countVideos(aids: number[]): Promise<Map<number, BiliCounts>> {
  const s = await session()
  const out = new Map<number, BiliCounts>()
  for (let i = 0; i < aids.length; i += BATCH) {
    const resources = aids
      .slice(i, i + BATCH)
      .map((a) => `${a}:2`)
      .join(",")
    const data = await s.get<ResourceInfo[] | null>(`https://api.bilibili.com/medialist/gateway/base/resource/infos?resources=${resources}`, "https://www.bilibili.com/")
    for (const r of data ?? []) {
      const c = r.cnt_info
      out.set(r.id, { plays: c.play, likes: c.thumb_up, coins: c.coin, favorites: c.collect, shares: c.share, danmaku: c.danmaku, comments: c.reply })
    }
    await pause(300)
  }
  return out
}
