// The pictures a generated effect samples (`#textures`), by the effect's source.
//
// A stage converted from the game carries its particle systems as effects the
// app generates (lib/unity-particles.ts), and each draws the game's own
// pictures. Those cannot ride in the scene document — they are images, the
// document is text — so they live beside the stage, under `particles/`, and
// are decoded into this registry every time the stage loads, upload or
// restore alike. The install (use-scene-sync) looks its effect's pictures up
// here by the effect's source, which is what makes a saved scene draw them
// again after a reload: the source comes back from the document, the pictures
// from the stage's own files.

type EffectTexture = { source: ImageBitmap; srgb: boolean } | null

const byWgsl = new Map<string, EffectTexture[]>()

/** The pictures registered for an effect's source, in slot order, if any. */
export function effectTexturesFor(wgsl: string): EffectTexture[] | undefined {
  return byWgsl.get(wgsl)
}

/**
 * Decode the particle pictures a stage names in its `<Name>.lights.json` and
 * register them under each effect's source. Returns how many effects got
 * pictures. `pathOf` gives a file's path relative to the stage folder the way
 * the loader sees it; `pmxPath` is the stage's PMX in the same form.
 */
export async function loadParticleTextures(files: File[], pmxPath: string, pathOf: (f: File) => string): Promise<number> {
  const stem = pmxPath.replace(/\.pmx$/i, "")
  const dir = pmxPath.slice(0, pmxPath.lastIndexOf("/") + 1)
  const rigFile = files.find((f) => pathOf(f) === `${stem}.lights.json`)
  if (!rigFile) return 0
  let rig: { particles?: { wgsl?: unknown; textures?: unknown[] }[] }
  try {
    rig = JSON.parse(await rigFile.text())
  } catch {
    return 0
  }
  // by path WITHOUT its extension: the upload re-encodes a large picture as
  // WebP, which renames it, and the rig still names the PNG it was written as
  const bare = (p: string) => p.replace(/\.(png|webp|jpe?g)$/i, "")
  const byPath = new Map(files.map((f) => [bare(pathOf(f)), f]))
  let n = 0
  for (const p of rig.particles ?? []) {
    if (typeof p?.wgsl !== "string" || !Array.isArray(p.textures)) continue
    const textures = await Promise.all(
      p.textures.map(async (t): Promise<EffectTexture> => {
        const entry = t as { path?: unknown; srgb?: unknown } | null
        const file = entry && typeof entry.path === "string" ? byPath.get(bare(dir + entry.path)) : undefined
        if (!file) return null
        try {
          return { source: await createImageBitmap(file), srgb: entry!.srgb !== false }
        } catch {
          return null
        }
      }),
    )
    byWgsl.set(p.wgsl, textures)
    n++
  }
  return n
}
