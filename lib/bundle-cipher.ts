// A published scene's asset bundle, stored opaque.
//
// Every bundle uploads as `<random>.bin`: the zip run through AES-CTR, its key
// derived from the file's own random name and a constant here. Nothing extra is
// stored or fetched — whoever has the name and this code can open it, which is
// every viewer, and is the point: this is NOT protection. It is so that F12
// shows a nameless file of noise rather than an `assets.zip` anyone can save
// and double-click. Someone who reads this file can reverse it; a browser has
// to end up with the models in memory to draw them, so nothing client-side can
// do better.
//
// `scripts/db-seal-bundles.mjs` carries the same algorithm for the migration of
// bundles published before this; the two must agree byte for byte.

const PEPPER = "reze-design/bundle/v1"

/** Is this bundle URL one of ours that has to be opened before unzipping? */
export const isSealedBundle = (url: string): boolean => /\.bin(?:$|\?)/.test(url)

/** The random name a sealed bundle's key is derived from: its file name. */
export const sealedName = (urlOrKey: string): string => urlOrKey.split("?")[0].split("/").pop() ?? ""

async function keyFor(name: string): Promise<{ key: CryptoKey; counter: Uint8Array<ArrayBuffer> }> {
  const enc = new TextEncoder()
  const raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${PEPPER}:key:${name}`)))
  const iv = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${PEPPER}:ctr:${name}`)))
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-CTR" }, false, ["encrypt", "decrypt"])
  // The high 64 bits from the name; the low 64 count blocks from zero, so the
  // counter cannot wrap inside a bundle.
  const counter = new Uint8Array(new ArrayBuffer(16))
  counter.set(iv.subarray(0, 8))
  return { key, counter }
}

/** Seal a zip for upload under `name`. CTR keeps the size identical. */
export async function sealBundle(zip: Blob, name: string): Promise<Blob> {
  const { key, counter } = await keyFor(name)
  const out = await crypto.subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, key, await zip.arrayBuffer())
  return new Blob([out], { type: "application/octet-stream" })
}

/**
 * The zip a fetched bundle holds, whichever way it was stored.
 *
 * A `.bin` that already begins with a zip's local-file signature was never
 * sealed: an editor tab loaded before sealing shipped took the opaque key the
 * new server handed out and uploaded its plain zip there (51TSnp). Opened as
 * it is rather than "decrypted" into noise. A sealed file starting with those
 * four bytes by chance is a one-in-four-billion event.
 */
export async function bundleZip(data: Blob, url: string): Promise<Blob> {
  if (!isSealedBundle(url)) return data
  const head = new Uint8Array(await data.slice(0, 4).arrayBuffer())
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return data
  return openSealedBundle(data, sealedName(url))
}

/** Open a sealed bundle back into its zip. */
export async function openSealedBundle(data: Blob, name: string): Promise<Blob> {
  const { key, counter } = await keyFor(name)
  const out = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, key, await data.arrayBuffer())
  return new Blob([out], { type: "application/zip" })
}
