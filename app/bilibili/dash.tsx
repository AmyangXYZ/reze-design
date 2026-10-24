"use client"

// The dashboard kit /bilibili is built from: a one-screen shell,
// cards, stat tiles with sparklines, an area chart, columns, bar lists and a
// searchable table.
//
// A light page (.dash-light, the admin's theme). Colour: two series at most,
// BLUE first and ORANGE second: a soft blue, and the dataviz reference
// palette's light orange. Validated as a pair on the white card: CVD
// separation ΔE 22.4 (protan), normal vision 28.0, both inside the light
// lightness band and over 3:1. One series anywhere is BLUE.
//
// Charts draw at their box's real pixel size (useSize), so text stays crisp and
// marks keep their thickness at any window size.

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SCROLL_FADE, useScrollFade } from "@/components/editor/scroll-fade"
import { cn } from "@/lib/utils"

export const BLUE = "#5f8fd6"
export const ORANGE = "#eb6834"

export const fmt = (x: number) => x.toLocaleString()
export const short = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(Math.round(x))

/** The box's size in CSS pixels, kept current as the window changes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// ── Layout ──

/** The page: one screen tall on a desktop, every card sharing it; on a phone
 *  the cards stack and the page scrolls. */
export function Shell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    // flex-none on a desktop: as a flex item, flex-1's zero basis and growth
    // would override the height and let the page grow with its content.
    <main className="dash-light flex w-full flex-1 flex-col gap-3 bg-background p-3 text-sm text-foreground sm:p-4 lg:h-dvh lg:max-h-dvh lg:flex-none lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">{header}</header>
      {children}
    </main>
  )
}

/** A panel. Without a title (a table whose tabs already name it) the content
 *  starts at the top. */
export function Card({ title, aside, className, children }: { title?: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex h-72 min-h-0 flex-col rounded-surface border border-line bg-surface shadow-xs lg:h-auto", !title && "pt-3", className)}>
      {title && (
        <div className="flex shrink-0 items-center gap-3 px-4 pt-3.5 pb-1">
          <h2 className="text-xs font-medium text-foreground">{title}</h2>
          {aside && <div className="ml-auto flex items-center gap-3">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// ── Stat tiles ──

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [values.length < 2 ? w / 2 : (w * i) / (values.length - 1), h - 2 - ((h - 4) * v) / max] as const)
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")
  return (
    <div ref={ref} className="h-7 w-full">
      {w > 0 && values.length > 1 && (
        <svg width={w} height={h} aria-hidden>
          <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity={0.15} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}

/** A figure, what it means, and optionally its recent shape. */
export function Stat({ label, value, sub, spark, color = BLUE }: { label: string; value: string; sub?: string; spark?: number[]; color?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 rounded-surface border border-line bg-surface px-4 py-3 shadow-xs">
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold text-foreground">{value}</div>
          {sub && <div className="truncate text-2xs text-muted-foreground">{sub}</div>}
        </div>
        {spark && (
          <div className="w-20 shrink-0">
            <Sparkline values={spark} color={color} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Charts ──

type Tip = { x: number; y: number; title: string; body: string }

function Tooltip({ tip }: { tip: Tip }) {
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-interior border border-line-strong bg-surface-raised px-2.5 py-1.5 shadow-float"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="truncate text-xs font-medium text-foreground">{tip.title}</div>
      <div className="mt-0.5 text-2xs text-muted-foreground">{tip.body}</div>
    </div>
  )
}

/** A chart's drawing area: fills what its card leaves, and measures itself. */
function Plot({ label, children }: { label: string; children: (w: number, h: number, setTip: (t: Tip | null) => void) => React.ReactNode }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  return (
    <div ref={ref} className="relative min-h-0 flex-1">
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="absolute inset-0" role="img" aria-label={label}>
          {children(w, h, setTip)}
        </svg>
      )}
      {tip && <Tooltip tip={tip} />}
    </div>
  )
}

/** Gridline steps of 1, 2 or 5 times a power of ten, about four of them up to
 *  a top at or above `max`, so every label is a round number. */
function niceScale(max: number) {
  const raw = Math.max(1, max) / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  const top = Math.ceil(Math.max(1, max) / step) * step
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
}

const PAD = { l: 44, r: 16, t: 14, b: 22 }

function Grid({ w, h, scale }: { w: number; h: number; scale: { top: number; ticks: number[] } }) {
  const y = (v: number) => PAD.t + (h - PAD.t - PAD.b) * (1 - v / scale.top)
  return (
    <>
      {scale.ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? "stroke-line-strong" : "stroke-line"} />
          <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" className="fill-muted-foreground text-2xs tabular-nums">
            {short(v)}
          </text>
        </g>
      ))}
    </>
  )
}

/** Labels along the bottom, as many as fit without touching. */
const everyFor = (n: number, w: number, minGap: number) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - PAD.l - PAD.r) / minGap))))

