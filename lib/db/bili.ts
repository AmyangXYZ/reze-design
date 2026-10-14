import "server-only"

// The kept Bilibili videos (schema.biliVideos): the daily job finds new ones
// and recounts them all; /analysis reads them.

import { desc, sql } from "drizzle-orm"
import { countVideos, findVideos, type BiliCounts, type BiliFound } from "@/lib/bilibili"
import { db, schema } from "@/lib/db"

const t = schema.biliVideos
const DAY = 86_400_000

export type FindReport = { added: number; blocked: boolean; loggedIn: boolean }

export const allVideos = () => db.select().from(t).orderBy(desc(t.likes))

/** What /analysis shows of a video. */
export type PublicVideo = { bvid: string; title: string; mid: number; author: string; published: string; plays: number; likes: number }

/** Every kept video, most liked first; empty before the table exists. */
export async function publicVideos(): Promise<PublicVideo[]> {
  try {
    const rows = await db
      .select({ bvid: t.bvid, title: t.title, mid: t.mid, author: t.author, published: t.published, plays: t.plays, likes: t.likes })
      .from(t)
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

/** Keep the videos not seen before, and count them. Returns how many. */
async function keep(found: BiliFound[]): Promise<number> {
  if (found.length === 0) return 0
  const inserted = await db.insert(t).values(found).onConflictDoNothing({ target: t.bvid }).returning({ aid: t.aid })
  if (inserted.length) await recount(inserted.map((r) => r.aid))
  return inserted.length
}

/**
 * New uploads from every known maker over the past week, and every MMD upload
 * over the past `scanHours`, for at most `budgetMs`.
 */
export async function findNew(scanHours: number, budgetMs: number): Promise<FindReport> {
  const known = await db.selectDistinctOn([t.mid], { mid: t.mid, author: t.author }).from(t)
  const now = Date.now()
  const r = await findVideos(new Map(known.map((k) => [k.mid, k.author])), now - 7 * DAY, now - scanHours * 3_600_000, now + budgetMs)
  return { added: await keep(r.found), blocked: r.blocked, loggedIn: r.loggedIn }
}
