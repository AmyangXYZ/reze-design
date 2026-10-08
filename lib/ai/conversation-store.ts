// The AI conversation, kept in this browser.
//
// IndexedDB rather than localStorage: a conversation with a provider that takes
// no uploads carries its captures inline, a few hundred kilobytes each, and
// localStorage tops out around 5MB for the whole site. One record, one key.
// Every failure resolves quietly — a conversation that cannot be saved still
// works for this tab.

import type { AgentMessage } from "@/lib/ai/agent-loop"

export type SavedConversation = { messages: AgentMessage[]; thumbs: Record<number, string[]> }

const DB = "reze-agent"
const STORE = "conversation"
const KEY = "current"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function loadConversation(): Promise<SavedConversation | null> {
  try {
    const saved = (await run("readonly", (s) => s.get(KEY))) as SavedConversation | undefined
    return saved && Array.isArray(saved.messages) ? { messages: saved.messages, thumbs: saved.thumbs ?? {} } : null
  } catch {
    return null
  }
}

export async function saveConversation(saved: SavedConversation): Promise<void> {
  try {
    if (!saved.messages.length) await run("readwrite", (s) => s.delete(KEY))
    else await run("readwrite", (s) => s.put(saved, KEY))
  } catch {
    /* storage blocked or full — the conversation lives for this tab only */
  }
}
