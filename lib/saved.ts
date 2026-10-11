// The last good copy of a server list, kept in this browser.
//
// So the libraries and the gallery open full on a cold start even when the
// server cannot be reached, then refresh underneath. For a visitor on a lossy
// route (lib/net) most of what they browse is what they browsed last time, and
// an empty library is a worse answer than a slightly old one.
//
// IndexedDB, not localStorage: the public library is over a megabyte of JSON
// (every effect's WGSL, every graph), and localStorage's few megabytes per
// site are where drafts live — a full one would stop drafts saving.
//
// A cache, never a source of truth: anything here can be missing, stale, or
// from an older shape, and every reader falls back to "nothing saved". The
// version in each key is bumped when a shape changes, which drops old copies.

const DB = "reze-design-saved"
const STORE = "kv"

let opened: Promise<IDBDatabase | null> | null = null
function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      // Blocked, private mode, no IndexedDB at all: there is just nothing saved.
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opened
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const req = op(db.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve((req.result as T) ?? null)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export function readSaved<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return run<T>("readonly", (s) => s.get(key))
}

/** Fire and forget: a save that fails only means the next cold start waits. */
export function writeSaved(key: string, value: unknown): void {
  if (typeof indexedDB === "undefined") return
  void run("readwrite", (s) => s.put(value, key))
}

export function clearSaved(key: string): void {
  if (typeof indexedDB === "undefined") return
  void run("readwrite", (s) => s.delete(key))
}
