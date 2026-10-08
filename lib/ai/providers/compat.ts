// Every other model, through the Chat Completions API that Gemini, DeepSeek,
// Qwen, Grok, OpenRouter and most self-hosted servers speak. Server only.
//
// The conversation arrives in the shared shape (Anthropic's blocks — see
// ./types) and is translated on the way out:
//
//   user text / images        → a user message of text / image_url parts
//   tool_result               → a tool message (text only — the API takes no
//                               pictures there), its images in a user message
//                               straight after the results
//   assistant text            → the assistant message's content
//   tool_use                  → its tool_calls
//   thinking                  → its reasoning_details, where the model gave
//                               some (OpenRouter asks for them back unchanged)
//
// and the reply on the way back: content → text, tool_calls → tool_use, the
// streamed reasoning → a thinking block. No file uploads: pictures travel as
// data URLs, and the browser stops re-sending all but the latest few
// (lib/ai/agent-loop), which keeps every request small.

import OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentMessage } from "@/lib/ai/agent-loop"
import { TurnError, type Provider, type Target, type TurnArgs } from "@/lib/ai/providers/types"

type Block = Anthropic.Beta.BetaContentBlockParam
type Msg = OpenAI.Chat.ChatCompletionMessageParam
type Part = OpenAI.Chat.ChatCompletionContentPart
type ImageSource = { type: string; data?: string; media_type?: string; url?: string }
type Detail = Record<string, unknown>

const client = (target: Omit<Target, "model">) => new OpenAI({ apiKey: target.key, baseURL: target.baseURL })

const UNAVAILABLE = "(An earlier image, not available to this model.)"

function imagePart(source: ImageSource): Part {
  if (source.type === "base64" && source.data) return { type: "image_url", image_url: { url: `data:${source.media_type ?? "image/jpeg"};base64,${source.data}` } }
  if (source.type === "url" && source.url) return { type: "image_url", image_url: { url: source.url } }
  // A file id belongs to the provider that uploaded it.
  return { type: "text", text: UNAVAILABLE }
}

/** The shared history as Chat Completions messages. */
export function toMessages(system: string, messages: AgentMessage[]): Msg[] {
  const out: Msg[] = [{ role: "system", content: system }]
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content
    if (m.role === "assistant") {
      const text = blocks.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text] : [])).join("\n\n")
      const calls = blocks.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : [],
      )
      const details = blocks.flatMap((b) => (b.type === "thinking" ? ((b as { reasoning_details?: Detail[] }).reasoning_details ?? []) : []))
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(details.length ? { reasoning_details: details } : {}),
      } as Msg)
      continue
    }
    const pictures: Part[] = []
    const parts: Part[] = []
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const content = typeof b.content === "string" ? [{ type: "text" as const, text: b.content }] : (b.content ?? [])
        // The first text is the tool's data; what follows is its pictures and their labels.
        const [data, ...rest] = content
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: data?.type === "text" ? data.text : "(no output)" })
        for (const c of data?.type === "text" ? rest : content) {
          if (c.type === "text") pictures.push({ type: "text", text: c.text })
          else if (c.type === "image") pictures.push(imagePart(c.source as ImageSource))
        }
      } else if (b.type === "text") parts.push({ type: "text", text: b.text })
      else if (b.type === "image") parts.push(imagePart(b.source as ImageSource))
    }
    if (pictures.length) out.push({ role: "user", content: [{ type: "text", text: "The pictures from those results:" }, ...pictures, ...parts] })
    else if (parts.length) out.push({ role: "user", content: parts })
  }
  return out
}

/** Streamed reasoning details, put back together: pieces of one detail share an
 *  index, their text-like fields concatenate, the rest arrive once. */
function mergeDetails(into: Detail[], pieces: Detail[]) {
  for (const p of pieces) {
    const at = typeof p.index === "number" ? into.findIndex((d) => d.index === p.index && d.type === p.type) : -1
    if (at < 0) {
      into.push({ ...p })
      continue
    }
    const d = into[at]
    for (const [k, v] of Object.entries(p)) {
      if (["text", "summary", "data"].includes(k) && typeof v === "string") d[k] = `${(d[k] as string | undefined) ?? ""}${v}`
      else if (v != null) d[k] = v
    }
  }
}

