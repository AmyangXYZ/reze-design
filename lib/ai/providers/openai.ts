// GPT, through OpenAI's Responses API. Server only.
//
// The Responses API rather than Chat Completions because the GPT-6 models take
// function tools only there. The conversation arrives in the shared shape
// (Anthropic's blocks — see ./types) and is translated on the way out:
//
//   user text / images        → a user message of input_text / input_image
//   tool_result               → function_call_output, its images included
//   assistant text            → an assistant message
//   tool_use                  → function_call
//   thinking                  → dropped (each turn reasons afresh; store:false)
//
// and the reply on the way back: output_text → text, function_call →
// tool_use, the reasoning summary → a thinking block (shown in the panel, never
// sent back).
//
// Images are uploaded once to OpenAI's Files API, as on the Claude side, so the
// history stays small. With no server-side clearing of old results here, a long
// session is kept in budget by sending only the latest few captures' pictures;
// older ones go as a note that they were seen. Nothing in the stored history is
// rewritten — the trimming happens to the copy sent.

import OpenAI, { toFile } from "openai"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentMessage } from "@/lib/ai/agent-loop"
import { TurnError, type Provider, type TurnArgs } from "@/lib/ai/providers/types"

const MODEL = process.env.AGENT_OPENAI_MODEL || "gpt-6.1-sol"
/** Captures whose pictures are sent; earlier ones are mentioned, not shown. */
const KEEP_CAPTURES = 3

type Block = Anthropic.Beta.BetaContentBlockParam
type Input = OpenAI.Responses.ResponseInputItem
type ImageSource = { type: string; data?: string; media_type?: string; file_id?: string; url?: string }

const client = () => new OpenAI()

function imagePart(source: ImageSource): OpenAI.Responses.ResponseInputImage | null {
  if (source.type === "base64" && source.data) return { type: "input_image", detail: "auto", image_url: `data:${source.media_type ?? "image/jpeg"};base64,${source.data}` }
  if (source.type === "file" && source.file_id) return { type: "input_image", detail: "auto", file_id: source.file_id }
  if (source.type === "url" && source.url) return { type: "input_image", detail: "auto", image_url: source.url }
  return null
}

/** The shared history as Responses API input. */
export function toInput(messages: AgentMessage[]): Input[] {
  // Which tool results keep their pictures: the last few that have any.
  const withImages: string[] = []
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue
    for (const b of m.content) {
      if (b.type === "tool_result" && Array.isArray(b.content) && b.content.some((c) => c.type === "image")) withImages.push(b.tool_use_id)
    }
  }
  const shown = new Set(withImages.slice(-KEEP_CAPTURES))

  const out: Input[] = []
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content
    if (m.role === "assistant") {
      const text = blocks.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text] : [])).join("\n\n")
      if (text) out.push({ role: "assistant", content: text })
      for (const b of blocks) {
        if (b.type === "tool_use") out.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })
      }
      continue
    }
    const parts: OpenAI.Responses.ResponseInputMessageContentList = []
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const content = typeof b.content === "string" ? [{ type: "text" as const, text: b.content }] : (b.content ?? [])
        const output: OpenAI.Responses.ResponseFunctionCallOutputItemList = []
        let dropped = 0
        for (const c of content) {
          if (c.type === "text") output.push({ type: "input_text", text: c.text })
          else if (c.type === "image") {
            const img = shown.has(b.tool_use_id) ? imagePart(c.source as ImageSource) : null
            if (img) output.push(img)
            else dropped++
          }
        }
        if (dropped) output.push({ type: "input_text", text: `(${dropped} earlier image${dropped > 1 ? "s" : ""} from this step not re-sent; you saw ${dropped > 1 ? "them" : "it"} then.)` })
        out.push({ type: "function_call_output", call_id: b.tool_use_id, output })
      } else if (b.type === "text") parts.push({ type: "input_text", text: b.text })
      else if (b.type === "image") {
        const img = imagePart(b.source as ImageSource)
        if (img) parts.push(img)
      }
    }
    if (parts.length) out.push({ role: "user", content: parts })
  }
  return out
}

