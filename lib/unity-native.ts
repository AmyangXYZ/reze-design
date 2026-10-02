// The game's own materials, out of a scene bundle.
//
// ag-rip writes two kinds of them beside a scene: a STAGE PACKAGE (a folder
// with stage.json, its meshes, its textures and its translated shaders), which
// the engine draws as the game draws it, and a LOOK (a look.json beside a
// prop's .pmx), which dresses that model's materials in the game's shaders.
// Both are read here out of the bundle's files by path; the engine does the
// rest. Nothing is tuned on the way: what the files say is what draws.

import type { Engine, NativeLook, NativeMaterialSpec, NativeShaderInfo, NativeStagePackage, NativeStageReader, NativeTexture } from "reze-engine"
import { clearUniformTracks, setUniformTracks, type MaterialUniformTracks, type UniformKey } from "@/lib/timeline/uniforms"

/** A look.json as ag-rip writes it. Its materials carry a few keys of their
 *  own (`game`, `shader`, `defaults`) for whoever reads the file; the engine
 *  reads none of them. `uniforms` are the values the game animates over the
 *  take: per name, sparse [clip frame, value] keys, which the timeline samples
 *  (lib/timeline/uniforms.ts) over the static `values`. */
export type NativeLookFile = {
  shaders: string[]
  /** wrap / filter: Unity's import settings (Repeat, Clamp...; Point, Bilinear...). */
  textures: Record<string, { file: string; srgb: boolean; wrap?: string; filter?: string }>
  materials: (NativeMaterialSpec & { uniforms?: Record<string, UniformKey[]> } & Record<string, unknown>)[]
  /** Game vertex stream semantic -> the PMX additional UV channel holding it. */
  streams?: Record<string, number>
}

/** A look ready to dress a model: the engine's part, and the keyed material
 *  values the timeline plays on it. */
export type LoadedLook = { look: NativeLook; uniforms: MaterialUniformTracks }

/**
 * A look's keyed values per model material: each spec's `uniforms` under
 * every material name it dresses. Pure. A keyless name is dropped, and a
 * look with nothing keyed gives {} — nothing for the timeline to visit.
 */
export function lookUniformTracks(look: Pick<NativeLookFile, "materials">): MaterialUniformTracks {
  const out: MaterialUniformTracks = {}
  for (const m of look.materials) {
    const keyed = Object.entries(m.uniforms ?? {}).filter(([, keys]) => Array.isArray(keys) && keys.length > 0)
    if (!keyed.length) continue
    for (const name of m.materials) out[name] = Object.fromEntries(keyed)
  }
  return out
}

/** Reads one bundle file's bytes by its bundle path, or null when it is not there. */
export type BundleRead = (path: string) => Promise<ArrayBuffer | null>

/** A reader over bundle files, whose names ARE their bundle paths. */
export function bundleReader(files: readonly { name: string; arrayBuffer(): Promise<ArrayBuffer> }[]): BundleRead {
  const byPath = new Map(files.map((f) => [f.name, f]))
  return async (path) => (await byPath.get(path)?.arrayBuffer()) ?? null
}

/** The folder a path sits in, slash included — "" for a path at the root. */
export const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1)

/** A stage folder as the document names it, always ending in a slash, so a
 *  prefix match cannot reach a sibling called "stage2/". */
export const stageFolder = (folder: string) => (folder.endsWith("/") ? folder : `${folder}/`)

/**
 * Every file a look names, as bundle paths.
 *
 * The look's own paths are relative to the look.json, because the converter
 * writes the folder before it knows where the scene will put it. Pure, so the
 * one rule that can go quietly wrong — a texture resolved against the bundle
 * root instead of the look's folder decodes nothing and draws white — is
 * testable without a decoder.
 */
export function lookFilePaths(lookPath: string, look: NativeLookFile) {
  const dir = dirOf(lookPath)
  return {
    shaders: look.shaders.map((name) => ({
      name,
      vert: `${dir}shaders/${name}.vert.wgsl`,
      frag: `${dir}shaders/${name}.frag.wgsl`,
      info: `${dir}shaders/${name}.json`,
    })),
    textures: Object.entries(look.textures).map(([key, t]) => ({
      key,
      path: dir + t.file.replace(/\\/g, "/").replace(/^\.\//, ""),
      srgb: t.srgb,
      ...(t.wrap ? { wrap: t.wrap } : {}),
      ...(t.filter ? { filter: t.filter } : {}),
    })),
  }
}

/**
 * A PNG or WebP as the engine wants a native texture: RGBA8, rows top first,
 * exactly the bytes in the file. No colour conversion and no premultiply —
 * the game's shaders decide what a texel means, and a browser that "helped"
 * would hand them different numbers than the game's.
 */
async function decodeTexture(bytes: ArrayBuffer, srgb: boolean): Promise<NativeTexture> {
  const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" })
  const { width, height } = bmp
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("no 2d context to decode a look's texture")
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const { data } = ctx.getImageData(0, 0, width, height)
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), srgb }
}

/** Read a look.json and everything it names into the engine's NativeLook, with
 *  its keyed values for the timeline. */
