// Which provider and target a request goes to. Server only.
//
// A request names the person's own connection (`via`: provider, key, model),
// or none — and then it is Premium, on this server's keys: Claude on a
// developer's own `next dev`, GPT in production, AGENT_PROVIDER to force one.

import { anthropicProvider } from "@/lib/ai/providers/anthropic"
import { compatProvider } from "@/lib/ai/providers/compat"
import { openaiProvider } from "@/lib/ai/providers/openai"
import { presetOf, publicBaseURL, type Api, type Via } from "@/lib/ai/providers/presets"
import type { Provider, Target } from "@/lib/ai/providers/types"

const BY_API: Record<Api, Provider> = { anthropic: anthropicProvider, openai: openaiProvider, compat: compatProvider }

export type Route = { provider: Provider; target: Target }

/** The person's connection as a provider and target, or why it cannot be one. */
export function routeOf(via: Partial<Via>, needModel = true): Route | { error: string } {
  const preset = presetOf(String(via.provider))
  if (!preset) return { error: "unknown provider" }
  if (typeof via.key !== "string" || !via.key.trim()) return { error: "no key" }
  if (needModel && (typeof via.model !== "string" || !via.model.trim())) return { error: "no model" }
  const baseURL = preset.id === "custom" ? publicBaseURL(String(via.baseURL ?? "")) : preset.baseURL
  if (!baseURL) return { error: "the server address must be a public https address" }
  return { provider: BY_API[preset.api], target: { key: via.key.trim(), model: String(via.model ?? "").trim(), baseURL } }
}

/** Premium: this server's own key. Null when the server has none. */
export function premiumRoute(): Route | null {
  const forced = process.env.AGENT_PROVIDER
  const api: Api = forced === "anthropic" || forced === "openai" ? forced : process.env.NODE_ENV === "development" ? "anthropic" : "openai"
  if (api === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return null
    return { provider: anthropicProvider, target: { key, model: process.env.AGENT_ANTHROPIC_MODEL || "claude-opus-5-5", baseURL: "https://api.anthropic.com" } }
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return { provider: openaiProvider, target: { key, model: process.env.AGENT_OPENAI_MODEL || "gpt-6.1-sol", baseURL: "https://api.openai.com/v1" } }
}
