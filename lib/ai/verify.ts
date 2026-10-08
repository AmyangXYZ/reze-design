// Verify a connection: a tiny request that proves the key works, the model
// sees a picture, and it calls a tool — what the AI needs. A red square goes
// in with a `report` tool; the model passes when it calls the tool, names the
// colour, and finishes once handed the result. A model that cannot see but
// still calls tools passes as text only: it works from the numbers the tools
// report. Runs in the person's browser, like every request on their own key.

import type { AgentMessage, AgentStreamEvent } from "@/lib/ai/agent-loop"
import { filesIn } from "@/lib/ai/agent-loop"
import type { Route } from "@/lib/ai/providers"
import type { Verdict } from "@/lib/ai/providers/presets"

/** A 64px red square (224, 32, 32), as a PNG. */
const RED_SQUARE =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsIty/VMZxQi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywKkKwEPXi+AaQAAAABJRU5ErkJggg=="

const TOOLS = [
  {
    name: "report",
    description: "Report the main colour of the image.",
    parameters: { type: "object", properties: { colour: { type: "string", description: "The colour, in one word." } }, required: ["colour"] },
  },
]

/** How long a service gets to answer before the verdict is that it did not. */
const DEADLINE = 60_000

type Reply = Extract<AgentStreamEvent, { type: "message" }>

/** One turn, its reply, or what went wrong. Uploads it made are deleted. */
async function ask(route: Route, messages: AgentMessage[], signal: AbortSignal): Promise<{ reply: Reply } | { error: string }> {
  let reply: Reply | null = null
  let sent: AgentMessage | null = null
  try {
    await route.provider.turn({
      target: route.target,
      messages,
      system: "You are checking a connection. Do exactly what is asked.",
      tools: TOOLS,
      signal,
      send: (e) => {
        if (e.type === "message") reply = e
        else if (e.type === "sent") sent = e.message
      },
    })
  } catch (e) {
    return { error: signal.aborted ? `no answer from ${new URL(route.target.baseURL).host} within ${DEADLINE / 1000} seconds` : e instanceof Error ? e.message : String(e) }
  } finally {
    if (sent) void route.provider.deleteFiles(route.target, filesIn([sent])).catch(() => null)
  }
  return reply ? { reply } : { error: "the reply was cut off" }
}

const callIn = (reply: Reply) => reply.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")

/**
 * Two rounds, the shape of every real request: the model calls the tool, is
 * handed its result, and must finish. The second round is where services that
 * need something of their own handed back (Gemini's thought signatures,
 * DeepSeek's reasoning) refuse a history that lost it.
 */
async function rounds(route: Route, request: AgentMessage, signal: AbortSignal): Promise<{ verdict: Verdict; error?: string; colour?: string }> {
  const first = await ask(route, [request], signal)
  if ("error" in first) return { verdict: "error", error: first.error }
  const call = callIn(first.reply)
  if (!call) return { verdict: "noTools" }
  const colour = String((call.input as { colour?: unknown })?.colour ?? "")
  const second = await ask(
    route,
    [
      request,
      { role: "assistant", content: first.reply.content as AgentMessage["content"] & object },
      { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: '{"ok":true}' }, { type: "text", text: "Thanks. Reply with one word: done." }] },
    ],
    signal,
  )
  if ("error" in second) return { verdict: "error", error: second.error }
  return { verdict: "ready", colour }
}

export async function verify(route: Route): Promise<{ verdict: Verdict; error?: string }> {
  const deadline = AbortSignal.timeout(DEADLINE)
  const seeing = await rounds(
    route,
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: RED_SQUARE } },
        { type: "text", text: "What colour is this image? Answer only by calling the report tool." },
      ],
    },
    deadline,
  )
  if (seeing.verdict === "ready" && /red|crimson|scarlet|红/i.test(seeing.colour ?? "")) return { verdict: "ready" }
  if (seeing.verdict === "noTools") return seeing
  // A wrong colour, or a request refused for its picture: try it without one.
  // A model that reads text and calls tools still does the work, from the
  // numbers the tools report.
  // Services word that refusal differently — some as a bare 500 — so anything
  // but a refused key, a limit or no connection gets the second try; a real
  // outage fails that one too.
  const pictureRefused = seeing.verdict === "error" && !/model error 40[134]|busy|connection|no answer|cut off/i.test(seeing.error ?? "")
  if (seeing.verdict === "error" && !pictureRefused) return seeing
  const reading = await rounds(route, { role: "user", content: [{ type: "text", text: "Call the report tool with the colour red." }] }, deadline)
  return reading.verdict === "ready" ? { verdict: "textOnly" } : reading
}
