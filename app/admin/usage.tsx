"use client"

// AI usage on this server's key: tokens per day, stacked by account, and each
// account's totals. With `user`, one account alone (the account panel).
//
// Colour follows the ACCOUNT, in a fixed order by how much each used over the
// window: the six heaviest get the six categorical hues (validated against
// this page's near-white — worst colour-blind separation 9.1),
// everyone else folds into one grey "Other". Never a seventh hue.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UsageReport, UsageUser } from "@/app/api/admin/ai-usage/route"

/** Light-surface categorical slots, in order (green skipped to keep six
 *  apart). Three sit under 3:1 on white — legal with the legend and the table
 *  beside the chart, which this view always has. */
const HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"]
const OTHER = "#b3b1aa"
const PERIODS = [7, 30, 90] as const

export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n))
const handle = (u: UsageUser) => (u.username ? `@${u.username}` : u.name)

type Seg = { key: string; label: string; color: string; input: number; cached: number; output: number }

export function UsageView({ user, compact = false }: { user?: string; compact?: boolean }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/ai-usage?days=${days}${user ? `&user=${encodeURIComponent(user)}` : ""}`)
      .then(async (r) => {
        const d = (await r.json()) as UsageReport & { error?: string }
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
        if (live) {
          setReport(d)
          setError(null)
        }
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [days, user])

  // The six heaviest accounts keep a hue each; the rest are "Other".
  const ranked = useMemo(() => [...(report?.users ?? [])].sort((a, b) => b.input + b.output - (a.input + a.output)), [report])
  const colorOf = useMemo(() => new Map(ranked.slice(0, HUES.length).map((u, i) => [u.id, HUES[i]])), [ranked])
  const nameOf = useMemo(() => new Map(ranked.map((u) => [u.id, handle(u)])), [ranked])

  const columns = useMemo(() => {
    if (!report) return []
    return report.days.map((day) => {
      const rows = report.series.filter((s) => s.day === day)
      const segs: Seg[] = []
      const other: Seg = { key: "other", label: "Other", color: OTHER, input: 0, cached: 0, output: 0 }
      for (const r of rows) {
        const c = colorOf.get(r.user)
        if (c) segs.push({ key: r.user, label: nameOf.get(r.user) ?? r.user, color: c, input: r.input, cached: r.cached, output: r.output })
        else {
          other.input += r.input
          other.cached += r.cached
          other.output += r.output
        }
      }
      // Stack in the legend's order, heaviest at the bottom.
      segs.sort((a, b) => ranked.findIndex((u) => u.id === a.key) - ranked.findIndex((u) => u.id === b.key))
      if (other.input + other.output > 0) segs.push(other)
      return { day, segs, total: segs.reduce((s, x) => s + x.input + x.output, 0) }
    })
  }, [report, colorOf, nameOf, ranked])

  const total = ranked.reduce((s, u) => ({ input: s.input + u.input, cached: s.cached + u.cached, output: s.output + u.output, turns: s.turns + u.turns }), { input: 0, cached: 0, output: 0, turns: 0 })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-6">
          <Figure label="Tokens" value={tokens(total.input + total.output)} />
          <Figure label="Cached input" value={total.input ? `${Math.round((total.cached / total.input) * 100)}%` : "—"} />
          <Figure label="Model turns" value={String(total.turns)} />
          {!user && <Figure label="Accounts" value={String(ranked.length)} />}
        </div>
        <div className="flex gap-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Button
              key={p}
              size="xs"
              variant="ghost"
              onClick={() => setDays(p)}
              className={cn("h-7 rounded-chip px-2.5 text-[13px]", days === p ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              {p} days
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-[13px] text-amber-600">{error}</p>
      ) : !report ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : report.missing ? (
        <p className="text-[13px] text-muted-foreground">Usage isn’t recorded yet — the ai_usage table has not been created (run the database migration).</p>
      ) : ranked.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No AI use on this server’s key in the last {days} days.</p>
      ) : (
        <>
          <StackedBars columns={columns} height={compact ? 140 : 220} />
          {!user && <Legend users={ranked} colorOf={colorOf} />}
          {!compact && !user && <UsageTable users={ranked} colorOf={colorOf} />}
        </>
      )}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-xl">{value}</div>
    </div>
  )
}

function Legend({ users, colorOf }: { users: UsageUser[]; colorOf: Map<string, string> }) {
  const shown = users.slice(0, HUES.length)
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {shown.map((u) => (
        <span key={u.id} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: colorOf.get(u.id) }} />
          {handle(u)}
        </span>
      ))}
      {users.length > shown.length && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: OTHER }} />
          Other ({users.length - shown.length})
        </span>
      )}
    </div>
  )
}

/** Tokens per day, stacked. Thin bars, a 2px gap between segments, rounded
 *  top ends, three recessive gridlines, and a tooltip on every segment. */
function StackedBars({ columns, height }: { columns: { day: string; segs: Seg[]; total: number }[]; height: number }) {
  const [hover, setHover] = useState<{ day: string; seg: Seg; x: number; y: number } | null>(null)
  const W = 720
  const left = 44
  const bottom = 20
  const plotH = height - bottom - 6
  const max = Math.max(1, ...columns.map((c) => c.total))
  // A round number at or above the peak, for honest gridlines.
  const step = 10 ** Math.floor(Math.log10(max))
  const top = Math.ceil(max / step) * step
  const y = (v: number) => 6 + plotH - (v / top) * plotH
  const slot = (W - left) / columns.length
  const barW = Math.max(2, Math.min(22, slot * 0.7))
  const every = Math.ceil(columns.length / 8)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="AI tokens per day">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" />
            <text x={left - 6} y={y(top * f) + 3} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {tokens(top * f)}
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          const x = left + i * slot + (slot - barW) / 2
          let acc = 0
          return (
            <g key={c.day}>
              {c.segs.map((s, k) => {
                const v = s.input + s.output
                const y1 = y(acc + v)
                const h = Math.max(0, y(acc) - y1 - (k > 0 ? 2 : 0))
                acc += v
                const last = k === c.segs.length - 1
                const r = last ? Math.min(4, barW / 2, h) : 0
                return (
                  <path
                    key={s.key}
                    d={`M${x},${y1 + h} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y1 + h} Z`}
                    fill={s.color}
                    opacity={hover && (hover.day !== c.day || hover.seg.key !== s.key) ? 0.55 : 1}
                    onMouseEnter={() => setHover({ day: c.day, seg: s, x: ((x + barW / 2) / W) * 100, y: (y1 / height) * 100 })}
                    onMouseLeave={() => setHover(null)}
                  />
                )
              })}
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {c.day.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-interior border border-line-strong bg-surface-raised px-2.5 py-1.5 text-[13px] whitespace-nowrap shadow-float"
          style={{ left: `${hover.x}%`, top: `calc(${hover.y}% - 6px)` }}
        >
          <div className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-[2px]" style={{ background: hover.seg.color }} />
            {hover.seg.label} · {hover.day}
          </div>
          <div className="mt-0.5 font-mono text-muted-foreground">
            {tokens(hover.seg.input)} in ({tokens(hover.seg.cached)} cached) · {tokens(hover.seg.output)} out
          </div>
        </div>
      )}
    </div>
  )
}

function UsageTable({ users, colorOf }: { users: UsageUser[]; colorOf: Map<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-surface border border-line">
      <table className="w-full text-[13px]">
        <thead className="text-muted-foreground">
          <tr className="border-b border-line text-left">
            {["Account", "Tokens", "Input", "Cached", "Output", "Turns", "Models", "Last used"].map((h) => (
              <th key={h} className="px-3.5 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-line last:border-0">
              <td className="px-3.5 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: colorOf.get(u.id) ?? OTHER }} />
                  {handle(u)}
                </span>
              </td>
              <td className="px-3.5 py-2.5 font-mono">{tokens(u.input + u.output)}</td>
              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{tokens(u.input)}</td>
              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{u.input ? `${Math.round((u.cached / u.input) * 100)}%` : "—"}</td>
              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{tokens(u.output)}</td>
              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{u.turns}</td>
              <td className="px-3.5 py-2.5 text-muted-foreground">{u.models.join(", ")}</td>
              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{new Date(u.last).toLocaleDateString("en-CA")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
