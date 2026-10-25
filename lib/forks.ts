import "server-only"
import { sql } from "drizzle-orm"
import { schema } from "@/lib/db"

// A scene's FORKS: other people's published scenes made from it. Counted only
// when published (opening one in the editor is not a fork — anyone can click
// that, and counting clicks would mean a write per visitor), only where anyone
// can see them, and never the author's own: republishing your own scene is an
// edit, not someone building on it.

/** The forks of the outer row, as a FROM clause aliased `f`. */
export const forkScenes = sql`library_items f
  where f.forked_from_id = ${schema.libraryItems.id}
    and f.kind = 'scene' and f.visibility = 'public' and f.deleted_at is null
    and f.owner_id is distinct from ${schema.libraryItems.ownerId}`

/** How many there are, as a column. */
export const forkCount = () => sql<number>`(select count(*)::int from ${forkScenes})`
