// ray-mmd materials — the per-material .fx presets MMD stages ship with — as
// style groups.
//
// A ray-mmd material .fx is a settings file: #define lines say which map feeds
// which channel, const lines hold the scalars, and one #include pulls in the
// shared shader that does the work. So a preset converts by being read; the
// HLSL behind it never has to run. The .emd beside it says which preset each
// PMX material wears, by material index.
//
// The conversion reproduces ray-mmd's material model on our Principled node:
// albedo, a tangent-space normal map, smoothness and metalness read from their
// channels, and emission as albedo × a mask. The maps are downscaled into PNGs
// beside the .pmx and named per material in a sidecar (lib/material-maps.ts).
// ray-mmd's own glass and water presets become the Glass and Water looks.

import type { GraphLink, GraphNode, ShaderGraph, SocketValue, StyleGroup } from "reze-engine"
import { libraryGraph } from "@/lib/materials"
import { sidecarPath, type MaterialImages, type MaterialMapsDoc } from "@/lib/material-maps"
import { parsePmxMesh } from "@/lib/pmx-mesh"
import { relFilePath } from "@/lib/scene-files"
import { decodeTga } from "@/lib/tga"

// ── Paths ──

const normalize = (p: string) => {
  const out: string[] = []
  for (const part of p.replace(/[\\¥]/g, "/").split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}
const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1)
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)
const stemOf = (p: string) => baseOf(p).replace(/\.[^.]+$/, "")
const isAbsolute = (p: string) => /^[a-z]:[\\/¥]/i.test(p) || /^[\\/¥]{2}/.test(p)

function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder("shift_jis").decode(buffer)
  }
}

// ── .emd ──

/** An MME effect assignment. `fx` is null where an object inherits the model's
 *  default, and "" where it was set to none. */
export type Emd = {
  fallback: string | null
  objects: Map<number, { fx: string | null; show: boolean }>
}

export function parseEmd(text: string): Emd {
  const objects: Emd["objects"] = new Map()
  let fallback: string | null = null
  let section = ""
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const head = /^\[(.+)\]$/.exec(line)
    if (head) {
      section = head[1]
      continue
    }
    const m = section === "Effect" && /^Obj(?:\[(\d+)\])?(\.show)?\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[3].trim()
    const fx = value.toLowerCase() === "none" ? "" : value
    if (m[1] === undefined) {
      if (!m[2]) fallback = fx
      continue
    }
    const entry = objects.get(Number(m[1])) ?? { fx: null, show: true }
    if (m[2]) entry.show = value.toLowerCase() !== "false"
    else entry.fx = fx
    objects.set(Number(m[1]), entry)
  }
  return { fallback, objects }
}

/** How well an .emd describes a model: -1 when it names a material the model
 *  does not have, otherwise how many presets are named after their material. */
export function emdFit(emd: Emd, materialNames: string[]): number {
  let score = 0
  for (const [i, entry] of emd.objects) {
    if (i >= materialNames.length) return -1
    const fx = entry.fx && stemOf(normalize(entry.fx)).toLowerCase()
    const name = materialNames[i].toLowerCase()
    if (fx && (name.includes(fx) || fx.includes(name))) score++
  }
  return score
}

// ── The other assignment: a hand-written table ──
//
// Not every pack ships an .emd. A Chinese stage convention writes the same
// thing as a text table — a section per model, then `12------1`, material 12
// wears 1.fx — because the author assigned the presets by index in MME and
// typed out what they did. Read into the same shape, it goes through the .emd
// path untouched.

/** One model's block in a material table. */
export type MaterialTableSection = { name: string; objects: Emd["objects"] }

const ENTRY = /^\s*(\d+)\s*[-–—]{2,}\s*(.+?)\s*$/

/** The spec an entry names: the first of the author's variants, without the
 *  note they put beside it. "无" (none) is an assignment to nothing. */
function tableSpec(raw: string): string {
  const first = raw.split("/")[0]
  const name = first.replace(/[（(][^）)]*[）)]/g, "").trim()
  return name === "无" || name.toLowerCase() === "none" ? "" : name
}

