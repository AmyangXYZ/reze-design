// Stored objects, straight from R2.
//
// Listed live rather than mirrored into Postgres: the bucket is the source of
// truth for what exists, and a table that drifts from it would be worse than no
// table at all.

import { NextResponse } from "next/server"
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase } from "@/lib/db"

const s3 = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

export async function GET(request: Request) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!(await requireAdmin(request.headers))) return NextResponse.json({ error: "not found" }, { status: 404 })
  const res = await s3().send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, MaxKeys: 500 }))
  const objects = (res.Contents ?? []).map((o) => ({
    key: o.Key!,
    size: o.Size ?? 0,
    modified: o.LastModified?.toISOString() ?? null,
  }))
  return NextResponse.json({ objects, truncated: res.IsTruncated ?? false })
}

export async function DELETE(request: Request) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!(await requireAdmin(request.headers))) return NextResponse.json({ error: "not found" }, { status: 404 })
  const { key } = ((await request.json().catch(() => ({}))) ?? {}) as { key?: unknown }
  if (typeof key !== "string" || !key) return NextResponse.json({ error: "invalid key" }, { status: 400 })
  await s3().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
  return NextResponse.json({ deleted: key })
}
