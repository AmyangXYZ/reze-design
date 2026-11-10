// The outliner's tree and the per-character effect copy.
// Run: npx esbuild lib/timeline/rows.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs

import { buildRows, charRow, copyEffectTo, effectOn, moveEffectTo, STAGE_ROW, SCENE_ROW, toggleRow, type RowLabels, type RowSource } from "@/lib/timeline/rows"

let failures = 0
function eq<T>(got: T, want: T, name: string) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) {
    failures++
    console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`)
  }
}

const labels: RowLabels = {
  scene: "Scene", stage: "Stage", camera: "Camera", motion: "Motion", morphs: "Morphs",
  visibility: "Visibility", parent: "Holds", effects: "Effects", materials: "Materials", group: (n) => n,
}
const src: RowSource = {
  cast: [
    { id: "a", name: "Makima", bones: ["上半身", "左腕", "謎"], morphs: ["あ"], materials: ["髪", "服"] },
    { id: "b", name: "Reze", bones: [], morphs: [], materials: [] },
  ],
  stages: [{ id: "s", name: "Church", part: false, materials: ["床"] }],
  props: [{ id: "p", name: "Sword" }],
  effects: [
    { uid: "e1", name: "Aurora", cast: false },
    { uid: "e2", name: "Sparks", models: ["a"], cast: true },
    { uid: "e3", name: "Both", models: ["a", "b"], cast: true },
    { uid: "e4", name: "Chains", cast: true },
  ],
  camera: true,
}
const ids = (section: string | null, open: string[] = []) => buildRows(src, section, new Set(open), labels).map((r) => r.id)

// One section open at a time: the rest are headings.
eq(ids(charRow("a")), ["scene", "char/a", "char/a/motion", "char/a/morphs", "char/a/fx", "char/a/vis", "char/b", "stage", "prop/p"], "Makima's section, closed inside: effects before visibility")
eq(ids(SCENE_ROW), ["scene", "scene/camera", "scene/fx", "char/a", "char/b", "stage", "prop/p"], "the scene's section")
eq(ids(STAGE_ROW, ["stage/s"]), ["scene", "char/a", "char/b", "stage", "stage/s", "stage/s/床", "prop/p"], "the stage, a model opened to its materials")
eq(ids("prop/p"), ["scene", "char/a", "char/b", "stage", "prop/p", "prop/p/parent"], "a prop opens to its holds")

// Visibility opens to the whole model, then a Materials row opening to each.
eq(ids(charRow("a"), ["char/a/vis", "char/a/vis/mats"]).filter((i) => i.startsWith("char/a/vis")), ["char/a/vis", "char/a/vis/model", "char/a/vis/mats", "char/a/vis/mats/髪", "char/a/vis/mats/服"], "model, then materials")

// Effects nest under their owner's Effects row: shared and several-character ones under the scene.
eq(ids(SCENE_ROW, ["scene/fx"]).filter((i) => i.startsWith("fx/")), ["fx/e1"], "the scene has only effects that read no one")
eq(ids(charRow("a"), ["char/a/fx"]).filter((i) => i.startsWith("fx/")), ["fx/e2", "fx/e3", "fx/e4"], "every character effect she is in")
eq(ids(charRow("b"), ["char/b/fx"]).filter((i) => i.startsWith("fx/")), ["fx/e3", "fx/e4"], "and hers")
eq(effectOn({ cast: false }, "a"), false, "a scene effect is no one's")

// Motion opens to named groups; bones no group lists go last under Other.
const motion = buildRows(src, charRow("a"), new Set(["char/a/motion"]), labels).filter((r) => r.kind === "group").map((r) => r.ref)
eq(motion[motion.length - 1], "Other", "an unlisted bone lands in Other")

// Rows inside a section toggle in and out of the open set.
const row = buildRows(src, charRow("a"), new Set(), labels).find((r) => r.id === "char/a/motion")!
eq([...toggleRow(new Set(), row)], ["char/a/motion"], "toggle opens")
eq([...toggleRow(new Set(["char/a/motion"]), { ...row, open: true })], [], "toggle closes")

// Copying makes her an independent copy; moving takes it off one and onto the other.
type E = { id: string; uid?: string; models?: string[] }
const list: E[] = [{ id: "fx", uid: "u1", models: ["a"] }, { id: "other", uid: "u2" }]
eq(copyEffectTo(list, "u1", "b", ["a", "b"]), [{ id: "fx", uid: "u1", models: ["a"] }, { id: "fx", models: ["b"] }, { id: "other", uid: "u2" }], "copy after, hers alone")
eq(copyEffectTo<E>([{ id: "fx", uid: "u1" }], "u1", "b", ["a", "b"]), [{ id: "fx", uid: "u1", models: ["a"] }, { id: "fx", models: ["b"] }], "on her already: she leaves the original for her copy")
eq(moveEffectTo(list, "u1", "a", "b", ["a", "b", "c"]), [{ id: "fx", uid: "u1", models: ["b"] }, { id: "other", uid: "u2" }], "moved")
eq(moveEffectTo<E>([{ id: "fx", uid: "u1" }], "u1", "a", "a", ["a", "b"]), [{ id: "fx", uid: "u1" }], "onto everyone again it aims at no list")

if (failures) {
  console.log(`${failures} failure(s)`)
  process.exit(1)
}
console.log("rows: ok")
