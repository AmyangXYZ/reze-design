// How the Bilibili videos are summed for a chart: by maker, and by the week
// they were published. Shared by the admin view and /analysis.

export type GroupVideo = { mid: number; author: string; published: string; plays: number; likes: number }
export type Group = { key: string; label: string; videos: number; plays: number; likes: number }

const DAY = 86_400_000

/** Monday 00:00 UTC of the week holding `t`. */
const weekOf = (t: number) => {
  const d = new Date(t)
  const day = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY
}

/** Reze Design's first release went out in July 2026; the weeks start there. */
const FIRST_WEEK = weekOf(Date.UTC(2026, 6, 1))

const md = (t: number) => new Date(t).toISOString().slice(5, 10)

function add(by: Map<string, Group>, key: string, label: string, v: GroupVideo) {
  const g = by.get(key) ?? { key, label, videos: 0, plays: 0, likes: 0 }
  g.videos++
  g.plays += v.plays
  g.likes += v.likes
  by.set(key, g)
}

/** One group per maker, most liked first. */
export function byMaker(videos: GroupVideo[]): Group[] {
  const by = new Map<string, Group>()
  for (const v of videos) add(by, String(v.mid), v.author, v)
  return [...by.values()].sort((a, b) => b.likes - a.likes)
}

/** One group per week, every week from July to the newest video's, empty
 *  weeks included. Labelled by the Monday, as MM-DD. */
export function byWeek(videos: GroupVideo[]): Group[] {
  if (videos.length === 0) return []
  const by = new Map<string, Group>()
  let last = FIRST_WEEK
  for (const v of videos) {
    const w = weekOf(Date.parse(v.published))
    last = Math.max(last, w)
    add(by, String(w), md(w), v)
  }
  const out: Group[] = []
  for (let w = FIRST_WEEK; w <= last; w += 7 * DAY) out.push(by.get(String(w)) ?? { key: String(w), label: md(w), videos: 0, plays: 0, likes: 0 })
  return out
}