type Delta = {
  content?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
  reasoning_details?: Detail[]
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

async function turn({ target, messages, system, tools, send, signal }: TurnArgs): Promise<void> {
  const c = client(target)
  // Nothing to upload: the newest message goes as it is.
  send({ type: "sent", message: messages[messages.length - 1] })
  const openrouter = target.baseURL.startsWith("https://openrouter.ai/")
  try {
    const stream = await c.chat.completions.create(
      {
        model: target.model,
        messages: toMessages(system, messages),
        tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
        stream: true,
        // OpenRouter's own fields: reasoning at the models' default effort, and
        // Claude's prefix cached (the other providers cache on their own).
        ...(openrouter ? { reasoning: { effort: "medium" }, ...(target.model.startsWith("anthropic/") ? { cache_control: { type: "ephemeral" } } : {}) } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    )
    let text = ""
    let thinking = ""
    const details: Detail[] = []
    const calls: { id: string; name: string; args: string }[] = []
    let finish: string | null = null
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const d = choice.delta as Delta
      if (d.content) {
        text += d.content
        send({ type: "text", text: d.content })
      }
      const r = d.reasoning ?? d.reasoning_content
      if (r) {
        thinking += r
        send({ type: "thinking", text: r })
      }
      if (d.reasoning_details?.length) mergeDetails(details, d.reasoning_details)
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? calls.length
        calls[i] ??= { id: "", name: "", args: "" }
        if (tc.id) calls[i].id = tc.id
        if (tc.function?.name && !calls[i].name) {
          calls[i].name = tc.function.name
          send({ type: "tool", name: tc.function.name })
        }
        if (tc.function?.arguments) calls[i].args += tc.function.arguments
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }

    const content: Anthropic.Beta.BetaContentBlock[] = []
    if (thinking.trim() || details.length) {
      content.push({ type: "thinking", thinking: thinking.trim(), signature: "", ...(details.length ? { reasoning_details: details } : {}) } as Anthropic.Beta.BetaContentBlock)
    }
    if (text) content.push({ type: "text", text, citations: null } as Anthropic.Beta.BetaContentBlock)
    const made = calls.filter((x) => x?.name)
    for (const [i, call] of made.entries()) {
      let input: unknown = {}
      try {
        input = JSON.parse(call.args || "{}")
      } catch {
        input = {}
      }
      content.push({ type: "tool_use", id: call.id || `call_${Date.now()}_${i}`, name: call.name, input } as Anthropic.Beta.BetaContentBlock)
    }
    const stopReason = finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : made.length ? "tool_use" : "end_turn"
    send({ type: "message", content, stopReason, usage: null })
  } catch (e) {
    if (e instanceof TurnError) throw e
    if (e instanceof OpenAI.RateLimitError) throw new TurnError("the model is busy — try again in a moment", true)
    if (e instanceof OpenAI.APIConnectionError) throw new TurnError(`connection to the model failed: ${e.message}`, true)
    if (e instanceof OpenAI.APIError) throw new TurnError(`model error ${e.status ?? ""}: ${e.message}`, (e.status ?? 500) >= 500 || e.status === 408 || e.status === 409)
    throw new TurnError(e instanceof Error ? e.message : String(e), false)
  }
}

type ListedModel = { id: string; architecture?: { input_modalities?: string[] }; supported_parameters?: string[] }

/** Models that are not for conversation at all — embeddings, speech, image
 *  making, reranking — by the names the services give them. */
const NOT_CHAT = /embed|rerank|tts|asr|whisper|transcri|speech|audio|realtime|moderation|imagine|imagen|-image|image-|wanx|wan2|flux|paraformer|cosyvoice|sambert|livetranslate/i

export const compatProvider: Provider = {
  api: "compat",
  turn,
  models: async (target) => {
    const ids: string[] = []
    for await (const m of client(target).models.list()) {
      const x = m as unknown as ListedModel
      // OpenRouter says what each model takes: only those that see and call tools.
      if (x.architecture?.input_modalities && !x.architecture.input_modalities.includes("image")) continue
      if (x.supported_parameters && !x.supported_parameters.includes("tools")) continue
      if (NOT_CHAT.test(x.id)) continue
      ids.push(x.id)
    }
    return ids
  },
  deleteFiles: async () => {},
}
