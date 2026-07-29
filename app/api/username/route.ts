// Claiming a handle. Separate from the auth routes because it's ours, not
// better-auth's — and because uniqueness has to be enforced somewhere the client
// can't skip.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { libraryItems } from "@/lib/db/schema"
import { isTaken, normalize, validate } from "@/lib/username"

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const { username } = ((await request.json().catch(() => ({}))) ?? {}) as { username?: unknown }
  if (typeof username !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 })

  const [me] = await db
    .select({ chosenAt: user.usernameChangedAt })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)
  // Only the auto-assigned handle can be replaced. Once chosen it is permanent:
  // handles appear in URLs (reze.design/<user>/<scene>), so renaming breaks every
  // link to that user's scenes, and a freed handle lets someone impersonate them.
  if (me?.chosenAt) return NextResponse.json({ error: "already-set" }, { status: 409 })

  const wanted = normalize(username)
  const shapeError = validate(wanted)
  if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 })

  // Checked here for a clean message, but the column's UNIQUE constraint is what
  // actually decides — two people claiming the same handle at once must not both
  // win, and only the database can settle that.
  if (await isTaken(wanted, session.user.id)) {
    return NextResponse.json({ error: "taken" }, { status: 409 })
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(user).set({ username: wanted, usernameChangedAt: new Date() }).where(eq(user.id, session.user.id))
      // `author` is denormalised so a scene snapshot needs no join — which means a
      // rename has to be carried into it, or everything already published keeps
      // showing the old name. Same transaction: the two must not disagree.
      await tx
        .update(libraryItems)
        .set({ author: wanted })
        .where(eq(libraryItems.ownerId, session.user.id))
    })
  } catch {
    return NextResponse.json({ error: "taken" }, { status: 409 })
  }
  return NextResponse.json({ username: wanted })
}
