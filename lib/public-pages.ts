import "server-only"

// Every maker's page is cached for all visitors and rebuilt at most hourly, so the
// database can sleep between visits. What a page shows changes only through the
// routes that write it, and each of those marks the page stale here: the next
// visit rebuilds it.

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

/** Mark the makers' pages at these handles stale. */
export function refreshMakerPages(...handles: (string | null | undefined)[]) {
  for (const handle of new Set(handles)) if (handle) revalidatePath(`/${handle}`)
}

/** The handle a user's page lives at. */
export async function handleOf(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ handle: user.username }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.handle ?? null
}
