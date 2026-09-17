// Extra image maps that belong to a model's materials — normal, mask, emissive.
//
// A PMX material carries one texture. Stages converted from ray-mmd carry more,
// and those maps are ASSET data in the same sense the PMX texture is: they go
// where the model goes. So they live in the model's own files — PNGs plus a
// sidecar beside the .pmx naming them per material — and the bundle, publish
// and reload carry them with no help from the scene document.
//
// The engine takes maps per style group (`tex_image/0..3`). A group is handed
// the maps of the first material in it that has any, at the moment it goes to
// the engine; app state never holds the decoded images, so documents stay plain
// data.

import type { GroupImage, StyleGroup } from "reze-engine"

/** One slot of a material's maps, as the sidecar stores it. `path` is relative
 *  to the .pmx's folder. */
export type MaterialMapRef = { path: string; srgb: boolean } | null

export type MaterialMapsDoc = {
  version: 1
  materials: Record<string, MaterialMapRef[]>
}

export type MaterialImages = (GroupImage | null)[]

const live = new Map<string, Map<string, MaterialImages>>()

/** The sidecar that sits beside a model: `stage.pmx` → `stage.maps.json`. */
export const sidecarPath = (pmxPath: string) => pmxPath.replace(/\.pmx$/i, "") + ".maps.json"

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
    const images = g.materials.map((m) => maps.get(m)).find((x) => x !== undefined)
    return images ? { ...g, images } : g
  })
}

/**
 * Read a model's sidecar out of its files and decode the maps it names.
 *
 * `files` are named by path (a bundle) or carry webkitRelativePath (an upload);
 * `pmxPath` is the .pmx's path in the same form. A model without a sidecar
 * clears whatever an earlier model under this id left behind.
 */
export async function loadMaterialMaps(modelId: string, files: File[], pmxPath: string, pathOf: (f: File) => string) {
  const byPath = new Map(files.map((f) => [pathOf(f), f]))
  const sidecar = byPath.get(sidecarPath(pmxPath))
  if (!sidecar) {
    clearMaterialMaps(modelId)
    return
  }
  let doc: MaterialMapsDoc
  try {
    doc = JSON.parse(await sidecar.text()) as MaterialMapsDoc
  } catch (e) {
    console.warn(`Unreadable material maps for ${pmxPath}:`, e)
    clearMaterialMaps(modelId)
    return
  }
  const dir = pmxPath.slice(0, pmxPath.lastIndexOf("/") + 1)
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
    Object.entries(doc.materials).map(async ([name, refs]) => {
      const images = await Promise.all(
        refs.map(async (ref) => {
          if (!ref) return null
          const source = await decode(ref.path)
          return source ? { source, srgb: ref.srgb } : null
        }),
      )
      byMaterial.set(name, images)
    }),
  )
  setMaterialMaps(modelId, byMaterial)
}
