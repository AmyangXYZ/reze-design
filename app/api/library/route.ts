// Publishing: the only route into the library.
//
// Built-ins ship in the repo and never come from here. A row appears when
// someone publishes, which is also the moment content acquires an owner, a
// stable id and a name under which others will see it.

import { NextResponse } from "next/server"
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"
import { nameClash } from "@/lib/db/names"
import { normalizeName, withGraphName, type LibraryKind } from "@/lib/library"

const KINDS: LibraryKind[] = ["grade", "graph", "effect", "scene"]
const MAX_NAME = 60
const MAX_DESCRIPTION = 500
const MAX_TAGS = 5
const MAX_TAG_LENGTH = 16
const MAX_CREDITS = 4000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Base58: no 0/O/I/l ambiguity — these ids live in shareable URLs.
//
// Six characters is 38 billion combinations, which is generous for a URL that
// already carries the author: /amyang/3Fk9Qw. Collisions are handled rather than
// engineered away, because at this length a retry is far cheaper than the extra
// characters everyone would read forever.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
function shortId(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => BASE58[b % 58]).join("")
}

/** A short id no scene is using. Checked rather than assumed. */
async function freeShortId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = shortId()
    const [taken] = await db
      .select({ id: schema.libraryItems.id })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.id, candidate))
      .limit(1)
    if (!taken) return candidate
  }
  // Vanishingly unlikely; a longer id beats failing the publish.
  return shortId(10)
}

/**
 * The community library: every public row, all kinds — the client filters by
 * kind. One request feeds the three libraries, the quick-picks, and name
 * resolution, mirroring how /stats already works. `mine` marks the caller's own
 * rows so the "Yours" facet can include published work next to local drafts.
 */
export async function GET(request: Request) {
  // No database configured: every list here is legitimately empty. See lib/db —
  // the editor and its built-in libraries run with no server at all.
  if (!hasDatabase) {
    const url = new URL(request.url)
    if (url.searchParams.get("kind") !== "scene") return NextResponse.json({ items: [] })
    if (url.searchParams.get("counts") === "tags") return NextResponse.json({ tags: [] })
    return NextResponse.json({ scenes: [], nextCursor: null })
  }

  // ── Scenes: the gallery ──────────────────────────────────────────────────────
  // Its own shape because a scene card wants a poster and a like state, and a
  // preset card wants a payload — sending both to both would be waste in each
  // direction. Cursor-paged, because "every public row" stops working long
  // before the library does.
  const url = new URL(request.url)
  if (url.searchParams.get("kind") === "scene") {
    // Deliberately NOT session-gated. Reading who you are is its own round trip to
    // Singapore (~260ms), and the gallery would wait on it before even asking for
    // the rows — for a list that is public and identical for everyone. Personal
    // state (did I like this) belongs to the scene page, which needs a session
    // anyway.
    // Tag counts across EVERY public scene, not the page in front of you: tags are
    // a way of browsing the whole gallery, so they must not shrink when you narrow
    // it to your own or to what you liked.
    if (url.searchParams.get("counts") === "tags") {
      const rows = await db
        .select({ tag: sql<string>`tag`, n: sql<number>`count(*)::int` })
        .from(sql`${schema.libraryItems}, unnest(${schema.libraryItems.tags}) as tag`)
        .where(
          and(
            eq(schema.libraryItems.kind, "scene"),
            eq(schema.libraryItems.visibility, "public"),
            isNull(schema.libraryItems.deletedAt),
          ),
        )
        .groupBy(sql`tag`)
      return NextResponse.json({ tags: rows.sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)) })
    }

    const sort = url.searchParams.get("sort") ?? "hot"
    const facet = url.searchParams.get("facet")
    const before = Number(url.searchParams.get("before")) || null
    const limit = Math.min(Number(url.searchParams.get("limit")) || 24, 48)

    // Reddit's ordering: a young post with a few likes outranks an old one with
    // the same, and the gap closes as both age.
    const hot = sql<number>`log(greatest(${schema.libraryItems.likeCount}, 1) + 1)
      + extract(epoch from ${schema.libraryItems.createdAt}) / 45000`
    const order = sort === "new" ? desc(schema.libraryItems.createdAt) : sort === "top" ? desc(schema.libraryItems.likeCount) : desc(hot)

    // Only the personal facets read a session — the default list stays one public
    // query with no auth round trip in front of it.
    const viewer = facet ? await auth.api.getSession({ headers: request.headers }) : null
    if (facet && !viewer) return NextResponse.json({ scenes: [], nextCursor: null })

    const selection = db
      .select({
        id: schema.libraryItems.id,
        name: schema.libraryItems.name,
        author: schema.libraryItems.author,
        description: schema.libraryItems.description,
        // Sent with the list rather than fetched on selection: a second round trip
        // to Singapore to read a credit is how a credit ends up unread.
        credits: schema.libraryItems.credits,
        tags: schema.libraryItems.tags,
        likeCount: schema.libraryItems.likeCount,
        viewCount: schema.libraryItems.viewCount,
        posterKey: schema.libraryItems.posterKey,
        createdAt: schema.libraryItems.createdAt,
      })
      .from(schema.libraryItems)
    const scenes = await (facet === "liked" && viewer
      ? selection.innerJoin(
          schema.likes,
          and(eq(schema.likes.itemId, schema.libraryItems.id), eq(schema.likes.userId, viewer.user.id)),
        )
      : selection
    )
      .where(
        and(
          eq(schema.libraryItems.kind, "scene"),
          eq(schema.libraryItems.visibility, "public"),
          isNull(schema.libraryItems.deletedAt),
          facet === "yours" && viewer ? eq(schema.libraryItems.ownerId, viewer.user.id) : undefined,
          before ? lt(schema.libraryItems.createdAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(order)
      .limit(limit + 1)

    const page = scenes.slice(0, limit)

    return NextResponse.json({
      scenes: page.map(({ posterKey, createdAt, ...s }) => ({
        ...s,
        createdAt: createdAt.toISOString(),
        poster: posterKey ? `${process.env.R2_PUBLIC_BASE_URL}/${posterKey}` : null,
      })),
      // Keyset, not offset: rows shift under an offset as people publish.
      nextCursor: scenes.length > limit ? page[page.length - 1].createdAt.getTime() : null,
    })
  }

  const session = await auth.api.getSession({ headers: request.headers })
  const rows = await db
    .select({
      id: schema.libraryItems.id,
      kind: schema.libraryItems.kind,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      description: schema.libraryItems.description,
      tags: schema.libraryItems.tags,
      version: schema.libraryItems.version,
      payload: schema.libraryItems.payload,
      ownerId: schema.libraryItems.ownerId,
    })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.visibility, "public"))
    // Newest first. Libraries show built-ins sorted by name — a fixed set you
    // learn the shape of — and community by date, where recency is the only
    // signal anyone has about work they have not seen. The rows carry no
    // timestamp, so this ordering IS the date sort the client renders.
    .orderBy(desc(schema.libraryItems.createdAt))
  const items = rows.map(({ ownerId, ...r }) => ({
    ...r,
    owner: "user" as const,
    mine: !!session && ownerId === session.user.id,
  }))
  return NextResponse.json({ items })
}

