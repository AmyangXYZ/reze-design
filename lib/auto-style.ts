// Auto style groups — one classifier for every model.
//
// A model is not styled by which slot it was uploaded into. A character holds
// a glass, a wooden fan, a steel sword; a prop is often another figure; a
// stage is mostly materials. So every model takes the same two tables:
//
//   ROLE_HINTS   what a FIGURE's parts are called (eye, face, hair, skin) and
//                what clothes and trims are (socks, stockings, metal, cloth) —
//                worn on the current style pack's graphs
//   the STAGE table (lib/stage-style)   what materials are made of — glass,
//                wood, stone, water, foliage, neon…
//
// What decides between them is the MODEL, not the slot: whether it has a head.
// The figure roles are the dangerous ones — hair and eye carry render classes,
// so a chance hit draws a wall in the hair pass or has it write the eye
// stencil — and only a model with a head bone has hair or eyes to find. So:
//
//   a figure        roles → stage table → (unclaimed)
//   anything else   stage table → Stage Surface for converted materials →
//                   the material roles only (cloth, metal, socks, stockings)
//
// Unclaimed materials stay ungrouped, on the neutral default — the materials
// panel lists them, which is a better answer than a wrong look. Materials
// already in a group are never touched, so this is safe to run twice and
// cannot undo hand-grouping.
//
// App-side on purpose: a keyword table is taste, edited often, and the
// engine's own hint list (its autoStyleGroups) cannot be told to skip the
// figure roles for scenery. The role table below follows the engine's.

import type { RenderClass, StyleGroup } from "reze-engine"
import { SLOT_GRAPHS, libraryGraph, packGraph, type LookPack } from "@/lib/materials"
import { LOOK_STATE, STAGE_SURFACE, lookFor } from "@/lib/stage-style"

export type Role = "eye" | "face" | "hair" | "body" | "stockings" | "metal" | "cloth_smooth" | "cloth_rough"

/** The character groups: what each role is called, and how it is drawn. */
export const CHARACTER_GROUPS: { id: Role; label: string; renderClass: RenderClass; alphaMode?: "hashed" }[] = [
  { id: "body", label: "Body", renderClass: "auto" },
  { id: "face", label: "Face", renderClass: "auto" },
  { id: "hair", label: "Hair", renderClass: "hair" },
  { id: "eye", label: "Eye", renderClass: "eye" },
  { id: "cloth_smooth", label: "Smooth Cloth", renderClass: "auto" },
  { id: "cloth_rough", label: "Rough Cloth", renderClass: "auto" },
  { id: "stockings", label: "Stockings", renderClass: "auto", alphaMode: "hashed" },
  { id: "metal", label: "Metal", renderClass: "auto" },
]

/** The roles only a figure has: render classes, or skin and face tones a
 *  wall or a sword must never wear. */
const FIGURE_ROLES = new Set<Role>(["eye", "face", "hair", "body"])

// Substring hints, JP/CN/EN, ordered: more specific families first (靴下 must
// hit socks before 靴 hits cloth). Kept in step with the engine's
// PRESET_NAME_HINTS, whose reasons travel with them:
//
// SOCKS ARE CLOTH, STOCKINGS ARE SHEER — the sock words go to rough cloth ahead
// of the stocking words, 袜子 before the bare 袜 that 丝袜 still reaches.
// Bare 口 is not a face word (it is in 袖口, a cuff), and simplified 发 appears
// only in compounds (it also writes 发光, glow — an emissive panel in the hair
// pass).
const ROLE_HINTS: [Role, string[]][] = [
  ["cloth_rough", ["靴下", "ソックス", "ニーソ", "袜子", "短袜", "棉袜", "socks", "sock"]],
  ["stockings", ["タイツ", "ストッキング", "袜", "stocking", "tights", "pantyhose"]],
  ["eye", ["白目", "目影", "二重", "睫", "まつげ", "まゆ", "眉", "目", "瞳", "眼", "eye", "iris", "pupil", "lash", "brow"]],
  [
    "face",
    ["顔", "颜", "顏", "脸", "臉", "かお", "face", "舌", "tongue", "牙", "牙齿", "齿", "歯", "teeth", "tooth", "口腔", "口内", "mouth", "嘴", "唇", "歯茎", "gums"],
  ],
  [
    "hair",
    ["前髪", "後髪", "髪", "髮", "頭髪", "もみあげ", "アホ毛", "ヘア", "头发", "前发", "后发", "长发", "短发", "发丝", "刘海", "辫", "马尾", "hair", "ahoge", "bang"],
  ],
  ["body", ["肌", "皮肤", "skin", "指甲", "nail"]],
  ["metal", ["金属", "メタル", "metal", "earring", "耳环", "耳環"]],
  [
    "cloth_smooth",
    [
      "服", "衣", "裙", "裤", "スカート", "ワンピ", "リボン", "袖", "靴", "鞋", "帽", "体", "飾", "饰", "尾",
      "套", "腿", "带", "绳", "纱", "巾", "布", "背球", "腰花", "花蕊",
      "skirt", "dress", "ribbon", "sleeve", "shoes", "shirt", "short", "boot", "hat", "cloth", "accessor", "trigger",
    ],
  ],
]

/** Whole names that are body parts — skin by another name. Whole, never
 *  substrings: 手 is a hand, 手套 the glove it wears. */
const BODY_PART_NAMES = new Set(["手", "手部", "腕", "足", "脚", "腿", "爪", "hand", "hands", "arm", "arms", "leg", "legs", "body"])

/** Head bones, in the names PMX and its converters use. */
const HEAD_BONES = new Set(["頭", "头", "head"])