export async function loadNativeLook(lookPath: string, read: BundleRead): Promise<LoadedLook> {
  const need = async (path: string) => {
    const bytes = await read(path)
    if (!bytes) throw new Error(`missing ${path}`)
    return bytes
  }
  const text = async (path: string) => new TextDecoder().decode(await need(path))
  const file = JSON.parse(await text(lookPath)) as NativeLookFile
  const paths = lookFilePaths(lookPath, file)
  const [shaders, textures] = await Promise.all([
    Promise.all(
      paths.shaders.map(async (s) => ({
        name: s.name,
        vert: await text(s.vert),
        frag: await text(s.frag),
        info: JSON.parse(await text(s.info)) as NativeShaderInfo,
      })),
    ),
    Promise.all(
      paths.textures.map(
        async (t) =>
          [
            t.key,
            {
              ...(await decodeTexture(await need(t.path), t.srgb)),
              // how the game samples it: a clamped mask read past its edge is its border
              ...(t.wrap ? { wrap: t.wrap } : {}),
              ...(t.filter ? { filter: t.filter } : {}),
            },
          ] as const,
      ),
    ),
  ])
  const look: NativeLook = {
    shaders,
    textures: Object.fromEntries(textures),
    // Only the keys the engine reads: the rest is the converter's notes.
    materials: file.materials.map((m) => ({
      materials: m.materials,
      queue: m.queue,
      passes: m.passes,
      values: m.values,
      textures: m.textures,
    })),
    // the game vertex streams the PMX carries in its additional UVs (vertex
    // colour, keyed over a particle's life by its UV morphs)
    ...(file.streams ? { streams: file.streams } : {}),
  }
  return { look, uniforms: lookUniformTracks(file) }
}

/**
 * Which models wear a look, per engine.
 *
 * The engine's removeModel frees a model's buffers and does NOT take its look
 * off, and the look draws out of those buffers — so a removed prop would leave
 * the next frame submitting destroyed ones. Every removal goes through
 * `undress` first; the set is what lets it skip the models that never wore one.
 */
const dressed = new WeakMap<Engine, Set<string>>()

export function dress(engine: Engine, modelId: string, { look, uniforms }: LoadedLook): boolean {
  const ok = engine.setModelNativeLook(modelId, look)
  if (ok) {
    if (!dressed.has(engine)) dressed.set(engine, new Set())
    dressed.get(engine)!.add(modelId)
    // the values the game animates on its materials, on the timeline's clock
    setUniformTracks(engine, modelId, uniforms)
  }
  return ok
}

export function undress(engine: Engine, modelId: string): void {
  if (!dressed.get(engine)?.delete(modelId)) return
  setUniformTracks(engine, modelId, null)
  engine.setModelNativeLook(modelId, null)
}

/**
 * Empty the engine of everything a scene put in it — every model, every look,
 * the game stage — by asking the ENGINE what it holds rather than trusting any
 * list a host keeps.
 *
 * That difference is the whole point. A host's lists are what its loads
 * REPORTED, and a load superseded mid-flight adds its model and then bails
 * before reporting it: an orphan that no list names, so a swap that removed
 * "the models in state" left it drawing — unstyled, since it bailed before its
 * looks — under every scene after, and a second swap missed it the same way.
 * It also kept its id, so the next load of that id was minted `id_1`.
 *
 * Looks before models, for the reason `undress` exists. Planes are models to
 * the engine and go too; their decoders are the host's to close.
 */
export function clearEngineScene(engine: Engine): Promise<void> {
  for (const id of dressed.get(engine) ?? []) engine.setModelNativeLook(id, null)
  dressed.delete(engine)
  clearUniformTracks(engine)
  for (const name of engine.getModelNames()) engine.removeModel(name)
  return setNativeStageInTurn(engine, null)
}

/**
 * One stage install at a time, per engine.
 *
 * `setNativeStage` keeps whichever load finishes LAST, so two in flight — a
 * scene's stage still loading when the next scene's clear arrives — could put
 * the outgoing scene's stage back after the incoming one cleared it. Queued,
 * every call sees the one before it finished, and a load that has gone stale
 * by the time it lands takes itself down before the next call runs.
 */
const turns = new WeakMap<Engine, Promise<unknown>>()

export function setNativeStageInTurn(
  engine: Engine,
  pkg: NativeStagePackage | null,
  read?: NativeStageReader,
  stale: () => boolean = () => false,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const run = (turns.get(engine) ?? Promise.resolve()).then(async () => {
    if (pkg && stale()) return
    await engine.setNativeStage(pkg, read, onProgress)
    if (pkg && stale()) await engine.setNativeStage(null)
  })
  turns.set(
    engine,
    run.catch(() => {}),
  )
  return run
}

/**
 * Put a bundle's stage package up. Returns its name, or null when the package
 * is not in the bundle (evicted, or never packed).
 *
 * A package that is there but fails to draw still answers with its name: the
 * document keeps naming it and the panel keeps its row, so a shader that did
 * not compile costs the picture rather than the user's scene.
 */
export async function loadNativeStage(
  engine: Engine,
  folder: string,
  read: BundleRead,
  stale: () => boolean,
  /** How far its pictures, meshes and shaders have got, by the engine's weights. */
  onProgress?: (name: string, done: number, total: number) => void,
): Promise<string | null> {
  const dir = stageFolder(folder)
  const json = await read(`${dir}stage.json`)
  if (!json) {
    console.warn(`[native stage] no ${dir}stage.json in the scene's bundle`)
    return null
  }
  const pkg = JSON.parse(new TextDecoder().decode(json)) as NativeStagePackage
  const reader: NativeStageReader = async (path) => {
    const bytes = await read(dir + path)
    if (!bytes) throw new Error(`missing ${dir}${path}`)
    return bytes
  }
  try {
    await setNativeStageInTurn(engine, pkg, reader, stale, onProgress && ((done, total) => onProgress(pkg.name, done, total)))
    const report = engine.nativeReport()
    if (report.errors.length) console.warn(`[native stage] ${pkg.name}: ${report.errors.length} shader error(s)`, report.errors)
  } catch (e) {
    console.error(`[native stage] ${pkg.name} did not load:`, e)
  }
  return pkg.name
}
