import "server-only"

// The kept Bilibili videos (schema.biliVideos): the daily job
// (scripts/bili-daily.ts) finds new ones and recounts them all; /analysis
// reads them.

import { desc, gte, sql } from "drizzle-orm"
import { countVideos, findVideos, LAUNCH, type BiliCounts, type BiliFound } from "@/lib/bilibili"
import { db, schema } from "@/lib/db"

const t = schema.biliVideos
const DAY = 86_400_000

export type FindReport = { added: number; blocked: boolean; loggedIn: boolean }

export const allVideos = () => db.select().from(t).orderBy(desc(t.likes))

/** What /analysis shows of a video. */
export type PublicVideo = {
  bvid: string
  title: string
  mid: number
  author: string
  published: string
  plays: number
  likes: number
  coins: number
  favorites: number
  shares: number
  comments: number
}

/** Every kept video from the launch on, most liked first; empty before the
 *  table exists. A video dated before Reze Design existed cannot have been
 *  made with it, whatever its description says. */
export async function publicVideos(): Promise<PublicVideo[]> {
  try {
    const rows = await db
      .select({
        bvid: t.bvid,
        title: t.title,
        mid: t.mid,
        author: t.author,
        published: t.published,
        plays: t.plays,
        likes: t.likes,
        coins: t.coins,
        favorites: t.favorites,
        shares: t.shares,
        comments: t.comments,
      })
      .from(t)
      .where(gte(t.published, new Date(LAUNCH)))
      .orderBy(desc(t.likes))
    return rows.map((r) => ({ ...r, published: r.published.toISOString() }))
  } catch {
    return []
  }
}

/** Write fresh counts for every video Bilibili still returns, in one statement. */
export async function recount(aids: number[]) {
  const counts = await countVideos(aids)
  if (counts.size === 0) return
  const rows = [...counts].map(
    ([aid, c]: [number, BiliCounts]) =>
      sql`(${aid}::bigint, ${c.plays}::int, ${c.likes}::int, ${c.coins}::int, ${c.favorites}::int, ${c.shares}::int, ${c.danmaku}::int, ${c.comments}::int)`,
  )
  await db.execute(sql`
    update ${t} set
      plays = v.plays, likes = v.likes, coins = v.coins, favorites = v.favorites,
      shares = v.shares, danmaku = v.danmaku, comments = v.comments, counted_at = now()
    from (values ${sql.join(rows, sql`, `)}) as v(aid, plays, likes, coins, favorites, shares, danmaku, comments)
    where ${t.aid} = v.aid`)
}

/** Keep a video not seen before, and count it, the moment it is found.
 *  True when it was new. */
export async function keepVideo(v: BiliFound): Promise<boolean> {
  const [row] = await db.insert(t).values(v).onConflictDoNothing({ target: t.bvid }).returning({ aid: t.aid })
  if (row) await recount([row.aid])
  return !!row
}

/**
 * New uploads from every known maker over the past week, and every MMD upload
 * over the past `scanHours`, for at most `budgetMs`.
 */
export async function findNew(scanHours: number, budgetMs: number): Promise<FindReport> {
  const known = await db.selectDistinctOn([t.mid], { mid: t.mid, author: t.author }).from(t)
  const now = Date.now()
  let added = 0
  const r = await findVideos(new Map(known.map((k) => [k.mid, k.author])), now - 7 * DAY, now - scanHours * 3_600_000, now + budgetMs, async (v) => {
    if (await keepVideo(v)) added++
  })
  return { added, blocked: r.blocked, loggedIn: r.loggedIn }
}

/** When the counts were last read from Bilibili: the newest count in the
 *  table, as ISO. Null before anything is counted. */
export async function countedAt(): Promise<string | null> {
  try {
    const [row] = await db.select({ at: sql<Date | null>`max(${t.countedAt})` }).from(t)
    return row?.at ? new Date(row.at).toISOString() : null
  } catch {
    return null
  }
}

/** The server's clock, for "this week" figures. A function, so a page reads it
 *  once per request rather than in render. */
export const serverNow = () => Date.now()
