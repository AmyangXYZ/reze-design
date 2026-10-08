// Every other model, through the Chat Completions API that Gemini, DeepSeek,
// Qwen, Grok, OpenRouter and self-hosted servers (Ollama, LM Studio) speak.
// Runs in the person's own browser, with their own key, from their own
// network.
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
//                               some (OpenRouter asks for them back unchanged),
//                               and for DeepSeek its reasoning_content
//
// Two services refuse a history that lost what they handed out: Gemini wants
// each tool call's thought signature back (extra_content.google), DeepSeek
// every earlier reply's reasoning_content once tools are in play — both
// answer 400 without. Each is kept on its block and returned as it came.
//
// and the reply on the way back: content → text, tool_calls → tool_use, the
// streamed reasoning → a thinking block. No file uploads: pictures travel as
// data URLs, and the loop stops re-sending all but the latest few
// (lib/ai/agent-loop), which keeps every request small.
//
// Plain fetch rather than an SDK: a browser asks the service's permission
// (CORS) for every header a request carries, and some services allow only
// authorization and content-type — an SDK's own headers would be refused.

import type OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentMessage } from "@/lib/ai/agent-loop"
import { TurnError, type Provider, type Target, type TurnArgs } from "@/lib/ai/providers/types"

type Block = Anthropic.Beta.BetaContentBlockParam
type Msg = OpenAI.Chat.ChatCompletionMessageParam
type Part = OpenAI.Chat.ChatCompletionContentPart
type ImageSource = { type: string; data?: string; media_type?: string; url?: string }
type Detail = Record<string, unknown>

/** The two headers every service allows; a keyless local server gets one. */
const headers = (target: Omit<Target, "model">): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(target.key ? { Authorization: `Bearer ${target.key}` } : {}),
})

/** A refused request as a TurnError: busy and failing servers are worth
 *  another try, a refused key or request is not. */
async function refusal(res: Response): Promise<TurnError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string; message?: string } | null
  const said = typeof body?.error === "string" ? body.error : (body?.error?.message ?? body?.message ?? res.statusText)
  if (res.status === 429) return new TurnError("the model is busy — try again in a moment", true)
  return new TurnError(`model error ${res.status}: ${said}`, res.status >= 500 || res.status === 408 || res.status === 409)
}

/** A fetch that failed to reach the service at all. */
const unreachable = (e: unknown, target: Omit<Target, "model">) =>
  new TurnError(`connection to the model failed: ${new URL(target.baseURL).host} — ${e instanceof Error ? e.message : String(e)}`, true)

/** The data lines of a server-sent event stream, parsed. */
async function* events(res: Response): AsyncGenerator<Record<string, unknown>> {
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
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") return
      yield JSON.parse(data) as Record<string, unknown>
    }
  }
}

const UNAVAILABLE = "(An earlier image, not available to this model.)"

function imagePart(source: ImageSource): Part {
  if (source.type === "base64" && source.data) return { type: "image_url", image_url: { url: `data:${source.media_type ?? "image/jpeg"};base64,${source.data}` } }
  if (source.type === "url" && source.url) return { type: "image_url", image_url: { url: source.url } }
  // A file id belongs to the provider that uploaded it.
  return { type: "text", text: UNAVAILABLE }
}

/** What Gemini accepts on a tool call it did not make itself — one another
 *  model made, earlier in a conversation that switched. */
const FOREIGN_SIGNATURE = { google: { thought_signature: "skip_thought_signature_validator" } }

/** Where a request goes, for the services that need something of their own. */
export type Quirks = { gemini?: boolean; deepseek?: boolean }

export const quirksOf = (baseURL: string): Quirks => {
  const host = new URL(baseURL).host
  return { gemini: host === "generativelanguage.googleapis.com", deepseek: host === "api.deepseek.com" }
}

/** The shared history as Chat Completions messages. */
export function toMessages(system: string, messages: AgentMessage[], quirks: Quirks = {}): Msg[] {
  const out: Msg[] = [{ role: "system", content: system }]
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content
    if (m.role === "assistant") {
      const text = blocks.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text] : [])).join("\n\n")
      const calls = blocks.flatMap((b) => {
        if (b.type !== "tool_use") return []
        const extra = (b as { extra_content?: unknown }).extra_content ?? (quirks.gemini ? FOREIGN_SIGNATURE : undefined)
        return [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }, ...(extra ? { extra_content: extra } : {}) }]
      })
      const details = blocks.flatMap((b) => (b.type === "thinking" ? ((b as { reasoning_details?: Detail[] }).reasoning_details ?? []) : []))
      const reasoning = blocks.flatMap((b) => (b.type === "thinking" && b.thinking ? [b.thinking] : [])).join("")
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(details.length ? { reasoning_details: details } : {}),
        ...(quirks.deepseek ? { reasoning_content: reasoning } : {}),
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
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[]
}

