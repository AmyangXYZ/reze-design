// One turn of the AI: the conversation in, the model's reply out, streamed.
//
// The LOOP lives in the browser (lib/ai/agent-loop.ts), because the tools do:
// they drive the engine and read the canvas, which exist only in the tab. This
// route is the part that cannot live there — it holds the API keys, decides who
// may spend them, and pins what the model is told (the system prompt and the
// tool list are attached here, never taken from the request). It keeps no
// state: every call carries the whole conversation.
//
// WHICH MODEL is decided here and nowhere else (lib/ai/providers): Claude on a
// developer's own `next dev`, GPT in production, AGENT_PROVIDER to force one.
// The conversation has one shape for both, so nothing in the browser changes.
//
// Wire format: newline-delimited JSON, one AgentStreamEvent per line.

import { auth } from "@/lib/auth"
import { hasDatabase } from "@/lib/db"
import { AGENT_SYSTEM_PROMPT } from "@/lib/ai/agent-prompt"
import { SCENE_TOOLS } from "@/lib/ai/scene-tools"
import type { AgentMessage, AgentStreamEvent } from "@/lib/ai/agent-loop"
import type { Provider } from "@/lib/ai/providers/types"
import { anthropicProvider } from "@/lib/ai/providers/anthropic"
import { openaiProvider } from "@/lib/ai/providers/openai"

export const maxDuration = 300

/** Requests a minute, per account. A soft guard — memory is per instance —
 *  against a runaway loop, not a billing system. */
const PER_MINUTE = 40
/** The newest message carries at most a few captures; anything bigger is not
 *  this client. */
const MAX_BODY = 8 * 1024 * 1024

const TOOLS = SCENE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))

/** Claude locally, GPT deployed — unless AGENT_PROVIDER says otherwise. */
function provider(): Provider {
  const forced = process.env.AGENT_PROVIDER
  if (forced === "anthropic") return anthropicProvider
  if (forced === "openai") return openaiProvider
  return process.env.NODE_ENV === "development" ? anthropicProvider : openaiProvider
}

const recent = new Map<string, number[]>()
function overLimit(user: string): boolean {
  const now = Date.now()
  const hits = (recent.get(user) ?? []).filter((t) => now - t < 60_000)
  hits.push(now)
  recent.set(user, hits)
  return hits.length > PER_MINUTE
}

type Gate = { ok: true; user: string } | { ok: false; status: number; error: string }

/** Signed in, on Premium. A local dev server lets the developer through when it
 *  has no database, or when AGENT_DEV_OPEN=1 (for driving the editor headless);
 *  neither applies to a production build. */
async function gate(request: Request): Promise<Gate> {
  if (process.env.NODE_ENV === "development" && process.env.AGENT_DEV_OPEN === "1") return { ok: true, user: "dev" }
  if (!hasDatabase) {
    return process.env.NODE_ENV === "development" ? { ok: true, user: "dev" } : { ok: false, status: 401, error: "unauthenticated" }
  }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { ok: false, status: 401, error: "unauthenticated" }
  if ((session.user as { plan?: string }).plan !== "premium") return { ok: false, status: 403, error: "premium" }
  return { ok: true, user: session.user.id }
}

export async function POST(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  const p = provider()
  if (!process.env[p.keyEnv]) return Response.json({ error: `the server has no ${p.keyEnv}` }, { status: 503 })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 })
  if (overLimit(g.user)) return Response.json({ error: "slow down" }, { status: 429 })

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
        await p.turn({ messages, system: AGENT_SYSTEM_PROMPT, tools: TOOLS, send, signal: request.signal })
      } catch (e) {
        if (!request.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e) })
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
      "X-Agent-Provider": p.name,
    },
  })
}

/** Uploaded captures of a conversation the user has cleared. */
export async function DELETE(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  const p = provider()
  if (!process.env[p.keyEnv]) return Response.json({ ok: true })
  const body = (await request.json().catch(() => ({}))) as { files?: unknown }
  // Anthropic's ids are file_…, OpenAI's file-….
  const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string" && /^file[_-][A-Za-z0-9]+$/.test(f)).slice(0, 500) : []
  await p.deleteFiles(files)
  return Response.json({ ok: true, deleted: files.length })
}