export type Point = { key: string; label: string; value: number; title: string; body: string }

/** One series over time, a line over a soft fill, with a crosshair. */
export function AreaChart({ points, label, color = BLUE }: { points: Point[]; label: string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <Plot label={label}>
      {(w, h, setTip) => {
        if (points.length < 2) return null
        const scale = niceScale(Math.max(...points.map((p) => p.value)))
        const top = scale.top
        const x = (i: number) => PAD.l + ((w - PAD.l - PAD.r) * i) / (points.length - 1)
        const y = (v: number) => PAD.t + (h - PAD.t - PAD.b) * (1 - v / top)
        const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ")
        const every = everyFor(points.length, w, 72)
        const gid = `fill-${label.replace(/\W/g, "")}`
        return (
          <g
            onMouseMove={(e) => {
              const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.nativeEvent.offsetX - PAD.l) / (w - PAD.l - PAD.r)) * (points.length - 1))))
              setHover(i)
              setTip({ x: x(i), y: y(points[i].value), title: points[i].title, body: points[i].body })
            }}
            onMouseLeave={() => {
              setHover(null)
              setTip(null)
            }}
          >
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity={0.28} />
                <stop offset="1" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={w} height={h} fill="transparent" />
            <Grid w={w} h={h} scale={scale} />
            <path d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {points.map((p, i) =>
              i % every === 0 ? (
                <text key={p.key} x={x(i)} y={h - 5} textAnchor="middle" className="fill-muted-foreground text-2xs tabular-nums">
                  {p.label}
                </text>
              ) : null,
            )}
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={h - PAD.b} className="stroke-line-strong" />
                <circle cx={x(hover)} cy={y(points[hover].value)} r={4.5} fill={color} className="stroke-background" strokeWidth={2} />
              </>
            )}
          </g>
        )
      }}
    </Plot>
  )
}

export type Bar = { key: string; label: string; a: number; b?: number; title: string; body: string }

/** Columns over time; with `b`, a second series stacked on the first, 2px of
 *  surface between them. Only the top of a column is rounded. */
