// Extra image maps that belong to a model's materials — normal, mask, emissive.
//
// A PMX material carries one texture. Stages carry more, and those maps are
// ASSET data in the same sense the PMX texture is: they go where the model goes,
// so they live in the model's own files and the bundle, publish and reload carry
// them with no help from the scene document.
//
// A folder says which map belongs to which material by NAMING — `<T>_D.png`
// beside `<T>_N.png`, the set's own convention, readable by anyone who opens the
// folder and needing nothing kept in step with it.
//
// The engine takes maps per style group (`tex_image/0..3`). A group is handed
// the maps of the first material in it that has any, at the moment it goes to
// the engine; app state never holds the decoded images, so documents stay plain
// data.

import type { GroupImage, Model, StyleGroup } from "reze-engine"

export type MaterialImages = (GroupImage | null)[]

const live = new Map<string, Map<string, MaterialImages>>()

export function setMaterialMaps(modelId: string, byMaterial: Map<string, MaterialImages>) {
  live.set(modelId, byMaterial)
}

export function clearMaterialMaps(modelId: string) {
  live.delete(modelId)
}

const readsMaps = (g: StyleGroup) => g.graph.nodes.some((n) => n.type.startsWith("tex_image/"))

/** `groups` as the engine should receive them: each group whose graph samples
 *  group images gets its materials' maps, unless it already carries its own. */
export function withMaterialMaps(modelId: string, groups: StyleGroup[]): StyleGroup[] {
  const maps = live.get(modelId)
  if (!maps) return groups
  return groups.map((g) => {
    if (g.images?.length || !readsMaps(g)) return g
    // PER MATERIAL, not per group. A look that carries its own ramp sets
    // `images` itself and is left alone above; everything reaching here is a
    // group whose members each brought maps, and a converted stage puts
    // twenty-seven props with twenty-seven different normal maps in ONE group
    // on purpose — a group each is a pipeline each. The engine binds these per
    // draw call, so they share the pipeline and differ only in what the bind
    // group points at.
    const byMaterial = Object.fromEntries(
      g.materials.flatMap((m) => {
        const images = maps.get(m)
        return images ? [[m, images] as const] : []
      }),
    )
    if (!Object.keys(byMaterial).length) return g
    // NO SUBSTITUTE FOR A MISSING MAP. This used to hand the first material's
    // maps to every member that brought none, on the reasoning that a plausible
    // map beats white. It is not plausible — it is another surface's grain on
    // this one, which is a stool wearing the floor's wood. A material that
    // shipped no map says so in its own relief strength, which the converter
    // writes as zero, and zero returns the geometric normal exactly.
    return { ...g, imagesByMaterial: byMaterial }
  })
}

/** One slot of a material's maps. `path` is relative to the .pmx's folder. */
type MapRef = { path: string; srgb: boolean } | null

/** A name a file system and a zip both take, applied identically by whatever
 *  writes the maps — see `namedMaps`. */
const fileSafe = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, "_")

/**
 * The maps a model states by NAMING.
 *
 * A game's own texture set already says this: the albedo is `<T>_D.png` and its
 * normal is `<T>_N.png`, and a converter that keeps those names has recorded the
 * pairing in the folder where a person can see it. So the rule is:
 *
 *   a material's relief map is `maps/<base>_N.png`, where `<base>` is its
 *   albedo's file name without the extension and without a trailing `_D` — or
 *   the material's own name, for a material that samples no albedo.
 *
 * ONE SLOT, LINEAR — the whole of what a name can carry, and all a stage needs.
 * A ray-mmd import wants more than that (four slots in the order its graph
 * samples them, each with its own colour space), so it hands its maps straight
 * to the engine on the group's own `images` and they last as long as the
 * session: re-import the folder after a reload.
 */
