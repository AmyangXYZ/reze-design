// The AI conversations, kept in this browser — one record per conversation,
// and an index of the tabs: their order, their titles, which one is open.
//
// IndexedDB rather than localStorage: a conversation with a provider that takes
// no uploads carries its captures inline, a few hundred kilobytes each, and
// localStorage tops out around 5MB for the whole site. The index is small and
// read first, so the tab strip draws without loading every conversation.
// Every failure resolves quietly — a conversation that cannot be saved still
// works for this tab.

import type { AgentMessage, Usage } from "@/lib/ai/agent-loop"

export type SavedConversation = {
  messages: AgentMessage[]
  thumbs: Record<number, string[]>
  /** A run was going when this was written: read back, it was cut off. */
  running?: boolean
  /** The last request's tokens; null where the service did not say. */
  lastRun?: Usage | null
}

export type ConversationTab = { id: string; title: string }
export type ConversationIndex = { tabs: ConversationTab[]; active: string | null }

const DB = "reze-agent"
const STORE = "conversations"
const INDEX = "index"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    // v2: many conversations. v1's single "conversation" store is dropped.
    req.onupgradeneeded = () => {
      const db = req.result
      if (db.objectStoreNames.contains("conversation")) db.deleteObjectStore("conversation")
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
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

export async function loadIndex(): Promise<ConversationIndex> {
  try {
    const index = (await run("readonly", (s) => s.get(INDEX))) as ConversationIndex | undefined
    return index && Array.isArray(index.tabs) ? index : { tabs: [], active: null }
  } catch {
    return { tabs: [], active: null }
  }
}

export async function saveIndex(index: ConversationIndex): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(index, INDEX))
  } catch {
    /* storage blocked or full */
  }
}

export async function loadConversation(id: string): Promise<SavedConversation | null> {
  try {
    const saved = (await run("readonly", (s) => s.get(id))) as SavedConversation | undefined
    return saved && Array.isArray(saved.messages)
      ? { messages: saved.messages, thumbs: saved.thumbs ?? {}, running: saved.running === true, lastRun: saved.lastRun }
      : null
  } catch {
    return null
  }
}

export async function saveConversation(id: string, saved: SavedConversation): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(saved, id))
  } catch {
    /* storage blocked or full — the conversation lives for this tab only */
  }
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(id))
  } catch {
    /* nothing to delete */
  }
}
