// Drive the editor's agent tools in a real browser and save what they return.
//
//   node scripts/agent-tools-probe.mjs [url] [steps.json]
//
// Starts Chrome headless with WebGPU on (its own profile under
// analysis/agent/chrome), opens the editor, waits for window.rezeTools (dev
// only), runs each step — a tool name and its arguments — and writes every
// result to analysis/agent/probe/: the data as JSON, each image as a JPEG.
// The GPU half of lib/ai (captures, the frame read-back, the light probe) can
// only be checked like this; tools.test.mts covers the rest.

import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const url = process.argv[2] ?? "http://localhost:3000/"
const out = "analysis/agent/probe"
mkdirSync(out, { recursive: true })

const steps = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], "utf8"))
  : [
      ["get_scene", {}],
      ["capture", {}],
      ["capture", { shots: [{ shot: "closeup", angle: "front" }, { shot: "full", angle: "three-quarter-left" }] }],
      ["probe_light", {}],
      ["effect_impact", {}],
      ["filmstrip", { times: [2, 8, 14] }],
    ]

const chromePaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
]
const chrome = chromePaths.find((p) => existsSync(p))
if (!chrome) throw new Error("no Chrome or Edge found")
const port = 9333
const browser = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(process.cwd(), "analysis/agent/chrome")}`,
    "--enable-unsafe-webgpu",
    "--window-size=1600,900",
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((t) => t.type === "page")
  } catch {}
}
if (!target) throw new Error("Chrome did not come up")

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener("open", r, { once: true }))
let seq = 0
const pending = new Map()
const logs = []
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`)
  } else if (msg.method === "Runtime.exceptionThrown") {
    logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression, timeout = 180000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result?.result?.value
}

try {
  await send("Runtime.enable")
  await send("Page.enable")
  await send("Page.navigate", { url })
  // The editor is ready when the tools are up and a character is on stage.
  let ready = false
  for (let i = 0; i < 240 && !ready; i++) {
    await sleep(1000)
    ready = await evaluate(
      `(async () => { if (!window.rezeTools) return false; const r = await window.rezeTools.run("get_scene"); return r.data.characters.length > 0 })()`,
    ).catch(() => false)
  }
  if (!ready) throw new Error("the editor never had a character on stage")
  console.log("editor ready; WebGPU adapter:", await evaluate(`(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? (a.info?.vendor + " " + a.info?.architecture) : "none" })()`))
  await sleep(3000)

  for (const [i, [name, args]] of steps.entries()) {
    const t0 = Date.now()
    // Two steps that are not tools: run a page expression, or save what the
    // page shows — for checking the editor's own UI around the tools.
    if (name === "__eval") {
      // An agent request can run for minutes.
      const v = await evaluate(`(async () => { ${args} })()`, 900000)
      console.log(`${String(i).padStart(2, "0")}-eval: ${JSON.stringify(v)?.slice(0, 300)}`)
      continue
    }
    if (name === "__screenshot") {
      const shot = await send("Page.captureScreenshot", { format: "png" })
      writeFileSync(join(out, `${String(i).padStart(2, "0")}-${args || "screen"}.png`), Buffer.from(shot.result.data, "base64"))
      console.log(`${String(i).padStart(2, "0")}-screenshot`)
      continue
    }
    const r = await evaluate(`window.rezeTools.run(${JSON.stringify(name)}, ${JSON.stringify(args)})`)
    const tag = `${String(i).padStart(2, "0")}-${name}`
    const images = r?.images ?? []
    images.forEach((im, k) => writeFileSync(join(out, `${tag}-${k}.jpg`), Buffer.from(im.dataUrl.split(",")[1], "base64")))
    writeFileSync(join(out, `${tag}.json`), JSON.stringify({ args, data: r?.data, images: images.map((im) => im.label) }, null, 2))
    console.log(`${tag}: ${Date.now() - t0}ms, ${images.length} image(s)${r?.data?.error ? `, ERROR ${r.data.error}` : ""}`)
  }
} finally {
  writeFileSync(join(out, "console.txt"), logs.join("\n"))
  console.log(`${logs.length} console warnings/errors → ${out}/console.txt`)
  ws.close()
  browser.kill()
}
