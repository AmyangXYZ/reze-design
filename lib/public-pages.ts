import "server-only"

// What every visitor sees the same is cached, so the database sleeps between
// visits and wakes only for someone signed in. Two layers:
//
// - Maker pages are whole cached pages, rebuilt at most hourly.
// - The shared library reads — the preset list, stats, the gallery, scene pages,
//   resolved pins — are cached query results under the tags below, kept until a
//   write marks them stale.
//
// What these show changes only through the routes that write it, and each of
// those marks what it touched stale here: the next visit rebuilds it. Expired at
// once rather than served stale, so a publish shows on the very next load.

import { revalidatePath, revalidateTag } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

/** The shared lists and counts: the preset list, stats, the gallery and its counts. */
export const LIBRARY_TAG = "library"
/** Every item's own cached row at once. */
export const ITEMS_TAG = "items"
/** One item's cached row: its scene page, its resolved payload. */
export const itemTag = (id: string) => `item:${id}`

const NOW = { expire: 0 }

/** Mark the makers' pages at these handles stale. */
export function refreshMakerPages(...handles: (string | null | undefined)[]) {
  for (const handle of new Set(handles)) if (handle) revalidatePath(`/${handle}`)
}

/** Mark the shared lists stale, and the rows of the items a write touched. */
export function refreshLibrary(...ids: string[]) {
  revalidateTag(LIBRARY_TAG, NOW)
  for (const id of new Set(ids)) revalidateTag(itemTag(id), NOW)
}

/** Mark the shared lists and every item's row stale — for a write that rewrites
 *  all of one maker's items at once (a rename carries the author onto each). */
export function refreshEveryItem() {
  revalidateTag(LIBRARY_TAG, NOW)
  revalidateTag(ITEMS_TAG, NOW)
}

/** The handle a user's page lives at. */
export async function handleOf(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ handle: user.username }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.handle ?? null
}
