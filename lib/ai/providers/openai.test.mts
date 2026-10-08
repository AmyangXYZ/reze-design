// Tests for the OpenAI translation: the shared history out, the reply back.
//
//   npx esbuild lib/ai/providers/openai.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=analysis/agent/oa.mjs && node analysis/agent/oa.mjs

import assert from "node:assert/strict"
import { toInput, fromResponse } from "./openai"
import type { AgentMessage } from "@/lib/ai/agent-loop"

let failures = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

const capture = (id: string, file: string) => ({
  type: "tool_result" as const,
  tool_use_id: id,
  content: [
    { type: "text" as const, text: "{\"ok\":true}" },
    { type: "image" as const, source: { type: "file" as const, file_id: file } },
  ],
})

await test("a request, a call, its result and the reply translate in order", () => {
  const history: AgentMessage[] = [
    { role: "user", content: [{ type: "image", source: { type: "file", file_id: "file-ref" } }, { type: "text", text: "match this" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "" }, { type: "text", text: "Looking." }, { type: "tool_use", id: "c1", name: "capture", input: { size: 256 } }] },
    { role: "user", content: [capture("c1", "file-a")] },
  ]
  const input = toInput(history) as unknown as Record<string, unknown>[]
  assert.deepEqual(
    input.map((i) => i.type ?? i.role),
    ["user", "assistant", "function_call", "function_call_output"],
  )
  assert.equal((input[2] as { arguments: string }).arguments, JSON.stringify({ size: 256 }))
  const out = (input[3] as { output: { type: string; file_id?: string }[] }).output
  assert.deepEqual(out.map((o) => o.type), ["input_text", "input_image"])
  assert.equal(out[1].file_id, "file-a")
  assert.ok(!JSON.stringify(input).includes("\"hm\""), "thinking is not sent back")
})

await test("only the latest captures keep their pictures", () => {
  const history: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "go" }] }]
  for (let k = 0; k < 5; k++) {
    history.push({ role: "assistant", content: [{ type: "tool_use", id: `c${k}`, name: "capture", input: {} }] })
    history.push({ role: "user", content: [capture(`c${k}`, `file-${k}`)] })
  }
  const sent = JSON.stringify(toInput(history))
  assert.ok(!sent.includes("file-0") && !sent.includes("file-1"), "the oldest are not re-sent")
  assert.ok(sent.includes("file-2") && sent.includes("file-4"), "the last three are")
  assert.match(sent, /not re-sent/)
  // The stored history itself is untouched.
  assert.ok(JSON.stringify(history).includes("file-0"))
})

await test("a reply with a call comes back as tool_use; plain text as end_turn", () => {
  const withCall = fromResponse({
    output: [
      { type: "reasoning", id: "r", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "function_call", call_id: "x1", name: "set_settings", arguments: "{\"patch\":{}}" },
    ],
    incomplete_details: null,
  } as never)
  assert.equal(withCall.stopReason, "tool_use")
  assert.deepEqual(withCall.content.map((b) => b.type), ["thinking", "tool_use"])
  const done = fromResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }], incomplete_details: null } as never)
  assert.equal(done.stopReason, "end_turn")
  assert.equal((done.content[0] as { text: string }).text, "Done.")
})

await test("cut off at the token limit reads as max_tokens", () => {
  const cut = fromResponse({ output: [], incomplete_details: { reason: "max_output_tokens" } } as never)
  assert.equal(cut.stopReason, "max_tokens")
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
console.log("\nall passing")
