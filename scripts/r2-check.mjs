// End-to-end R2 check: sign an upload, PUT through it as a browser would,
// read it back over the PUBLIC domain, then clean up.
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})
const key = `_healthcheck/${Date.now()}.txt`
const body = "reze-design r2 healthcheck"

try {
  await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }))
  console.log("✓ credentials valid, bucket reachable")

  // Presigned PUT — the path a browser upload actually takes, since a 50MB zip
  // can't go through a Vercel function (4.5MB body cap).
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: "text/plain" }), {
    expiresIn: 60,
  })
  const put = await fetch(url, { method: "PUT", body, headers: { "content-type": "text/plain" } })
  console.log(put.ok ? `✓ presigned PUT ${put.status}` : `✗ presigned PUT ${put.status}`)
  if (!put.ok) process.exit(1)

  const publicUrl = `${R2_PUBLIC_BASE_URL}/${key}`
  const get = await fetch(publicUrl)
  const text = await get.text()
  console.log(get.ok && text === body ? `✓ public read ${get.status}, body matches` : `✗ public read ${get.status}`)
  console.log("  cf-cache-status:", get.headers.get("cf-cache-status"))
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  console.log("✓ cleaned up", key)
}
