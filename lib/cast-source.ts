// Resolving a model in the scene to castColour's inputs.
//
// Lib-level, not page-level: nothing in here is view — it is "where do this
// model's bytes live", answered from the same two places the rest of the app
// answers it. An uploaded model's Files are still in memory (lib/scene-files);
// a served model lives under its folder URL. The shipped editor grows the same
// swatch later by importing this, not by porting seventy lines of plumbing.

import type { Scene } from "@/lib/scene"
import type { StyleGroup } from "reze-engine"
import { assetUrl, modelPmxUrl } from "@/lib/scene"
import { sceneFiles, relFilePath } from "@/lib/scene-files"
import type { CastColourSource } from "@/lib/model-colour"

/** Case-insensitive path comparison — texture references and filenames rarely
 *  agree on case across authoring tools. Slashes are already normalized on both
 *  sides (pmx-mesh for texture paths, relFilePath for Files). */
const fold = (p: string) => p.toLowerCase()

export function castSourceFor(
  id: string,
  scene: Scene,
  groups: StyleGroup[] | undefined,
  /** The scene's unzipped asset bundle, when there is one. A model you uploaded
   *  keeps its Files only for THIS session; after a refresh the same bytes are
   *  in here, and without them the swatch fell back to neutral on every reload
   *  — the colour appeared to be a property of having just uploaded. */
  bundle?: File[],
): CastColourSource | null {
  // The render class, not the group id: ids are label slugs ("long-hair"), the
  // render class is the role the engine actually assigned. ROLE_WEIGHT in
  // model-colour speaks role vocabulary.
  const role = new Map<string, string>()
  for (const g of groups ?? []) for (const name of g.materials) role.set(name, g.renderClass ?? g.id)
  const roleOf = (material: string) => role.get(material)

  const kept = sceneFiles.models.get(id)
  if (kept) {
    return {
      pmx: kept.pmx,
      // Match on the path tail: two textures can share a basename in different
      // subfolders, and relFilePath carries the folder the user picked.
      resolveTexture: (path) => {
        const want = fold(path)
        const base = want.split("/").pop()
        return (
          kept.files.find((f) => {
            const rel = fold(relFilePath(f))
            return rel.endsWith(want) || fold(f.name) === base
          }) ?? null
        )
      },
      roleOf,
    }
  }

  const model = scene.assets.models.find((m) => m.model.id === id)?.model
  if (!model) return null

  // Out of the bundle: File.name carries the bundle-relative PATH (lib/uploads),
  // which is what the engine resolves textures against too. Scoped to this
  // model's own folder, because two models in one bundle can share a texture
  // basename and a bare-name match would hand one of them the other's colour.
  if (model.source.kind === "bundle" && bundle?.length) {
    const path = model.source.path
    const pmxFile = bundle.find((f) => fold(f.name) === fold(path))
    if (!pmxFile) return null
    const dir = fold(path).slice(0, fold(path).lastIndexOf("/") + 1)
    return {
      pmx: pmxFile,
      resolveTexture: (texture) => {
        const want = fold(texture)
        const base = want.split("/").pop()
        const inDir = bundle.filter((f) => fold(f.name).startsWith(dir))
        return inDir.find((f) => fold(f.name).endsWith(want) || fold(f.name).split("/").pop() === base) ?? null
      },
      roleOf,
    }
  }

  const pmx = modelPmxUrl(model)
  if (!pmx || model.source.kind !== "folder") return null
  const dir = model.source.dir
  return { pmx, resolveTexture: (path) => assetUrl(dir, path), roleOf }
}
