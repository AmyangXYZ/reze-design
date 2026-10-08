// Verify a connection: one tiny request that proves the key works, the model
// sees a picture, and it calls a tool — the three things the AI needs. A red
// square goes in with a `report` tool; the model passes when it calls the tool
// and names the colour. Runs in the person's browser, like every request on
// their own key.

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

export async function verify(route: Route): Promise<{ verdict: Verdict; error?: string }> {
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: RED_SQUARE } },
        { type: "text", text: "What colour is this image? Answer only by calling the report tool." },
      ],
    },
  ]
  const deadline = AbortSignal.timeout(DEADLINE)
  let reply: Extract<AgentStreamEvent, { type: "message" }> | null = null
  let sent: AgentMessage | null = null
  try {
    await route.provider.turn({
      target: route.target,
      messages,
      system: "You are checking a connection. Do exactly what is asked.",
      tools: TOOLS,
      signal: deadline,
      send: (e) => {
        if (e.type === "message") reply = e
        else if (e.type === "sent") sent = e.message
      },
    })
  } catch (e) {
    if (deadline.aborted) return { verdict: "error", error: `no answer from ${new URL(route.target.baseURL).host} within ${DEADLINE / 1000} seconds` }
    const error = e instanceof Error ? e.message : String(e)
    // A model that takes no pictures usually says so by refusing the request.
    return { verdict: /image|vision|multimodal|modalit/i.test(error) && !/40[13]/.test(error) ? "noVision" : "error", error }
  } finally {
    if (sent) void route.provider.deleteFiles(route.target, filesIn([sent])).catch(() => null)
  }
  const call = (reply as Extract<AgentStreamEvent, { type: "message" }> | null)?.content.find((b) => b.type === "tool_use")
  if (!call || call.type !== "tool_use") return { verdict: "noTools" }
  const colour = String((call.input as { colour?: unknown })?.colour ?? "")
  return { verdict: /red|crimson|scarlet|红/i.test(colour) ? "ready" : "noVision" }
}
