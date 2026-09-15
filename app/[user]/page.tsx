import { cache } from "react"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { and, desc, eq, isNull } from "drizzle-orm"
import { db, hasDatabase, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import type { EffectPayload, GradePayload, GraphPayload } from "@/lib/library"
import { validate } from "@/lib/username"
import { Profile } from "./profile"

// A maker's page at reze.design/<handle>: what they have published, for anyone
// holding the link. Public rows only and no session read, so the page is the
// same for every visitor and can be cached — five minutes stale is fine for a
// showcase, and a cached page leaves the database asleep.

export const revalidate = 300

const posterUrl = (key: string | null) => (key ? `${process.env.R2_PUBLIC_BASE_URL}/${key}` : null)

/** One read for the page and its metadata. */
const load = cache(async (handle: string) => {
  // A path that could never be a handle — a stray file request, a reserved word —
  // is answered without asking the database.
  if (!hasDatabase || validate(handle) !== null) return null
  const [owner] = await db
    .select({ id: user.id, handle: user.username, image: user.image, createdAt: user.createdAt, banned: user.banned })
    .from(user)
    .where(eq(user.username, handle))
    .limit(1)
  if (!owner?.handle || owner.banned) return null

  const items = schema.libraryItems
  const published = (kind: "scene" | "effect" | "graph" | "grade") =>
    and(eq(items.ownerId, owner.id), eq(items.kind, kind), eq(items.visibility, "public"), isNull(items.deletedAt))
  // A preset's payload is its picture — the shader, the graph, the grade.
  const presets = (kind: "effect" | "graph" | "grade") =>
    db
      .select({
        id: items.id,
        name: items.name,
        description: items.description,
        payload: items.payload,
        likeCount: items.likeCount,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(published(kind))
      .orderBy(desc(items.createdAt))
  const [scenes, effects, graphs, grades] = await Promise.all([
    // A scene's payload is its whole document; the card needs its poster.
    db
      .select({
        id: items.id,
        name: items.name,
        description: items.description,
        likeCount: items.likeCount,
        viewCount: items.viewCount,
        posterKey: items.posterKey,
        featuredAt: items.featuredAt,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(published("scene"))
      .orderBy(desc(items.createdAt)),
    presets("effect"),
    presets("graph"),
    presets("grade"),
  ])

  const preset = <P,>({ payload, createdAt, ...row }: (typeof effects)[number]) => ({
    ...row,
    payload: payload as P,
    createdAt: createdAt.toISOString(),
  })
  return {
    handle: owner.handle,
    image: owner.image,
    joined: owner.createdAt.toISOString(),
    scenes: scenes.map(({ posterKey, featuredAt, createdAt, ...s }) => ({
      ...s,
      poster: posterUrl(posterKey),
      pinned: featuredAt !== null,
      createdAt: createdAt.toISOString(),
    })),
    effects: effects.map((row) => {
      const { payload, ...rest } = preset<EffectPayload>(row)
      return { ...rest, wgsl: payload.wgsl }
    }),
    graphs: graphs.map((row) => {
      const { payload, ...rest } = preset<GraphPayload>(row)
      return { ...rest, graph: payload.graph }
    }),
    grades: grades.map((row) => {
      const { payload, ...rest } = preset<GradePayload>(row)
      return { ...rest, spec: payload.spec }
    }),
  }
})

export async function generateMetadata({ params }: { params: Promise<{ user: string }> }): Promise<Metadata> {
  const { user: raw } = await params
  const profile = await load(raw.toLowerCase())
  if (!profile) return { title: "Not found · Reze Design" }
  const title = `@${profile.handle} · Reze Design`
  const description = `${profile.scenes.length} scenes on Reze Design.`
  const poster = profile.scenes.find((s) => s.poster)?.poster
  const images = poster ? [poster] : undefined
  return {
    title,
    description,
    openGraph: { title, description, type: "profile", images },
    twitter: { card: "summary_large_image", title, description, images },
  }
}

export default async function ProfilePage({ params }: { params: Promise<{ user: string }> }) {
  const { user: raw } = await params
  // Handles are lowercase; one address per maker.
  const handle = raw.toLowerCase()
  if (raw !== handle) permanentRedirect(`/${handle}`)
  const profile = await load(handle)
  if (!profile) notFound()
  return <Profile {...profile} />
}