export function Columns({ bars, label, colors = [BLUE, ORANGE] }: { bars: Bar[]; label: string; colors?: [string, string] }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <Plot label={label}>
      {(w, h, setTip) => {
        const scale = niceScale(Math.max(...bars.map((b) => b.a + (b.b ?? 0))))
        const top = scale.top
        const slot = (w - PAD.l - PAD.r) / Math.max(1, bars.length)
        const colW = Math.max(3, Math.min(28, slot * 0.62))
        const y = (v: number) => PAD.t + (h - PAD.t - PAD.b) * (1 - v / top)
        const every = everyFor(bars.length, w, 56)
        const seg = (x: number, y0: number, y1: number, round: boolean) => {
          const hgt = Math.max(0, y0 - y1)
          const r = round ? Math.min(4, colW / 2, hgt) : 0
          return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + colW - r} Q${x + colW},${y1} ${x + colW},${y1 + r} V${y0} Z`
        }
        return (
          <>
            <Grid w={w} h={h} scale={scale} />
            {bars.map((b, i) => {
              const x = PAD.l + i * slot + (slot - colW) / 2
              const yA = y(b.a)
              const yB = y(b.a + (b.b ?? 0))
              const dim = hover !== null && hover !== b.key ? 0.45 : 1
              return (
                <g
                  key={b.key}
                  onMouseEnter={() => {
                    setHover(b.key)
                    setTip({ x: x + colW / 2, y: yB, title: b.title, body: b.body })
                  }}
                  onMouseLeave={() => {
                    setHover(null)
                    setTip(null)
                  }}
                >
                  <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h - PAD.t - PAD.b} fill="transparent" />
                  {b.a > 0 && <path d={seg(x, y(0), yA, !b.b)} fill={colors[0]} opacity={dim} />}
                  {!!b.b && <path d={seg(x, b.a > 0 ? yA - 2 : y(0), yB, true)} fill={colors[1]} opacity={dim} />}
                  {i % every === 0 && (
                    <text x={x + colW / 2} y={h - 5} textAnchor="middle" className="fill-muted-foreground text-2xs tabular-nums">
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}
          </>
        )
      }}
    </Plot>
  )
}

export type ListRow = { key: string; label: React.ReactNode; title?: string; a: number; b?: number; note?: string; value: string }

/** Ranked rows with a data bar each, scrolling inside the card with a fading
 *  edge while there are more. With `b`, the bar is two segments. */
export function BarList({ rows, colors = [BLUE, ORANGE], rank = true }: { rows: ListRow[]; colors?: [string, string]; rank?: boolean }) {
  const [ref, more] = useScrollFade<HTMLDivElement>()
  const top = Math.max(1, ...rows.map((r) => r.a + (r.b ?? 0)))
  return (
    <div ref={ref} className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-3", more && SCROLL_FADE)}>
      <ol className="flex flex-col gap-2.5 pt-1">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              {rank && <span className="w-4 shrink-0 text-2xs text-muted-foreground tabular-nums">{i + 1}</span>}
              <span className="min-w-0 flex-1 truncate text-foreground">{r.label}</span>
              {r.note && <span className="shrink-0 text-2xs text-muted-foreground">{r.note}</span>}
              <span className="w-12 shrink-0 text-right font-medium text-foreground tabular-nums">{r.value}</span>
            </div>
            <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", rank && "ml-6")}>
              <div className="h-full" style={{ width: `${(r.a / top) * 100}%`, backgroundColor: colors[0] }} />
              {!!r.b && <div className="h-full border-l-2 border-surface" style={{ width: `${(r.b / top) * 100}%`, backgroundColor: colors[1] }} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Table ──

export type Column<T> = {
  key: string
  header: string
  /** Fixed width class for a number column; the first column takes the rest. */
  width?: string
  /** Value to sort by; absent means the column does not sort. */
  sort?: (row: T) => number
  cell: (row: T) => React.ReactNode
}

/**
 * Rows filtered by a search and sorted by any number column (first click sorts
 * descending: for counts, "most" is the question). Scrolls inside its card with
 * its header pinned. `head` sits left of the search box: tabs, say.
 */
export function SmartTable<T>({
  rows,
  columns,
  rowKey,
  text,
  initialSort,
  placeholder,
  head,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** What the search box matches against. */
  text: (row: T) => string
  initialSort: string
  placeholder: string
  head?: React.ReactNode
}) {
  const [q, setQ] = useState("")
  const [sort, setSort] = useState({ key: initialSort, desc: true })
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    const out = needle ? rows.filter((r) => text(r).toLowerCase().includes(needle)) : [...rows]
    if (col?.sort) out.sort((a, b) => (sort.desc ? col.sort!(b) - col.sort!(a) : col.sort!(a) - col.sort!(b)))
    return out
  }, [rows, columns, sort, needle, text])

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-1 pb-3">
        {head}
        <div className="relative ml-auto w-44">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-7 pl-7 text-xs" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-line">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} className={c.width} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} className={cn("sticky top-0 z-[1] bg-surface-raised px-3 py-2 text-2xs font-medium text-muted-foreground", i > 0 ? "text-right" : "text-left")}>
                  {c.sort ? (
                    <Button
                      variant="bare"
                      onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}
                      className={cn("inline-flex items-center gap-0.5 hover:text-foreground", sort.key === c.key && "text-foreground")}
                    >
                      {c.header}
                      {sort.key === c.key && (sort.desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
                    </Button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} className="border-t border-line transition-colors hover:bg-muted">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2", i > 0 && "text-right tabular-nums")}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Two or three choices as one segmented control. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <div className="flex rounded-chip bg-muted p-0.5">
      {options.map((o) => (
        <Button
          key={o.key}
          variant="bare"
          onClick={() => onChange(o.key)}
          className={cn("rounded-chip px-2.5 py-1 text-2xs font-medium transition-colors", value === o.key ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}
