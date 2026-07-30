// Publishing: the only route into the library.
//
// Built-ins ship in the repo and never come from here. A row appears when
// someone publishes, which is also the moment content acquires an owner, a
// stable id and a name under which others will see it.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"
import type { LibraryKind } from "@/lib/library"

const KINDS: LibraryKind[] = ["grade", "graph", "effect", "scene"]
const MAX_NAME = 60
const MAX_DESCRIPTION = 500
const MAX_TAGS = 8

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "sign in to publish" }, { status: 401 })

  // Every account is given a handle at sign-up, so this is unreachable — but the
  // fallbacks are the user's real name or their email, and publishing either
  // would be worse than refusing.
  if (session.user.banned) return NextResponse.json({ error: "account suspended" }, { status: 403 })

  const author = session.user.username
  if (!author) return NextResponse.json({ error: "set a handle before publishing" }, { status: 409 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const { kind, name, description, tags, payload } = (body ?? {}) as Record<string, unknown>
  if (typeof kind !== "string" || !KINDS.includes(kind as LibraryKind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 })
  }
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }
  if (payload == null || typeof payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400 })
  }

  // Ids are machine-minted, names are the human key: unique per kind, enforced by
  // the (kind, name) index — the same rule that lets scene documents reference
  // content by name without ambiguity.
  const id = crypto.randomUUID()
  let row
  try {
    ;[row] = await db
      .insert(schema.libraryItems)
      .values({
        id,
        kind: kind as LibraryKind,
        name: name.trim(),
        author,
        description: typeof description === "string" ? description.slice(0, MAX_DESCRIPTION) : "",
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS) : [],
        payload: payload as never,
        ownerId: session.user.id,
        // Published means visible. Private is the column default so an accidental
        // insert stays invisible, but this route is an explicit act.
        visibility: "public",
      })
      .returning()
  } catch {
    // The unique (kind, name) index objected — the only constraint on this insert.
    return NextResponse.json({ error: "name-taken" }, { status: 409 })
  }

  return NextResponse.json({ item: row }, { status: 201 })
}
