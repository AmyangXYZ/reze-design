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

import type { AlphaMode, StyleGroup } from "reze-engine"
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
export const STAGE_MATERIAL_RULES: { graph: string; keywords: string[]; alphaMode?: AlphaMode }[] = [
  { graph: "Emissive", keywords: ["発光", "電球", "ネオン", "蛍光", "ライト", "灯泡", "发光", "霓虹", "灯", "neon", "emissive", "emission", "bulb", "lamp", "light"] },
  { graph: "Gold", keywords: ["金色", "真鍮", "ゴールド", "黄金", "黄铜", "青铜", "gold", "golden", "brass", "bronze"] },
  { graph: "Glass", keywords: ["ガラス", "硝子", "レンズ", "窓", "玻璃", "窗", "镜片", "boli", "glass", "window", "lens", "pane"] },
  { graph: "Tile", keywords: ["タイル", "陶器", "瓷砖", "地砖", "陶瓷", "tile", "ceramic"] },
  { graph: "Brick", keywords: ["レンガ", "煉瓦", "砖墙", "砖头", "砖", "brick"] },
  { graph: "Concrete", keywords: ["コンクリート", "セメント", "混凝土", "水泥", "shuini", "concrete", "cement"] },
  { graph: "Stone", keywords: ["大理石", "石材", "花岗岩", "石头", "岩", "石", "stone", "marble", "granite", "rock"] },
  // FOLIAGE IS ALPHA-TESTED, which is the whole reason it has a rule. A leaf
  // card's antialiased edges put it in the alpha-blend bucket, where the cards
  // are drawn in author order and stop occluding each other — soft haloed
  // leaves and haze wherever the canopy overlaps itself. `hashed` is
  // alpha-to-coverage in the opaque phase: crisp edges, depth written, which
  // is what the games these stages come from do with exactly these materials.
  //
  // Ahead of Wood, so a tree is a tree before it is timber, and ahead of
  // Fabric, so a leaf is never cloth.
  {
    graph: "Foliage",
    alphaMode: "hashed",
    keywords: ["植物", "樹木", "葉", "芝", "草", "花", "树", "叶", "灌木", "plant", "tree", "shrub", "bush", "leaf", "leaves", "foliage", "grass", "flower", "ivy", "vegetation"],
  },
  { graph: "Wood", keywords: ["木材", "木目", "木板", "木頭", "木头", "板", "木", "wood", "plank", "timber"] },
  { graph: "Fabric", keywords: ["カーテン", "生地", "布料", "窗帘", "织物", "幕", "布", "fabric", "cloth", "textile", "curtain"] },
  { graph: "Leather", keywords: ["レザー", "皮革", "皮带", "革", "皮", "leather"] },
  { graph: "Rubber", keywords: ["タイヤ", "ゴム", "橡胶", "轮胎", "rubber", "tire", "tyre"] },
  { graph: "Paper", keywords: ["ポスター", "紙", "纸张", "海报", "书本", "纸", "paper", "poster", "book"] },
  // PINYIN, which is how a Unity rip from a Chinese game names its materials —
  // X333's pool is X333_shui. It is tested after 水泥/shuini, so cement stays
  // cement.
  { graph: "Water", keywords: ["水面", "池塘", "水", "湖", "河", "海", "shui", "water", "pool", "river", "ocean"] },
  // OUR Metal, not a stage-set copy of it: measured against the fork's, the
  // principled node is the same material (metallic 1, specular 1, roughness .30
  // vs .32) and the only real difference is how far the NPR overlay is mixed in
  // — 0.70 against 0.20. That is a difference in STYLIZATION, not in substance,
  // and this app toon-shades everything else in the frame, so the anime metal is
  // the one that belongs on a railing standing next to a toon-shaded character.
  { graph: "Metal", keywords: ["金属", "メタル", "アルミ", "鉄", "鋼", "钢", "铁", "铝", "铬", "metal", "steel", "iron", "aluminum", "aluminium", "chrome"] },
  { graph: "Plastic", keywords: ["プラスチック", "ビニール", "塑料", "塑胶", "pvc", "plastic", "toy"] },
]

