// Tests for agent-notice: every way a run can end says something and offers
// the right next step.
//
//   npx esbuild lib/ai/agent-notice.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=analysis/agent/an.mjs && node analysis/agent/an.mjs

import assert from "node:assert/strict"
import { errorKind, noticeOf } from "./agent-notice"

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

await test("a run that simply finished says nothing", () => {
  assert.equal(noticeOf("done", null, null), null)
  assert.equal(noticeOf(null, null, null), null)
})

await test("a stop says who stopped it, and offers nothing to press", () => {
  assert.equal(noticeOf("stopped", null, "user")?.kind, "stopped")
  assert.equal(noticeOf("stopped", null, "scene")?.kind, "stoppedScene")
  assert.equal(noticeOf("stopped", null, "user")?.action, undefined)
})

await test("the step limit offers to continue; a closed page, to try again", () => {
  assert.equal(noticeOf("limit", null, null)?.action, "continue")
  assert.equal(noticeOf("interrupted", null, null)?.action, "retry")
})

await test("every message the server and the loop send lands on a plain kind", () => {
  const cases: [string, string][] = [
    ["unauthenticated", "signIn"],
    ["premium", "premium"],
    ["slow down", "rateLimited"],
    ["HTTP 429", "rateLimited"],
    ["too large", "tooLarge"],
    ["the server has no OPENAI_API_KEY", "notSetUp"],
    ["the model is busy — try again in a moment", "busy"],
    ["model error 529: overloaded", "busy"],
    ["model error 500: internal", "busy"],
    ["connection to the model failed: ECONNRESET", "network"],
    ["Failed to fetch", "network"],
    ["the reply was cut off", "network"],
    ["model error 400: messages.3: tool_use ids must be unique", "broken"],
    ["something nobody planned for", "unknown"],
  ]
  for (const [error, kind] of cases) assert.equal(errorKind(error), kind, error)
})

await test("faults that a second try can fix offer one; account and setup refusals do not", () => {
  assert.equal(noticeOf("error", "the model is busy", null)?.action, "retry")
  assert.equal(noticeOf("error", "Failed to fetch", null)?.action, "retry")
  assert.equal(noticeOf("error", "premium", null)?.action, undefined)
  assert.equal(noticeOf("error", "the server has no OPENAI_API_KEY", null)?.action, undefined)
  assert.equal(noticeOf("error", "model error 400: bad", null)?.action, "newChat")
})

await test("only a general message carries the raw detail", () => {
  assert.equal(noticeOf("error", "weird thing", null)?.detail, "weird thing")
  assert.equal(noticeOf("error", "the model is busy", null)?.detail, undefined)
})

await test("nothing ran before an account refusal, so nothing is said to be kept", () => {
  assert.equal(noticeOf("error", "premium", null)?.kept, false)
  assert.equal(noticeOf("error", "Failed to fetch", null)?.kept, true)
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
console.log("\nall passing")
