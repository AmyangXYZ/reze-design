"use client"

// The person's own AI connections: which services they connected, with which
// key, which of those services' models they use, and the one in use now.
//
// Kept in THIS BROWSER only, and used from here: every request on a person's
// own key goes from their browser straight to the service, over their own
// network. No copy of a key exists anywhere else — a cleared browser simply
// means making a new key at the service (the menu links to the page for it).

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

/** The providers, loaded the first time a person's own connection is used —
 *  they are not part of the editor's first load. */
const providers = () => import("@/lib/ai/providers")

const viaOfConnection = (c: Connection, model = ""): Via => ({ provider: c.provider, key: c.key, model, ...(c.baseURL ? { baseURL: c.baseURL } : {}) })

/** Verify one model of a connection, and record the verdict. */
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
  const [{ routeOf }, { verify }] = await Promise.all([providers(), import("@/lib/ai/verify")])
  const route = routeOf(viaOfConnection(c, model))
  if ("error" in route) return setEntry({ id: model, verdict: "error", error: route.error })
  const out = await verify(route)
  setEntry({ id: model, verdict: out.verdict, ...(out.error ? { error: out.error } : {}) })
}

/** The models a key can use, from the service itself. Throws the service's
 *  words when the key is refused. */
export async function listModels(via: Omit<Via, "model">): Promise<string[]> {
  const { routeOf } = await providers()
  const route = routeOf(via, false)
  if ("error" in route) throw new Error(route.error)
  return [...new Set(await route.provider.models(route.target))].sort()
}

/** Delete what a cleared conversation uploaded to the person's own service. */
export async function deleteOwnFiles(via: Via, ids: string[]) {
  const { routeOf } = await providers()
  const route = routeOf(via)
  if (!("error" in route)) await route.provider.deleteFiles(route.target, ids)
}
