// The art director's loop, in the browser: ask the model, run the tools it
// asks for, hand back what they found, and go round again until it is done.
//
// This is the whole of what makes it an agent rather than a chat. One request
// from the user can be many rounds — change, capture, judge, change again —
// with no one in between; it ends when the model stops asking for tools, when
// the user presses stop, or at a round limit that makes it wrap up.
//
// The model is reached through /api/agent, one call per round. The history
// here is APPEND-ONLY: every reply is kept exactly as it came back (thinking
// included) and nothing earlier is ever rewritten — the model's reasoning is
// bound to the history it was produced against. The one replacement is the
// newest message, swapped for the copy the server actually sent (images
// uploaded and referenced by id) before anything follows it.

import type Anthropic from "@anthropic-ai/sdk"
import type { ToolResult } from "@/lib/ai/scene-tools"

export type AgentMessage = Anthropic.Beta.BetaMessageParam

/** One line of /api/agent's stream. */
export type AgentStreamEvent =
  | { type: "sent"; message: AgentMessage }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "message"; content: Anthropic.Beta.BetaContentBlock[]; stopReason: string | null; usage: unknown }
  | { type: "error"; message: string }

/** What the loop tells the panel as it goes. */
export type AgentProgress =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool-done"; name: string; ok: boolean }
  | { type: "history"; messages: AgentMessage[] }

export type AgentOutcome = { messages: AgentMessage[]; ended: "done" | "stopped" | "limit" | "refused" | "error"; error?: string }

/** Rounds before the loop tells the model to wrap up. */
export const MAX_ROUNDS = 24

/** A tool's result as the model reads it: the data as JSON, then its images. */
export function toolResultBlock(id: string, result: ToolResult): Anthropic.Beta.BetaToolResultBlockParam {
  const data = result.data as { error?: unknown } | null
  const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = [{ type: "text", text: JSON.stringify(result.data) }]
  for (const im of result.images ?? []) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.*)$/.exec(im.dataUrl)
    if (!m) continue
    content.push({ type: "text", text: `Image: ${im.label}` })
    content.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } })
  }
  return { type: "tool_result", tool_use_id: id, content, ...(data && typeof data === "object" && "error" in data ? { is_error: true } : {}) }
}

/** Read an NDJSON response line by line. */
async function* lines(res: Response): AsyncGenerator<AgentStreamEvent> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) yield JSON.parse(line) as AgentStreamEvent
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as AgentStreamEvent
}

/**
 * Run the loop from `history`, whose last message is the user's new request.
 * Resolves with the history as it stands at the end — always well-formed:
 * every tool call the model made has its answer, even when stopped.
 */
export async function runAgent(opts: {
  history: AgentMessage[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  onProgress: (p: AgentProgress) => void
  signal: AbortSignal
  endpoint?: string
  maxRounds?: number
}): Promise<AgentOutcome> {
  const messages = [...opts.history]
  const max = opts.maxRounds ?? MAX_ROUNDS
  const publish = () => opts.onProgress({ type: "history", messages: [...messages] })

  for (let round = 0; ; round++) {
    if (opts.signal.aborted) return { messages, ended: "stopped" }
    let res: Response
    try {
      res = await fetch(opts.endpoint ?? "/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: opts.signal,
      })
    } catch (e) {
      if (opts.signal.aborted) return { messages, ended: "stopped" }
      return { messages, ended: "error", error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { messages, ended: "error", error: body.error ?? `HTTP ${res.status}` }
    }

    let reply: Extract<AgentStreamEvent, { type: "message" }> | null = null
    try {
      for await (const e of lines(res)) {
        if (e.type === "sent") {
          messages[messages.length - 1] = e.message
          publish()
        } else if (e.type === "text" || e.type === "thinking") opts.onProgress(e)
        else if (e.type === "message") reply = e
        else if (e.type === "error") return { messages, ended: "error", error: e.message }
      }
    } catch (e) {
      if (opts.signal.aborted) return { messages, ended: "stopped" }
      return { messages, ended: "error", error: e instanceof Error ? e.message : String(e) }
    }
    if (!reply) return { messages, ended: opts.signal.aborted ? "stopped" : "error", error: "the reply was cut off" }

    messages.push({ role: "assistant", content: reply.content as Anthropic.Beta.BetaContentBlockParam[] })
    publish()
    if (reply.stopReason === "refusal") return { messages, ended: "refused" }
    if (reply.stopReason === "pause_turn") continue

    const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    if (calls.length === 0) return { messages, ended: "done" }
    // A call cut off at the token limit may parse as a smaller valid one;
    // never run it.
    if (reply.stopReason === "max_tokens") {
      messages.push({
        role: "user",
        content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Your reply hit the length limit before this call was complete; it was not run." })),
      })
      publish()
      continue
    }

    // One at a time, in order: each tool sees the scene the one before left
    // (useSceneTools waits a render after each).
    const results: Anthropic.Beta.BetaContentBlockParam[] = []
    for (const call of calls) {
      if (opts.signal.aborted) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Stopped by the user before this ran." })
        continue
      }
      const input = (call.input ?? {}) as Record<string, unknown>
      opts.onProgress({ type: "tool", name: call.name, input })
      const result = await opts.runTool(call.name, input)
      const block = toolResultBlock(call.id, result)
      opts.onProgress({ type: "tool-done", name: call.name, ok: !block.is_error })
      results.push(block)
    }
    if (round + 1 >= max && !opts.signal.aborted) {
      results.push({ type: "text", text: "That is the last round for this request. Do not call more tools: say what you changed, where it stands, and what is left." })
    }
    messages.push({ role: "user", content: results })
    publish()
    if (opts.signal.aborted) return { messages, ended: "stopped" }
    if (round + 1 > max) return { messages, ended: "limit" }
  }
}

/**
 * A saved history made whole again. A page closed mid-run can leave the last
 * reply's tool calls with no answers, and the API refuses a history like that
 * — so each one is answered as interrupted. Appended, never rewritten: the
 * history stays a prefix of itself.
 */
export function settle(messages: AgentMessage[]): AgentMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant" || typeof last.content === "string") return messages
  const calls = last.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
  if (!calls.length) return messages
  return [
    ...messages,
    {
      role: "user",
      content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Interrupted: the page was closed before this ran." })),
    },
  ]
}

/** Every uploaded file the conversation references — to delete with it. */
export function filesIn(messages: AgentMessage[]): string[] {
  const out = new Set<string>()
  const walk = (b: unknown) => {
    if (!b || typeof b !== "object") return
    const block = b as { type?: string; source?: { type?: string; file_id?: string }; content?: unknown }
    if (block.type === "image" && block.source?.type === "file" && block.source.file_id) out.add(block.source.file_id)
    if (Array.isArray(block.content)) block.content.forEach(walk)
  }
  for (const m of messages) if (Array.isArray(m.content)) m.content.forEach(walk)
  return [...out]
}
