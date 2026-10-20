// How the Bilibili videos are summed for a chart: by maker, and by the week
// they were published.

export type GroupVideo = { mid: number; author: string; published: string; plays: number; likes: number; favorites: number }
export type Group = { key: string; label: string; videos: number; plays: number; likes: number; favorites: number }

const DAY = 86_400_000

const WEEK = 7 * DAY

/** 00:00 UTC of the day holding `t`. */
const dayOf = (t: number) => {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** The start of a week: a function from a time to the first moment of the
 *  week holding it. */
export type WeekOf = (t: number) => number

/** Calendar weeks: Monday 00:00 UTC of the week holding `t`. */
export const calendarWeek: WeekOf = (t) => dayOf(t) - ((new Date(t).getUTCDay() + 6) % 7) * DAY

/** Seven-day windows that end with the day holding `now` and step back from
 *  it, so the newest is always a whole week and a sparkline beside a "this
 *  week" figure slides a day at a time instead of dropping on Monday. */
export const weekEndingAt = (now: number): WeekOf => {
  const end = dayOf(now) + DAY
  return (t: number) => end - Math.ceil((end - t) / WEEK) * WEEK
}

/** Reze Design's first release went out in July 2026; the weeks start there. */
const LAUNCH = Date.UTC(2026, 6, 1)

const md = (t: number) => new Date(t).toISOString().slice(5, 10)

function add(by: Map<string, Group>, key: string, label: string, v: GroupVideo) {
  const g = by.get(key) ?? { key, label, videos: 0, plays: 0, likes: 0, favorites: 0 }
  g.videos++
  g.plays += v.plays
  g.likes += v.likes
  g.favorites += v.favorites
  by.set(key, g)
}

/** One group per maker, most liked first. */
export function byMaker(videos: GroupVideo[]): Group[] {
  const by = new Map<string, Group>()
  for (const v of videos) add(by, String(v.mid), v.author, v)
  return [...by.values()].sort((a, b) => b.likes - a.likes)
}

/** One group per week as `weekOf` cuts them, every week from July to the one
 *  holding `now`, empty weeks included. Labelled by the first day, as MM-DD. */
export function byWeek(videos: GroupVideo[], weekOf: WeekOf, now: number): Group[] {
  if (videos.length === 0) return []
  const by = new Map<string, Group>()
  for (const v of videos) {
    const w = weekOf(Date.parse(v.published))
    add(by, String(w), md(w), v)
  }
  const out: Group[] = []
  for (let w = weekOf(LAUNCH); w <= weekOf(now); w += WEEK) out.push(by.get(String(w)) ?? { key: String(w), label: md(w), videos: 0, plays: 0, likes: 0, favorites: 0 })
  return out
}

/** Likes so far on each day from the first video to the newest, counting each
 *  video's likes on the day it was published. */
export function cumulative(videos: GroupVideo[]): { day: number; label: string; likes: number }[] {
  if (videos.length === 0) return []
  const by = new Map<number, number>()
  for (const v of videos) {
    const t = Date.parse(v.published)
    const d = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate())
    by.set(d, (by.get(d) ?? 0) + v.likes)
  }
  const days = [...by.keys()].sort((a, b) => a - b)
  const out: { day: number; label: string; likes: number }[] = []
  let sum = 0
  for (let d = days[0]; d <= days[days.length - 1]; d += DAY) {
    sum += by.get(d) ?? 0
    out.push({ day: d, label: md(d), likes: sum })
  }
  return out
}
