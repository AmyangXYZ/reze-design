import "server-only"

// Everything /analysis puts on screen, from both places the work shows up.
//
// Two sources answer the same questions differently. export_stats is what people
// RENDERED, shared voluntarily, one row per finished video — the majority path,
// and a sample. Published scenes are what people PUT HERE, complete, no opt-in
// involved — a census of a smaller thing. Neither is the truth on its own, which
// is why the page lets a reader pick.
//
// Kept out of the page because these are the queries that decide what the
// numbers MEAN, and several carry rules the shapes do not show.

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { sceneUsage } from "@/lib/db/stats"
import type { LibraryKind } from "@/lib/library"

export type Slice = { label: string; n: number }
export type ItemRank = { id: string; name: string; kind: LibraryKind; exports: number; scenes: number }

export type ExportAnalysis = {
  /** Rows in export_stats — one per shared finished video. */
  exportTotal: number
  /** Public, undeleted published scenes. */
  sceneTotal: number
  /**
   * Aspect, resolution and rendering style are EXPORT-ONLY, and structurally so:
   * a scene document holds no render size, and the look pack is a browser
   * preference that never enters it. There is no scene-side number to show
   * beside these, which is why the source switch hides them rather than
   * pretending a published scene has an aspect ratio.
   */
  aspect: Slice[]
  quality: Slice[]
  look: Slice[]
  /** Model names by source, already reduced to basenames — one model reached by
   *  two different paths is one row. */
  exportModels: Slice[]
  sceneModels: Slice[]
  /** Every item that reached either, carrying both counts so the switch is a
   *  choice of which to read rather than a second query. */
  items: ItemRank[]
}

const EMPTY: ExportAnalysis = {
  exportTotal: 0,
  sceneTotal: 0,
  aspect: [],
  quality: [],
  look: [],
  exportModels: [],
  sceneModels: [],
  items: [],
}

/**
 * The file's name without the folders that led to it.
 *
 * Aggregating on this rather than in SQL is load-bearing, not tidying: the demo
 * model is reached as `https://assets.reze.one/demo/reze/reze.pmx` from one scene
 * and `models/reze/reze.pmx` from another, and grouping by path would rank the
 * same model twice at half its real weight.
 */
function byBasename(paths: { path: string; n: number }[]): Slice[] {
  const totals = new Map<string, number>()
  for (const { path, n } of paths) {
    const clean = path.split(/[?#]/)[0]
    const last = clean.split("/").pop() ?? clean
    let label = last
    try {
      label = decodeURIComponent(last)
    } catch {
      // A name that is not valid percent-encoding is already a name.
    }
    totals.set(label, (totals.get(label) ?? 0) + n)
  }
  return [...totals]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, 50)
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
  const [[exports], [scenes], aspect, quality, look, exportModelRows, sceneModelRows, items, usage] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(schema.exportStats),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.libraryItems)
        .where(
          and(
            eq(schema.libraryItems.kind, "scene"),
            eq(schema.libraryItems.visibility, "public"),
            isNull(schema.libraryItems.deletedAt),
          ),
        ),
      splitBy("aspect"),
      splitBy("quality"),
      splitBy("look"),
      // `unnest` is why this is raw SQL: the count is of APPEARANCES, so a scene
      // with two characters contributes to both — which is what "how many exports
      // had this model in them" actually asks.
      db.execute<{ path: string; n: number }>(sql`
        select m as path, count(*)::int as n
        from ${schema.exportStats}, unnest(models) as m
        group by m
      `),
      // The same question of published scenes, read out of the document each one
      // stored. No opt-in involved — a published scene is public by definition,
      // and this is the only figure on the page that is a census rather than a
      // sample.
      db.execute<{ path: string; n: number }>(sql`
        select md->>'model' as path, count(*)::int as n
        from ${schema.libraryItems} li,
             jsonb_array_elements(li.payload->'doc'->'assets'->'models') as md
        where li.kind = 'scene'
          and li.visibility = 'public'
          and li.deleted_at is null
          and md->>'model' is not null
        group by 1
      `),
      // Every public item, not only the ones with exports — the scene view needs
      // the ones a published scene uses and no finished video has reached yet.
      db
        .select({
          id: schema.libraryItems.id,
          name: schema.libraryItems.name,
          kind: schema.libraryItems.kind,
          exports: schema.libraryItems.exportCount,
        })
        .from(schema.libraryItems)
        .where(and(eq(schema.libraryItems.visibility, "public"), isNull(schema.libraryItems.deletedAt))),
      // Counted from scene_uses rather than the item's usage_count, which is
      // incremented at publish and never decremented — this is what stays true
      // after a scene is taken down.
      sceneUsage(),
    ])

  return {
    exportTotal: exports?.n ?? 0,
    sceneTotal: scenes?.n ?? 0,
    aspect,
    quality,
    look,
    exportModels: byBasename(exportModelRows.rows.map((r) => ({ path: r.path, n: Number(r.n) }))),
    sceneModels: byBasename(sceneModelRows.rows.map((r) => ({ path: r.path, n: Number(r.n) }))),
    items: items
      .map((r) => ({ ...r, scenes: usage.get(r.id) ?? 0 }))
      .filter((r) => r.exports > 0 || r.scenes > 0),
  }
}

export { EMPTY as EMPTY_ANALYSIS }
