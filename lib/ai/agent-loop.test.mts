// Tests for the agent loop, against a scripted /api/agent.
//
//   npx esbuild lib/ai/agent-loop.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=analysis/agent/al.mjs && node analysis/agent/al.mjs
//
// The model is replaced by a script of replies; the tools by a recorder. What
// is checked is the loop's own contract: it runs every call in order and
// answers each one, keeps the history append-only (bar the newest message's
// uploaded copy), stops when asked without leaving a call unanswered, and
// makes the model wrap up at the round limit.

import assert from "node:assert/strict"
import { runAgent, filesIn, settle, toolResultBlock, historyFor, LOOP_NOTE, type AgentMessage, type AgentStreamEvent } from "./agent-loop"
import type { ToolResult } from "./scene-tools"

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

type Reply = { content: unknown[]; stopReason: string }
const toolUse = (id: string, name: string, input: object = {}) => ({ type: "tool_use", id, name, input })
const text = (t: string) => ({ type: "text", text: t })

/** A fetch that answers each POST with the next scripted reply, recording
 *  what it was sent. `sent` swaps the newest message the way the server does. */
function scripted(replies: Reply[], opts: { upload?: boolean } = {}) {
  const bodies: AgentMessage[][] = []
  let i = 0
  const fetchImpl = async (_url: string, init: { body: string }) => {
    const { messages } = JSON.parse(init.body) as { messages: AgentMessage[] }
    bodies.push(messages)
    const reply = replies[i++]
    if (!reply) throw new Error("script ran out")
    const last = messages[messages.length - 1]
    const sentCopy = opts.upload ? { ...last, uploaded: true } : last
    const events: AgentStreamEvent[] = [
      { type: "sent", message: sentCopy as AgentMessage },
      { type: "text", text: "…" },
      { type: "message", content: reply.content as never, stopReason: reply.stopReason, usage: null },
    ]
    return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 })
  }
  return { fetchImpl, bodies }
}

function withFetch<T>(f: unknown, run: () => Promise<T>): Promise<T> {
  const was = globalThis.fetch
  globalThis.fetch = f as typeof fetch
  return run().finally(() => (globalThis.fetch = was))
}

const user = (t: string): AgentMessage => ({ role: "user", content: [{ type: "text", text: t }] })