function namedMaps(model: Model, byPath: Map<string, File>, dir: string): Record<string, MapRef[]> {
  const textures = model.getTextures()
  const out: Record<string, MapRef[]> = {}
  // A glTF stage names its maps for the MATERIAL, three of them: `_N` the
  // normal, `_ORM` occlusion-roughness-metal in glTF's channel order, `_E` the
  // emissive picture — the slots the Stage PBR look samples, in that order.
  // Every material of such a stage has all three; a map it did not bring is a
  // 1x1 stand-in written at upload (gltf-stage.ts).
  const first = (stem: string, suffix: string): MapRef => {
    for (const ext of ["png", "webp", "jpg"]) {
      const rel = `maps/${stem}_${suffix}.${ext}`
      if (byPath.has(dir + rel)) return { path: rel, srgb: suffix === "E" }
    }
    return null
  }
  for (const m of model.getMaterials()) {
    const own = fileSafe(m.name)
    const orm = first(own, "ORM")
    if (orm) {
      out[m.name] = [first(own, "N"), orm, first(own, "E")]
      continue
    }
    const albedo = textures[m.diffuseTextureIndex]?.path
    const base = albedo
      ? (albedo.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").replace(/_D$/, "")
      : fileSafe(m.name)
    if (!base) continue
    const rel = `maps/${base}_N.png`
    if (byPath.has(dir + rel)) out[m.name] = [{ path: rel, srgb: false }]
  }
  return out
}

/**
 * Read a model's maps out of its files and decode them.
 *
 * `files` are named by path (a bundle) or carry webkitRelativePath (an upload);
 * `pmxPath` is the .pmx's path in the same form. Which map belongs to which
 * material is read off the folder by `namedMaps`, so the loaded model is needed
 * too — it is what says which albedo each material samples. A model whose folder
 * names none clears whatever an earlier model under this id left behind.
 */
export async function loadMaterialMaps(
  modelId: string,
  files: File[],
  pmxPath: string,
  pathOf: (f: File) => string,
  model?: Model | null,
) {
  const byPath = new Map(files.map((f) => [pathOf(f), f]))
  const dir = pmxPath.slice(0, pmxPath.lastIndexOf("/") + 1)
  const materials = model ? namedMaps(model, byPath, dir) : {}
  const count = model ? model.getMaterials().length : 0
  if (!Object.keys(materials).length) {
    clearMaterialMaps(modelId)
    return { materials: count, named: 0, decoded: 0, missing: [] }
  }
  const decoded = new Map<string, Promise<ImageBitmap | null>>()
  const decode = (path: string) => {
    let pending = decoded.get(path)
    if (!pending) {
      const file = byPath.get(dir + path)
      pending = file
        ? createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).catch(() => null)
        : Promise.resolve(null)
      decoded.set(path, pending)
    }
    return pending
  }
  const byMaterial = new Map<string, MaterialImages>()
  await Promise.all(
    Object.entries(materials).map(async ([name, refs]) => {
      const images = await Promise.all(
        refs.map(async (ref) => {
          if (!ref) return null
          const source = await decode(ref.path)
          // A relief map is tiled across its surface, so it gets mips: without
          // them X309's far sea sampled its ripples as noise and sparkled.
          return source ? { source, srgb: ref.srgb, mipmaps: true } : null
        }),
      )
      byMaterial.set(name, images)
    }),
  )
  setMaterialMaps(modelId, byMaterial)
  // What actually bound. An unbound slot is not an absence — it is the 1x1
  // WHITE stand-in, and white in an ORM map reads as roughness 1 and metal 1:
  // a fully rough metal, which has no diffuse of its own and no highlight to
  // find. The surface keeps its texture and its lamps and loses every trace of
  // the camera, which is indistinguishable from a bad shader unless something
  // says out loud whether the map arrived.
  const missing: string[] = []
  let bound = 0
  for (const [name, images] of byMaterial) {
    if (images[1]) bound++
    else missing.push(name)
  }
  return { materials: count, named: Object.keys(materials).length, decoded: bound, missing }
}
