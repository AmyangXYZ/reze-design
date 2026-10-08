"use client"

// The person's own AI connections: which services they connected, with which
// key, which of those services' models they use, and the one in use now.
//
// Kept in THIS BROWSER only. A key is sent with each request and passes
// through the server, which never stores it — so there is no copy anywhere
// else to lose or leak, and a cleared browser simply means making a new key at
// the provider (the menu links straight to the page for it).

import { useSyncExternalStore } from "react"
import { storageKey } from "@/lib/storage"
import { presetOf, type ProviderId, type Verdict, type Via } from "@/lib/ai/providers/presets"

export type ModelEntry = { id: string; verdict: Verdict | "checking"; error?: string }

export type Connection = {
  id: string
  provider: ProviderId
  key: string
  /** Custom only: where its server is. */
  baseURL?: string
  models: ModelEntry[]
}

/** What the next request uses: Premium (this server's key), or one model of
 *  one connection. */
export type Active = { connection: "premium" } | { connection: string; model: string }

export type AiSettings = { connections: Connection[]; active: Active | null }

const KEY = storageKey("ai.connections")
const EMPTY: AiSettings = { connections: [], active: null }

let current: AiSettings | null = null
const listeners = new Set<() => void>()

function read(): AiSettings {
  if (current) return current
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as AiSettings) : EMPTY
    current = { connections: Array.isArray(parsed.connections) ? parsed.connections : [], active: parsed.active ?? null }
  } catch {
    current = EMPTY
  }
  return current
}

export function updateAi(fn: (s: AiSettings) => AiSettings) {
  current = fn(read())
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* storage blocked — the settings last for this tab */
  }
  for (const l of listeners) l()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAiSettings(): AiSettings {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** The model a request uses, resolved: what was picked if it still exists,
 *  else Premium where there is Premium, else the first model that passed. */
export function resolveActive(s: AiSettings, premium: boolean): Active | null {
  const a = s.active
  if (a?.connection === "premium" && premium) return a
  if (a && "model" in a && s.connections.some((c) => c.id === a.connection && c.models.some((m) => m.id === a.model))) return a
  if (premium) return { connection: "premium" }
  for (const c of s.connections) {
    const m = c.models.find((x) => x.verdict === "ready")
    if (m) return { connection: c.id, model: m.id }
  }
  return null
}

/** The connection as a request carries it; null for Premium or nothing. */
export function viaOf(s: AiSettings, active: Active | null): Via | null {
  if (!active || !("model" in active)) return null
  const c = s.connections.find((x) => x.id === active.connection)
  if (!c) return null
  return { provider: c.provider, key: c.key, model: active.model, ...(c.baseURL ? { baseURL: c.baseURL } : {}) }
}

/** What a connection is called in a list: its service, and the key's last
 *  four characters to tell two of the same service apart. */
export function connectionLabel(c: Connection): string {
  const name = c.provider === "custom" && c.baseURL ? new URL(c.baseURL).hostname : (presetOf(c.provider)?.label ?? c.provider)
  return `${name} ··${c.key.slice(-4)}`
}

/** Ask the server to verify one model of a connection, and record the verdict. */
export async function verifyModel(connectionId: string, model: string) {
  const setEntry = (entry: ModelEntry) =>
    updateAi((s) => ({
      ...s,
      connections: s.connections.map((c) =>
        c.id !== connectionId ? c : { ...c, models: c.models.some((m) => m.id === model) ? c.models.map((m) => (m.id === model ? entry : m)) : [...c.models, entry] },
      ),
    }))
  const c = read().connections.find((x) => x.id === connectionId)
  if (!c) return
  setEntry({ id: model, verdict: "checking" })
  try {
    const res = await fetch("/api/agent/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ via: { provider: c.provider, key: c.key, model, ...(c.baseURL ? { baseURL: c.baseURL } : {}) } }),
    })
    const out = (await res.json().catch(() => ({}))) as { verdict?: Verdict; error?: string }
    setEntry({ id: model, verdict: res.ok ? (out.verdict ?? "error") : "error", ...(out.error ? { error: out.error } : {}) })
  } catch (e) {
    setEntry({ id: model, verdict: "error", error: e instanceof Error ? e.message : String(e) })
  }
}

/** The models a key can use, from the provider itself. Throws the server's
 *  words when the key is refused. */
export async function listModels(via: Omit<Via, "model">): Promise<string[]> {
  const res = await fetch("/api/agent/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ via }) })
  const out = (await res.json().catch(() => ({}))) as { models?: string[]; error?: string }
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`)
  return out.models ?? []
}
