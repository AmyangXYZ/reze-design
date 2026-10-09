// The editor chrome's scales, checked. `npm run lint:chrome`.
//
// AGENTS.md states them: four text sizes, the two text colours and three
// accents, the surface/line tokens, three radii and rounded-full. Written down
// alone they drifted — an audit found nine radius spellings and seven sizes —
// so this reads every class string in app/ and components/ and names what is
// off the scale. components/ui (the primitives) and app/admin (its own light
// theme) are out of scope.
//
// Only string literals are read (className="…", cn("…"), `…`), never comments
// or prose, so "rounded corner" in a sentence is not a finding.
//
// An exception is a deliberate palette, not a convenience: each entry below
// says why it exists. A new one belongs in review, not in a hurry.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const RULES = [
  { id: "text-size", re: /(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem)\]/g, fix: "text-2xs · text-xs · text-sm · text-base" },
  { id: "radius", re: /(?<![\w-])rounded(?:-(?:[trblse]{1,2}-)?(?:xs|sm|md|lg|xl|2xl|3xl|\[[^\]]+\]))?(?![\w-])/g, fix: "rounded-surface · rounded-interior · rounded-chip · rounded-full" },
  { id: "grey", re: /(?<![\w-])(?:text|bg|border|ring|fill|stroke)-(?:zinc|neutral|gray|slate|stone)-\d+(?:\/\d+)?/g, fix: "text-foreground/-muted-foreground · bg-surface/-raised/-background · border-line/-strong" },
  { id: "hex", re: /(?<![\w-])[\w:-]*-\[#[0-9a-fA-F]{3,8}\]/g, fix: "a token" },
  { id: "accent-shade", re: /(?<![\w-])(?:text|bg|border|ring)-(?:blue|amber|red)-(?:50|100|200|300|500|600|700|800|900|950)(?:\/\d+)?/g, fix: "the accent at -400 (blue-400 · amber-400 · red-400)" },
  { id: "text-opacity", re: /(?<![\w-])text-(?:muted-)?foreground\/\d+/g, fix: "text-foreground or text-muted-foreground, no opacity" },
]

/** file → rule ids allowed there, and why. */
const EXCEPTIONS = {
  "components/graph/reze-node.tsx": { grey: "a node card is canvas content that must stand off the dark canvas", hex: "socket colours are Blender's data-type code" },
  "components/editor/wgsl-editor.tsx": { hex: "the code view's own ground and gutter, matched to its syntax theme" },
  "components/scene/anim-player.tsx": { radius: "the transport's 20px corner clamps to a pill when collapsed — explained where it is set" },
}
/** Classes allowed anywhere, and why. */
const ANYWHERE = new Map([
  ["text-zinc-950", "dark text on the white library-door pills"],
  ["hover:text-zinc-950", "dark text on the white library-door pills"],
])

const files = execFileSync("git", ["ls-files", "app", "components"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !f.startsWith("components/ui/") && !f.startsWith("app/admin/"))

const LITERAL = /"[^"\n]*"|`[^`]*`|'[^'\n]*'/g
let count = 0
for (const file of files) {
  const src = readFileSync(file, "utf8")
  for (const lit of src.matchAll(LITERAL)) {
    for (const rule of RULES) {
      for (const hit of lit[0].matchAll(rule.re)) {
        const cls = hit[0]
        if (ANYWHERE.has(cls) || EXCEPTIONS[file]?.[rule.id]) continue
        const line = src.slice(0, lit.index + hit.index).split("\n").length
        console.log(`${file}:${line}  ${rule.id}  ${cls}  → ${rule.fix}`)
        count++
      }
    }
  }
}
if (count) {
  console.log(`\n${count} off the chrome's scale — see AGENTS.md "Editor chrome".`)
  process.exitCode = 1
} else console.log("chrome: on scale")