export async function POST(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
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

  const { id, kind, name, description, tags, payload, credits, changelog, bundleKey, bundleBytes, posterKey, forkedFromId, uses } =
    (body ?? {}) as Record<string, unknown>
  if (typeof kind !== "string" || !KINDS.includes(kind as LibraryKind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 })
  }
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }
  if (payload == null || typeof payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400 })
  }
  // A scene redistributes other people's models, motions and music. The 借物表 is
  // the community's own norm for that, so it is required rather than encouraged.
  if (kind === "scene" && (typeof credits !== "string" || !credits.trim())) {
    return NextResponse.json({ error: "credits are required" }, { status: 400 })
  }

  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")
  // A graph carries a name inside itself too, and the row's name is the one
  // everybody sees. Reconciled HERE, where the name is decided, so the stored
  // payload can never disagree with the row it belongs to — see withGraphName.
  const wanted = normalizeName(name)
  const stored = kind === "graph" ? withGraphName(payload, wanted) : payload
  const common = {
    name: wanted,
    author,
    description: text(description, MAX_DESCRIPTION),
    // Same shape the client offers: few, short, single words. Enforced here too,
    // because the only tag rule that holds is the one the server applies.
    tags: Array.isArray(tags)
      ? [
          ...new Set(
            tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH))
              .filter(Boolean),
          ),
        ].slice(0, MAX_TAGS)
      : [],
    payload: stored as never,
    ownerId: session.user.id,
  }

  // ── Scenes ───────────────────────────────────────────────────────────────────
  // Short id, because the id IS the share URL. No version rows: nothing imports a
  // scene, so there is nothing for anyone to pin.
  if (kind === "scene") {
    // Pins the client says this document makes. Filtered against real version rows
    // below rather than trusted — a bad edge would inflate someone's usage count.
    const pins = Array.isArray(uses)
      ? uses.filter(
          (u): u is { id: string; version: number } =>
            typeof u === "object" && u !== null && typeof (u as { id: unknown }).id === "string" &&
            Number.isInteger((u as { version: unknown }).version),
        )
      : []

    const [scene] = await db
      .insert(schema.libraryItems)
      .values({
        ...common,
        id: await freeShortId(),
        kind: "scene",
        credits: text(credits, MAX_CREDITS),
        bundleKey: typeof bundleKey === "string" ? bundleKey : null,
        bundleBytes: typeof bundleBytes === "number" ? bundleBytes : 0,
        posterKey: typeof posterKey === "string" ? posterKey : null,
        // Recorded automatically when the session began from someone else's scene
        // — there is no fork button, publishing IS the fork.
        forkedFromId: typeof forkedFromId === "string" ? forkedFromId : null,
        // Published means visible. Private is the column default so an accidental
        // insert stays invisible, but this route is an explicit act.
        visibility: "public",
      })
      .returning()

    if (pins.length > 0) {
      const real = await db
        .select({ itemId: schema.libraryItemVersions.itemId, version: schema.libraryItemVersions.version })
        .from(schema.libraryItemVersions)
        .where(
          inArray(
            schema.libraryItemVersions.itemId,
            pins.map((p) => p.id),
          ),
        )
      const valid = pins.filter((p) => real.some((r) => r.itemId === p.id && r.version === p.version))
      if (valid.length > 0) {
        await db.transaction(async (tx) => {
          await tx
            .insert(schema.sceneUses)
            .values(valid.map((p) => ({ sceneId: scene.id, itemId: p.id, itemVersion: p.version })))
          // Denormalised so a library card needs no join.
          await tx
            .update(schema.libraryItems)
            .set({ usageCount: sql`${schema.libraryItems.usageCount} + 1` })
            .where(
              inArray(
                schema.libraryItems.id,
                valid.map((p) => p.id),
              ),
            )
        })
      }
    }
    // Shaped like a gallery card so the client can drop it straight into the
    // list it just joined, instead of re-reading the whole page to learn one row.
    return NextResponse.json(
      {
        item: {
          ...scene,
          poster: scene.posterKey ? `${process.env.R2_PUBLIC_BASE_URL}/${scene.posterKey}` : null,
        },
      },
      { status: 201 },
    )
  }

  // ── Presets ──────────────────────────────────────────────────────────────────
  // The client sends the draft's uuid, so a preset is the SAME entity before and
  // after it goes public. Publishing over one you already own writes the next
  // immutable version rather than a second item.
  const itemId = typeof id === "string" && UUID.test(id) ? id : crypto.randomUUID()

  // One name per kind, for everybody. Not per author: the editor resolves a look
  // BY NAME — the quick switch matches a group to a library row that way, and
  // applying one looks it up that way — so a second "Neon Hair" does not read as
  // two artists' takes, it makes one of them unreachable.
  //
  // Case and spacing folded, because a library where "neon hair" and "Neon Hair"
  // are different things is a library nobody can search.
  const clash = await nameClash(kind as LibraryKind, wanted, itemId)
  if (clash) return NextResponse.json({ error: "name-taken", taken: clash }, { status: 409 })
  const [existing] = await db
    .select({ ownerId: schema.libraryItems.ownerId, version: schema.libraryItems.version })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, itemId))
    .limit(1)
  if (existing && existing.ownerId !== session.user.id) {
    return NextResponse.json({ error: "not yours" }, { status: 403 })
  }
  const version = existing ? existing.version + 1 : 1

  let row
  try {
    row = await db.transaction(async (tx) => {
      const [item] = existing
        ? await tx
            .update(schema.libraryItems)
            .set({ ...common, version, deletedAt: null, updatedAt: new Date() })
            .where(eq(schema.libraryItems.id, itemId))
            .returning()
        : await tx
            .insert(schema.libraryItems)
            .values({
              ...common,
              id: itemId,
              kind: kind as LibraryKind,
              version,
              visibility: "public",
              // Derived from someone else's preset — their item is untouched, this
              // is yours, and the trail back to them is kept.
              forkedFromId: typeof forkedFromId === "string" ? forkedFromId : null,
            })
            .returning()
      // Immutable: written once, never updated. This row is what a scene pins.
      await tx.insert(schema.libraryItemVersions).values({
        itemId,
        version,
        payload: stored as never,
        changelog: text(changelog, MAX_DESCRIPTION) || null,
      })
      return item
    })
  } catch {
    // The unique (owner, kind, name) index — you already have one by that name.
    return NextResponse.json({ error: "name-taken" }, { status: 409 })
  }

  return NextResponse.json({ item: row }, { status: 201 })
}
