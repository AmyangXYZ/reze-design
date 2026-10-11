// Tests for reads that survive a bad network: lib/net (retries, the growing
// retry wait, the failing state the libraries' offline line reads) and the
// scene bundle's resuming download (lib/scene-host downloadBundle).
//
//   npx esbuild lib/net.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/net.mjs && node /tmp/net.mjs
//
// Against a real local HTTP server that misbehaves the ways a lossy route
// does: refuses, answers 5xx, stalls, and cuts a download off part-way.

import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { randomBytes } from "node:crypto"
import { fetchJson, HttpError, isFailing, retryLater, retryNow, retrySettled } from "@/lib/net"
import { downloadBundle } from "@/lib/scene-host"

let failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
  }
}

// One server; each test installs the handler it needs.
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_, res) => res.end()
const server = createServer((req, res) => handler(req, res))
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

// ── fetchJson ────────────────────────────────────────────────────────────────

await test("fetchJson retries a 503 and returns the answer that follows", async () => {
  let n = 0
  handler = (_, res) => (++n < 3 ? res.writeHead(503).end() : res.end(JSON.stringify({ ok: n })))
  assert.deepEqual(await fetchJson(`${base}/x`), { ok: 3 })
})

await test("fetchJson does not retry a 404: that is the server's answer", async () => {
  let n = 0
  handler = (_, res) => (n++, res.writeHead(404).end())
  await assert.rejects(fetchJson(`${base}/x`), (e) => e instanceof HttpError && e.status === 404)
  assert.equal(n, 1)
})

await test("fetchJson times out a stalled response and retries it", async () => {
  let n = 0
  handler = (_, res) => {
    // The first answer sends headers and then never finishes its body.
    if (++n === 1) return void res.writeHead(200, { "content-type": "application/json" }).write("{")
    res.end(JSON.stringify({ n }))
  }
  assert.deepEqual(await fetchJson(`${base}/x`, undefined, { timeoutMs: 300 }), { n: 2 })
})

await test("fetchJson gives up after its attempts and throws", async () => {
  let n = 0
  handler = (_, res) => (n++, res.writeHead(502).end())
  await assert.rejects(fetchJson(`${base}/x`, undefined, { attempts: 2 }))
  assert.equal(n, 2)
})

// ── retryLater ───────────────────────────────────────────────────────────────

// Enough of a browser for retryLater: events, visibility, and intervals we
// can see and fire by hand rather than wait out.
const win = new EventTarget()
const doc = Object.assign(new EventTarget(), { visibilityState: "visible" })
Object.assign(globalThis, { window: win, document: doc })
const intervals: { ms: number; fn: () => void; live: boolean }[] = []
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = ((fn: () => void, ms: number) => {
  const t = { ms, fn, live: true }
  intervals.push(t)
  return t
}) as unknown as typeof setInterval
globalThis.clearInterval = ((t: { live: boolean }) => {
  if (t && typeof t === "object" && "live" in t) t.live = false
}) as unknown as typeof clearInterval
const lastWait = () => intervals.filter((t) => t.live).at(-1)

await test("retryLater waits 5s, 10s, 20s, then 30s while it keeps failing", () => {
  const waits: number[] = []
  const attempt = () => {
    // The load fails again and asks again, as the stores do.
    retryLater("t1", attempt)
  }
  retryLater("t1", attempt)
  for (let i = 0; i < 5; i++) {
    const w = lastWait()!
    waits.push(w.ms)
    w.fn()
  }
  assert.deepEqual(waits, [5000, 10000, 20000, 30000, 30000])
  retrySettled("t1")
})

await test("a success resets the wait back to 5s", () => {
  retryLater("t2", () => {})
  lastWait()!.fn()
  retryLater("t2", () => {})
  assert.equal(lastWait()!.ms, 10000)
  retrySettled("t2")
  retryLater("t2", () => {})
  assert.equal(lastWait()!.ms, 5000)
  retrySettled("t2")
})

await test("one wait per key: two surfaces failing the same load do not stack", () => {
  const before = intervals.filter((t) => t.live).length
  retryLater("t3", () => {})
  retryLater("t3", () => {})
  assert.equal(intervals.filter((t) => t.live).length, before + 1)
  retrySettled("t3")
})

await test("failing holds from the first failure until a success, through the attempt", () => {
  assert.equal(isFailing(["t4"]), false)
  retryLater("t4", () => {})
  assert.equal(isFailing(["t4"]), true)
  // The wait fires and the attempt is in flight: still failing, so the line
  // does not flicker off and back on.
  lastWait()!.fn()
  assert.equal(isFailing(["t4"]), true)
  retrySettled("t4")
  assert.equal(isFailing(["t4"]), false)
})

