// Presigned upload for a scene's asset bundle, or its poster.
//
// The browser PUTs straight to R2 — Vercel caps request bodies at 4.5MB, and a
// model zip is routinely ten times that. The key is permanent storage, not a
// staging area, and the server picks it, never the request: a bundle goes to a
// fresh opaque key under the CALLER's owner tag (lib/bundle-owner), sealed by
// the browser before upload (lib/bundle-cipher); a poster stays under the
// caller's user id, since a poster is public by design. Fresh per publish,
// because every publish creates a new scene row and two scenes must never share
// one bundle.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/lib/auth"
import { MAX_BUNDLE_BYTES } from "@/lib/library"
import { hasDatabase } from "@/lib/db"
import { newBundleKey } from "@/lib/bundle-owner"

// A published object is immutable — every publish mints a new scene row and a
// new key — so it wants `public, max-age=31536000, immutable`, and without it R2
// serves the zip with no cache headers and every browser re-fetches the whole
// bundle on every visit, refresh and fork.
//
// It is NOT signed into the presigned PUT, though that is the obvious place for
// it. Signing a header puts it in the browser's Access-Control-Request-Headers,
// and the bucket's CORS policy allows a fixed list that does not include
// cache-control — so the preflight failed and every publish died as an
// unexplained "network error", which is all XHR reports for a refused preflight.
// The header is applied out of band instead; see scripts/r2-backfill-cache.mjs.

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
  const ext = posterType.split("/")[1] === "jpeg" ? "jpg" : posterType.split("/")[1]
  const key = poster ? `scenes/${session.user.id}/${sceneId}/poster.${ext}` : newBundleKey(session.user.id)
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: poster ? posterType : "application/octet-stream",
    }),
    { expiresIn: 600 },
  )
  return NextResponse.json({ uploadUrl, key, publicUrl: `${process.env.R2_PUBLIC_BASE_URL}/${key}` })
}