/**
 * Source shader → look, for a stage that says what its materials WERE.
 *
 * The keyword table below guesses from a name, which is all a hand-authored PMX
 * offers. A stage converted out of a game engine knows better: the converter
 * writes the material's source shader into the PMX memo, a free-text field MMD
 * shows and nothing else reads. `Terrain_X333_005` is a pane of glass whose
 * name says "terrain"; no keyword will ever catch it, and its own shader says
 * `SimPipeline/PBR/Glass`.
 *
 * Matched on the tail after the last slash, so a family ports without listing
 * every variant, and checked BEFORE the keywords — a statement beats a guess.
 */
export const SHADER_LOOKS: Record<string, string> = {
  Ripplet: "Water",
  Glass: "Glass",
  Plant: "Foliage",
  SceneBillboard: "Foliage",
}

/**
 * Looks that mean a REAL SURFACE, not painted light.
 *
 * A converted stage marks its premultiplied materials full-bright, because most
 * of them are a light shaft or a decal — colour finished elsewhere, to be drawn
 * as painted. A window is premultiplied for the same reason and is nothing like
 * it: it reflects, it has a fresnel, and it gets darker edge-on. Left in the
 * unlit group it renders as a flat tinted pane.
 *
 * So a material this table recognises as one of these is taken out of that
 * group and given the look instead. The game offers no shader to tell them
 * apart — one Standard covers both — and the name is what the artists used.
 */
export const SURFACE_LOOKS = new Set(["Glass", "Water"])

/** The catch-all for a converted stage's unnamed props — reads the metal,
 *  roughness and occlusion the converter packed into each PMX material. */
export const STAGE_SURFACE = "Stage Surface"

/** The look a material's own source shader means, or null. */
export function shaderLookFor(memo: string): string | null {
  const tail = memo.slice(memo.lastIndexOf("/") + 1).trim()
  return SHADER_LOOKS[tail] ?? null
}

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
export function stageStyleGroups(
  materials: string[],
  existing: StyleGroup[],
  /** Each material's PMX memo, when the model carries one. */
  memos: Record<string, string> = {},
): StyleGroup[] | null {
  // Never touch the pinned character groups even if a stage somehow has them:
  // they carry render classes, and this table knows nothing about those.
  const base = existing.filter((g) => g.renderClass !== "eye" && g.renderClass !== "hair")
  const grouped = new Set(base.flatMap((g) => g.materials))
  const byLook = new Map<string, string[]>()
  for (const material of materials) {
    if (grouped.has(material)) continue
    const look = shaderLookFor(memos[material] ?? "") ?? stageLookFor(material)
    if (!look) continue
    byLook.set(look, [...(byLook.get(look) ?? []), material])
  }
  // EVERYTHING ELSE, IN ONE GROUP — but only where the model can back it up.
  //
  // A converted stage is mostly props: Props_object_337, Props_sofa_006,
  // X323_chair_001. No keyword classifies those and their shader is the same
  // Standard every wall uses, so three quarters of an interior fell through to
  // the neutral default and a fabric sofa, a polished floor and a steel counter
  // all rendered at roughness 0.5 with no metal. Their real values ride in the
  // PMX specular the converter packed, and Stage Surface reads them — so one
  // group covers a whole set and still varies per material.
  //
  // Gated on the MEMO, which only a converted stage has. A hand-authored PMX's
  // specular is whatever its exporter wrote, usually black, and black here
  // would read as metal 0 roughness 0: a mirror where a cotton curtain was.
  const unclaimed = materials.filter((m) => !grouped.has(m) && !stageLookFor(m) && !shaderLookFor(memos[m] ?? ""))
  const surfaced = unclaimed.filter((m) => (memos[m] ?? "").length > 0)
  if (surfaced.length) byLook.set(STAGE_SURFACE, surfaced)

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
    const alphaMode = STAGE_MATERIAL_RULES.find((r) => r.graph === look)?.alphaMode
    next.push({
      id,
      label: look,
      materials: names,
      graph: structuredClone(graph),
      renderClass: "auto",
      ...(alphaMode ? { alphaMode } : {}),
    })
    changed = true
  }
  return changed ? next : null
}
