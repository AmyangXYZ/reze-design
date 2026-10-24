import "server-only"
import { unstable_cache } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { hasDatabase, schema } from "@/lib/db"
import { STOCK_OWNED, presetRows } from "@/lib/library-rows"
import { LIBRARY_TAG } from "@/lib/public-pages"
import type { LibraryItem } from "@/lib/library"
import { sceneRefs, type SceneDoc } from "@/lib/scene"

/**
 * The stock: every public, undeleted grade, graph and effect the stock
 * account (lib/admin STOCK_EMAIL) owns. Cached until a write marks the
 * library stale (lib/public-pages), so the editor's boot never wakes the
 * database. Empty with no database: a clone boots on the engine's neutral look.
 */
export const stockRows = unstable_cache(
  async (): Promise<LibraryItem[]> => {
    if (!hasDatabase) return []
    const rows = await presetRows(
      and(eq(schema.libraryItems.visibility, "public"), isNull(schema.libraryItems.deletedAt), STOCK_OWNED),
    )
    // Oldest first: the order they were made in is the shelf's order.
    return rows.reverse().map((r) => ({ ...r, owner: "stock" as const }))
  },
  ["stock"],
  { tags: [LIBRARY_TAG] },
)


/**
 * The stock a document names: by pin, or by name where it holds a string
 * (a group's `graph`, an effect's `source`, the grade's `preset`). What a scene
 * page sends with its document, so the viewer parses it in its first render
 * without the whole shelf.
 */
export async function stockRowsFor(doc: SceneDoc): Promise<LibraryItem[]> {
  const ids = new Set(sceneRefs(doc).map((r) => r.id))
  const names = new Set<string>()
  const walk = (v: unknown, key?: string) => {
    if (typeof v === "string") {
      if (key === "graph" || key === "source" || key === "preset") names.add(v)
    } else if (Array.isArray(v)) for (const x of v) walk(x)
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(doc)
  return (await stockRows()).filter((r) => ids.has(r.id) || names.has(r.name))
}
