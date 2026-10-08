// The AI services a person can connect with their own key.
//
// Plain module: the server reads it to know where to send a request, the AI
// panel's menu reads it to offer the choices. Three wire formats cover them
// all — Anthropic's Messages API, OpenAI's Responses API, and the Chat
// Completions API that everyone else speaks (lib/ai/providers/compat.ts).

export type Api = "anthropic" | "openai" | "compat"

export type ProviderId = "anthropic" | "openai" | "gemini" | "deepseek" | "qwen" | "qwen-cn" | "xai" | "openrouter" | "custom"

export type Preset = {
  id: ProviderId
  label: string
  api: Api
  /** Where requests go. Empty for custom, which the person supplies. */
  baseURL: string
  /** Where to make (or remake) a key. */
  keyUrl: string
  /** Models that see pictures and call tools, newest first — what the model
   *  list opens on. Shown only where the service's own list has them, so a
   *  retired name drops out instead of failing. */
  recommended: string[]
}

export const PRESETS: Preset[] = [
  { id: "anthropic", label: "Claude", api: "anthropic", baseURL: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys", recommended: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  { id: "openai", label: "OpenAI", api: "openai", baseURL: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", recommended: ["gpt-6.1-sol", "gpt-5.4-mini"] },
  { id: "gemini", label: "Gemini", api: "compat", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", recommended: ["gemini-3.8-flash", "gemini-3.1-pro-preview"] },
  { id: "deepseek", label: "DeepSeek", api: "compat", baseURL: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", recommended: ["deepseek-flash"] },
  { id: "qwen", label: "Qwen", api: "compat", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key", recommended: ["qwen3.8-max", "qwen3.7-plus"] },
  { id: "qwen-cn", label: "通义千问", api: "compat", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key", recommended: ["qwen3.8-max", "qwen3.7-plus"] },
  { id: "xai", label: "Grok", api: "compat", baseURL: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", recommended: ["grok-4.7"] },
  { id: "openrouter", label: "OpenRouter", api: "compat", baseURL: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", recommended: ["anthropic/claude-opus-5.5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "qwen/qwen3.8-max", "deepseek/deepseek-v4.1-flash", "x-ai/grok-4.7"] },
  { id: "custom", label: "Custom", api: "compat", baseURL: "", keyUrl: "", recommended: [] },
]

export const presetOf = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)

/** What verifying a connection found (lib/ai/verify). */
export type Verdict = "ready" | "noVision" | "noTools" | "error"

/** A person's own connection, as a request carries it. */
export type Via = { provider: ProviderId; key: string; model: string; baseURL?: string }
