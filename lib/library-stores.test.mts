// Tests for the library's two client stores: everyone's rows
// (lib/community-store, from the CDN-cached /api/library) and yours
// (lib/mine-store, from /api/library/mine), and the one merge between them.
//
//   npx esbuild lib/library-stores.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/ls.mjs && node /tmp/ls.mjs
//
// What must hold: your private rows appear only while you are signed in, your
// public rows are marked yours, built-ins never show as community rows, an
// edit survives the next merge, and a failed load keeps what was there and
// recovers on its own.

import "@/lib/test-stock.mts"
import assert from "node:assert/strict"
import { cache, communityItems, isMine, load, removeCommunityItem, renameCommunityItem, settled, subscribe } from "@/lib/community-store"
import { likedIds, mineRows, noteLike, syncMine } from "@/lib/mine-store"
import { isFailing, retryNow } from "@/lib/net"
import { stockEffects } from "@/lib/stock"

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

// Enough browser for lib/net's retry wait; no IndexedDB, so nothing is saved.
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})

const row = (id: string, name: string, extra: object = {}) => ({
  id,
  kind: "effect" as const,
  name,
  author: "someone",
  description: "",
  tags: [],
  payload: { wgsl: "" },
  owner: "user" as const,
  visibility: "public" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...extra,
})
const stock = stockEffects()[0]
let publicRows = [row("p1", "Theirs"), row("p2", "Mine, public"), row(stock.id, stock.name)]
const ownRows = [{ ...row("p2", "Mine, public"), mine: true }, { ...row("v1", "Mine, private", { visibility: "private" }), mine: true }]
const liked = ["p1"]
let down = false
globalThis.fetch = (async (url: string) => {
  if (down) throw new TypeError("Failed to fetch")
  const body =
    url === "/api/library/mine" ? { items: ownRows, liked } : url === "/api/library" ? { items: publicRows } : null
  return new Response(JSON.stringify(body), { status: body ? 200 : 404 })
}) as typeof fetch
const ids = () => (cache ?? []).map((i) => i.id).sort()
const tick = () => new Promise((r) => setTimeout(r, 20))

await test("signed out: everyone's rows, built-ins left out, nothing yours", async () => {
  await load(true)
  assert.equal(settled, true)
  assert.deepEqual(ids(), ["p1", "p2"])
  assert.equal(isMine("p2"), false)
})

await test("signing in merges your rows: private ones appear, public ones are marked yours", async () => {
  syncMine("u1")
  await tick()
  assert.deepEqual(ids(), ["p1", "p2", "v1"])
  assert.equal(communityItems("effect").find((i) => i.id === "p2")?.mine, true)
  assert.equal(communityItems("effect").find((i) => i.id === "p1")?.mine, false)
  assert.equal(likedIds().has("p1"), true)
})

await test("a fresh public list does not drop your private rows", async () => {
  publicRows = [...publicRows, row("p3", "New")]
  await load(true)
  assert.deepEqual(ids(), ["p1", "p2", "p3", "v1"])
})

await test("a rename shows at once and survives the next merge", async () => {
  renameCommunityItem("v1", "Renamed")
  assert.equal(communityItems("effect").find((i) => i.id === "v1")?.name, "Renamed")
  await load(true)
  assert.equal(communityItems("effect").find((i) => i.id === "v1")?.name, "Renamed")
})

await test("a delete removes the row from both sides", () => {
  removeCommunityItem("p2")
  assert.deepEqual(ids(), ["p1", "p3", "v1"])
  assert.equal(mineRows().some((r) => r.id === "p2"), false)
})

await test("a like is reflected in your hearts", () => {
  noteLike("p3", true)
  assert.equal(likedIds().has("p3"), true)
  noteLike("p3", false)
  assert.equal(likedIds().has("p3"), false)
})

await test("signing out takes your private rows and hearts away", () => {
  syncMine(null)
  assert.equal(ids().includes("v1"), false)
  assert.equal(likedIds().size, 0)
})

await test("subscribers hear every change", async () => {
  let heard = 0
  const off = subscribe(() => heard++)
  await load(true)
  off()
  assert.ok(heard >= 1)
})

await test("a failed refresh keeps the rows, says it is failing, and recovers", async () => {
  const before = ids()
  down = true
  await load(true)
  assert.deepEqual(ids(), before, "rows were dropped")
  assert.equal(isFailing(["community"]), true)
  down = false
  retryNow(["community"])
  await tick()
  assert.equal(isFailing(["community"]), false)
})

console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
