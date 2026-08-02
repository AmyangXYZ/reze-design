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

const DB_NAME = "reze-design"
// v2: an earlier (reverted) experiment shipped this database at v1 with a different
// store. Same name + same version means onupgradeneeded never fires, the store this
// code needs never exists, and every transaction throws — silently, through the
// failure-tolerant wrappers. The bump forces the upgrade on browsers that ran it.
const DB_VERSION = 2
const STORE = "local-bundle"
const KEY = "local"

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
        resolve(rec.entries.map((e) => new File([e.file], e.path, { type: e.file.type })))
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
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