/** The reply in the shared shape, and why it stopped in Anthropic's words. */
export function fromResponse(r: OpenAI.Responses.Response): { content: Anthropic.Beta.BetaContentBlock[]; stopReason: string } {
  const content: Anthropic.Beta.BetaContentBlock[] = []
  let calls = 0
  for (const item of r.output) {
    if (item.type === "reasoning") {
      const summary = (item.summary ?? []).map((s) => s.text).join("\n\n").trim()
      if (summary) content.push({ type: "thinking", thinking: summary, signature: "" } as Anthropic.Beta.BetaContentBlock)
    } else if (item.type === "message") {
      for (const c of item.content) if (c.type === "output_text" && c.text) content.push({ type: "text", text: c.text, citations: null } as Anthropic.Beta.BetaContentBlock)
    } else if (item.type === "function_call") {
      calls++
      let input: unknown = {}
      try {
        input = JSON.parse(item.arguments || "{}")
      } catch {
        input = {}
      }
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input } as Anthropic.Beta.BetaContentBlock)
    }
  }
  const why = r.incomplete_details?.reason
  const stopReason = why === "max_output_tokens" ? "max_tokens" : why === "content_filter" ? "refusal" : calls ? "tool_use" : "end_turn"
  return { content, stopReason }
}

/** The newest message with every inline image uploaded and referenced by id. */
async function uploadImages(c: OpenAI, message: AgentMessage): Promise<AgentMessage> {
  if (typeof message.content === "string") return message
  const upload = async (b: Block): Promise<Block> => {
    if (b.type === "image" && b.source.type === "base64") {
      const ext = b.source.media_type.split("/")[1] ?? "jpeg"
      const file = await c.files.create({
        file: await toFile(Buffer.from(b.source.data, "base64"), `capture.${ext}`, { type: b.source.media_type }),
        purpose: "vision",
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

async function turn({ messages, system, tools, send, signal }: TurnArgs): Promise<void> {
  const c = client()
  const last = await uploadImages(c, messages[messages.length - 1])
  send({ type: "sent", message: last })
  try {
    const stream = await c.responses.create(
      {
        model: MODEL,
        instructions: system,
        input: toInput([...messages.slice(0, -1), last]),
        tools: tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })),
        // Summaries of the reasoning, for the panel's progress line.
        reasoning: { effort: "medium", summary: "auto" },
        max_output_tokens: 32000,
        // The browser keeps the conversation; nothing needs to live on OpenAI's side.
        store: false,
        stream: true,
      },
      { signal },
    )
    let final: OpenAI.Responses.Response | null = null
    for await (const event of stream) {
      if (event.type === "response.output_item.added" && event.item.type === "function_call") send({ type: "tool", name: event.item.name })
      else if (event.type === "response.output_text.delta") send({ type: "text", text: event.delta })
      else if (event.type === "response.reasoning_summary_text.delta") send({ type: "thinking", text: event.delta })
      else if (event.type === "response.reasoning_summary_part.done") send({ type: "thinking", text: "\n\n" })
      else if (event.type === "response.completed" || event.type === "response.incomplete") final = event.response
      else if (event.type === "response.failed") throw new TurnError(event.response.error?.message ?? "the model failed", true)
      else if (event.type === "error") throw new TurnError(event.message, true)
    }
    if (!final) throw new TurnError("the reply was cut off", true)
    const { content, stopReason } = fromResponse(final)
    send({ type: "message", content, stopReason, usage: final.usage })
  } catch (e) {
    if (e instanceof TurnError) throw e
    if (e instanceof OpenAI.RateLimitError) throw new TurnError("the model is busy — try again in a moment", true)
    if (e instanceof OpenAI.APIConnectionError) throw new TurnError(`connection to the model failed: ${e.message}`, true)
    if (e instanceof OpenAI.APIError) throw new TurnError(`model error ${e.status ?? ""}: ${e.message}`, (e.status ?? 500) >= 500 || e.status === 408 || e.status === 409)
    throw new TurnError(e instanceof Error ? e.message : String(e), false)
  }
}

export const openaiProvider: Provider = {
  name: "openai",
  keyEnv: "OPENAI_API_KEY",
  turn,
  deleteFiles: async (ids) => {
    const c = client()
    await Promise.all(ids.map((id) => c.files.delete(id).catch(() => null)))
  },
}
