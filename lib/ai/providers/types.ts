// What the agent route asks of a model provider: one turn, streamed.
//
// The conversation is kept in ONE shape whichever model answers — Anthropic's
// message blocks, which is what the browser stores, shows and re-sends — and
// each provider translates at its edge. So the loop, the panel and a saved
// conversation never learn which model is on the other end; switching is the
// route's decision alone (see app/api/agent/route.ts).
//
// A turn: upload any inline images in the newest message and say so with a
// `sent` event (the browser keeps that copy), stream text / thinking / tool
// starts as they come, and finish with one `message` event carrying the reply
// in the shared shape and a stop reason in Anthropic's words — tool_use,
// end_turn, max_tokens, refusal — which is what the loop reads.

import type { AgentMessage, AgentStreamEvent } from "@/lib/ai/agent-loop"
import type { Api } from "@/lib/ai/providers/presets"

/** A failed turn, saying whether the same request could succeed if tried
 *  again — the provider busy, overloaded or failing, the connection dropped —
 *  or not (a refused key, a malformed request). The loop retries the first. */
export class TurnError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

/** A base64 string's bytes, in a browser or on the server alike. */
export const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

/** Where one turn goes: whose key, which model, which server. */
export type Target = { key: string; model: string; baseURL: string }

export type TurnArgs = {
  target: Target
  messages: AgentMessage[]
  system: string
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]
  send: (e: AgentStreamEvent) => void
  signal: AbortSignal
}

export type Provider = {
  api: Api
  turn: (args: TurnArgs) => Promise<void>
  /** The models this key can use, by id. */
  models: (target: Omit<Target, "model">) => Promise<string[]>
  /** Delete uploaded files by id — a conversation the user cleared. */
  deleteFiles: (target: Omit<Target, "model">, ids: string[]) => Promise<void>
}
