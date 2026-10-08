// Which provider and target the person's own connection goes to. Runs in
// their browser: the request leaves from their own network, so a service
// their network reaches — a mainland one, or a model on their own machine —
// is one they can use.

import { anthropicProvider } from "@/lib/ai/providers/anthropic"
import { compatProvider } from "@/lib/ai/providers/compat"
import { openaiProvider } from "@/lib/ai/providers/openai"
import { presetOf, type Api, type Via } from "@/lib/ai/providers/presets"
import type { Provider, Target } from "@/lib/ai/providers/types"

const BY_API: Record<Api, Provider> = { anthropic: anthropicProvider, openai: openaiProvider, compat: compatProvider }

export type Route = { provider: Provider; target: Target }

/** A custom server's address, as typed: http or https, no trailing slash. */
export function serverAddress(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().replace(/\/+$/, "") : null
  } catch {
    return null
  }
}

/** The person's connection as a provider and target, or why it cannot be one.
 *  A custom server may need no key — a local one usually does not. */
export function routeOf(via: Partial<Via>, needModel = true): Route | { error: string } {
  const preset = presetOf(String(via.provider))
  if (!preset) return { error: "unknown provider" }
  const key = typeof via.key === "string" ? via.key.trim() : ""
  if (!key && preset.id !== "custom") return { error: "no key" }
  if (needModel && (typeof via.model !== "string" || !via.model.trim())) return { error: "no model" }
  const baseURL = preset.id === "custom" ? serverAddress(String(via.baseURL ?? "")) : preset.baseURL
  if (!baseURL) return { error: "the server address must start with http:// or https://" }
  return { provider: BY_API[preset.api], target: { key, model: String(via.model ?? "").trim(), baseURL } }
}
