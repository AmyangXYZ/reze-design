// Account moderation. Admin only — there is no owner path here, because nobody
// should be able to ban or delete themselves by accident.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { libraryItems } from "@/lib/db/schema"
import { isTaken, normalize, validate } from "@/lib/username"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request.headers)
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 })
  const { id } = await ctx.params

  const { banned, reason, username } = ((await request.json().catch(() => ({}))) ?? {}) as {
    banned?: unknown
    reason?: unknown
    username?: unknown
  }

  // ── Rename ─────────────────────────────────────────────────────────────────
  // Safe because nothing durable is keyed by the handle: user.id is the identity,
  // and a share URL resolves by scene id (the handle segment is decoration, so old
  // links survive). The one thing that must move with it is the denormalised
  // author on everything they published — same transaction, or the two disagree.
  if (typeof username === "string") {
    const wanted = normalize(username)
    const shapeError = validate(wanted)
    if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 })
    if (await isTaken(wanted, id)) return NextResponse.json({ error: "taken" }, { status: 409 })
    try {
      await db.transaction(async (tx) => {
        await tx.update(user).set({ username: wanted, usernameChangedAt: new Date() }).where(eq(user.id, id))
        await tx.update(libraryItems).set({ author: wanted }).where(eq(libraryItems.ownerId, id))
      })
    } catch {
      return NextResponse.json({ error: "taken" }, { status: 409 })
    }
    return NextResponse.json({ id, username: wanted })
  }

  // Renaming yourself is fine; banning yourself is not.
  if (id === admin.user.id) return NextResponse.json({ error: "cannot ban yourself" }, { status: 400 })
  if (typeof banned !== "boolean") return NextResponse.json({ error: "invalid" }, { status: 400 })

  await db
    .update(user)
    .set({
      banned,
      bannedAt: banned ? new Date() : null,
      banReason: banned && typeof reason === "string" ? reason.slice(0, 200) : null,
    })
    .where(eq(user.id, id))
  return NextResponse.json({ id, banned })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request.headers)
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 })
  const { id } = await ctx.params
  if (id === admin.user.id) return NextResponse.json({ error: "cannot delete yourself" }, { status: 400 })

  // Sessions and provider links cascade. Published items survive with a null
  // owner: deleting an account should not silently break scenes that reference
  // its content. Delete those explicitly first if that is what you want.
  await db.delete(user).where(eq(user.id, id))
  return NextResponse.json({ deleted: id })
}
