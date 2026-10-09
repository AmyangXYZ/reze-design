import { cache } from "react"
import { notFound, permanentRedirect } from "next/navigation"
import { headers } from "next/headers"
import { unstable_cache } from "next/cache"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/admin"
import { eq } from "drizzle-orm"
import { db, hasDatabase, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import type { ScenePayload } from "@/lib/library"
import { ITEMS_TAG, itemTag } from "@/lib/public-pages"
import { SceneViewer } from "./viewer"

// A published scene at reze.design/<handle>/<shortId> — the address the Share
// dialog hands out. The handle is human context (whose scene this is); the short
// id is what actually resolves, so renaming a scene never breaks a link.

export const revalidate = 0

/** The scene's row, cached until a write to it marks it stale (lib/public-pages),
 *  so opening a link leaves the database asleep. */
const sceneRow = (id: string) =>
  unstable_cache(
    async () => {
      const [row] = await db
        .select({
          id: schema.libraryItems.id,
          name: schema.libraryItems.name,
          author: schema.libraryItems.author,
          description: schema.libraryItems.description,
          credits: schema.libraryItems.credits,
          payload: schema.libraryItems.payload,
          likeCount: schema.libraryItems.likeCount,
          createdAt: schema.libraryItems.createdAt,
          visibility: schema.libraryItems.visibility,
          posterKey: schema.libraryItems.posterKey,
          nsfw: schema.libraryItems.nsfw,
          displayOnly: schema.libraryItems.displayOnly,
          ownerId: schema.libraryItems.ownerId,
          kind: schema.libraryItems.kind,
          handle: user.username,
        })
        .from(schema.libraryItems)
        .leftJoin(user, eq(schema.libraryItems.ownerId, user.id))
        .where(eq(schema.libraryItems.id, id))
        .limit(1)
      return row ? { ...row, createdAt: row.createdAt.toISOString() } : null
    },
    ["scene-page", id],
    { tags: [itemTag(id), ITEMS_TAG] },
  )()

/** One read for the page and its metadata. */
const load = cache(async (id: string) => {
  // Nothing is published where nothing is stored. See lib/db — a clone with no
  // database still runs the editor; scene links simply resolve to not-found.
  if (!hasDatabase) return null
  const row = await sceneRow(id)
  if (!row || row.kind !== "scene") return null
  // Private is the author's, and an admin's to inspect. A stranger holding the
  // link gets the same not-found a nonexistent id gets — never a 403, which
  // would confirm it.
  if (row.visibility === "private") {
    const session = await auth.api.getSession({ headers: await headers() })
    const admin = !!session?.user.emailVerified && isAdminEmail(session.user.email)
    if (!session || (row.ownerId !== session.user.id && !admin)) return null
  }

  return row
})

export async function generateMetadata({ params }: { params: Promise<{ user: string; scene: string }> }) {
  const { scene } = await params
  const row = await load(scene)
  if (!row) return { title: "Scene not found · Reze Design" }
  const title = `${row.name} · Reze Design`
  const description = row.description || `A 3D scene by ${row.handle ?? row.author}.`
  // The link preview is the cover the author chose at publish — except on a
  // flagged scene, whose preview is shown to whoever the link lands in front of.
  const images = row.posterKey && !row.nsfw ? [`${process.env.R2_PUBLIC_BASE_URL}/${row.posterKey}`] : undefined
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Reze Design", images },
    twitter: { card: "summary_large_image", title, description, images },
  }
}

export default async function ScenePage({ params }: { params: Promise<{ user: string; scene: string }> }) {
  const { user: handle, scene } = await params
  const row = await load(scene)
  if (!row) notFound()

  // The scene id alone resolves the page — the handle is readable decoration, so a
  // link survives its author being renamed. When it is stale (or was never right),
  // send the browser to the canonical URL rather than serving two addresses for
  // one scene: the address bar stays honest and search engines see one page.
  const canonical = row.handle ?? row.author
  if (handle !== canonical) permanentRedirect(`/${canonical}/${row.id}`)

  const doc = (row.payload as ScenePayload).doc
  return (
    <SceneViewer
      doc={doc}
      sceneId={row.id}
      title={row.name}
      author={row.handle ?? row.author}
      description={row.description}
      credits={row.credits}
      likeCount={row.likeCount}
      publishedAt={row.createdAt}
      displayOnly={row.displayOnly}
    />
  )
}
