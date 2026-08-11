// Presigned upload for a scene's asset bundle.
//
// The browser PUTs straight to R2 — Vercel caps request bodies at 4.5MB, and a
// model zip is routinely ten times that. The key is permanent storage, not a
// staging area: scoped under the CALLER's user id (from the session, never the
// request), so nobody can write outside their own prefix no matter what id they
// claim. The client sends a fresh id per publish, because every publish creates a
// new scene row and two scenes must never share one bundle.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/lib/auth"
import { hasDatabase } from "@/lib/db"

/**
 * A published object is immutable, so it may be cached forever.
 *
 * Every publish creates a new scene row and a new key (see the note above), so
 * no URL this route signs is ever rewritten — the one thing `immutable` demands.
 * Without it R2 serves the zip with no cache headers at all and the browser
 * re-fetches the whole bundle every time: opening a scene in the editor after
 * viewing it downloaded the same 165MB twice, and so did every revisit and
 * refresh.
 *
 * Returned to the client rather than only signed, because a presigned PUT is
 * signed OVER this header — the browser has to send back the identical string
 * or R2 rejects the upload, and two copies of it would eventually disagree.
 */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

const MAX_BUNDLE_BYTES = 200 * 1024 * 1024
const MAX_POSTER_BYTES = 20 * 1024 * 1024
const POSTER_TYPES = ["image/png", "image/jpeg", "image/webp"]

const s3 = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

export async function POST(request: Request) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const { sceneId, size, kind, contentType } = ((await request.json().catch(() => ({}))) ?? {}) as {
    sceneId?: unknown
    size?: unknown
    kind?: unknown
    contentType?: unknown
  }
  if (typeof sceneId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(sceneId)) {
    return NextResponse.json({ error: "invalid sceneId" }, { status: 400 })
  }
  if (typeof size === "number" && size > MAX_BUNDLE_BYTES) {
    return NextResponse.json({ error: "bundle too large" }, { status: 413 })
  }

  // Two objects live under a scene: its asset bundle and its gallery poster.
  const poster = kind === "poster"
  const posterType = POSTER_TYPES.includes(String(contentType)) ? String(contentType) : "image/webp"
  if (poster && typeof size === "number" && size > MAX_POSTER_BYTES) {
    return NextResponse.json({ error: "poster too large" }, { status: 413 })
  }
  const ext = poster ? (posterType.split("/")[1] === "jpeg" ? "jpg" : posterType.split("/")[1]) : "zip"
  const key = `scenes/${session.user.id}/${sceneId}/${poster ? `poster.${ext}` : "assets.zip"}`
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: poster ? posterType : "application/zip",
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
    { expiresIn: 600 },
  )
  return NextResponse.json({
    uploadUrl,
    key,
    publicUrl: `${process.env.R2_PUBLIC_BASE_URL}/${key}`,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
  })
}