await test("isFailing matches by prefix, so one line can watch every gallery shelf", () => {
  retryLater("gallery:yours", () => {})
  assert.equal(isFailing(["gallery:"]), true)
  assert.equal(isFailing(["community"]), false)
  retrySettled("gallery:yours")
})

await test("a hidden tab does not retry; showing it, or coming back online, does", () => {
  let runs = 0
  retryLater("t5", () => runs++)
  doc.visibilityState = "hidden"
  lastWait()!.fn()
  assert.equal(runs, 0)
  doc.visibilityState = "visible"
  doc.dispatchEvent(new Event("visibilitychange"))
  assert.equal(runs, 1)
  retryLater("t5", () => runs++)
  win.dispatchEvent(new Event("online"))
  assert.equal(runs, 2)
  retrySettled("t5")
})

await test("Retry asks now, without waiting out the delay, even in a hidden tab", () => {
  let runs = 0
  retryLater("t6", () => runs++)
  doc.visibilityState = "hidden"
  retryNow(["t6"])
  doc.visibilityState = "visible"
  assert.equal(runs, 1)
  retrySettled("t6")
})

globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval

// ── downloadBundle ───────────────────────────────────────────────────────────

const FILE = randomBytes(3 * 1024 * 1024)
const ranges: string[] = []
/** Serve FILE, honouring Range, misbehaving as `plan` says on each connection. */
function serveFile(plan: ("drop" | "stall" | "ok" | "ignore-range" | "503")[]) {
  let i = 0
  ranges.length = 0
  handler = (req, res) => {
    const step = plan[Math.min(i++, plan.length - 1)]
    const range = req.headers.range
    ranges.push(range ?? "")
    if (step === "503") return void res.writeHead(503).end()
    const from = range && step !== "ignore-range" ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    const body = FILE.subarray(from)
    res.writeHead(from > 0 ? 206 : 200, {
      "content-length": String(body.length),
      ...(from > 0 ? { "content-range": `bytes ${from}-${FILE.length - 1}/${FILE.length}` } : {}),
    })
    if (step === "drop") {
      res.write(body.subarray(0, 1024 * 1024))
      setTimeout(() => res.socket?.destroy(), 50)
    } else if (step === "stall") {
      res.write(body.subarray(0, 512 * 1024))
    } else res.end(body)
  }
}
const bytesOf = async (b: Blob | null) => Buffer.from(await b!.arrayBuffer())

await test("a download cut off part-way resumes from where it stopped", async () => {
  serveFile(["drop", "ok"])
  const got = await bytesOf(await downloadBundle(`${base}/b.bin`, () => false))
  assert.ok(got.equals(FILE), "bytes differ")
  assert.equal(ranges[0], "")
  assert.match(ranges[1], /^bytes=\d+-$/)
  assert.ok(Number(/\d+/.exec(ranges[1])![0]) >= 1024 * 1024, "resumed from the start")
})

await test("several drops in a row still finish with the right bytes", async () => {
  serveFile(["drop", "drop", "drop", "ok"])
  assert.ok((await bytesOf(await downloadBundle(`${base}/b.bin`, () => false))).equals(FILE))
})

await test("a stalled download is aborted and resumed", async () => {
  serveFile(["stall", "ok"])
  assert.ok((await bytesOf(await downloadBundle(`${base}/b.bin`, () => false, undefined, 300))).equals(FILE))
  assert.match(ranges[1], /^bytes=\d+-$/)
})

await test("a server that ignores the range starts over instead of splicing", async () => {
  serveFile(["drop", "ignore-range"])
  assert.ok((await bytesOf(await downloadBundle(`${base}/b.bin`, () => false))).equals(FILE))
})

await test("a 503 is retried; progress ends at the full size", async () => {
  serveFile(["503", "ok"])
  let last = 0
  const blob = await downloadBundle(`${base}/b.bin`, () => false, (p) => p && (last = p.received))
  assert.equal(blob!.size, FILE.length)
  assert.ok(last <= FILE.length)
})

await test("a 404 fails at once with its status, no retries", async () => {
  let n = 0
  handler = (_, res) => (n++, res.writeHead(404).end())
  await assert.rejects(downloadBundle(`${base}/b.bin`, () => false), (e: { failure?: { status: number } }) => e.failure?.status === 404)
  assert.equal(n, 1)
})

await test("stale part-way returns null and stops", async () => {
  serveFile(["ok"])
  let reads = 0
  const blob = await downloadBundle(`${base}/b.bin`, () => ++reads > 2)
  assert.equal(blob, null)
})

server.close()
console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
