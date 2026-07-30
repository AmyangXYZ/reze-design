// Removing a published item — by its owner, or by an admin. Moderation IS
// deletion: published means public until someone removes it, so there is no
// visibility state machine to shepherd. Both checks happen here because the
// admin page is only a convenience — the API is the boundary.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { requireAdmin } from "@/lib/admin"
import { db, schema } from "@/lib/db"
/** The item id if this request may act on it, otherwise null. */
async function authorize(request: Request, id: string) {
  if (await requireAdmin(request.headers)) return { id, admin: true as const }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const [row] = await db
    .select({ ownerId: schema.libraryItems.ownerId })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  if (!row || row.ownerId !== session.user.id) return null
  return { id, admin: false as const }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ok = await authorize(request, id)
  // 404 rather than 403: a stranger probing ids learns nothing about what exists.
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 })
  await db.delete(schema.libraryItems).where(eq(schema.libraryItems.id, id))
  return NextResponse.json({ deleted: id })
}