await test("tools run in order, each answered, until the model stops calling them", async () => {
  const { fetchImpl, bodies } = scripted([
    { content: [toolUse("a", "get_scene"), toolUse("b", "capture", { size: 256 })], stopReason: "tool_use" },
    { content: [text("Warmer now.")], stopReason: "end_turn" },
  ])
  const ran: string[] = []
  const out = await withFetch(fetchImpl, () =>
    runAgent({
      history: [user("warmer")],
      runTool: async (name) => (ran.push(name), { data: { ok: true } }),
      onProgress: () => {},
      signal: new AbortController().signal,
    }),
  )
  assert.equal(out.ended, "done")
  assert.deepEqual(ran, ["get_scene", "capture"])
  // user, assistant(tool calls), user(results), assistant(text)
  assert.deepEqual(out.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"])
  const results = out.messages[2].content as { tool_use_id: string }[]
  assert.deepEqual(results.map((r) => r.tool_use_id), ["a", "b"])
  assert.equal(bodies.length, 2)
})

await test("the history only grows: each request extends the last one", async () => {
  const { fetchImpl, bodies } = scripted([
    { content: [toolUse("a", "get_scene")], stopReason: "tool_use" },
    { content: [toolUse("b", "capture")], stopReason: "tool_use" },
    { content: [text("done")], stopReason: "end_turn" },
  ])
  await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  for (let k = 1; k < bodies.length; k++) {
    const prev = JSON.stringify(bodies[k - 1])
    const now = JSON.stringify(bodies[k].slice(0, bodies[k - 1].length))
    assert.equal(now, prev, `request ${k} rewrote earlier history`)
  }
})

await test("the newest message is replaced by the copy the server sent", async () => {
  const { fetchImpl } = scripted([{ content: [text("hi")], stopReason: "end_turn" }], { upload: true })
  const out = await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal((out.messages[0] as { uploaded?: boolean }).uploaded, true)
})

await test("stop mid-run answers every pending call and ends", async () => {
  const controller = new AbortController()
  const { fetchImpl } = scripted([{ content: [toolUse("a", "capture"), toolUse("b", "set_settings")], stopReason: "tool_use" }])
  const ran: string[] = []
  const out = await withFetch(fetchImpl, () =>
    runAgent({
      history: [user("x")],
      runTool: async (name) => {
        ran.push(name)
        controller.abort() // the user presses stop while the first tool runs
        return { data: {} }
      },
      onProgress: () => {},
      signal: controller.signal,
    }),
  )
  assert.equal(out.ended, "stopped")
  assert.deepEqual(ran, ["capture"], "nothing runs after stop")
  const results = out.messages[out.messages.length - 1].content as { tool_use_id: string; is_error?: boolean }[]
  assert.deepEqual(results.map((r) => r.tool_use_id), ["a", "b"], "both calls answered")
  assert.equal(results[1].is_error, true)
})

await test("at the round limit the model is told to wrap up, then the loop ends", async () => {
  const forever = Array.from({ length: 5 }, (_, k) => ({ content: [toolUse(`t${k}`, "capture")], stopReason: "tool_use" }))
  const { fetchImpl, bodies } = scripted(forever)
  const out = await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal, maxRounds: 2 }),
  )
  assert.equal(out.ended, "limit")
  const wrap = JSON.stringify(bodies[2])
  assert.match(wrap, /last round for this request/)
})

await test("a call cut off at the token limit is not run", async () => {
  const { fetchImpl } = scripted([
    { content: [toolUse("a", "set_settings", { patch: {} })], stopReason: "max_tokens" },
    { content: [text("ok")], stopReason: "end_turn" },
  ])
  const ran: string[] = []
  const out = await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async (n) => (ran.push(n), { data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.deepEqual(ran, [])
  assert.equal(out.ended, "done")
})

await test("a server error ends the run with its message", async () => {
  const f = async () => new Response(JSON.stringify({ error: "premium" }), { status: 403 })
  const out = await withFetch(f, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal(out.ended, "error")
  assert.equal(out.error, "premium")
})

await test("a transient failure is retried, and the run carries on", async () => {
  const { fetchImpl } = scripted([{ content: [text("ok")], stopReason: "end_turn" }])
  let calls = 0
  const flaky = async (url: string, init: { body: string }) => (++calls === 1 ? new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 }) : fetchImpl(url, init))
  const retries: string[] = []
  const out = await withFetch(flaky, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: (p) => p.type === "retry" && retries.push(p.reason), signal: new AbortController().signal }),
  )
  assert.equal(out.ended, "done")
  assert.equal(calls, 2)
  assert.deepEqual(retries, ["bad gateway"])
})

