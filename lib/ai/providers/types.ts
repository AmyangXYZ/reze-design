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

export type TurnArgs = {
  messages: AgentMessage[]
  system: string
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]
  send: (e: AgentStreamEvent) => void
  signal: AbortSignal
}

export type Provider = {
  name: "anthropic" | "openai"
  /** The environment variable its key lives in. */
  keyEnv: string
  turn: (args: TurnArgs) => Promise<void>
  /** Delete uploaded files by id — a conversation the user cleared. */
  deleteFiles: (ids: string[]) => Promise<void>
}