async function turn({ target, messages, system, tools, send, signal }: TurnArgs): Promise<void> {
  // Nothing to upload: the newest message goes as it is.
  send({ type: "sent", message: messages[messages.length - 1] })
  const openrouter = target.baseURL.startsWith("https://openrouter.ai/")
  const quirks = quirksOf(target.baseURL)
  let res: Response
  try {
    res = await fetch(`${target.baseURL}/chat/completions`, {
      method: "POST",
      headers: headers(target),
      signal,
      body: JSON.stringify({
        model: target.model,
        messages: toMessages(system, messages, quirks),
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        stream: true,
        // OpenRouter's own fields: reasoning at the models' default effort, and
        // Claude's prefix cached (the other services cache on their own).
        ...(openrouter ? { reasoning: { effort: "medium" }, ...(target.model.startsWith("anthropic/") ? { cache_control: { type: "ephemeral" } } : {}) } : {}),
        // DeepSeek stops early by default; a written shader needs the room.
        ...(quirks.deepseek ? { max_tokens: 32000 } : {}),
      }),
    })
  } catch (e) {
    if (signal.aborted) throw e
    throw unreachable(e, target)
  }
  if (!res.ok || !res.body) throw await refusal(res)

  let text = ""
  let thinking = ""
  const details: Detail[] = []
  const calls: { id: string; name: string; args: string; extra?: unknown }[] = []
  let finish: string | null = null
  try {
    for await (const chunk of events(res)) {
      if (chunk.error) throw new TurnError(`model error: ${JSON.stringify(chunk.error)}`, true)
      const choice = (chunk.choices as { delta?: Delta; finish_reason?: string | null }[] | undefined)?.[0]
      if (!choice) continue
      const d = choice.delta ?? {}
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
        if (tc.extra_content) calls[i].extra = tc.extra_content
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }
  } catch (e) {
    if (e instanceof TurnError || signal.aborted) throw e
    throw new TurnError(`the reply was cut off: ${e instanceof Error ? e.message : String(e)}`, true)
  }

  const content: Anthropic.Beta.BetaContentBlock[] = []
  if (thinking.trim() || details.length) {
    // Kept as it came: DeepSeek is handed it back exactly.
    content.push({ type: "thinking", thinking, signature: "", ...(details.length ? { reasoning_details: details } : {}) } as Anthropic.Beta.BetaContentBlock)
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
    content.push({
      type: "tool_use",
      id: call.id || `call_${Date.now()}_${i}`,
      name: call.name,
      input,
      ...(call.extra ? { extra_content: call.extra } : {}),
    } as Anthropic.Beta.BetaContentBlock)
  }
  const stopReason = finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : made.length ? "tool_use" : "end_turn"
  send({ type: "message", content, stopReason, usage: null })
}

type ListedModel = { id: string; architecture?: { input_modalities?: string[] }; supported_parameters?: string[] }

/** Models that are not for conversation at all — embeddings, speech, image
 *  making, reranking — by the names the services give them. */
const NOT_CHAT = /embed|rerank|tts|asr|whisper|transcri|speech|audio|realtime|moderation|imagine|imagen|-image|image-|wanx|wan2|flux|paraformer|cosyvoice|sambert|livetranslate/i

export const compatProvider: Provider = {
  api: "compat",
  turn,
  models: async (target) => {
    let res: Response
    try {
      res = await fetch(`${target.baseURL}/models`, { headers: headers(target) })
    } catch (e) {
      throw unreachable(e, target)
    }
    if (!res.ok) throw await refusal(res)
    const body = (await res.json()) as { data?: ListedModel[] }
    return (body.data ?? []).flatMap((x) => {
      // OpenRouter says what each model takes: only those that see and call tools.
      if (x.architecture?.input_modalities && !x.architecture.input_modalities.includes("image")) return []
      if (x.supported_parameters && !x.supported_parameters.includes("tools")) return []
      return NOT_CHAT.test(x.id) ? [] : [x.id]
    })
  },
  deleteFiles: async () => {},
}
