// /analysis/bilibili: the videos people posted on Bilibili that credit Reze
// Design. The daily job (app/api/cron/bilibili) finds and counts them; this
// page only reads the table.

import type { Metadata } from "next"
import { hasDatabase } from "@/lib/db"
import { publicVideos } from "@/lib/db/bili"
import { BilibiliView } from "./view"

export const metadata: Metadata = {
  title: "On Bilibili · Reze Design",
  description: "Videos on Bilibili made with Reze Design: their makers, plays and likes, counted daily.",
}

/** Per request, like /analysis. The numbers move once a day, so a `revalidate`
 *  is the lever if this page ever draws real traffic. */
export const dynamic = "force-dynamic"

export default async function BilibiliPage() {
  const videos = hasDatabase ? await publicVideos() : []
  return <BilibiliView videos={videos} />
}
