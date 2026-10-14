"use client"

// The presentation half of /analysis/bilibili. Client for the same reason as
// /analysis: the locale lives in localStorage.

import { useMemo, useState } from "react"
import { byMaker, byWeek, type Group } from "@/lib/bili-groups"
import type { PublicVideo } from "@/lib/db/bili"
import { useT } from "@/lib/i18n"
import { AnalysisTabs } from "../tabs"
import { Panel, SERIES, StackBar, Tile } from "../view"
import { VideoTable } from "./video-table"

// ── On Bilibili ──
//
// The videos people posted that credit Reze Design (lib/db/bili.ts, found and
// counted by the daily job). A posted video is a finished export, so its bars
// wear the exports colour: the page's two meanings stay two.

const LINK = "hover:text-foreground hover:underline underline-offset-2"
const space = (mid: number) => `https://space.bilibili.com/${mid}`

/** One ranked row: the name line, then the bar with its value. Same rhythm as
 *  Ranks, single series. */
function BiliRow({
  rank,
  top,
  value,
  children,
  aside,
}: {
  rank: number
  top: number
  value: number
  children: React.ReactNode
  aside: React.ReactNode
}) {
  return (
    <li className="mb-2 break-inside-avoid last:mb-0">
      <div className="flex items-baseline gap-2.5">
        <span className="w-5 shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">{rank}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{children}</span>
        <span className="max-w-[40%] shrink-0 truncate text-2xs text-muted-foreground">{aside}</span>
      </div>
      <div className="flex items-center gap-2.5 pl-[30px]">
        <div className="min-w-0 flex-1">
          <StackBar a={value} b={0} top={top} />
        </div>
        <span className="shrink-0 font-mono text-2xs font-semibold text-foreground tabular-nums">{value.toLocaleString()}</span>
      </div>
    </li>
  )
}

/** Likes on the videos published each week, July onward. */
function WeekColumns({
  weeks,
  label,
  weekOf,
  tip,
}: {
  weeks: Group[]
  label: string
  weekOf: (d: string) => string
  tip: (v: number, p: string, l: string) => string
}) {
  const [hover, setHover] = useState<{ g: Group; x: number; y: number } | null>(null)
  const W = 880
  const H = 200
  const left = 40
  const bottom = 18
  const plotH = H - bottom - 6
  const max = Math.max(1, ...weeks.map((w) => w.likes))
  // A round number at or above the peak, for honest gridlines.
  const step = 10 ** Math.floor(Math.log10(max))
  const top = Math.ceil(max / step) * step
  const y = (v: number) => 6 + plotH - (v / top) * plotH
  const slot = (W - left) / Math.max(1, weeks.length)
  const colW = Math.max(2, Math.min(28, slot - 2))
  const every = Math.ceil(weeks.length / 10)
  const short = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(top * f)} y2={y(top * f)} className="stroke-line" />
            <text x={left - 6} y={y(top * f) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-2xs">
              {short(top * f)}
            </text>
          </g>
        ))}
        {weeks.map((g, i) => {
          const x = left + i * slot + (slot - colW) / 2
          const y1 = y(g.likes)
          const h = Math.max(0, y(0) - y1)
          const r = Math.min(4, colW / 2, h)
          return (
            <g
              key={g.key}
              onMouseEnter={() => setHover({ g, x: ((x + colW / 2) / W) * 100, y: (y1 / H) * 100 })}
              onMouseLeave={() => setHover(null)}
            >
              {/* The hit target is the whole slot, so an empty week can be read too. */}
              <rect x={left + i * slot} y={6} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y1 + h} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + colW - r} Q${x + colW},${y1} ${x + colW},${y1 + r} V${y1 + h} Z`}
                  fill={SERIES.exports}
                  opacity={hover && hover.g.key !== g.key ? 0.55 : 1}
                />
              )}
              {i % every === 0 && (
                <text x={x + colW / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground font-mono text-2xs">
                  {g.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-interior border border-line-strong bg-surface-raised px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: `${hover.x}%`, top: `calc(${hover.y}% - 6px)` }}
        >
          <div className="text-xs font-medium text-foreground">{weekOf(hover.g.label)}</div>
          <div className="mt-0.5 font-mono text-2xs text-muted-foreground">
            {tip(hover.g.videos, hover.g.plays.toLocaleString(), hover.g.likes.toLocaleString())}
          </div>
        </div>
      )}
    </div>
  )
}

export function BilibiliView({ videos }: { videos: PublicVideo[] }) {
  const t = useT().bilibili
  const makers = useMemo(() => byMaker(videos), [videos])
  const weeks = useMemo(() => byWeek(videos), [videos])
  const plays = videos.reduce((a, v) => a + v.plays, 0)
  const likes = videos.reduce((a, v) => a + v.likes, 0)
  return (
    <main className="w-full flex-1 bg-black px-6 py-12 text-sm sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <AnalysisTabs />
        <h1 className="mt-6 text-lg font-semibold">{t.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t.videos} value={videos.length.toLocaleString()} />
          <Tile label={t.makers} value={makers.length.toLocaleString()} />
          <Tile label={t.plays} value={plays.toLocaleString()} />
          <Tile label={t.likes} value={likes.toLocaleString()} />
        </div>

        <div className="mt-4">
          <Panel title={t.byWeek}>
            <WeekColumns weeks={weeks} label={t.byWeek} weekOf={t.weekOf} tip={t.tip} />
          </Panel>
        </div>

        <div className="mt-4">
          <Panel title={t.byMaker}>
            <ol className="mt-3 gap-x-8 sm:columns-2">
              {makers.map((m, i) => (
                <BiliRow key={m.key} rank={i + 1} top={makers[0].likes} value={m.likes} aside={t.nVideos(m.videos)}>
                  <a href={space(Number(m.key))} target="_blank" rel="noreferrer" className={LINK}>
                    {m.label}
                  </a>
                </BiliRow>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="mt-4">
          <VideoTable videos={videos} />
        </div>
      </div>
    </main>
  )
}
