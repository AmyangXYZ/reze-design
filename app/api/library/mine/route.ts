// What the library shows only YOU: your own published presets, private ones
// among them, and which items you liked.
//
// Split from the public reads (/api/library, /api/library/stats) so those can be
// cached at the CDN for everyone and polled freely. This is the one read that
// goes to the database every time, so the client asks for it when a session
// appears and after you change something, never on a timer.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"
import { presetRows } from "@/lib/library-rows"

const PRIVATE = { "Cache-Control": "private, no-store" }

export async function GET(request: Request) {
  if (!hasDatabase) return NextResponse.json({ items: [], liked: [] }, { headers: PRIVATE })
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401, headers: PRIVATE })
  const [own, likes] = await Promise.all([
    presetRows(eq(schema.libraryItems.ownerId, session.user.id)),
    db.select({ itemId: schema.likes.itemId }).from(schema.likes).where(eq(schema.likes.userId, session.user.id)),
  ])
  return NextResponse.json(
    {
      items: own.map((r) => ({ ...r, owner: "user" as const, mine: true })),
      liked: likes.map((l) => l.itemId),
    },
    { headers: PRIVATE },
  )
}
