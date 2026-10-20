"use client"

// The presentation half of /bilibili, on the dashboard kit (./dash):
// five stats; likes over time; likes by week and the top makers; and every
// video or maker in a searchable table. One screen on a desktop.

import { useMemo, useState } from "react"
import { byMaker, byWeek, calendarWeek, cumulative, weekEndingAt } from "@/lib/bili-groups"
import type { PublicVideo } from "@/lib/db/bili"
import { useT } from "@/lib/i18n"
import { Stamp } from "@/components/stamp"
import { cn } from "@/lib/utils"
import { AreaChart, BarList, Card, Columns, Segmented, Shell, SmartTable, Stat, fmt, short, type Column } from "./dash"

const LINK = "hover:underline underline-offset-2"
const space = (mid: number) => `https://space.bilibili.com/${mid}`
const watch = (bvid: string) => `https://www.bilibili.com/video/${bvid}`
const WEEK = 7 * 86_400_000

type Maker = ReturnType<typeof byMaker>[number]

export function BilibiliView({ videos, updated, now }: { videos: PublicVideo[]; updated: string | null; now: number }) {
  const t = useT().bilibili
  const [tab, setTab] = useState<"videos" | "makers">("videos")
  const makers = useMemo(() => byMaker(videos), [videos])
  const weeks = useMemo(() => byWeek(videos, calendarWeek, now), [videos, now])
  const rolling = useMemo(() => byWeek(videos, weekEndingAt(now), now), [videos, now])
  const days = useMemo(() => cumulative(videos), [videos])

  const stats = useMemo(() => {
    const sum = (k: "plays" | "likes" | "favorites") => videos.reduce((a, v) => a + v[k], 0)
    const recent = videos.filter((v) => now - Date.parse(v.published) < WEEK)
    // A maker is new this week when their first credited video is.
    const first = new Map<number, number>()
    for (const v of videos) first.set(v.mid, Math.min(first.get(v.mid) ?? Infinity, Date.parse(v.published)))
    const newMakers = [...first.values()].filter((t0) => now - t0 < WEEK).length
    return { plays: sum("plays"), likes: sum("likes"), favorites: sum("favorites"), recent, newMakers }
  }, [videos, now])

  const videoColumns: Column<PublicVideo>[] = [
    {
      key: "video",
      header: t.video,
      cell: (v) => (
        <>
          <a href={watch(v.bvid)} target="_blank" rel="noreferrer" title={v.title} className={cn("block truncate text-foreground", LINK)}>
            {v.title}
          </a>
          <a href={space(v.mid)} target="_blank" rel="noreferrer" className={cn("block truncate text-2xs text-muted-foreground", LINK)}>
            {v.author}
          </a>
        </>
      ),
    },
    { key: "published", header: t.published, width: "w-16", sort: (v) => Date.parse(v.published), cell: (v) => <span className="text-muted-foreground">{v.published.slice(5, 10)}</span> },
    { key: "plays", header: t.plays, width: "w-20", sort: (v) => v.plays, cell: (v) => <span className="text-muted-foreground">{fmt(v.plays)}</span> },
    { key: "likes", header: t.likes, width: "w-16", sort: (v) => v.likes, cell: (v) => <span className="font-medium text-foreground">{fmt(v.likes)}</span> },
  ]
  const makerColumns: Column<Maker>[] = [
    {
      key: "maker",
      header: t.maker,
      cell: (m) => (
        <a href={space(Number(m.key))} target="_blank" rel="noreferrer" className={cn("block truncate text-foreground", LINK)}>
          {m.label}
        </a>
      ),
    },
    { key: "videos", header: t.videos, width: "w-16", sort: (m) => m.videos, cell: (m) => <span className="text-muted-foreground">{m.videos}</span> },
    { key: "plays", header: t.plays, width: "w-20", sort: (m) => m.plays, cell: (m) => <span className="text-muted-foreground">{fmt(m.plays)}</span> },
    { key: "likes", header: t.likes, width: "w-16", sort: (m) => m.likes, cell: (m) => <span className="font-medium text-foreground">{fmt(m.likes)}</span> },
  ]
  const tabs = (
    <Segmented
      value={tab}
      onChange={setTab}
      options={[
        { key: "videos", label: `${t.videos} ${videos.length}` },
        { key: "makers", label: `${t.makers} ${makers.length}` },
      ]}
    />
  )

  return (
    <Shell
      header={
        <>
          <div className="min-w-0">
            <h1 className="text-base font-semibold">{t.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{t.intro}</p>
          </div>
          {updated && (
            <div className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {t.updated}
              <Stamp iso={updated} className="font-medium text-foreground tabular-nums" />
            </div>
          )}
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label={t.videos} value={fmt(videos.length)} sub={t.thisWeek(fmt(stats.recent.length))} spark={rolling.map((w) => w.videos)} />
        <Stat label={t.makers} value={fmt(makers.length)} sub={t.newMakers(stats.newMakers)} />
        <Stat label={t.plays} value={fmt(stats.plays)} sub={t.thisWeek(fmt(stats.recent.reduce((a, v) => a + v.plays, 0)))} spark={rolling.map((w) => w.plays)} />
        <Stat label={t.likes} value={fmt(stats.likes)} sub={t.thisWeek(fmt(stats.recent.reduce((a, v) => a + v.likes, 0)))} spark={rolling.map((w) => w.likes)} />
        <Stat label={t.favorites} value={fmt(stats.favorites)} sub={t.thisWeek(fmt(stats.recent.reduce((a, v) => a + v.favorites, 0)))} spark={rolling.map((w) => w.favorites)} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={t.growth} className="lg:col-span-8">
          <AreaChart
            label={t.growth}
            points={days.map((d) => ({ key: String(d.day), label: d.label, value: d.likes, title: d.label, body: t.onDay(d.label, fmt(d.likes)) }))}
          />
        </Card>

        <Card className="h-[32rem] lg:col-span-4 lg:row-span-2 lg:h-auto">
          {tab === "videos" ? (
            <SmartTable
              rows={videos}
              columns={videoColumns}
              rowKey={(v) => v.bvid}
              text={(v) => `${v.title} ${v.author}`}
              initialSort="published"
              placeholder={t.search}
              head={tabs}
            />
          ) : (
            <SmartTable rows={makers} columns={makerColumns} rowKey={(m) => m.key} text={(m) => m.label} initialSort="likes" placeholder={t.search} head={tabs} />
          )}
        </Card>

        <Card title={t.byWeek} className="lg:col-span-4">
          <Columns
            label={t.byWeek}
            bars={weeks.map((w) => ({ key: w.key, label: w.label, a: w.likes, title: t.weekOf(w.label), body: t.tip(w.videos, fmt(w.plays), fmt(w.likes)) }))}
          />
        </Card>

        <Card title={t.topMakers} className="lg:col-span-4">
          <BarList
            rows={makers.map((m) => ({
              key: m.key,
              title: t.tip(m.videos, fmt(m.plays), fmt(m.likes)),
              label: (
                <a href={space(Number(m.key))} target="_blank" rel="noreferrer" className={LINK}>
                  {m.label}
                </a>
              ),
              a: m.likes,
              note: t.nVideos(m.videos),
              value: short(m.likes),
            }))}
          />
        </Card>
      </div>
    </Shell>
  )
}
