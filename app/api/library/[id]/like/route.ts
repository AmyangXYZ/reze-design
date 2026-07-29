// Liking a published item.
//
// Public in effect — anyone signed in can like anything visible — because a
// sharing platform's whole feedback loop is people seeing that others valued
// their work. The count lives on the item so reads never join.

import { NextResponse } from "next/server"
import { and, eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "sign in to like" }, { status: 401 })
  if (session.user.banned) return NextResponse.json({ error: "account suspended" }, { status: 403 })

  const { id } = await ctx.params
  const [item] = await db
    .select({ visibility: schema.libraryItems.visibility })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  // Private items aren't likeable, and saying "not found" avoids confirming they exist.
  if (!item || item.visibility === "private") return NextResponse.json({ error: "not found" }, { status: 404 })

  // One transaction so the row and the cached count can't disagree. Toggling:
  // a second call removes the like, which is what a heart button means.
  const liked = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ userId: schema.likes.userId })
      .from(schema.likes)
      .where(and(eq(schema.likes.userId, session.user.id), eq(schema.likes.itemId, id)))
      .limit(1)

    if (existing.length > 0) {
      await tx
        .delete(schema.likes)
        .where(and(eq(schema.likes.userId, session.user.id), eq(schema.likes.itemId, id)))
      await tx
        .update(schema.libraryItems)
        // GREATEST guards against a negative count if rows ever get out of step.
        .set({ likeCount: sql`greatest(${schema.libraryItems.likeCount} - 1, 0)` })
        .where(eq(schema.libraryItems.id, id))
      return false
    }

    await tx.insert(schema.likes).values({ userId: session.user.id, itemId: id })
    await tx
      .update(schema.libraryItems)
      .set({ likeCount: sql`${schema.libraryItems.likeCount} + 1` })
      .where(eq(schema.libraryItems.id, id))
    return true
  })

  const [row] = await db
    .select({ likeCount: schema.libraryItems.likeCount })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  return NextResponse.json({ liked, likeCount: row?.likeCount ?? 0 })
}
