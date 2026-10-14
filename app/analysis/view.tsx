"use client"

// The presentation half of /analysis, on the dashboard kit (./dash): five
// stats; exports and published scenes per week; every model; formats; and the
// presets that reached a video or a scene. One screen on a desktop.
//
// Two sources answer every question here: exports (what people rendered,
// shared by choice) in BLUE, and published scenes (what they put here) in
// ORANGE, stacked wherever both apply.
//
// Client because the locale lives in localStorage, which no server render can
// see.

import Link from "next/link"
import { useMemo, useState } from "react"
import { useT } from "@/lib/i18n"
import type { ExportAnalysis, Slice } from "@/lib/db/export-analysis"
import { BarList, BLUE, Card, Columns, Key, ORANGE, Segmented, Shell, Stat, fmt } from "./dash"
import { AnalysisTabs } from "./tabs"

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Monday 00:00 UTC of the week holding `t`. */
const weekOf = (t: number) => {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY
}

/** What the file is called, without what kind of file it is. */
const modelName = (file: string) => file.replace(/\.(pmx|pmd|zip)$/i, "")

type Pair = { key: string; label: string; a: number; b: number }

/** Model names from both sources into one row each, most used first. */
function stackModels(exports: Slice[], scenes: Slice[]): Pair[] {
  const rows = new Map<string, Pair>()
  const put = (s: Slice, key: "a" | "b") => {
    const cur = rows.get(s.label) ?? { key: s.label, label: modelName(s.label), a: 0, b: 0 }
    cur[key] += s.n
    rows.set(s.label, cur)
  }
  for (const s of exports) put(s, "a")
  for (const s of scenes) put(s, "b")
  return [...rows.values()].sort((x, y) => y.a + y.b - (x.a + x.b))
}

type FormatKey = "aspect" | "quality" | "look"
type KindKey = "graph" | "effect" | "grade"

export function AnalysisView({ data, now }: { data: ExportAnalysis; now: number }) {
  const t = useT()
  const a = t.analysis
  const [format, setFormat] = useState<FormatKey>("aspect")
  const [kind, setKind] = useState<KindKey>("graph")
  const models = useMemo(() => stackModels(data.exportModels, data.sceneModels), [data])

  // Every week from the first day either source has to this one, empty weeks
  // included, so the columns are a time axis.
  const weeks = useMemo(() => {
    if (data.days.length === 0) return []
    const by = new Map<number, { exports: number; scenes: number }>()
    for (const d of data.days) {
      const w = weekOf(Date.parse(d.day))
      const cur = by.get(w) ?? { exports: 0, scenes: 0 }
      cur.exports += d.exports
      cur.scenes += d.scenes
      by.set(w, cur)
    }
    const out: { week: number; label: string; exports: number; scenes: number }[] = []
    for (let w = Math.min(...by.keys()); w <= weekOf(now); w += WEEK)
      out.push({ week: w, label: new Date(w).toISOString().slice(5, 10), ...(by.get(w) ?? { exports: 0, scenes: 0 }) })
    return out
  }, [data.days, now])

  const recent = useMemo(() => {
    const days = data.days.filter((d) => now - Date.parse(d.day) < WEEK)
    return { exports: days.reduce((s, d) => s + d.exports, 0), scenes: days.reduce((s, d) => s + d.scenes, 0) }
  }, [data.days, now])

  const formatRows: Slice[] = data[format]
  const formatTotal = formatRows.reduce((s, r) => s + r.n, 0)
  const presets = data.items.filter((i) => i.kind === kind).sort((x, y) => y.exports + y.scenes - (x.exports + x.scenes))
  const top = models[0]
  const legend = (
    <>
      <Key color={BLUE} label={a.exports} />
      <Key color={ORANGE} label={a.scenesTile} />
    </>
  )

  return (
    <Shell
      header={
        <>
          <AnalysisTabs />
          <div className="min-w-0">
            <h1 className="text-base font-semibold">{a.title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {a.intro}{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                {t.render.shareStatsLink}
              </Link>
            </p>
          </div>
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label={a.exports} value={fmt(data.exportTotal)} sub={a.thisWeek(recent.exports)} spark={weeks.map((w) => w.exports)} />
        <Stat label={a.scenesTile} value={fmt(data.sceneTotal)} sub={a.thisWeek(recent.scenes)} spark={weeks.map((w) => w.scenes)} color={ORANGE} />
        <Stat label={a.models} value={fmt(models.length)} sub={a.modelsSub} />
        <Stat label={a.presets} value={fmt(data.items.length)} sub={a.presetsSub} />
        <Stat label={a.topModel} value={top ? top.label : "—"} sub={top ? [top.a > 0 && a.videos(top.a), top.b > 0 && a.scenes(top.b)].filter(Boolean).join(" · ") : undefined} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={a.perWeek} aside={legend} className="lg:col-span-8">
          <Columns
            label={a.perWeek}
            bars={weeks.map((w) => ({ key: String(w.week), label: w.label, a: w.exports, b: w.scenes, title: a.weekOf(w.label), body: a.weekTip(w.exports, w.scenes) }))}
          />
        </Card>

        <Card title={a.models} aside={legend} className="h-[32rem] lg:col-span-4 lg:row-span-2 lg:h-auto">
          {models.length === 0 ? (
            <p className="px-4 text-xs text-muted-foreground">{a.empty}</p>
          ) : (
            <BarList
              rows={models.map((m) => ({
                key: m.key,
                label: m.label,
                title: [m.a > 0 && a.videos(m.a), m.b > 0 && a.scenes(m.b)].filter(Boolean).join(" · "),
                a: m.a,
                b: m.b,
                value: fmt(m.a + m.b),
              }))}
            />
          )}
        </Card>

        <Card
          title={a.formats}
          aside={
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { key: "aspect", label: a.aspect },
                { key: "quality", label: a.resolution },
                { key: "look", label: a.style },
              ]}
            />
          }
          className="lg:col-span-4"
        >
          {formatRows.length === 0 ? (
            <p className="px-4 text-xs text-muted-foreground">{a.empty}</p>
          ) : (
            <BarList
              rank={false}
              rows={formatRows.map((r) => ({
                key: r.label,
                label: r.label,
                a: r.n,
                note: a.videos(r.n),
                value: `${Math.round((r.n / Math.max(1, formatTotal)) * 100)}%`,
              }))}
            />
          )}
        </Card>

        <Card
          title={a.presets}
          aside={
            <Segmented
              value={kind}
              onChange={setKind}
              options={(["graph", "effect", "grade"] as const).map((k) => ({ key: k, label: a.kinds[k] }))}
            />
          }
          className="lg:col-span-4"
        >
          {presets.length === 0 ? (
            <p className="px-4 text-xs text-muted-foreground">{a.emptyItems}</p>
          ) : (
            <BarList
              rows={presets.map((p) => ({
                key: p.id,
                label: p.name,
                title: [p.exports > 0 && a.videos(p.exports), p.scenes > 0 && a.scenes(p.scenes)].filter(Boolean).join(" · "),
                a: p.exports,
                b: p.scenes,
                value: fmt(p.exports + p.scenes),
              }))}
            />
          )}
        </Card>
      </div>
    </Shell>
  )
}
