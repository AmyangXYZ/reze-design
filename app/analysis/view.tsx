"use client"

// The presentation half of /analysis.
//
// Client, only so the page speaks the language the rest of the app does — the
// locale lives in localStorage and `navigator`, which no server render can see.
// The numbers still arrive prerendered from the server component; what hydration
// changes is the words around them.
//
// One accent, and it carries magnitude only. Every panel is a ranked list whose
// bars mean "more", never "which" — so there is no categorical palette here and
// nothing that needs a second hue to be read correctly.

import Link from "next/link"
import { useT } from "@/lib/i18n"
import type { ExportAnalysis, ItemRank, Slice } from "@/lib/db/export-analysis"

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
 *  indistinguishable length. The percentage beside it is of the total, so the
 *  honest figure is on screen either way. */
function Bar({ value, top }: { value: number; top: number }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-blue-400" style={{ width: `${top > 0 ? Math.max(2, (value / top) * 100) : 0}%` }} />
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

/** Two counts per row, never one: an item finished in many videos but published in
 *  few scenes is used constantly and shared elsewhere, which is the comparison
 *  this whole page exists to make visible. */
function Ranked({ title, rows, empty, scenes }: { title: string; rows: ItemRank[]; empty: string; scenes: (n: number) => string }) {
  const top = rows[0]?.exports ?? 0
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-foreground">{r.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {r.exports} · {scenes(r.scenes)}
                </span>
              </div>
              <Bar value={r.exports} top={top} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const RANKED_KINDS = ["graph", "effect", "grade"] as const

export function AnalysisView({ data, minModelCount }: { data: ExportAnalysis; minModelCount: number }) {
  const t = useT()
  const a = data
  const models = a.modelsOther > 0 ? [...a.models, { label: t.analysis.otherModels, n: a.modelsOther }] : a.models

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

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label={t.analysis.exports} value={a.total.toLocaleString()} note={t.analysis.exportsNote} />
          <Tile label={t.analysis.models} value={a.modelsSeen.toLocaleString()} note={t.analysis.modelsNote} />
          <Tile label={t.analysis.presets} value={a.items.length.toLocaleString()} note={t.analysis.presetsNote} />
        </section>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Bars title={t.analysis.aspect} rows={a.aspect} total={a.total} empty={t.analysis.empty} />
          <Bars title={t.analysis.resolution} rows={a.quality} total={a.total} empty={t.analysis.empty} />
          <Bars title={t.analysis.style} rows={a.look} total={a.total} empty={t.analysis.empty} />
          <Bars title={t.analysis.models} rows={models} total={a.total} empty={t.analysis.empty} />
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">{t.analysis.modelNote(minModelCount)}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {RANKED_KINDS.map((kind) => (
            <Ranked
              key={kind}
              title={t.analysis.kinds[kind]}
              rows={a.items.filter((i) => i.kind === kind).slice(0, 8)}
              empty={t.analysis.emptyItems}
              scenes={t.analysis.scenes}
            />
          ))}
        </div>

      </div>
    </main>
  )
}
