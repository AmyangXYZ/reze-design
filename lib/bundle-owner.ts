import "server-only"
import { createHmac, randomBytes } from "node:crypto"
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"

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
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    })
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
  } catch (e) {
    console.error("[publish] could not delete replaced bundle", key, e)
  }
}
