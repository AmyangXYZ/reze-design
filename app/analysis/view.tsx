"use client"

// The presentation half of /analysis.
//
// Client because the locale lives in localStorage, which no server render can
// see. Everything else here is static: one view, no modes, nothing to switch.
//
// Two series, one bar. A row's length is what it adds up to and its two segments
// are where that came from — exports on the left, published scenes on the right.
// This is the alternative to both mistakes: a single total hides the split, and a
// mode switch makes you hold one view in your head while looking at another.
// Stacking sums AND shows the composition, so the interesting case — used
// constantly, published rarely — is visible without asking for it.

import Link from "next/link"
import { useT } from "@/lib/i18n"
import type { ExportAnalysis, ItemRank, Slice } from "@/lib/db/export-analysis"

/**
 * The two series, and the only meaning colour carries on this page.
 *
 * Validated as a categorical pair against this page's near-black surface: every
 * gate passes with no warning — CVD separation ΔE 26.7 (protan), normal-vision
 * 35.2, both inside the dark lightness band and clear of 3:1 contrast. Red and
 * blue are about as far apart as two hues get for every kind of colour vision,
 * which is what a two-series stack wants.
 */
const SERIES = { exports: "#3b82f6", scenes: "#ef4444" } as const

/** One row's two parts. `b` is zero for the export-only splits, which then draw
 *  as a plain bar rather than a stack of one. */
type Stack = { key: string; label: string; a: number; b: number }

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-interior border border-line bg-surface-raised p-3">
      <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-mono text-xl text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div>
    </div>
  )
}

/**
 * The bar: total length against the largest row, split into its two sources.
 *
 * Against the TOP row rather than the total, because the question a reader has is
 * how a row compares to the leader — against a grand total every row of a long
 * tail is a stub of the same indistinguishable length.
 *
 * Only the OUTER ends are round. Two capsules with rounded inner edges read as
 * two bars that happen to be near each other; one capsule divided by a colour
 * change reads as a total made of two parts, which is what it is. The colour
 * boundary is enough to find — it does not need a gap to sit in.
 */
function StackBar({ a, b, top }: { a: number; b: number; top: number }) {
  const total = a + b
  const width = top > 0 ? Math.max(2, (total / top) * 100) : 0
  const both = a > 0 && b > 0
  return (
    <div className="mt-1 h-1.5 w-full">
      <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }}>
        {a > 0 && (
          <div
            className={`h-full ${both ? "rounded-l-full" : "rounded-full"}`}
            style={{ flex: a, backgroundColor: SERIES.exports }}
          />
        )}
        {b > 0 && (
          <div
            className={`h-full ${both ? "rounded-r-full" : "rounded-full"}`}
            style={{ flex: b, backgroundColor: SERIES.scenes }}
          />
        )}
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-surface border border-line-strong bg-surface p-4">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

/** What the file is called, without what kind of file it is. The row is a model's
 *  name to a reader; ".pmx" is the same four characters on every line and says
 *  nothing about which model this is. */
const modelName = (file: string) => file.replace(/\.(pmx|pmd|zip)$/i, "")

/**
 * One ranked list, whole — every row it has, never a preview.
 *
 * `rank` numbers the rows where position is the point (the models list, which is
 * the question this page was built to answer) and the two-column flow keeps a long
 * one readable. `share` prints each row against the total, which only means
 * something where a row IS a share of the whole: an export has one aspect ratio,
 * but it has a whole cast, so the models list shows counts alone.
 */
function Ranks({
  title,
  rows,
  empty,
  rank = false,
  columns = false,
  share,
}: {
  title: string
  rows: Stack[]
  empty: string
  rank?: boolean
  columns?: boolean
  share?: number
}) {
  const ordered = [...rows].sort((x, y) => y.a + y.b - (x.a + x.b))
  const top = ordered[0] ? ordered[0].a + ordered[0].b : 0
  return (
    <Panel title={title}>
      {ordered.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className={`mt-3 ${columns ? "gap-x-8 sm:columns-2" : ""}`}>
          {ordered.map((r, i) => (
            <li key={r.key} className="mb-2 break-inside-avoid last:mb-0">
              <div className="flex items-baseline gap-2.5">
                {rank && (
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{r.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {share ? `${Math.round((r.a / share) * 100)}% · ${r.a}` : r.b > 0 ? `${r.a} · ${r.b}` : r.a}
                </span>
              </div>
              {/* Indented past the rank so the bars line up as one column to
                  compare down, rather than starting under the numbers. */}
              <div className={rank ? "pl-[30px]" : ""}>
                <StackBar a={r.a} b={r.b} top={top} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

const RANKED_KINDS = ["graph", "effect", "grade"] as const

/** A single-series row: the export-only splits, which have no scene half. */
const solo = (rows: Slice[]): Stack[] => rows.map((r) => ({ key: r.label, label: r.label, a: r.n, b: 0 }))

/** Model names from both sources into one row each, so a bar can show the split
 *  the same way the preset lists do. */
function stackModels(exports: Slice[], scenes: Slice[]): Stack[] {
  const rows = new Map<string, Stack>()
  const put = (s: Slice, key: "a" | "b") => {
    const cur = rows.get(s.label) ?? { key: s.label, label: modelName(s.label), a: 0, b: 0 }
    cur[key] += s.n
    rows.set(s.label, cur)
  }
  for (const s of exports) put(s, "a")
  for (const s of scenes) put(s, "b")
  return [...rows.values()]
}

const itemStack = (r: ItemRank): Stack => ({ key: r.id, label: r.name, a: r.exports, b: r.scenes })

function Legend({ exports, scenes }: { exports: string; scenes: string }) {
  return (
    <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
      {[
        [SERIES.exports, exports],
        [SERIES.scenes, scenes],
      ].map(([color, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

export function AnalysisView({ data }: { data: ExportAnalysis }) {
  const t = useT()
  const models = stackModels(data.exportModels, data.sceneModels)

  return (
    <main className="w-full flex-1 bg-black px-6 py-12 text-sm sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-lg font-semibold">{t.analysis.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t.analysis.intro}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            {t.render.shareStatsLink}
          </Link>
          .
        </p>
        <Legend exports={t.analysis.exports} scenes={t.analysis.scenesTile} />

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t.analysis.exports} value={data.exportTotal.toLocaleString()} note={t.analysis.exportsNote} />
          <Tile label={t.analysis.scenesTile} value={data.sceneTotal.toLocaleString()} note={t.analysis.scenesNote} />
          <Tile label={t.analysis.models} value={models.length.toLocaleString()} note={t.analysis.modelsNote} />
          <Tile
            label={t.analysis.presets}
            value={data.items.length.toLocaleString()}
            note={t.analysis.presetsNote}
          />
        </section>

        <div className="mt-4">
          <Ranks title={t.analysis.models} rows={models} empty={t.analysis.empty} rank columns />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Ranks title={t.analysis.aspect} rows={solo(data.aspect)} empty={t.analysis.empty} share={data.exportTotal} />
          <Ranks
            title={t.analysis.resolution}
            rows={solo(data.quality)}
            empty={t.analysis.empty}
            share={data.exportTotal}
          />
          <Ranks title={t.analysis.style} rows={solo(data.look)} empty={t.analysis.empty} share={data.exportTotal} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t.analysis.renderOnly}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {RANKED_KINDS.map((kind) => (
            <Ranks
              key={kind}
              title={t.analysis.kinds[kind]}
              rows={data.items.filter((i) => i.kind === kind).map(itemStack)}
              empty={t.analysis.emptyItems}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
