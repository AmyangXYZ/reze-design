// The stock in Chinese: their names and descriptions come with their rows
// (`nameZh`, `descriptionZh`); their tags and a character's default group
// labels are translated here.
//
// DISPLAY ONLY. What is stored is always the English name — scenes refer to a
// stock item by it, and a scene made in one language opens in the other — so this
// translates on the way to the screen and never into a document. A user's or a
// published item shows as its author wrote it, in whatever language, unless its
// row carries a Chinese of its own (a style maker's graphs).

import type { Locale } from "@/lib/i18n"
import { stockEffects, stockGrades, stockGraphs, styleGraphs } from "@/lib/stock"

// The stock's tags. Abbreviations (AG, NPR, PBR, MIDI…) stay as they are;
// a tag already in Chinese is its own label.
const TAGS: Record<string, string> = {
  "aether-gazer": "深空之眼", "wuthering-waves": "鸣潮", "zenless-zone-zero": "绝区零", "honkai-star-rail": "星穹铁道", "arknights-endfield": "终末地",
  ag: "AG", wuwa: "WuWa", zzz: "ZZZ", hsr: "HSR", endfield: "终末地", npr: "NPR", pbr: "PBR", midi: "MIDI",
  anime: "二次元", soft: "柔和",
  body: "身体", face: "脸部", hair: "头发", eye: "眼睛", eyes: "眼睛", metal: "金属",
  cloth_smooth: "光滑布料", cloth_rough: "粗糙布料", stockings: "丝袜",
  stage: "场景", maps: "贴图", wood: "木材", tile: "瓷砖", brick: "砖", stone: "石材", concrete: "混凝土",
  plaster: "灰泥", wall: "墙面", lacquer: "漆面", plastic: "塑料", fabric: "织物", emission: "发光",
  glass: "玻璃", church: "教堂", bottle: "瓶子", water: "水", plant: "植物", terrain: "地形",
  nature: "自然", rain: "雨", mood: "氛围", overlay: "叠加", abstract: "抽象", neon: "霓虹", text: "文字",
  sky: "天空", night: "夜晚", calm: "宁静", particles: "粒子", glow: "发光", scene: "场景", magic: "魔法",
  fireworks: "烟花", festival: "节日", character: "角色", motion: "动作", reactive: "互动", gold: "金色",
  holy: "神圣", teleport: "传送", ground: "地面", light: "光", weather: "天气", winter: "冬季", audio: "音频",
  music: "音乐", background: "背景", fire: "火", lightning: "闪电", atmosphere: "大气", fog: "雾", sim: "模拟",
  outline: "描边", style: "风格", dark: "暗黑", blood: "血", embers: "余烬", sakura: "樱花", petals: "花瓣",
  spring: "春天", sparks: "火花", subtle: "细微", pool: "水池", retro: "复古", noise: "噪点", screen: "全屏",
  pixel: "像素", "8bit": "8 位", sprite: "精灵图", laser: "激光", superhero: "超级英雄", mirror: "镜子", mosaic: "马赛克", censor: "打码",
  reflection: "反射", lineart: "线稿", toon: "卡通", manga: "漫画", glitch: "故障", transition: "转场",
  trail: "拖尾", grass: "草", hand: "手", flowers: "花", gesture: "手势", dance: "舞蹈", stars: "星星",
  "stop-motion": "定格动画", neutral: "中性", clean: "干净", red: "红色", crimson: "深红", horror: "恐怖",
  saturated: "高饱和", contrast: "对比度", warm: "暖色", divine: "神圣", cool: "冷色", blue: "蓝色", cyan: "青色", pink: "粉色",
  romantic: "浪漫",
}

// A character's default groups (lib/auto-style CHARACTER_GROUPS), by their
// stored English label.
const GROUP_LABELS: Record<string, string> = {
  Body: "身体", Face: "脸部", Hair: "头发", Eye: "眼睛",
  "Smooth Cloth": "光滑布料", "Rough Cloth": "粗糙布料", Stockings: "丝袜", Metal: "金属",
}

export type StockKind = "graph" | "effect" | "grade"
// The rendering styles' graphs beside the stock's: they are curated too, and
// a group wearing one carries only its name.
const SHELVES = { graph: () => [...stockGraphs(), ...styleGraphs()], effect: stockEffects, grade: stockGrades }

/** An item as `{ name, owner }`, with its Chinese when the caller has the row.
 *  A row's own Chinese shows whoever owns it (a style maker's graphs carry
 *  theirs). Given only a name, the shelf is asked, and only for stock: a
 *  community item that shares a stock name is not that item. */
type Item = { name: string; owner?: string; nameZh?: string; descriptionZh?: string }
const fromStock = (item: Item) => item.owner === undefined || item.owner === "stock"

/** The row's Chinese, from the item itself or, given only a name, the shelf. */
function zhOf(kind: StockKind, item: Item): { name?: string; description?: string } {
  const row: Item | undefined =
    item.nameZh !== undefined ? item : fromStock(item) ? SHELVES[kind]().find((i) => i.name === item.name) : undefined
  return { name: row?.nameZh || undefined, description: row?.descriptionZh || undefined }
}

/** The name to show for an item: its Chinese where it has one, else the stored name. */
export function stockName(kind: StockKind, item: Item, locale: Locale): string {
  return (locale === "zh" && zhOf(kind, item).name) || item.name
}

/** The description to show: its Chinese where it has one, else the stored one. */
export function stockDescription(kind: StockKind, item: Item & { description?: string }, locale: Locale): string {
  return (locale === "zh" && zhOf(kind, item).description) || item.description || ""
}

/** A tag's label: a stock tag in Chinese; any other tag as written. */
export function tagLabel(tag: string, locale: Locale): string {
  return (locale === "zh" && TAGS[tag]) || tag
}

/** A group's label: a default group's in Chinese until the user renames it. */
export function localGroupLabel(label: string, locale: Locale): string {
  return (locale === "zh" && GROUP_LABELS[label]) || label
}

/** Every Chinese name and tag of a stock item, for search: either language finds it. */
export function stockSearchText(kind: StockKind, item: Item & { tags?: string[] }): string {
  if (!fromStock(item)) return ""
  const zh = zhOf(kind, item)
  return [zh.name, zh.description, ...(item.tags ?? []).map((t) => TAGS[t])].filter(Boolean).join(" ")
}
