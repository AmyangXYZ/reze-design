// The other half of /privacy: what the export stats switch actually produced.
//
// Public, because a page that tells you what is collected and never shows it back
// is asking to be taken on faith. Everything here came from the switch, so anyone
// deciding whether to turn it on can first read exactly what turning it on adds
// to — and the numbers are worth reading on their own, which is the point. It is
// the reason to opt in, not the apology for having asked.
//
// This half is the query; the words live in view.tsx, which is a client component
// only because the locale lives in localStorage and no server render can see it.

import type { Metadata } from "next"
import { hasDatabase } from "@/lib/db"
import { EMPTY_ANALYSIS, exportAnalysis } from "@/lib/db/export-analysis"
import { AnalysisView } from "./view"

export const metadata: Metadata = {
  title: "Analysis · Reze Design",
  description:
    "What people render: aspect ratios, resolutions, models, effects and looks, from exports shared by the people who made them.",
}

/**
 * Queried per request, never cached.
 *
 * A cached window here means someone finishes a video, opens this page and finds
 * their own export missing — and concludes the switch does nothing, which is the
 * one impression this page exists to prevent. The counters are what people check
 * right after doing the thing that moves them.
 *
 * The cost lever if this ever draws real traffic: a `revalidate` of 60 collapses
 * a burst into one query a minute and still reads as live. Reach for that when
 * the page has visitors, not before.
 */
export const dynamic = "force-dynamic"

export default async function AnalysisPage() {
  const data = hasDatabase ? await exportAnalysis() : EMPTY_ANALYSIS
  return <AnalysisView data={data} />
}
