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
 * authored in (and pinyin, which is how a rip from a Chinese game names its
 * materials).
 *
 * Every look is the game's stage model (Game PBR, see content/stage-graphs.json)
 * with defaults measured from Aether Gazer's own materials
 * (docs/ag-material-survey.md §5), or one of its special shaders: Glass,
 * Water, Foliage. Looks with no game counterpart are gone: leather, rubber and
 * paper wear Fabric, plastic wears Lacquer, gold and brass wear Metal (a
 * metal's colour IS its texture), brick wears Tile and concrete Stone.
 *
 * ORDER MATTERS: specific looks are tested before broad ones, so a bulb glows
 * before anything else claims it, granite (花岗岩) is Stone before 花 makes it a flower, a plant is foliage
 * before it is timber, cement (水泥, shuini) is Stone before "shui" makes it Water, and plaster
 * (漆喰) is tested before lacquer (漆).
 *
 * The names are library entries, resolved through libraryGraph — so an entry
 * that is renamed or retuned changes what this produces, and there is no
 * second copy of a graph to drift.
 *
 * Deliberate omissions. Bare 金 (gold), 光 (light) and 灯 (lamp) are NOT
 * keywords, nor "light" and "lamp": 金属 is metal, 光沢 is gloss, and a lamp is
 * mostly its housing — the game lights a shade through an emission MASK,
 * never a whole material, and glowing "light" materials wholesale painted
 * fixtures white. And 床 / 壁 (floor, wall) are absent — they say WHERE a
 * material is, not what it is made of.
 */
export const STAGE_MATERIAL_RULES: { graph: string; keywords: string[] }[] = [
  { graph: "Neon", keywords: ["発光", "電球", "ネオン", "蛍光", "灯泡", "灯管", "发光", "霓虹", "neon", "emissive", "emission", "bulb", "glow"] },
  { graph: "Glass", keywords: ["ガラス", "硝子", "レンズ", "窓", "玻璃", "窗", "镜片", "boli", "glass", "window", "lens", "pane"] },
  { graph: "Stone", keywords: ["コンクリート", "セメント", "混凝土", "水泥", "shuini", "concrete", "cement", "asphalt", "大理石", "石材", "花岗岩", "石头", "岩", "石", "stone", "marble", "granite", "rock"] },
  { graph: "Foliage", keywords: ["植物", "樹木", "葉", "芝", "草", "花", "树", "叶", "灌木", "plant", "tree", "shrub", "bush", "leaf", "leaves", "foliage", "grass", "flower", "ivy", "vegetation"] },
  { graph: "Water", keywords: ["水面", "池塘", "水", "湖", "河", "海", "shui", "water", "pool", "river", "ocean", "lake"] },
  { graph: "Metal", keywords: ["金属", "メタル", "アルミ", "鉄", "鋼", "钢", "铁", "铝", "铬", "金色", "真鍮", "ゴールド", "黄金", "黄铜", "青铜", "銅", "铜", "銀", "银", "metal", "steel", "iron", "aluminum", "aluminium", "chrome", "gold", "golden", "brass", "bronze", "copper", "silver"] },
  { graph: "Tile", keywords: ["タイル", "陶器", "瓷砖", "地砖", "陶瓷", "レンガ", "煉瓦", "砖墙", "砖头", "砖", "tile", "ceramic", "brick"] },
  { graph: "Plaster", keywords: ["漆喰", "石膏", "灰泥", "plaster", "stucco"] },
  { graph: "Wood", keywords: ["木材", "木目", "木板", "木頭", "木头", "板", "木", "wood", "plank", "timber"] },
  { graph: "Lacquer", keywords: ["漆", "ニス", "プラスチック", "ビニール", "塑料", "塑胶", "lacquer", "varnish", "pvc", "plastic", "toy"] },
  { graph: "Fabric", keywords: ["カーテン", "生地", "布料", "窗帘", "织物", "幕", "布", "絨毯", "地毯", "レザー", "皮革", "皮带", "革", "皮", "タイヤ", "ゴム", "橡胶", "轮胎", "ポスター", "紙", "纸张", "海报", "书本", "纸", "fabric", "cloth", "textile", "curtain", "carpet", "rug", "sofa", "cushion", "leather", "rubber", "tire", "tyre", "paper", "poster", "book"] },
]

/**
 * Source shader → look, for a stage that says what its materials WERE.
 *
 * The keyword table guesses from a name, which is all a hand-authored PMX
 * offers. A stage converted out of a game engine knows better: the converter
 * writes the material's source shader into the PMX memo. `Terrain_X333_005` is
 * a pane of glass whose name says "terrain"; its own shader says
 * `SimPipeline/PBR/Glass`.
 *
 * Matched on the tail after the last slash, so a family ports without listing
 * every variant, and checked BEFORE the keywords — a statement beats a guess.
 */
export const SHADER_LOOKS: Record<string, string> = {
  Ripplet: "Water",
  CartoonWaterV2: "Water",
  Glass: "Glass",
  Transparent: "Glass Shell",
  BottleGlass: "Bottle Glass",
  Plant: "Foliage",
  SceneBillboard: "Foliage",
  Standard_PBR_2: "Terrain",
}

/**
 * Looks that mean a REAL SURFACE, not painted light.
 *
 * A converted stage marks its premultiplied materials full-bright, because most
 * of them are a light shaft or a decal — colour finished elsewhere, to be drawn
 * as painted. A window is premultiplied for the same reason and is nothing like
 * it: it reflects, it has a fresnel, and it gets darker edge-on. So a material
 * this table recognises as one of these leaves that group and takes the look.
 */
export const SURFACE_LOOKS = new Set(["Glass", "Glass Shell", "Bottle Glass", "Water"])

/**
 * How each look meets the frame, where it is not plain "over". Glass is the
 * game's premultiplied pane — its reflection must not fade with its
 * transparency. Foliage is alpha-tested: hashed alpha is alpha-to-coverage in
 * the opaque phase, crisp leaf edges and depth written, which is what the game
 * does with its cutout plants; alpha-blended, the cards stop occluding each
 * other and the canopy turns to haze.
 */
export const LOOK_STATE: Record<string, Pick<StyleGroup, "alphaMode" | "blend">> = {
  Glass: { blend: "premultiplied" },
  Foliage: { alphaMode: "hashed" },
}

/** The catch-all for a converted stage — the game's model on the metal,
 *  roughness and occlusion the converter packed into each PMX material. */
export const STAGE_SURFACE = "Stage Surface"

/** A converted material drawn by the game's opaque standard model: it keeps
 *  its own measured values (Stage Surface) over any name-based guess. */
const STANDARD_SHADER = /\/PBR\/(Standard|Detailed)$/

/** The look a material's own source shader means, or null. */
export function shaderLookFor(memo: string): string | null {
  const tail = memo.slice(memo.lastIndexOf("/") + 1).trim()
  return SHADER_LOOKS[tail] ?? null
}

/**
 * The look one material wears: its source shader's when it states one; for a
 * converted material on the game's standard model, a name only when it names
 * a SPECIAL surface (glass, water, a plant) — everything else keeps its own
 * measured values through Stage Surface rather than a name's medians; for a
 * hand-made stage, whatever its name says.
 */
export function lookFor(material: string, memo: string): string | null {
  const stated = shaderLookFor(memo)
  if (stated) return stated
  const named = stageLookFor(material)
  if (named && STANDARD_SHADER.test(memo.trim()) && !SURFACE_LOOKS.has(named) && named !== "Foliage") return null
  return named
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
    const look = lookFor(material, memos[material] ?? "")
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
  const unclaimed = materials.filter((m) => !grouped.has(m) && !lookFor(m, memos[m] ?? ""))
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
    // Ids are /^[a-z0-9_-]+$/: "Glass Shell" is stage-glass-shell.
    const slug = look.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    let id = `stage-${slug}`
    for (let n = 2; taken.has(id); n++) id = `stage-${slug}-${n}`
    taken.add(id)
    next.push({
      id,
      label: look,
      materials: names,
      graph: structuredClone(graph),
      renderClass: "auto",
      ...LOOK_STATE[look],
    })
    changed = true
  }
  return changed ? next : null
}
