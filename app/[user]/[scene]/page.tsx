import { notFound, permanentRedirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import type { ScenePayload } from "@/lib/library"
import { SceneViewer } from "./viewer"

// A published scene at reze.design/<handle>/<shortId> — the address the Share
// dialog hands out. The handle is human context (whose scene this is); the short
// id is what actually resolves, so renaming a scene never breaks a link.

export const revalidate = 0

async function load(id: string) {
  const [row] = await db
    .select({
      id: schema.libraryItems.id,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      description: schema.libraryItems.description,
      credits: schema.libraryItems.credits,
      payload: schema.libraryItems.payload,
      likeCount: schema.libraryItems.likeCount,
      visibility: schema.libraryItems.visibility,
      kind: schema.libraryItems.kind,
      handle: user.username,
    })
    .from(schema.libraryItems)
    .leftJoin(user, eq(schema.libraryItems.ownerId, user.id))
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  if (!row || row.kind !== "scene" || row.visibility !== "public") return null
  return row
}

export async function generateMetadata({ params }: { params: Promise<{ user: string; scene: string }> }) {
  const { scene } = await params
  const row = await load(scene)
  if (!row) return { title: "Scene not found · Reze Design" }
  return {
    title: `${row.name} · Reze Design`,
    description: row.description || `A 3D scene by ${row.author}.`,
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
    />
  )
}
