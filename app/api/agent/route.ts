// One turn of the AI: the conversation in, the model's reply out, streamed.
//
// The LOOP lives in the browser (lib/ai/agent-loop.ts), because the tools do:
// they drive the engine and read the canvas, which exist only in the tab. This
// route is the part that cannot live there — it holds the API keys, decides who
// may spend them, and pins what the model is told (the system prompt and the
// tool list are attached here, never taken from the request). It keeps no
// state: every call carries the whole conversation.
//
// WHICH MODEL: the person's own connection when the request carries one
// (`via` — their key, which passes through and is never stored or logged),
// otherwise Premium on this server's keys (lib/ai/providers). The
// conversation has one shape for every provider, so the browser never
// translates anything.
//
// Wire format: newline-delimited JSON, one AgentStreamEvent per line.

import { gate, overLimit, type Gate } from "@/lib/ai/gate"
import { AGENT_SYSTEM_PROMPT } from "@/lib/ai/agent-prompt"
import { SCENE_TOOLS } from "@/lib/ai/scene-tools"
import type { AgentMessage, AgentStreamEvent } from "@/lib/ai/agent-loop"
import { TurnError } from "@/lib/ai/providers/types"
import { describeSettings } from "@/lib/ai/settings-schema"
import { premiumRoute, routeOf, type Route } from "@/lib/ai/providers"
import type { Via } from "@/lib/ai/providers/presets"

export const maxDuration = 300

/** The newest message carries at most a few captures; anything bigger is not
 *  this client. */
const MAX_BODY = 8 * 1024 * 1024

const TOOLS = SCENE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))

/** The instructions, with the look settings' reference built in: it never
 *  changes, so it belongs in the cached prefix rather than costing a round
 *  (describe_settings) at the start of every conversation. */
const SYSTEM = `${AGENT_SYSTEM_PROMPT}

The look settings you can change (set_settings), what each does and its range:
${describeSettings()}`

/** The person's connection, or Premium — or the response that says why neither. */
function pick(g: Extract<Gate, { ok: true }>, via: unknown): Route | Response {
  if (via && typeof via === "object") {
    const r = routeOf(via as Partial<Via>)
    return "error" in r ? Response.json({ error: r.error }, { status: 400 }) : r
  }
  if (!g.premium) return Response.json({ error: "premium" }, { status: 403 })
  return premiumRoute() ?? Response.json({ error: "the server has no AI key" }, { status: 503 })
}

export async function POST(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 })
  if (overLimit(g.user)) return Response.json({ error: "slow down", retryable: true }, { status: 429 })

  let messages: AgentMessage[]
  let via: unknown
  try {
    const body = (await request.json()) as { messages?: unknown; via?: unknown }
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error("no messages")
    messages = body.messages as AgentMessage[]
    via = body.via
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 })
  }
  const route = pick(g, via)
  if (route instanceof Response) return route

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`))
      try {
        await route.provider.turn({ target: route.target, messages, system: SYSTEM, tools: TOOLS, send, signal: request.signal })
      } catch (e) {
        if (!request.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e), retryable: e instanceof TurnError && e.retryable })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Which model answered, for anyone reading the network tab.
      "X-Agent-Model": route.target.model,
    },
  })
}

/** Uploaded captures of a conversation the user has cleared. */
export async function DELETE(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  const body = (await request.json().catch(() => ({}))) as { files?: unknown; via?: unknown }
  const route = pick(g, body.via)
  if (route instanceof Response) return Response.json({ ok: true })
  // Anthropic's ids are file_…, OpenAI's file-….
  const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string" && /^file[_-][A-Za-z0-9]+$/.test(f)).slice(0, 500) : []
  await route.provider.deleteFiles(route.target, files)
  return Response.json({ ok: true, deleted: files.length })
}