export function parseMaterialTable(text: string): MaterialTableSection[] {
  const sections: MaterialTableSection[] = []
  let pending = ""
  let current: MaterialTableSection | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = ENTRY.exec(line)
    if (!m) {
      // A heading, and only the last one before the entries is this block's.
      pending = line
      current = null
      continue
    }
    if (!current) {
      current = { name: pending, objects: new Map() }
      sections.push(current)
    }
    const spec = tableSpec(m[2])
    current.objects.set(Number(m[1]), { fx: spec ? spec + ".fx" : "", show: true })
  }
  return sections.filter((s) => s.objects.size > 0)
}

/** Punctuation and spacing carry no meaning across a heading and a file name:
 *  "A（议会外广场）" and "A-议会外广场.pmx" are the same block. */
const bare = (s: string) => s.replace(/[（(）)\-_\s.·]+/g, "").toLowerCase()

/**
 * How well a table section describes a model: -1 when it numbers a material
 * the model does not have.
 *
 * A section names no material, so nothing can be matched the way an .emd's
 * preset names are. What it has instead is its heading and its LENGTH — a
 * block written for a 22-material model ends at 21 — and both are strong.
 */
export function tableFit(section: MaterialTableSection, materialNames: string[], modelName: string): number {
  if (section.objects.size < 3) return -1
  let last = -1
  for (const i of section.objects.keys()) {
    if (i >= materialNames.length) return -1
    last = Math.max(last, i)
  }
  const heading = bare(section.name)
  const model = bare(modelName)
  const named = heading.length > 0 && (model.startsWith(heading) || heading.startsWith(model))
  const ends = last === materialNames.length - 1
  // One or the other has to hold. Numbers alone are not an assignment — a
  // readme listing steps fits every model with enough materials.
  if (!named && !ends) return -1
  return (named ? 100 : 0) + (ends ? 50 : 0) + section.objects.size
}

// ── Material .fx ──

type Preset = { defines: Map<string, string>; consts: Map<string, number[]> }

/** A ray-mmd material preset's settings, or null for any other .fx. */
export function parsePreset(text: string): Preset | null {
  const defines = new Map<string, string>()
  for (const m of text.matchAll(/^[ \t]*#define[ \t]+(\w+)[ \t]*([^\r\n]*)/gm)) {
    const quoted = /^"([^"]*)"/.exec(m[2].trim())
    defines.set(m[1], quoted ? quoted[1] : m[2].replace(/\/\/.*$/, "").trim())
  }
  if (!defines.has("ALBEDO_MAP_FROM")) return null
  const consts = new Map<string, number[]>()
  for (const m of text.matchAll(/\bconst[ \t]+\w+[ \t]+(\w+)[ \t]*=[ \t]*([^;]+);/g)) {
    const nums = m[2].replace(/^\s*\w+\s*\(/, "(").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)
    if (nums) consts.set(m[1], nums.map(Number))
  }
  return { defines, consts }
}

/** Where a channel comes from: the PMX material's own texture, or a file. */
type Source = { kind: "pmx" } | { kind: "file"; path: string }
type Channel = 0 | 1 | 2 | 3

