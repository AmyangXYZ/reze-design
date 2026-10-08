// Verify a connection: one tiny request that proves the key works, the model
// sees a picture, and it calls a tool — the three things the AI needs. A red
// square goes in with a `report` tool; the model passes when it calls the tool
// and names the colour. The key passes through and is never stored or logged.

import { deflateSync } from "node:zlib"
import { gate, overLimit } from "@/lib/ai/gate"
import { routeOf } from "@/lib/ai/providers"
import type { Verdict, Via } from "@/lib/ai/providers/presets"
import { filesIn, type AgentMessage, type AgentStreamEvent } from "@/lib/ai/agent-loop"

export const maxDuration = 60

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b: Buffer) => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A 64px red square, as a PNG. */
function redSquare(): string {
  const size = 64
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([224, 32, 32]))])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64")
}

const TOOLS = [
  {
    name: "report",
    description: "Report the main colour of the image.",
    parameters: { type: "object", properties: { colour: { type: "string", description: "The colour, in one word." } }, required: ["colour"] },
  },
]

export async function POST(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  if (overLimit(g.user)) return Response.json({ error: "slow down" }, { status: 429 })
  const body = (await request.json().catch(() => ({}))) as { via?: Partial<Via> }
  const route = routeOf(body.via ?? {})
  if ("error" in route) return Response.json({ error: route.error }, { status: 400 })

  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: redSquare() } },
        { type: "text", text: "What colour is this image? Answer only by calling the report tool." },
      ],
    },
  ]
  let reply: Extract<AgentStreamEvent, { type: "message" }> | null = null
  let sent: AgentMessage | null = null
  try {
    await route.provider.turn({
      target: route.target,
      messages,
      system: "You are checking a connection. Do exactly what is asked.",
      tools: TOOLS,
      signal: request.signal,
      send: (e) => {
        if (e.type === "message") reply = e
        else if (e.type === "sent") sent = e.message
      },
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    // A model that takes no pictures usually says so by refusing the request.
    const verdict: Verdict = /image|vision|multimodal|modalit/i.test(error) && !/40[13]/.test(error) ? "noVision" : "error"
    return Response.json({ verdict, error })
  } finally {
    if (sent) void route.provider.deleteFiles(route.target, filesIn([sent])).catch(() => null)
  }
  const call = (reply as Extract<AgentStreamEvent, { type: "message" }> | null)?.content.find((b) => b.type === "tool_use")
  if (!call || call.type !== "tool_use") return Response.json({ verdict: "noTools" satisfies Verdict })
  const colour = String((call.input as { colour?: unknown })?.colour ?? "")
  return Response.json({ verdict: (/red|crimson|scarlet|红/i.test(colour) ? "ready" : "noVision") satisfies Verdict, colour })
}
