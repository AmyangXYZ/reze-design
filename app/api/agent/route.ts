// One turn of the AI on Premium: the conversation in, the model's reply out,
// streamed.
//
// The LOOP lives in the browser (lib/ai/agent-loop.ts), because the tools do:
// they drive the engine and read the canvas, which exist only in the tab.
// With the person's own key the browser also calls the model itself, from
// their own network, and nothing comes here. This route is what Premium needs
// a server for: it holds this server's keys, decides who may spend them, and
// pins what the model is told (lib/ai/agent-context — never taken from the
// request). It keeps no state: every call carries the whole conversation.
//
// Wire format: newline-delimited JSON, one AgentStreamEvent per line.

import { gate, overLimit, type Gate } from "@/lib/ai/gate"
import { AGENT_SYSTEM, AGENT_TOOLS, modelNote } from "@/lib/ai/agent-context"
import type { AgentMessage, AgentStreamEvent } from "@/lib/ai/agent-loop"
import { TurnError } from "@/lib/ai/providers/types"
import { premiumRoute, type Route } from "@/lib/ai/premium"

export const maxDuration = 300

/** The newest message carries at most a few captures; anything bigger is not
 *  this client. */
const MAX_BODY = 8 * 1024 * 1024

/** This server's key for a Premium account — or the response that says why not. */
function pick(g: Extract<Gate, { ok: true }>): Route | Response {
  if (!g.premium) return Response.json({ error: "premium" }, { status: 403 })
  return premiumRoute() ?? Response.json({ error: "the server has no AI key" }, { status: 503 })
}

export async function POST(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 })
  if (overLimit(g.user)) return Response.json({ error: "slow down", retryable: true }, { status: 429 })

  const route = pick(g)
  if (route instanceof Response) return route
  let messages: AgentMessage[]
  try {
    const body = (await request.json()) as { messages?: unknown }
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error("no messages")
    messages = body.messages as AgentMessage[]
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`))
      try {
        await route.provider.turn({ target: route.target, messages, system: AGENT_SYSTEM + modelNote(route.target.model), tools: AGENT_TOOLS, send, signal: request.signal })
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
  const body = (await request.json().catch(() => ({}))) as { files?: unknown }
  const route = pick(g)
  if (route instanceof Response) return Response.json({ ok: true })
  // Anthropic's ids are file_…, OpenAI's file-….
  const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string" && /^file[_-][A-Za-z0-9]+$/.test(f)).slice(0, 500) : []
  await route.provider.deleteFiles(route.target, files)
  return Response.json({ ok: true, deleted: files.length })
}
