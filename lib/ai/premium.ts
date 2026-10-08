import "server-only"

// Premium: this server's own key. Claude on a developer's own `next dev`, GPT
// in production, AGENT_PROVIDER to force one.

import { anthropicProvider } from "@/lib/ai/providers/anthropic"
import { openaiProvider } from "@/lib/ai/providers/openai"
import type { Provider, Target } from "@/lib/ai/providers/types"

export type Route = { provider: Provider; target: Target }

/** Null when the server has no key. */
export function premiumRoute(): Route | null {
  const forced = process.env.AGENT_PROVIDER
  const api = forced === "anthropic" || forced === "openai" ? forced : process.env.NODE_ENV === "development" ? "anthropic" : "openai"
  if (api === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return null
    return { provider: anthropicProvider, target: { key, model: process.env.AGENT_ANTHROPIC_MODEL || "claude-opus-5-5", baseURL: "https://api.anthropic.com" } }
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return { provider: openaiProvider, target: { key, model: process.env.AGENT_OPENAI_MODEL || "gpt-6.1-sol", baseURL: "https://api.openai.com/v1" } }
}
