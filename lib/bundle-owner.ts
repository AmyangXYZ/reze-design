import "server-only"
import { createHmac, randomBytes } from "node:crypto"
import { CopyObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"

// Where a scene's bundle lives in storage, and whose it is.
//
// `b/<owner tag>/<random>.bin`. The tag is a keyed hash of the owner's user
// id, so the path says nothing about who published it or which scene it is
// (the old `scenes/<user id>/<scope>/assets.zip` said both) — while the server,
// holding the secret, can still tell whether a key it is handed belongs to the
// person handing it. That check is what makes deleting a replaced bundle safe:
// without it, a publish naming someone else's key and then replacing it would
// have us delete their file.

const secret = () => {
  const s = process.env.BETTER_AUTH_SECRET
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set")
  return s
}

/** The owner's opaque folder name. Stable per user, meaningless without the secret. */
export const ownerTag = (userId: string): string =>
  createHmac("sha256", secret()).update(`bundle-owner:${userId}`).digest("base64url").slice(0, 16)

/** A fresh key for a bundle this user is about to upload. */
export const newBundleKey = (userId: string): string => `b/${ownerTag(userId)}/${randomBytes(18).toString("base64url")}.bin`

/** Does this storage key hold a bundle the user published? Both layouts: the
 *  opaque one, and the per-user folder every bundle before it went to. */
export const ownsBundleKey = (userId: string, key: string): boolean =>
  key.startsWith(`b/${ownerTag(userId)}/`) || key.startsWith(`scenes/${userId}/`)

const r2 = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })

// Kept in step with scripts/r2-backfill-cache.mjs by hand — one string.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

const contentTypeFor = (key: string) => {
  if (key.endsWith(".zip")) return "application/zip"
  if (key.endsWith(".bin")) return "application/octet-stream"
  if (key.endsWith(".png")) return "image/png"
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg"
  return "image/webp"
}

/**
 * Give a just-published object the cache header it could not upload with.
 *
 * Published objects are immutable — every publish mints a new key — so they
 * want `immutable` for a year. The presigned PUT cannot carry it (see
 * app/api/upload/route.ts: a signed cache-control fails the bucket's CORS
 * preflight), and without it Cloudflare BYPASSES its cache for the object, so
 * every viewer pulled 30–200MB straight from the bucket and every revisit paid
 * for it again. scripts/r2-backfill-cache.mjs did this by hand, and new
 * publishes went uncached between runs; this does it at publish time.
 *
 * R2 has no in-place metadata edit: a copy onto itself with REPLACE, which is
 * why the content type is restated. Best effort — a failure leaves the object
 * uncached exactly as before, never a broken publish, and the backfill script
 * still catches it.
 */
export async function cacheImmutably(key: string): Promise<void> {
  try {
    await r2().send(
      new CopyObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        CopySource: `${process.env.R2_BUCKET}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        MetadataDirective: "REPLACE",
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        ContentType: contentTypeFor(key),
      }),
    )
  } catch (e) {
    console.error("[publish] could not set the cache header", key, e)
  }
}

/**
 * Remove a bundle a republish has replaced. Every publish uploads a fresh one,
 * so without this each correction left its predecessor in storage forever.
 * Best effort: a failure here leaves one orphan, never a broken publish.
 *
 * `key` is the bundle the author's OWN row named, so it needs no owner-tag
 * check: a row only ever gets a key through a publish — which checks the
 * incoming key's tag — or through scripts/db-seal-bundles.mjs, which assigned
 * keys by owner. (That script ran with a different secret than production, so
 * a migrated key's tag does not verify here; requiring it would orphan every
 * migrated bundle on its first republish.) Only bundle-shaped keys are deleted.
 */
export async function deleteReplacedBundle(key: string): Promise<void> {
  if (!/^b\/[^/]+\/[^/]+\.bin$/.test(key) && !/^scenes\/[^/]+\/[^/]+\/assets\.zip$/.test(key)) return
  try {
    await r2().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
  } catch (e) {
    console.error("[publish] could not delete replaced bundle", key, e)
  }
}
