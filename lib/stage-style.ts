// What materials are made of, from their names and shaders — the MATERIAL half
// of auto-styling (lib/auto-style has the classifier every model takes).
//
// A table that knows what stage materials are called, so a model arrives
// wearing tile, wood and glass instead of one flat default. It is app-side on
// purpose: a keyword table is taste, it will be edited often, and none of its
// looks carries a render class.

import type { StyleGroup } from "reze-engine"
import { fold } from "@/lib/command-search"

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