await test("a refusal that retrying cannot fix is not retried", async () => {
  let calls = 0
  const f = async () => (calls++, new Response(JSON.stringify({ error: "premium" }), { status: 403 }))
  const out = await withFetch(f, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal(out.ended, "error")
  assert.equal(calls, 1)
})

await test("one direct change finishes without being sent back to look", async () => {
  const { fetchImpl, bodies } = scripted([
    { content: [toolUse("a", "set_settings", { patch: {} })], stopReason: "tool_use" },
    { content: [text("Done.")], stopReason: "end_turn" },
  ])
  const out = await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal(out.ended, "done")
  assert.equal(bodies.length, 2)
})

await test("two or more changes finishing unseen get one nudge to look", async () => {
  const { fetchImpl, bodies } = scripted([
    { content: [toolUse("a", "set_settings", { patch: {} }), toolUse("a2", "set_grade", {})], stopReason: "tool_use" },
    { content: [text("Done.")], stopReason: "end_turn" },
    { content: [toolUse("b", "capture")], stopReason: "tool_use" },
    { content: [text("Checked, done.")], stopReason: "end_turn" },
  ])
  const ran: string[] = []
  const out = await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async (n) => (ran.push(n), { data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal(out.ended, "done")
  assert.deepEqual(ran, ["set_settings", "set_grade", "capture"])
  assert.equal(bodies.length, 4)
  assert.ok(JSON.stringify(bodies[2].at(-1)).includes(LOOP_NOTE), "the third request carries the nudge")
})

await test("a run that only looked, or looked last, is not nudged", async () => {
  const { fetchImpl, bodies } = scripted([
    { content: [toolUse("a", "set_settings", { patch: {} }), toolUse("b", "capture")], stopReason: "tool_use" },
    { content: [text("Done.")], stopReason: "end_turn" },
  ])
  await withFetch(fetchImpl, () =>
    runAgent({ history: [user("x")], runTool: async () => ({ data: {} }), onProgress: () => {}, signal: new AbortController().signal }),
  )
  assert.equal(bodies.length, 2)
})

await test("a tool result carries its data, its images, and is_error on an error", () => {
  const r: ToolResult = { data: { error: "no" }, images: [{ dataUrl: "data:image/jpeg;base64,AAAA", label: "A", metrics: {} as never }] }
  const b = toolResultBlock("x", r)
  assert.equal(b.is_error, true)
  const content = b.content as { type: string }[]
  assert.deepEqual(content.map((c) => c.type), ["text", "text", "image"])
})

await test("a saved history cut off mid-run is answered, never rewritten", () => {
  const cut: AgentMessage[] = [user("x"), { role: "assistant", content: [toolUse("a", "capture") as never, toolUse("b", "seek") as never] }]
  const fixed = settle(cut)
  assert.equal(fixed.length, 3)
  assert.equal(JSON.stringify(fixed.slice(0, 2)), JSON.stringify(cut), "the saved part is untouched")
  const answers = fixed[2].content as { tool_use_id: string; is_error: boolean }[]
  assert.deepEqual(answers.map((a) => a.tool_use_id), ["a", "b"])
  assert.equal(settle(fixed).length, 3, "a whole history is left as it is")
})

await test("Claude is sent its history whole; other providers, the trimmed copy", () => {
  // Five rounds, each answered with an inline capture, as on a person's own key.
  const history: AgentMessage[] = [user("go")]
  for (let k = 0; k < 5; k++) {
    history.push({ role: "assistant", content: [{ type: "thinking", thinking: `t${k}`, signature: `sig${k}` }, toolUse(`c${k}`, "capture") as never] })
    history.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `c${k}`, content: [{ type: "text", text: "{}" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: `IMG${k}` } }] }],
    })
  }
  const pictures = (h: AgentMessage[]) => (JSON.stringify(h).match(/IMG\d/g) ?? []).length
  // Claude: every turn exactly as it was — no earlier turn rewritten, ever.
  const claude = historyFor("anthropic", history, true)
  assert.equal(JSON.stringify(claude), JSON.stringify(history))
  // The others: only the latest few pictures go; the rest become a line.
  assert.equal(pictures(historyFor("openai", history, true)), 3)
  assert.equal(pictures(historyFor("compat", history, true)), 3)
  // A model that reads text only gets no picture, whoever it is.
  assert.equal(pictures(historyFor("anthropic", history, false)), 0)
})

await test("uploaded files are found for clean-up", () => {
  const m: AgentMessage[] = [
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: [{ type: "image", source: { type: "file", file_id: "file_1" } }] }] },
  ]
  assert.deepEqual(filesIn(m), ["file_1"])
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
console.log("\nall passing")