/** Does this skeleton belong to a figure? A head is the test: every MMD
 *  character has one, and no stage, sword or fan does. */
export function isFigure(boneNames: Iterable<string>): boolean {
  for (const name of boneNames) if (HEAD_BONES.has(name.trim().toLowerCase())) return true
  return false
}

/** The role a material name means, or null. Without a head, only the material
 *  roles — cloth, metal, socks, stockings — can answer. */
export function roleFor(material: string, figure: boolean): Role | null {
  const lower = material.toLowerCase()
  if (figure && BODY_PART_NAMES.has(lower.replace(/[\s_.\-0-9]+$/, ""))) return "body"
  for (const [role, hints] of ROLE_HINTS) {
    if (!figure && FIGURE_ROLES.has(role)) continue
    if (hints.some((h) => lower.includes(h))) return role
  }
  return null
}

type Claim = { role: Role } | { look: string }

/** What one material becomes, by the order in the header. */
export function classify(material: string, memo: string, figure: boolean): Claim | null {
  if (figure) {
    const role = roleFor(material, true)
    if (role) return { role }
    const look = lookFor(material, memo)
    return look ? { look } : null
  }
  const look = lookFor(material, memo)
  if (look) return { look }
  // A converted material keeps its own measured values (Stage Surface reads
  // the metal, roughness and occlusion the converter packed) over any name
  // guess. Gated on the memo, which only a converted model has: a hand-made
  // PMX's specular is usually black, which would read as a mirror.
  if (memo.length > 0) return { look: STAGE_SURFACE }
  const role = roleFor(material, false)
  return role ? { role } : null
}

/**
 * Style groups for any model, folded into whatever it already has.
 *
 * Returns null when nothing changed, so a caller can skip a recompile.
 */
export function autoStyle(
  materials: string[],
  existing: StyleGroup[],
  opts: {
    figure: boolean
    /** The style the role groups wear (the user's preference). */
    pack: LookPack
    /** Each material's PMX memo, when the model carries one. */
    memos?: Record<string, string>
  },
): StyleGroup[] | null {
  // Without a head, a pinned hair or eye group has nothing to draw — and must
  // never be handed a material by accident.
  const base = opts.figure ? existing : existing.filter((g) => g.renderClass !== "eye" && g.renderClass !== "hair")
  const grouped = new Set(base.flatMap((g) => g.materials))
  const byRole = new Map<Role, string[]>()
  const byLook = new Map<string, string[]>()
  for (const material of materials) {
    if (grouped.has(material)) continue
    const claim = classify(material, opts.memos?.[material] ?? "", opts.figure)
    if (!claim) continue
    if ("role" in claim) byRole.set(claim.role, [...(byRole.get(claim.role) ?? []), material])
    else byLook.set(claim.look, [...(byLook.get(claim.look) ?? []), material])
  }
  if (byRole.size === 0 && byLook.size === 0) return null

  const next = [...base]
  const taken = new Set(next.map((g) => g.id))
  let changed = base.length !== existing.length
  const merge = (at: number, names: string[]) => {
    const merged = [...new Set([...next[at].materials, ...names])]
    if (merged.length === next[at].materials.length) return
    next[at] = { ...next[at], materials: merged }
    changed = true
  }

  // Roles: one group per role, by the role's own id — the id the seeded drop
  // targets and a pack switch already know it by.
  for (const { id, label, renderClass, alphaMode } of CHARACTER_GROUPS) {
    const names = byRole.get(id)
    if (!names) continue
    const at = next.findIndex((g) => g.id === id)
    if (at >= 0) {
      merge(at, names)
      continue
    }
    const graph = packGraph(opts.pack, id) ?? SLOT_GRAPHS[id]
    if (!graph) continue
    taken.add(id)
    // Labelled as the seeded drop targets are, so builtin-text translates it.
    next.push({ id, label, materials: names, graph: structuredClone(graph), renderClass, ...(alphaMode ? { alphaMode } : {}) })
    changed = true
  }

  // Looks: one group per look, found again by the label it was given.
  for (const [look, names] of byLook) {
    const graph = libraryGraph(look)
    if (!graph) continue
    const at = next.findIndex((g) => (g.label ?? g.id) === look)
    if (at >= 0) {
      merge(at, names)
      continue
    }
    // Ids are /^[a-z0-9_-]+$/: "Glass Shell" is stage-glass-shell.
    const slug = look.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    let id = `stage-${slug}`
    for (let n = 2; taken.has(id); n++) id = `stage-${slug}-${n}`
    taken.add(id)
    next.push({ id, label: look, materials: names, graph: structuredClone(graph), renderClass: "auto", ...LOOK_STATE[look] })
    changed = true
  }
  return changed ? next : null
}

/** What autoStyle needs from a loaded model. */
type StyledModel = {
  getMaterials(): { name: string; memo?: string }[]
  getSkeleton(): { bones: { name: string }[] }
}

/** Whether a loaded model is a figure — see isFigure. */
export function modelIsFigure(model: StyledModel | null | undefined): boolean {
  return !!model && isFigure(model.getSkeleton().bones.map((b) => b.name))
}

/** autoStyle, read off a loaded model: its materials, their memos, its head. */
export function autoStyleModel(model: StyledModel | null | undefined, existing: StyleGroup[], pack: LookPack): StyleGroup[] | null {
  if (!model) return null
  const materials = model.getMaterials()
  const memos = Object.fromEntries(materials.filter((m) => m.memo).map((m) => [m.name, m.memo!]))
  return autoStyle(
    materials.map((m) => m.name),
    existing,
    { figure: modelIsFigure(model), pack, memos },
  )
}
