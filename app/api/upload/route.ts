// Presigned upload for a scene's asset bundle.
//
// The browser PUTs straight to R2 — Vercel caps request bodies at 4.5MB, and a
// model zip is routinely ten times that. The key is permanent storage, not a
// staging area: scoped under the CALLER's user id (from the session, never the
// request), so nobody can write outside their own prefix no matter what scene
// id they claim, and republishing a scene overwrites its own bundle in place.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/lib/auth"

const MAX_BUNDLE_BYTES = 200 * 1024 * 1024

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
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const { sceneId, size } = ((await request.json().catch(() => ({}))) ?? {}) as { sceneId?: unknown; size?: unknown }
  if (typeof sceneId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(sceneId)) {
    return NextResponse.json({ error: "invalid sceneId" }, { status: 400 })
  }
  if (typeof size === "number" && size > MAX_BUNDLE_BYTES) {
    return NextResponse.json({ error: "bundle too large" }, { status: 413 })
  }

  const key = `scenes/${session.user.id}/${sceneId}/assets.zip`
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: "application/zip" }),
    { expiresIn: 600 },
  )
  return NextResponse.json({ uploadUrl, publicUrl: `${process.env.R2_PUBLIC_BASE_URL}/${key}` })
}
