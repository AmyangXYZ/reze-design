// The local scene's asset bundle: the same {path, file} entries a publish zips to R2,
// written to IndexedDB instead — which is the whole design. Publishing and persisting
// are one operation with two destinations, so the layout in here is identical to a
// published bundle's, and everything downstream (loadSceneInto's bundle seam, clip and
// audio resolution, re-packing on publish) treats both the same.
//
// IndexedDB because these are Files, often tens of megabytes: structured clone stores a
// File whole — bytes, name, type — with no base64 round trip, and localStorage tops out
// around 5MB of string. The doc that points here stays in localStorage, where boot can
// read it synchronously.
//
// ONE record, deliberately. The editor edits a single local scene; opening someone
// else's published scene is a visit, not a switch. The record carries the scene id it
// belongs to, and a mismatched read returns nothing — so writing scene B's bundle
// automatically retires scene A's without a separate eviction step.
//
// Every failure path returns null/false rather than throwing: persistence is a
// convenience, never a precondition. Browsers evict IndexedDB under storage pressure,
// so a caller must treat "gone" as normal — the scene boots without those files and the
// user re-uploads.

import type { BundleEntry } from "@/lib/bundle"
import { storageKey } from "@/lib/storage"
import { mimeForPath } from "@/lib/uploads"

const DB_NAME = "reze-design"
// v2: an earlier (reverted) experiment shipped this database at v1 with a different
// store. Same name + same version means onupgradeneeded never fires, the store this
// code needs never exists, and every transaction throws — silently, through the
// failure-tolerant wrappers. The bump forces the upgrade on browsers that ran it.
// v3: adds the palette store below.
const DB_VERSION = 3
const STORE = "local-bundle"
const KEY = storageKey("local-bundle")
/** Extracted cast colours, keyed by a model's own source path. Its own store
 *  rather than a second shape in the bundle's: these outlive any one scene,
 *  and clearing a scene's bytes must not throw its colours away. */
const PALETTE_STORE = "cast-palette"

type BundleRecord = { sceneId: string; entries: BundleEntry[] }

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null) // private mode in some browsers
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      if (!req.result.objectStoreNames.contains(PALETTE_STORE)) req.result.createObjectStore(PALETTE_STORE)
      // Left behind by the reverted first attempt; its records are unreadable garbage.
      if (req.result.objectStoreNames.contains("local-scene")) req.result.deleteObjectStore("local-scene")
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

/** True only once the bytes are actually down — the caller must not write a doc
 *  pointing at a bundle that never landed. */
export async function saveLocalBundle(sceneId: string, entries: BundleEntry[]): Promise<boolean> {
  const db = await open()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite")
      const record: BundleRecord = { sceneId, entries }
      tx.objectStore(STORE).put(record, KEY)
      tx.oncomplete = () => resolve(true)
      // Quota is the expected failure — a large model in a tight browser.
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    } finally {
      db.close()
    }
  })
}

/**
 * The stored bundle as Files whose `name` is the bundle-relative path — the exact shape
 * `unzipToFiles` produces for a published bundle, so the two are interchangeable at the
 * engine seam. Null when absent, evicted, or belonging to a different scene.
 */
export async function loadLocalBundle(sceneId: string): Promise<File[] | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
      req.onsuccess = () => {
        const rec = req.result as BundleRecord | undefined
        if (!rec || rec.sceneId !== sceneId) return resolve(null)
        // Re-wrapped so the path IS the name — entries carry Blobs (the publish zip
        // type), and whatever name an original File had, `path` was computed before
        // storing and is authoritative. webkitRelativePath would not have survived
        // structured clone anyway.
        //
        // The type is named from the path when the stored blob has none, which is
        // the common case: entries are Blobs, and a Blob out of the zip packer
        // carries no type at all. Without this the unzip fix does not reach the
        // path the editor actually reloads from — a locally persisted scene would
        // keep handing the audio element a typeless object URL, which WebKit
        // refuses to play. It also repairs records written before any of this,
        // since the fallback is applied on the way OUT.
        resolve(rec.entries.map((e) => new File([e.file], e.path, { type: e.file.type || mimeForPath(e.path) })))
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    } finally {
      db.close()
    }
  })
}

/**
 * What is actually in the store, without the bytes and without an id to match.
 *
 * `loadLocalBundle` answers "is my scene's bundle here", which is the right
 * question everywhere except a crash report — where the interesting answer is
 * "there IS a bundle, belonging to a different scene", and a matching read would
 * have reported the same `null` as an empty store.
 */
export async function peekLocalBundle(): Promise<{ sceneId: string; entries: number; bytes: number } | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
      req.onsuccess = () => {
        const rec = req.result as BundleRecord | undefined
        if (!rec) return resolve(null)
        resolve({
          sceneId: rec.sceneId,
          entries: rec.entries.length,
          bytes: rec.entries.reduce((n, e) => n + (e.file?.size ?? 0), 0),
        })
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    } finally {
      db.close()
    }
  })
}

/**
 * Drop bundles written under a key this build no longer reads.
 *
 * The localStorage sweep has done this for documents since there were versions
 * to sweep; the bundle was the half that had none, so a file packed by an older
 * build kept being found and installed by a newer one long after the document
 * that named it was gone. Runs once at boot, costs one delete, and is the only
 * thing standing between a user and megabytes they cannot see or clear.
 */
export async function sweepRetiredBundles(): Promise<void> {
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite")
      // The un-versioned original. Nothing else joins this list: a version bump
      // now retires a whole generation at once.
      tx.objectStore(STORE).delete("local")
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    } finally {
      db.close()
    }
  })
}

export async function clearLocalBundle(): Promise<void> {
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    } finally {
      db.close()
    }
  })
}

/**
 * A model's extracted cast colour, remembered.
 *
 * Extraction decodes the model's textures and weighs them, which costs a few
 * hundred milliseconds — long enough that the swatch visibly arrives after the
 * row it belongs to. The answer only depends on the model's own bytes, so it is
 * worth remembering: the same model shows its colour immediately on every load
 * after the first.
 *
 * Keyed by the model's SOURCE PATH, which is stable across reloads for both a
 * site-served model and one unpacked from a scene bundle. A model uploaded this
 * second has no path until the scene is saved, so its first load extracts and
 * the next one reads this. Wrong colours are impossible by construction: a
 * different path is a different key.
 */
export async function loadCastPalette(key: string): Promise<string | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(PALETTE_STORE, "readonly").objectStore(PALETTE_STORE).get(key)
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    } finally {
      db.close()
    }
  })
}

export async function saveCastPalette(key: string, palette: string): Promise<void> {
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PALETTE_STORE, "readwrite")
      tx.objectStore(PALETTE_STORE).put(palette, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    } finally {
      db.close()
    }
  })
}
