// Auto style-groups for a STAGE, from its material names.
//
// The engine deliberately refuses to auto-group scenery: `resolvePreset` matches
// material names against CHARACTER hints (hair / eye / 髪 / 肌), and the hair and
// eye presets carry a renderClass — so a chance hit does not merely pick an odd
// look, it draws a wall in the hair pass or has it write the eye stencil.
// Ungrouped is the honest default there.
//
// This is the other half: a table that knows what stage materials are called, so
// a PMX stage arrives wearing tile, wood and glass instead of one flat default.
// It is app-side on purpose — a keyword table is taste, it will be edited often,
// and it must never be able to reach the engine's render classes.

import type { StyleGroup } from "reze-engine"
import { fold } from "@/lib/command-search"
import { libraryGraph } from "@/lib/materials"

/**
 * Material name → the look it means, in the three languages MMD stages are
 * authored in. Ported from the glbstage fork's table, with the Japanese column
 * added — most stages worth loading were named by their Japanese authors, and a
 * table without it classifies almost nothing on them.
 *
 * ORDER MATTERS: specific looks are tested before broad ones, so a lamp is an
 * emitter before it is metal and brass is gold before it is metal.
 *
 * The names are library entries (see content/stage-graphs.json), resolved
 * through libraryGraph — so an entry that is renamed or retuned changes what
 * this produces, and there is no second copy of a graph to drift.
 *
 * Two deliberate omissions. Bare 金 (gold) and 光 (light) are NOT keywords:
 * 金属 is metal and 光沢 is gloss, and a substring match would classify both
 * wrongly before the rule that fits them is ever reached. And 床 / 壁 (floor,
 * wall) are absent entirely — they say WHERE a material is, not what it is
 * made of, and guessing concrete for every floor would repaint the largest
 * surface of every stage on the way in.
 */
export const STAGE_MATERIAL_RULES: { graph: string; keywords: string[] }[] = [
  { graph: "Emissive", keywords: ["発光", "電球", "ネオン", "蛍光", "ライト", "灯泡", "发光", "霓虹", "灯", "neon", "emissive", "emission", "bulb", "lamp", "light"] },
  { graph: "Gold", keywords: ["金色", "真鍮", "ゴールド", "黄金", "黄铜", "青铜", "gold", "golden", "brass", "bronze"] },
  { graph: "Glass", keywords: ["ガラス", "硝子", "レンズ", "窓", "玻璃", "窗", "镜片", "glass", "window", "lens", "pane"] },
  { graph: "Tile", keywords: ["タイル", "陶器", "瓷砖", "地砖", "陶瓷", "tile", "ceramic"] },
  { graph: "Brick", keywords: ["レンガ", "煉瓦", "砖墙", "砖头", "砖", "brick"] },
  { graph: "Concrete", keywords: ["コンクリート", "セメント", "混凝土", "水泥", "concrete", "cement"] },
  { graph: "Stone", keywords: ["大理石", "石材", "花岗岩", "石头", "岩", "石", "stone", "marble", "granite", "rock"] },
  { graph: "Wood", keywords: ["木材", "木目", "木板", "木頭", "木头", "板", "木", "wood", "plank", "timber"] },
  { graph: "Fabric", keywords: ["カーテン", "生地", "布料", "窗帘", "织物", "幕", "布", "fabric", "cloth", "textile", "curtain"] },
  { graph: "Leather", keywords: ["レザー", "皮革", "皮带", "革", "皮", "leather"] },
  { graph: "Rubber", keywords: ["タイヤ", "ゴム", "橡胶", "轮胎", "rubber", "tire", "tyre"] },
  { graph: "Paper", keywords: ["ポスター", "紙", "纸张", "海报", "书本", "纸", "paper", "poster", "book"] },
  { graph: "Water", keywords: ["水面", "池塘", "水", "湖", "河", "海", "water", "pool", "river", "ocean"] },
  // OUR Metal, not a stage-set copy of it: measured against the fork's, the
  // principled node is the same material (metallic 1, specular 1, roughness .30
  // vs .32) and the only real difference is how far the NPR overlay is mixed in
  // — 0.70 against 0.20. That is a difference in STYLIZATION, not in substance,
  // and this app toon-shades everything else in the frame, so the anime metal is
  // the one that belongs on a railing standing next to a toon-shaded character.
  { graph: "Metal", keywords: ["金属", "メタル", "アルミ", "鉄", "鋼", "钢", "铁", "铝", "铬", "metal", "steel", "iron", "aluminum", "aluminium", "chrome"] },
  { graph: "Plastic", keywords: ["プラスチック", "ビニール", "塑料", "塑胶", "pvc", "plastic", "toy"] },
]

/** The look a stage material name means, or null when nothing does. */
export function stageLookFor(material: string): string | null {
  const name = fold(material)
  return STAGE_MATERIAL_RULES.find((r) => r.keywords.some((k) => name.includes(fold(k))))?.graph ?? null
}

/**
 * Style groups for a stage, folded into whatever it already has.
 *
 * Only UNGROUPED materials are classified, so running this twice is safe and
 * running it after hand-grouping cannot undo the hand work: a material already
 * in a group is left exactly where it was put. Names nothing recognises stay
 * ungrouped rather than being swept into a bucket — the materials panel lists
 * them, which is a better answer than a wrong look.
 *
 * Returns null when nothing changed, so a caller can skip a recompile it does
 * not need.
 */
export function stageStyleGroups(materials: string[], existing: StyleGroup[]): StyleGroup[] | null {
  // Never touch the pinned character groups even if a stage somehow has them:
  // they carry render classes, and this table knows nothing about those.
  const base = existing.filter((g) => g.renderClass !== "eye" && g.renderClass !== "hair")
  const grouped = new Set(base.flatMap((g) => g.materials))
  const byLook = new Map<string, string[]>()
  for (const material of materials) {
    if (grouped.has(material)) continue
    const look = stageLookFor(material)
    if (!look) continue
    byLook.set(look, [...(byLook.get(look) ?? []), material])
  }
  if (byLook.size === 0) return null

  const next = [...base]
  const taken = new Set(next.map((g) => g.id))
  let changed = base.length !== existing.length
  for (const [look, names] of byLook) {
    const graph = libraryGraph(look)
    if (!graph) continue
    // A second pass merges into the group it made the first time, found by the
    // label it gave it — the same rule the library uses to say what a look is.
    const i = next.findIndex((g) => (g.label ?? g.id) === look)
    if (i >= 0) {
      const merged = [...new Set([...next[i].materials, ...names])]
      if (merged.length === next[i].materials.length) continue
      next[i] = { ...next[i], materials: merged }
      changed = true
      continue
    }
    let id = `stage-${look.toLowerCase()}`
    for (let n = 2; taken.has(id); n++) id = `stage-${look.toLowerCase()}-${n}`
    taken.add(id)
    next.push({ id, label: look, materials: names, graph: structuredClone(graph), renderClass: "auto" })
    changed = true
  }
  return changed ? next : null
}
