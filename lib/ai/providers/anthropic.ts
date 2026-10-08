// Claude, through the Anthropic Messages API — from this server for Premium,
// from the person's own browser for their own key.
//
// The conversation's own shape is Anthropic's, so this is nearly a pass-
// through. What it adds: on the server, images uploaded once to the Files
// API (the history the browser re-sends stays small and is never rewritten,
// which preserved thinking needs); summarized adaptive thinking for the
// progress line, the whole prefix cached, stale tool results cleared
// server-side in a long session, and a fallback model when a request is
// declined.

import Anthropic, { toFile } from "@anthropic-ai/sdk"
import type { AgentMessage } from "@/lib/ai/agent-loop"
import { TurnError, bytesOf, type Provider, type Target, type TurnArgs } from "@/lib/ai/providers/types"

/** The client for a key, naming a workspace when it is this server's own
 *  organisation-wide key that needs it said (ANTHROPIC_WORKSPACE_ID). */
function client(target: Omit<Target, "model">): Anthropic {
  const workspace = target.key === process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_WORKSPACE_ID : undefined
  // No retries here: the loop retries a failed round itself. In a browser
  // the key is the person's own, sent from their own page.
  return new Anthropic({ apiKey: target.key, baseURL: target.baseURL, maxRetries: 0, dangerouslyAllowBrowser: true, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) })
}

type Block = Anthropic.Beta.BetaContentBlockParam

/**
 * A history another model wrote, made sendable here: its reasoning carries no
 * Anthropic signature (the API refuses an unsigned thinking block), its tool
 * calls may carry another service's fields, and its pictures were uploaded
 * somewhere this key cannot read. Ours pass untouched.
 */
function ownHistory(messages: AgentMessage[]): AgentMessage[] {
  const fix = (b: Block): Block[] => {
    if (b.type === "thinking" && !b.signature) return []
    // Gemini's thought signature rides on its tool calls; the API here takes no extra fields.
    if (b.type === "tool_use" && "extra_content" in b) {
      const call = { ...b } as typeof b & { extra_content?: unknown }
      delete call.extra_content
      return [call]
    }
    if (b.type === "image" && b.source.type === "file" && !b.source.file_id.startsWith("file_")) {
      return [{ type: "text", text: "(An earlier image, not available to this model.)" }]
    }
    if (b.type === "tool_result" && Array.isArray(b.content)) return [{ ...b, content: b.content.flatMap((x) => fix(x as Block)) as typeof b.content }]
    return [b]
  }
  return messages.map((m) => {
    if (typeof m.content === "string") return m
    const content = m.content.flatMap(fix)
    // A reply cut off by a closed page may hold only reasoning, which is
    // stripped above; the API refuses an empty turn.
    return { ...m, content: content.length ? content : [{ type: "text" as const, text: "(interrupted)" }] }
  })
}

/** The newest message with every inline image uploaded and referenced by id. */
async function uploadImages(c: Anthropic, message: AgentMessage): Promise<AgentMessage> {
  if (typeof message.content === "string") return message
  const upload = async (b: Block): Promise<Block> => {
    if (b.type === "image" && b.source.type === "base64") {
      const ext = b.source.media_type.split("/")[1] ?? "jpeg"
      const file = await c.files.upload({
        file: await toFile(bytesOf(b.source.data), `capture.${ext}`, { type: b.source.media_type }),
      })
      return { type: "image", source: { type: "file", file_id: file.id } }
    }
    if (b.type === "tool_result" && Array.isArray(b.content)) {
      return { ...b, content: (await Promise.all(b.content.map((x) => upload(x as Block)))) as typeof b.content }
    }
    return b
  }
  return { ...message, content: await Promise.all(message.content.map(upload)) }
}

async function turn({ target, messages, system, tools, send, signal }: TurnArgs): Promise<void> {
  const c = client(target)
  // Anthropic's file store refuses requests from a web page (no CORS), so
  // in the person's browser pictures go inline — the loop re-sends only the
  // latest few. On this server (Premium) each is uploaded once.
  const last = typeof window === "undefined" ? await uploadImages(c, messages[messages.length - 1]) : messages[messages.length - 1]
  send({ type: "sent", message: last })
  try {
    const reply = c.beta.messages.stream(
      {
        model: target.model,
        max_tokens: 32000,
        system: [{ type: "text", text: system }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
        messages: ownHistory([...messages.slice(0, -1), last]),
        // Summaries of the reasoning, so the panel shows progress while the
        // model works out what to do.
        thinking: { type: "adaptive", display: "summarized" },
        // Medium, the model's own default: high made each round's think
        // noticeably longer for little better judgement on this work.
        output_config: { effort: "medium" },
        // Caches the whole prefix — tools, system, the conversation so far.
        cache_control: { type: "ephemeral" },
        // Old captures are the bulk of a long session; the server clears
        // stale tool results (never the latest few), which leaves thinking
        // intact where a client-side rewrite would not.
        context_management: {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              trigger: { type: "input_tokens", value: 80_000 },
              keep: { type: "tool_uses", value: 8 },
              clear_at_least: { type: "input_tokens", value: 20_000 },
            },
          ],
        },
        // A safety decline re-runs on a fallback model rather than ending the turn.
        fallbacks: "default",
        betas: ["context-management-2025-06-27", "server-side-fallback-2026-07-01"],
      },
      { signal },
    )
    for await (const event of reply) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        send({ type: "tool", name: event.content_block.name })
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") send({ type: "text", text: event.delta.text })
        else if (event.delta.type === "thinking_delta") send({ type: "thinking", text: event.delta.thinking })
      }
    }
    const final = await reply.finalMessage()
    const u = final.usage
    // Anthropic counts cache reads and writes apart from input_tokens.
    const cachedIn = u.cache_read_input_tokens ?? 0
    const input = u.input_tokens + cachedIn + (u.cache_creation_input_tokens ?? 0)
    send({ type: "message", content: final.content, stopReason: final.stop_reason, usage: { input, output: u.output_tokens, cached: cachedIn } })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new TurnError("the model is busy — try again in a moment", true)
    if (e instanceof Anthropic.APIConnectionError) throw new TurnError(`connection to the model failed: ${e.message}`, true)
    if (e instanceof Anthropic.APIError) throw new TurnError(`model error ${e.status ?? ""}: ${e.message}`, (e.status ?? 500) >= 500 || e.status === 408 || e.status === 409)
    throw new TurnError(e instanceof Error ? e.message : String(e), false)
  }
}

export const anthropicProvider: Provider = {
  api: "anthropic",
  turn,
  models: async (target) => {
    const ids: string[] = []
    for await (const m of client(target).models.list({ limit: 100 })) ids.push(m.id)
    return ids
  },
  deleteFiles: async (target, ids) => {
    const c = client(target)
    await Promise.all(ids.map((id) => c.files.delete(id).catch(() => null)))
  },
}
