// The daily Bilibili job, run from the owner's Mac: Bilibili blocks Vercel's
// addresses, and a home connection gets through. `npm run bili:daily`.
//
// New uploads from every known maker over the past week, every MMD upload from
// 26 hours before the newest kept video (so one day's run overlaps the last,
// and a run after a blocked one covers the gap), each credited video written
// as it is found; then fresh counts for every video. Reads .env.local:
// DATABASE_URL, and BILIBILI_SESSDATA for the channel API.
//
// Bilibili 412s datacenter addresses, Cloudflare WARP's included: bilibili.com
// is excluded from the WARP tunnel (`warp-cli tunnel host list`).

import { allVideos, findNew, recount } from "@/lib/db/bili"

const at = () => new Date().toISOString().slice(0, 19).replace("T", " ")
console.log(at(), "finding new videos")
const report = await findNew(26, 60 * 60_000)
console.log(at(), `added ${report.added}${report.blocked ? ", stopped early (Bilibili blocked or out of time)" : ""}${report.loggedIn ? "" : ", signed out: set BILIBILI_SESSDATA"}`)
const videos = await allVideos()
await recount(videos.map((v) => v.aid))
console.log(at(), `recounted ${videos.length} videos`)
process.exit(0)
