// The daily Bilibili job (vercel.json): new videos crediting Reze Design, then
// fresh counts for all of them. Vercel calls it with the project's
// CRON_SECRET as a bearer token; nothing else gets in.

import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db"
import { allVideos, findNew, recount } from "@/lib/db/bili"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  try {
    // 26 hours, so a day's run overlaps the one before it. Four minutes, so the
    // recount and the database writes still fit in the function's five.
    const report = await findNew(26, 240_000)
    await recount((await allVideos()).map((v) => v.aid))
    return NextResponse.json(report)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
