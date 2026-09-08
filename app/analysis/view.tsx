"use client"

// The presentation half of /analysis.
//
// Client for two reasons: the locale lives in localStorage, which no server
// render can see, and the source switch is a lens over data already in hand
// rather than a new question — every source arrives in one payload, so choosing
// between them costs nothing and never blanks the page.
//
// One accent, and it carries magnitude only. Every panel is a ranked list whose
// bars mean "more", never "which", so there is no categorical palette here and
// nothing that needs a second hue to be read correctly.

import { useState } from "react"
import Link from "next/link"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n"
import type { ExportAnalysis, ItemRank, Slice } from "@/lib/db/export-analysis"

type Source = "all" | "scenes" | "exports"
const SOURCES: Source[] = ["all", "scenes", "exports"]

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-interior border border-line bg-surface-raised p-3">
      <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-mono text-xl text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div>
    </div>
  )
}

/** 4px track, rounded ends anchored at the left baseline — a bar this thin reads
 *  as a measure rather than as a block of colour. Widths are shares of the
 *  LARGEST row: against a total, every row of a long tail is a stub of the same
 *  indistinguishable length. */
function Bar({ value, top }: { value: number; top: number }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-blue-400"
        style={{ width: `${top > 0 ? Math.max(2, (value / top) * 100) : 0}%` }}
      />
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
 * The models list, given the whole width and a position on every row.
 *
 * The question this page was built to answer is which games' models people
 * actually bring, and a panel sharing a 2-up grid with "Aspect ratio" answers it
 * in the same breath as a detail. Numbering it says it is a ranking rather than a
 * breakdown, and two columns keep a long tail readable.
 *
 * A raw count, never a share: one export carries a whole cast, so a percentage of
 * exports would be a percentage of nothing.
 */
function ModelRanks({ title, rows, empty }: { title: string; rows: Slice[]; empty: string }) {
  const top = rows[0]?.n ?? 0
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-3 gap-x-8 sm:columns-2">
          {rows.map((r, i) => (
            <li key={r.label} className="mb-2 break-inside-avoid">
              <div className="flex items-baseline gap-2.5">
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{modelName(r.label)}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{r.n}</span>
              </div>
              {/* Indented to the name, so the bars line up as one column to
                  compare down rather than starting under the rank numbers. */}
              <div className="pl-[30px]">
                <Bar value={r.n} top={top} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function Bars({ title, rows, total, empty }: { title: string; rows: Slice[]; total: number; empty: string }) {
  const top = rows[0]?.n ?? 0
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-foreground">{r.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {total > 0 ? Math.round((r.n / total) * 100) : 0}% · {r.n}
                </span>
              </div>
              <Bar value={r.n} top={top} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Ranked by whichever source is selected, and labelled with the count that did
 *  the ranking — so the number beside a row is always the one it was sorted on. */
function Ranked({
  title,
  rows,
  empty,
  count,
  label,
}: {
  title: string
  rows: ItemRank[]
  empty: string
  count: (r: ItemRank) => number
  label: (r: ItemRank) => string
}) {
  const ordered = rows.filter((r) => count(r) > 0).sort((a, b) => count(b) - count(a))
  const top = ordered[0] ? count(ordered[0]) : 0
  return (
    <Panel title={title}>
      {ordered.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {ordered.slice(0, 8).map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-foreground">{r.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{label(r)}</span>
              </div>
              <Bar value={count(r)} top={top} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const RANKED_KINDS = ["graph", "effect", "grade"] as const

/** Two lists of names into one, summed. The combined view only — a single-source
 *  view shows its own list untouched. */
function mergeModels(a: Slice[], b: Slice[]): Slice[] {
  const totals = new Map<string, number>()
  for (const s of [...a, ...b]) totals.set(s.label, (totals.get(s.label) ?? 0) + s.n)
  return [...totals]
    .map(([label, n]) => ({ label, n }))
    .sort((x, y) => y.n - x.n || x.label.localeCompare(y.label))
    .slice(0, 50)
}

export function AnalysisView({ data }: { data: ExportAnalysis }) {
  const t = useT()
  const [source, setSource] = useState<Source>("all")

  const models =
    source === "exports"
      ? data.exportModels
      : source === "scenes"
        ? data.sceneModels
        : mergeModels(data.exportModels, data.sceneModels)

  // Aspect, resolution and style exist only in an export. A published scene
  // records no render size and no look pack, so the scenes view drops the row
  // rather than showing three panels of somebody else's numbers.
  const showRenderSplits = source !== "scenes"

  const count = (r: ItemRank) =>
    source === "exports" ? r.exports : source === "scenes" ? r.scenes : r.exports + r.scenes
  const label = (r: ItemRank) =>
    source === "exports"
      ? String(r.exports)
      : source === "scenes"
        ? String(r.scenes)
        : `${r.exports} · ${t.analysis.scenes(r.scenes)}`

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

        {/* One row, above everything it changes. It reorders and reveals; it
            never refetches. */}
        <Tabs value={source} onValueChange={(v) => setSource(v as Source)} className="mt-6">
          <TabsList>
            {SOURCES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {t.analysis.sources[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {source !== "scenes" && (
            <Tile label={t.analysis.exports} value={data.exportTotal.toLocaleString()} note={t.analysis.exportsNote} />
          )}
          {source !== "exports" && (
            <Tile label={t.analysis.scenesTile} value={data.sceneTotal.toLocaleString()} note={t.analysis.scenesNote} />
          )}
          <Tile label={t.analysis.models} value={models.length.toLocaleString()} note={t.analysis.modelsNote} />
          <Tile
            label={t.analysis.presets}
            value={data.items.filter((r) => count(r) > 0).length.toLocaleString()}
            note={t.analysis.presetsNote}
          />
        </section>

        <div className="mt-4">
          <ModelRanks title={t.analysis.models} rows={models} empty={t.analysis.empty} />
        </div>

        {showRenderSplits && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Bars title={t.analysis.aspect} rows={data.aspect} total={data.exportTotal} empty={t.analysis.empty} />
              <Bars
                title={t.analysis.resolution}
                rows={data.quality}
                total={data.exportTotal}
                empty={t.analysis.empty}
              />
              <Bars title={t.analysis.style} rows={data.look} total={data.exportTotal} empty={t.analysis.empty} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t.analysis.renderOnly}</p>
          </>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {RANKED_KINDS.map((kind) => (
            <Ranked
              key={kind}
              title={t.analysis.kinds[kind]}
              rows={data.items.filter((i) => i.kind === kind)}
              empty={t.analysis.emptyItems}
              count={count}
              label={label}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
