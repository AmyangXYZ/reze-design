# Editorial chrome: bringing reze.build's look to reze.design

Written 2026-10-19 from the reze.build session that made it. The user saw the result
and said it "really looks like a magazine cover", and wants reze.design's chrome to
move to the same lines and become more immersive. This is the brief. Read the
reze.build code it names before writing any here, and read this repo's `AGENTS.md`
first: its rules still hold unless this brief changes one, and when it does, change
`AGENTS.md` and `scripts/check-chrome.mjs` in the same edit.

## What reze.build did

`../reze-build` at `e1436b1`. Read these, in this order:

| File | What it is |
| --- | --- |
| `components/builder/console.tsx` | The console: type set straight on the backdrop, no panel. Serif display name, mono facts, a numbered index (`01 Body`), small swatches, dials. |
| `components/builder/dials.tsx` | Hairline dials: label left, mono value right (violet once changed), a 1px rule with a small ink bead, a tick where the default is. |
| `components/ui/slider.tsx` | The `variant="hairline"` it uses. |
| `components/builder/stage-controls.tsx` | Actions top right as bare icons plus one ink pill (Export); camera and pose as one line of type along the bottom with mono group labels and a violet underline for the chosen one; the head ruler. |
| `app/globals.css` | Tokens. `--font-display` (Instrument Serif, italic) and `--text-display` (40px) are the only additions to the type scale; values are set in the mono. |
| `app/layout.tsx` | Loading Instrument Serif via `next/font/google`. |

reze.build's chrome is LIGHT because it sits on a studio wall it controls. That
part does not transfer; the grammar does.

## The grammar

1. **The canvas is the cover.** The chrome is the cover's type. Remove containers
   wherever type alone reads; a box has to earn its place.
2. **One display line.** The scene's name in the serif italic, large, top left.
   Under it, one mono uppercase line of facts (cast, length, stage). It is the only
   display-size text anywhere.
3. **An index, not tabs.** The docks become a numbered list in a narrow column
   (`01 Cast`, `02 Look`, `03 Light`, …), mono numerals, the chosen one in ink and
   its numeral violet. Content sits beside it.
4. **Hairlines, not wells.** Sliders are 1px rules with a small bead; values are
   mono. Group headings are plain muted 11px words, not uppercase eyebrows.
5. **Controls as a line of type.** Transport, camera and view switches become one
   line along the bottom: mono uppercase group labels, plain words for the choices,
   a 1.5px violet underline for the chosen one.
6. **One solid object per screen edge at most.** reze.build has exactly one: the
   ink Export pill. Here that is Publish.
7. **The three accents keep their meanings.** Violet selected, amber warning, red
   destructive. Ink (`text-foreground`) carries emphasis; nothing else is coloured.

## What changes here

reze.design's canvas is the user's scene: a pink demo, falling stars, a dark stage,
effects moving every frame. Type set bare on that will not always read. So:

- **The glow from the wall's own colour behind each letter.** reze.build's bottom
  line uses `[text-shadow:0_0_3px_var(--background),0_0_8px_var(--background),0_0_14px_var(--background)]`.
  Here the glow takes the scene's own background colour (the document already knows
  it), so it disappears into the scene rather than looking like a stamp.
- **An edge fade where the type sits.** A soft gradient from the scene's background
  colour at the edge to transparent, under the console and under the bottom line
  only, the way a cover darkens a photo under its masthead. CSS over the canvas,
  never a blur: AGENTS.md records what a backdrop blur over a live canvas costs.
- **Dark and light.** The palettes (`lib/chrome-theme.ts`) restate the tokens; the
  editorial grammar must work in every one of them. Check the light one
  (strawberry) as well as night.
- **Workbenches stay surfaces.** The timeline and dopesheet, the node graph, the
  material tree, the WGSL editor, the AI panel, publish: dense tools a person works
  inside for minutes. They keep a surface, restyled to the same type, hairlines and
  mono values. A cover can have an inside.

## Order

1. Fonts and tokens: `--font-display`, `--text-display`, hairline slider variant.
   Update `AGENTS.md` and `check-chrome.mjs` for the new size.
2. The shell: display title + facts, the index, the dials of the selected dock on
   hairlines, the edge fade, the bottom line. The scene editor's look, before any
   individual editor.
3. The viewer (`app/[user]/[scene]`): it is the published cover. Same title,
   same bottom line, nothing else. Check it in Hide UI too.
4. The workbenches, one at a time.

## Working method

Look at your own work before handing it back. Drive headless Chrome over the
DevTools protocol, which renders WebGPU. This is not the Claude-in-Chrome extension,
which the user does not want used.

```js
// node shot.mjs <url> <out.png> [js-step ...]  — each step evaluated, then a 2.5s wait.
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const [url, out, ...steps] = process.argv.slice(2)
const port = 9333
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  "--window-size=1440,900", "--user-data-dir=<a scratch dir>", "about:blank",
], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page") } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener("open", r))
let id = 0
const pending = new Map()
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send("Page.navigate", { url })
await sleep(4000)
for (const step of steps) { await send("Runtime.evaluate", { expression: step, awaitPromise: true }); await sleep(2500) }
const shot = await send("Page.captureScreenshot", { format: "png" })
writeFileSync(out, Buffer.from(shot.result.data, "base64"))
ws.close(); chrome.kill(); process.exit(0)
```

Steps are plain DOM, e.g.
`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Look")).click()`.
Capture the demo scene, an empty scene and a light palette, at desktop and phone
width, before every hand-back.

## What the user rejected on the way

Each of these was tried on reze.build and turned down. Do not land on one:

- the shipped dark docks with larger text ("ugly, text so large");
- the same docks repainted light with rounded pills ("not opus level");
- one white panel down the left with floating pills around it ("converges to my
  reze design chrome");
- a start screen before the scene ("just enter with a scene").

## Constraints

- The live site has users. Nothing lands on main until the user has looked at it,
  and no commit until they say so.
- Never run prettier; this repo has no config for it.
- Raw `<button>`/`<input>` stay banned; extend the primitive (as reze.build did with
  the slider's `hairline` variant).
