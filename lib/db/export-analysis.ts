import "server-only"

// The public read of export_stats — everything /analysis puts on screen.
//
// Kept here rather than in the page because these are the queries that decide
// what the numbers MEAN, and two of them carry rules that are not obvious from
// the shapes they return.

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { sceneUsage } from "@/lib/db/stats"
import type { LibraryKind } from "@/lib/library"

/**
 * How many exports a model has to appear in before it is named on a public page.
 *
 * A name seen ONCE is one person's unusual model, published. Five is where a name
 * stops describing somebody and starts describing a habit — and a name below it
 * was never going to tell us anything anyway, so nothing analytical is lost by
 * folding it into a total.
 */
const MIN_MODEL_COUNT = 5

export type Slice = { label: string; n: number }
export type ItemRank = { id: string; name: string; kind: LibraryKind; exports: number; scenes: number }

export type ExportAnalysis = {
  total: number
  /** Distinct model names seen, including the ones too rare to name. */
  modelsSeen: number
  aspect: Slice[]
  quality: Slice[]
  look: Slice[]
  models: Slice[]
  /** Exports whose models were each too rare to name, as one figure. */
  modelsOther: number
  items: ItemRank[]
}

const EMPTY: ExportAnalysis = {
  total: 0,
  modelsSeen: 0,
  aspect: [],
  quality: [],
  look: [],
  models: [],
  modelsOther: 0,
  items: [],
}

/** count(*) by one column, biggest first — the shape every split on the page has. */
async function splitBy(column: "aspect" | "quality" | "look"): Promise<Slice[]> {
  const col = schema.exportStats[column]
  const rows = await db
    .select({ label: col, n: sql<number>`count(*)::int` })
    .from(schema.exportStats)
    .groupBy(col)
    .orderBy(desc(sql`count(*)`))
  return rows.map((r) => ({ label: r.label, n: r.n }))
}

export async function exportAnalysis(): Promise<ExportAnalysis> {
  const [[totals], aspect, quality, look, modelRows, modelTotals, ranked, usage] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.exportStats),
    splitBy("aspect"),
    splitBy("quality"),
    splitBy("look"),
    // One row per model NAME across every export's array. `unnest` is why this is
    // raw SQL — the count is of appearances, so a scene with two characters
    // contributes to both, which is the number "how many exports had this model
    // in them" actually wants.
    db.execute<{ label: string; n: number }>(sql`
      select m as label, count(*)::int as n
      from ${schema.exportStats}, unnest(models) as m
      group by m
      having count(*) >= ${MIN_MODEL_COUNT}
      order by n desc, m asc
      limit 24
    `),
    db.execute<{ seen: number; rare: number }>(sql`
      select
        count(distinct m)::int as seen,
        count(*) filter (where cnt < ${MIN_MODEL_COUNT})::int as rare
      from (
        select m, count(*) over (partition by m) as cnt
        from ${schema.exportStats}, unnest(models) as m
      ) t(m, cnt)
    `),
    // The counter on the item, not a scan of export_stats — it is already the
    // aggregate, and it survives the raw rows expiring.
    db
      .select({
        id: schema.libraryItems.id,
        name: schema.libraryItems.name,
        kind: schema.libraryItems.kind,
        exports: schema.libraryItems.exportCount,
      })
      .from(schema.libraryItems)
      .where(
        and(
          eq(schema.libraryItems.visibility, "public"),
          isNull(schema.libraryItems.deletedAt),
          gt(schema.libraryItems.exportCount, 0),
        ),
      )
      .orderBy(desc(schema.libraryItems.exportCount))
      .limit(60),
    // Scenes counted from scene_uses rather than the item's usage_count, so a
    // taken-down scene stops counting. The gap between this and `exports` is the
    // number the whole feature exists to show.
    sceneUsage(),
  ])

  const counted = modelTotals.rows[0]

  return {
    total: totals?.n ?? 0,
    modelsSeen: Number(counted?.seen ?? 0),
    aspect,
    quality,
    look,
    models: modelRows.rows.map((r) => ({ label: r.label, n: Number(r.n) })),
    modelsOther: Number(counted?.rare ?? 0),
    items: ranked.map((r) => ({ ...r, scenes: usage.get(r.id) ?? 0 })),
  }
}

export { EMPTY as EMPTY_ANALYSIS, MIN_MODEL_COUNT }