export type RayMaterial = {
  albedo: { source: Source | null; tint: [number, number, number]; applyDiffuse: boolean }
  normal: { source: Source; strength: number } | null
  /** `fallback` is the preset's constant, which stands in when the map turns out blank. */
  smoothness:
    | { source: Source; channel: Channel; type: number; scale: number; scaleMode: number; fallback: number }
    | { value: number }
  metalness: { source: Source; channel: Channel; scale: number; scaleMode: number; fallback: number } | { value: number }
  specular: number
  emissive:
    | { source: Source; channel: Channel; intensity: number }
    | { color: [number, number, number]; intensity: number }
    | null
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A preset read as ray-mmd reads it. Map paths come back resolved against the
 *  .fx's own folder; options with no counterpart here are listed in `warnings`. */
export function readRayMaterial(preset: Preset, fxPath: string, warnings: string[]): RayMaterial {
  const { defines, consts } = preset
  const int = (key: string) => Number.parseInt(defines.get(key) ?? "0", 10) || 0
  const scalar = (key: string, fallback: number) => consts.get(key)?.[0] ?? fallback
  const vec3 = (key: string, fallback: number): [number, number, number] => {
    const v = consts.get(key) ?? [fallback]
    return v.length >= 3 ? [v[0], v[1], v[2]] : [v[0], v[0], v[0]]
  }
  const channel = (key: string): Channel => (Math.min(3, Math.max(0, int(key))) as Channel)
  const source = (prefix: string, loopKey: string): Source | null => {
    const from = int(`${prefix}_FROM`)
    if (from === 0) return null
    if (from > 3) {
      warnings.push(`${stemOf(fxPath)}: ${prefix}_FROM ${from} is not supported`)
      return null
    }
    if (int(`${prefix}_UV_FLIP`)) warnings.push(`${stemOf(fxPath)}: ${prefix}_UV_FLIP is ignored`)
    if ((consts.get(loopKey) ?? [1]).some((x) => x !== 1)) warnings.push(`${stemOf(fxPath)}: ${loopKey} is ignored`)
    if (from === 3) return { kind: "pmx" }
    return { kind: "file", path: normalize(dirOf(fxPath) + (defines.get(`${prefix}_FILE`) ?? "")) }
  }

  const albedoSource = source("ALBEDO_MAP", "albedoMapLoopNum")
  const albedo = {
    source: albedoSource,
    tint: int("ALBEDO_MAP_APPLY_SCALE") === 1 || !albedoSource ? vec3("albedo", 1) : ([1, 1, 1] as [number, number, number]),
    applyDiffuse: int("ALBEDO_MAP_APPLY_DIFFUSE") === 1,
  }

  const normalSource = source("NORMAL_MAP", "normalMapLoopNum")
  const normalType = int("NORMAL_MAP_TYPE")
  if (normalSource && normalType >= 2) warnings.push(`${stemOf(fxPath)}: NORMAL_MAP_TYPE ${normalType} is not supported`)
  const normal = normalSource && normalType < 2 ? { source: normalSource, strength: scalar("normalMapScale", 1) } : null

  const smoothSource = source("SMOOTHNESS_MAP", "smoothnessMapLoopNum")
  const smoothness = smoothSource
    ? {
        source: smoothSource,
        channel: channel("SMOOTHNESS_MAP_SWIZZLE"),
        type: int("SMOOTHNESS_MAP_TYPE"),
        scale: scalar("smoothness", 1),
        scaleMode: int("SMOOTHNESS_MAP_APPLY_SCALE"),
        fallback: scalar("smoothness", 0.5),
      }
    : { value: scalar("smoothness", 0) }

  const metalSource = source("METALNESS_MAP", "metalnessMapLoopNum")
  const metalness = metalSource
    ? {
        source: metalSource,
        channel: channel("METALNESS_MAP_SWIZZLE"),
        scale: scalar("metalness", 1),
        scaleMode: int("METALNESS_MAP_APPLY_SCALE"),
        fallback: scalar("metalness", 0),
      }
    : { value: scalar("metalness", 0) }

  let emissive: RayMaterial["emissive"] = null
  if (int("EMISSIVE_ENABLE")) {
    const intensity = scalar("emissiveIntensity", 1) * (int("EMISSIVE_MAP_APPLY_SCALE") ? scalar("emissive", 1) : 1)
    const emissiveSource = source("EMISSIVE_MAP", "emissiveMapLoopNum")
    emissive = emissiveSource
      ? { source: emissiveSource, channel: channel("EMISSIVE_MAP_SWIZZLE"), intensity }
      : { color: vec3("emissive", 1).map(srgbToLinear) as [number, number, number], intensity: scalar("emissiveIntensity", 1) }
  }

  return { albedo, normal, smoothness, metalness, specular: scalar("specular", 0.5), emissive }
}

// ── Graph ──

/** A source as the graph samples it: the PMX texture, or group image slot n. */
export type Sampled = "pmx" | number

/** ray-mmd's material model on the Principled node. `sampled` maps each map
 *  path to how the graph reads it. */
export function rayGraph(m: RayMaterial, sampled: (source: Source) => Sampled | null): ShaderGraph {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  type Ref = [node: string, socket: string]
  const node = (id: string, type: string, inputs?: Record<string, SocketValue>) => {
    if (!nodes.some((n) => n.id === id)) nodes.push(inputs ? { id, type, inputs } : { id, type })
    return id
  }
  const link = ([from, socket]: Ref, to: string, toSocket: string) =>
    links.push({ from: { node: from, socket }, to: { node: to, socket: toSocket } })
  const sample = (s: Sampled) => (s === "pmx" ? node("tex", "texture") : node(`map${s}`, `tex_image/${s}`))
  const channelOf = (s: Sampled, ch: Channel): Ref => {
    const n = sample(s)
    if (ch === 3) return [n, "alpha"]
    const sep = `${n}_rgb`
    if (!nodes.some((x) => x.id === sep)) {
      node(sep, "separate_color")
      link([n, "color"], sep, "color")
    }
    return [sep, "rgb"[ch]]
  }
  let seq = 0
  const math = (op: string, a: Ref | number, b: Ref | number): Ref => {
    const inputs: Record<string, SocketValue> = {}
    if (typeof a === "number") inputs.a = a
    if (typeof b === "number") inputs.b = b
    const id = node(`math${seq++}`, `math/${op}`, inputs)
    if (typeof a !== "number") link(a, id, "a")
    if (typeof b !== "number") link(b, id, "b")
    return [id, "value"]
  }

  // Specular clamped the way the stage looks clamp it: a normal map under a low
  // roughness is exactly the noise-bumped highlight the clamp exists for.
  const shading: Record<string, SocketValue> = { spec_clamp: 10, specular_ior_level: m.specular, sheen_weight: 0 }
  const principled = node("principled", "principled", shading)

  // Albedo.
  const albedoAt = m.albedo.source && sampled(m.albedo.source)
  let base: Ref | null = null
  if (albedoAt != null) {
    base = [sample(albedoAt), "color"]
    if (m.albedo.tint.some((x) => x !== 1)) {
      const tint = node("tint", "mix/multiply", { fac: 1, b: m.albedo.tint })
      link(base, tint, "a")
      base = [tint, "color"]
    }
  }
  if (m.albedo.applyDiffuse) {
    const diffuse = node("diffuse", "material_diffuse")
    const mix = node("albedo", "mix/multiply", base ? { fac: 1 } : { fac: 1, a: m.albedo.tint })
    if (base) link(base, mix, "a")
    link([diffuse, "color"], mix, "b")
    base = [mix, "color"]
  }
  if (base) link(base, principled, "base_color")
  else shading.base_color = m.albedo.tint

  // Normal.
  const normalAt = m.normal && sampled(m.normal.source)
  if (m.normal && normalAt != null) {
    const nm = node("normal", "normal_map", { strength: m.normal.strength })
    link([sample(normalAt), "color"], nm, "color")
    link([nm, "normal"], principled, "normal")
  }

  // Roughness. Principled's roughness is the perceptual one, and ray-mmd's GGX
  // roughness is (1 - smoothness)², so the socket takes 1 - smoothness.
  const sm = m.smoothness
  const smoothAt = "source" in sm ? sampled(sm.source) : null
  if ("source" in sm && smoothAt != null) {
    const v = channelOf(smoothAt, sm.channel)
    let rough: Ref
    if (sm.scaleMode === 0 && sm.type === 2) rough = v
    else if (sm.scaleMode === 0 && sm.type === 1) rough = math("power", v, 0.5)
    else {
      let s: Ref = sm.type === 1 ? math("subtract", 1, math("power", v, 0.5)) : sm.type === 2 ? math("subtract", 1, v) : v
      if (sm.scaleMode === 1) s = math("multiply", s, sm.scale)
      if (sm.scaleMode === 2) s = math("power", s, sm.scale)
      rough = math("subtract", 1, s)
    }
    link(rough, principled, "roughness")
  } else {
    shading.roughness = Math.round((1 - Math.min(1, Math.max(0, "value" in sm ? sm.value : 0))) * 1e6) / 1e6
  }

  // Metalness.
  const mt = m.metalness
  const metalAt = "source" in mt ? sampled(mt.source) : null
  if ("source" in mt && metalAt != null) {
    let v = channelOf(metalAt, mt.channel)
    if (mt.scaleMode === 1) v = math("multiply", v, mt.scale)
    if (mt.scaleMode === 2) v = math("power", v, mt.scale)
    link(v, principled, "metallic")
  } else {
    shading.metallic = "value" in mt ? mt.value : 0
  }

  // Emission: ray-mmd lights the albedo through the mask.
  const em = m.emissive
  if (em && "source" in em) {
    const maskAt = sampled(em.source)
    if (maskAt != null) {
      const mask = channelOf(maskAt, em.channel)
      if (base) link(base, principled, "emission_color")
      else shading.emission_color = m.albedo.tint
      link(em.intensity === 1 ? mask : math("multiply", mask, em.intensity), principled, "emission_strength")
    }
  } else if (em) {
    shading.emission_color = em.color
    shading.emission_strength = em.intensity
  }

  return {
    version: 1,
    name: "ray-mmd",
    tags: ["stage", "ray-mmd"],
    nodes,
    links,
    output: { node: principled, socket: "color" },
  }
}

// ── Planning ──

export type PlannedGroup = {
  label: string
  materials: string[]
  look: { kind: "ray"; material: RayMaterial } | { kind: "library"; name: string }
}

/** ray-mmd's own presets, which ship with the renderer rather than the stage. */
function builtinLook(fx: string): string | null | undefined {
  const base = baseOf(normalize(fx)).toLowerCase()
  if (base.startsWith("material_glass")) return "Glass"
  if (base.startsWith("material_water")) return "Water"
  // The default material is what an unassigned material already is here.
  if (/^material(_2\.0)?\.fx$/.test(base)) return null
  return undefined
}

/**
 * Which look each material wears, grouped by preset.
 *
 * `presets` holds every .fx in the upload by normalized path. A preset path in
 * the .emd is relative to the .emd; an absolute one points into its author's
 * machine and is found by file name instead, when exactly one file has it.
 * A material name the .emd assigns two different presets keeps the first.
 */
export function planRayMmd(
  materialNames: string[],
  emd: Emd,
  emdPath: string,
  presets: Map<string, string>,
): { groups: PlannedGroup[]; hidden: string[]; warnings: string[] } {
  const warnings: string[] = []
  const byKey = new Map<string, PlannedGroup>()
  const claimed = new Map<string, string>()
  const parsed = new Map<string, RayMaterial | null>()
  const shown = new Map<string, boolean[]>()

  const resolve = (fx: string): string | undefined => {
    const direct = normalize(isAbsolute(fx) ? fx : dirOf(emdPath) + fx)
    if (presets.has(direct)) return direct
    const base = baseOf(normalize(fx)).toLowerCase()
    const matches = [...presets.keys()].filter((p) => baseOf(p).toLowerCase() === base)
    return matches.length === 1 ? matches[0] : undefined
  }

  materialNames.forEach((name, i) => {
    const entry = emd.objects.get(i)
    shown.set(name, [...(shown.get(name) ?? []), entry?.show ?? true])
    const fx = entry?.fx ?? emd.fallback
    if (!fx) return

    let key: string
    let look: PlannedGroup["look"]
    let label: string
    const builtin = builtinLook(fx)
    if (builtin === null) return
    if (builtin) {
      key = `look:${builtin}`
      look = { kind: "library", name: builtin }
      label = builtin
    } else {
      const path = resolve(fx)
      if (!path) {
        warnings.push(`${name}: ${baseOf(normalize(fx))} is not in the folder`)
        return
      }
      if (!parsed.has(path)) {
        const preset = parsePreset(presets.get(path)!)
        parsed.set(path, preset && readRayMaterial(preset, path, warnings))
        if (!preset) warnings.push(`${baseOf(path)} is not a ray-mmd material`)
      }
      const material = parsed.get(path)
      if (!material) return
      key = path
      look = { kind: "ray", material }
      label = stemOf(path)
    }

    const owner = claimed.get(name)
    if (owner !== undefined) {
      if (owner !== key) warnings.push(`${name}: also assigned ${label}, kept the first`)
      return
    }
    claimed.set(name, key)
    const group = byKey.get(key) ?? { label, materials: [], look }
    group.materials.push(name)
    byKey.set(key, group)
  })

  // A name is hidden only when every material carrying it is.
  const hidden = [...shown].filter(([, flags]) => flags.every((f) => !f)).map(([name]) => name)
  return { groups: [...byKey.values()], hidden, warnings }
}

// ── Upload ──

export type RayStage = {
  /** The upload as it should be kept: the .pmx, the textures it names, the
   *  generated maps and their sidecar. */
  files: File[]
  groups: StyleGroup[]
  hidden: string[]
  maps: Map<string, MaterialImages>
  warnings: string[]
}

/** Edge lengths the maps are stored at. The engine samples group maps without
 *  a mip chain, so a larger map buys shimmer as much as detail. */
const NORMAL_EDGE = 1024
const DATA_EDGE = 512
/** ray-mmd's EMISSIVE_EPSILON, and the same test for every mask: a channel that
 *  never reaches it carries no data. */
const BLANK = 2

type Prepared = { file: File; relPath: string; bitmap: ImageBitmap; max: number[] }

async function pool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await run(items[i])
      }
    }),
  )
  return out
}

