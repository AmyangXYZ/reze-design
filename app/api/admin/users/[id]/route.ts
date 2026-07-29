// Account moderation. Admin only — there is no owner path here, because nobody
// should be able to ban or delete themselves by accident.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request.headers)
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 })
  const { id } = await ctx.params
  if (id === admin.user.id) return NextResponse.json({ error: "cannot ban yourself" }, { status: 400 })

  const { banned, reason } = ((await request.json().catch(() => ({}))) ?? {}) as {
    banned?: unknown
    reason?: unknown
  }
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