async function pixelsOf(file: File): Promise<ImageData> {
  if (/\.tga$/i.test(file.name)) {
    const img = decodeTga(await file.arrayBuffer())
    return new ImageData(img.data, img.width, img.height)
  }
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** One map, downscaled to `edge` and encoded as PNG. Alpha is forced opaque
 *  unless a channel reads it, so the canvas's premultiplied storage cannot
 *  bend the colour channels underneath. */
async function prepare(source: File, edge: number, keepAlpha: boolean, outPath: string): Promise<Omit<Prepared, "relPath">> {
  const img = await pixelsOf(source)
  const px = img.data
  const max = [0, 0, 0, 0]
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > max[0]) max[0] = px[i]
    if (px[i + 1] > max[1]) max[1] = px[i + 1]
    if (px[i + 2] > max[2]) max[2] = px[i + 2]
    if (px[i + 3] > max[3]) max[3] = px[i + 3]
    if (!keepAlpha) px[i + 3] = 255
  }
  const scale = Math.min(1, edge / Math.max(img.width, img.height))
  const bitmap = await createImageBitmap(img, {
    resizeWidth: Math.max(1, Math.round(img.width * scale)),
    resizeHeight: Math.max(1, Math.round(img.height * scale)),
    resizeQuality: "high",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { file: new File([blob], outPath, { type: "image/png" }), bitmap, max }
}

/** The file an upload holds at `path`: exact, then ignoring case, then by name
 *  when only one file has it — the order the engine's texture lookup uses. */
function finder(files: File[]) {
  const exact = new Map<string, File>()
  const lower = new Map<string, File>()
  const byBase = new Map<string, File[]>()
  for (const f of files) {
    const p = normalize(relFilePath(f))
    exact.set(p, f)
    if (!lower.has(p.toLowerCase())) lower.set(p.toLowerCase(), f)
    const b = baseOf(p).toLowerCase()
    byBase.set(b, [...(byBase.get(b) ?? []), f])
  }
  return (path: string): File | undefined => {
    const p = normalize(path)
    return exact.get(p) ?? lower.get(p.toLowerCase()) ?? byBase.get(baseOf(p).toLowerCase())?.[0]
  }
}

/**
 * An upload's ray-mmd materials, ready to apply — or null when no .emd in it
 * describes this .pmx.
 */
export async function readRayMmd(
  files: File[],
  pmx: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RayStage | null> {
  const emdFiles = files.filter((f) => /\.emd$/i.test(f.name))
  const tableFiles = files.filter((f) => /\.txt$/i.test(f.name))
  if (emdFiles.length === 0 && tableFiles.length === 0) return null

  const mesh = parsePmxMesh(await pmx.arrayBuffer())
  const names = mesh.materials.map((m) => m.name)
  const stem = stemOf(normalize(relFilePath(pmx)))
  let best: { emd: Emd; path: string; fit: number } | null = null
  for (const f of emdFiles) {
    const emd = parseEmd(decodeText(await f.arrayBuffer()))
    const fit = emdFit(emd, names)
    if (fit > 0 && fit > (best?.fit ?? 0)) best = { emd, path: normalize(relFilePath(f)), fit }
  }
  // A table only where no .emd spoke for this model: the .emd is the format
  // MME itself writes, and a readme that happens to hold numbered lines is not
  // an assignment. Sections are scored against THIS .pmx, so a pack with one
  // table for five sub-stages gives each its own block.
  if (!best) {
    for (const f of tableFiles) {
      const path = normalize(relFilePath(f))
      for (const section of parseMaterialTable(decodeText(await f.arrayBuffer()))) {
        const fit = tableFit(section, names, stem)
        if (fit > 0 && fit > (best?.fit ?? 0)) best = { emd: { fallback: null, objects: section.objects }, path, fit }
      }
    }
  }
  if (!best) return null

  const presets = new Map<string, string>()
  for (const f of files) {
    if (/\.fx$/i.test(f.name)) presets.set(normalize(relFilePath(f)), decodeText(await f.arrayBuffer()))
  }
  const plan = planRayMmd(names, best.emd, best.path, presets)
  const warnings = [...plan.warnings]

  const pmxPath = normalize(relFilePath(pmx))
  const pmxDir = dirOf(pmxPath)
  const find = finder(files)
  const textureOf = new Map(
    mesh.materials.map((m) => [m.name, m.textureIndex >= 0 ? normalize(mesh.texturePaths[m.textureIndex] ?? "") : ""]),
  )

  // Every map any preset reads, with the most demanding use deciding its size.
  type Need = { edge: number; keepAlpha: boolean; srgb: boolean }
  const needs = new Map<string, Need>()
  const want = (path: string, edge: number, alpha: boolean, srgb: boolean) => {
    const prev = needs.get(path)
    needs.set(path, {
      edge: Math.max(edge, prev?.edge ?? 0),
      keepAlpha: alpha || (prev?.keepAlpha ?? false),
      srgb: srgb || (prev?.srgb ?? false),
    })
  }
  // A preset's albedo file IS the PMX texture when their names agree, which is
  // how these presets are generated; sampling the texture saves a copy.
  const isPmxTexture = (path: string, materials: string[]) =>
    materials.some((name) => stemOf(textureOf.get(name) ?? "").toLowerCase() === stemOf(path).toLowerCase())
  for (const g of plan.groups) {
    if (g.look.kind !== "ray") continue
    const m = g.look.material
    const file = (s: Source | null | undefined) => (s?.kind === "file" ? s.path : null)
    const albedo = file(m.albedo.source)
    if (albedo && !isPmxTexture(albedo, g.materials)) want(albedo, NORMAL_EDGE, false, true)
    const normal = file(m.normal?.source)
    if (normal) want(normal, NORMAL_EDGE, false, false)
    if ("source" in m.smoothness) {
      const p = file(m.smoothness.source)
      if (p) want(p, DATA_EDGE, m.smoothness.channel === 3, false)
    }
    if ("source" in m.metalness) {
      const p = file(m.metalness.source)
      if (p) want(p, DATA_EDGE, m.metalness.channel === 3, false)
    }
    if (m.emissive && "source" in m.emissive) {
      const p = file(m.emissive.source)
      if (p) want(p, DATA_EDGE, m.emissive.channel === 3, false)
    }
  }

  const taken = new Set<string>()
  const outPathFor = (path: string) => {
    let rel = `rzmaps/${stemOf(path)}.png`
    for (let n = 2; taken.has(rel.toLowerCase()); n++) rel = `rzmaps/${stemOf(path)}-${n}.png`
    taken.add(rel.toLowerCase())
    return rel
  }
  const jobs = [...needs].flatMap(([path, need]) => {
    const source = find(path)
    if (!source) {
      warnings.push(`${baseOf(path)} is not in the folder`)
      return []
    }
    return [{ path, need, source, relPath: outPathFor(path) }]
  })
  let done = 0
  onProgress?.(0, jobs.length)
  const prepared = new Map<string, Prepared>()
  await pool(jobs, 4, async (job) => {
    try {
      const out = await prepare(job.source, job.need.edge, job.need.keepAlpha, pmxDir + job.relPath)
      prepared.set(job.path, { ...out, relPath: job.relPath })
    } catch (e) {
      warnings.push(`${baseOf(job.path)}: ${e instanceof Error ? e.message : String(e)}`)
    }
    onProgress?.(++done, jobs.length)
  })

  // Graphs, one per preset, each with the slots its maps landed in.
  const groups: StyleGroup[] = []
  const maps = new Map<string, MaterialImages>()
  const sidecar: MaterialMapsDoc = { version: 1, materials: {} }
  const used = new Set<string>()
  const ids = new Set<string>()
  for (const g of plan.groups) {
    const base = `ray-${g.label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)

    if (g.look.kind === "library") {
      const graph = libraryGraph(g.look.name)
      if (graph) groups.push({ id, label: g.label, materials: g.materials, graph: structuredClone(graph), renderClass: "auto" })
      continue
    }

    const m = g.look.material
    // A channel that is 0 everywhere is a map nobody painted. Read literally it
    // is roughness 0 — a mirror of a rock — so the preset's constant stands in;
    // an emissive mask that never clears the threshold emits nothing.
    const blank = (s: Source, ch: Channel) => s.kind === "file" && (prepared.get(s.path)?.max[ch] ?? BLANK) < BLANK
    if ("source" in m.smoothness && blank(m.smoothness.source, m.smoothness.channel))
      m.smoothness = { value: m.smoothness.fallback }
    if ("source" in m.metalness && blank(m.metalness.source, m.metalness.channel))
      m.metalness = { value: m.metalness.fallback }
    if (m.emissive && "source" in m.emissive && blank(m.emissive.source, m.emissive.channel)) m.emissive = null
    const slots: string[] = []
    const sampled = (s: Source): Sampled | null => {
      if (s.kind === "pmx") return "pmx"
      // The albedo falls back to the PMX texture, which is what it usually is.
      if (s === m.albedo.source && (isPmxTexture(s.path, g.materials) || !prepared.has(s.path))) return "pmx"
      if (!prepared.has(s.path)) return null
      const at = slots.indexOf(s.path)
      if (at >= 0) return at
      if (slots.length === 4) {
        warnings.push(`${g.label}: more than four maps, ${baseOf(s.path)} dropped`)
        return null
      }
      slots.push(s.path)
      return slots.length - 1
    }
    const graph = rayGraph(m, sampled)
    groups.push({ id, label: g.label, materials: g.materials, graph, renderClass: "auto" })
    if (slots.length === 0) continue
    for (const p of slots) used.add(p)

    const images: MaterialImages = slots.map((p) => ({ source: prepared.get(p)!.bitmap, srgb: needs.get(p)!.srgb }))
    const refs = slots.map((p) => ({ path: prepared.get(p)!.relPath, srgb: needs.get(p)!.srgb }))
    for (const name of g.materials) {
      maps.set(name, images)
      sidecar.materials[name] = refs
    }
  }

  // Keep what the model reads: the .pmx, its textures, and what was made here.
  const kept = new Set<File>([pmx])
  for (const tex of mesh.texturePaths) {
    const f = tex && find(pmxDir + tex)
    if (f) kept.add(f)
  }
  const generated: File[] = []
  for (const [path, p] of prepared) {
    if (used.has(path)) generated.push(p.file)
    else p.bitmap.close()
  }
  const sidecarFile = new File([JSON.stringify(sidecar)], sidecarPath(pmxPath), { type: "application/json" })

  return {
    files: [...kept, ...generated, sidecarFile],
    groups,
    hidden: plan.hidden,
    maps,
    warnings,
  }
}
