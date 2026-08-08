// Which colour is most of this character actually wearing?
//
// Ten rounds of tuning failed on this before the inputs were audited, and the
// inputs turned out to be the whole problem. Two corruptions, both measured on
// real models (see the batch table in todo-cast-swatch-colour):
//
//   - vertexCount measures mesh DETAIL, not size. A decorated trim on one test
//     model carried 19× its true surface in votes; a plain skirt carried 1/9th.
//     Faces and frills are the densest geometry on an MMD model, which is why
//     every weighting built on vertex counts kept electing skin and accents.
//   - texture pixels measure SHEET LAYOUT, not worn area. A dress can be most
//     of the character and a corner of its sheet, and unused sheet space voted.
//
// So this module weights every texel by the 3D surface area mapped onto it:
// parse the PMX (positions, UVs, per-material ranges — lib/pmx-mesh), splat
// each triangle's bind-pose area into a UV-space grid per material, and let
// texels vote with the area that actually wears them. Both corruptions vanish
// without a tunable in sight.
//
// The decision layer is then just as blunt: area buckets into the palette's own
// hue families, chroma < 0.35 counting as COLOURLESS, and the top family wins
// unless colourless out-masses it 4× — in which case the answer is one of the
// two neutrals, picked by which side of mid-lightness holds more of the
// colourless mass. The 4× is not tuned: across fourteen real models the ratio
// was bimodal, ≤1.9 for every genuinely colourful character and ≥5.3 for every
// white/black/silver one, with nothing in between. It sits in the measured gap.
//
// The verdict is a CastPaletteId, not a hue. Voting already happens on the
// palette's own family boundaries, so returning an angle for the caller to
// re-quantize would only re-derive (at best) the decision made here.
//
// Chroma is HSV saturation, (max−min)/max, NOT HSL's: HSL divides by a term
// that collapses near white, so a faint cool cast on white fabric reads as
// confidently saturated. Chroma calls it what it looks like — this is the one
// survivor of the tuning era, and it is what keeps skin (≈0.27) colourless
// without ever naming skin.

import { parsePmxMesh, type PmxMesh } from "@/lib/pmx-mesh"
import { CAST_PALETTES, type CastPalette, type CastPaletteId } from "@/lib/cast-palette"

/** Everything the extraction needs to know about one model. */
export type CastColourSource = {
  /** The .pmx itself — a kept upload or a served URL. */
  pmx: File | string
  /** Resolve a texture path from the PMX table to something fetchable. */
  resolveTexture: (path: string) => File | string | null
  /** A material's render class ("hair", "eye", …), from the engine's grouping.
   *  The weights those roles carry live HERE, beside their rationale. */
  roleOf?: (materialName: string) => string | undefined
}

/**
 * How loudly each kind of material votes.
 *
 * Hair at a fraction: silver, white and black hair are so common that
 * full-weight hair mostly adds noise, while a genuinely teal- or pink-haired
 * character still gets counted. Eyes are zeroed on principle, not necessity —
 * with honest area weighting they measure ~0.1% anyway. Skin needs NO entry:
 * it sits under the chroma floor on its own, which is what keeps red and pink
 * costumes safe from any skin heuristic.
 */
const ROLE_WEIGHT: Record<string, number> = { hair: 0.3, eye: 0 }

/** The families a verdict can name — the palettes that carry a hue. */
const FAMILIES = CAST_PALETTES.filter((p): p is CastPalette & { hue: number } => p.hue !== null)

/** Texel grid for both the density splat and the downscaled texture. */
const GRID = 64
/** Below this a texel is not carrying a colour, it is carrying a cast. */
const CHROMA_FLOOR = 0.35
/** Colourless must out-mass the top colour this far to claim the model. */
const NEUTRAL_MARGIN = 4
/** What the app can decode; tga exists in the wild and cannot be. */
const IMAGE = /\.(png|jpe?g|bmp|webp)$/i

/** Hue, chroma (HSV saturation — see header) and HSL lightness. */
function hueChromaLum(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, d / max, l]
}

/** Shortest way round the circle: 350° and 10° are 20° apart. */
function arc(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 360 - d)
}

async function blobOf(src: File | string): Promise<Blob> {
  return typeof src === "string" ? await (await fetch(src)).blob() : src
}

/** Fetch + parse, scoped so the multi-megabyte buffer is collectable the moment
 *  the mesh (a few small arrays) has been copied out of it. */
async function meshOf(src: File | string): Promise<PmxMesh | null> {
  try {
    return parsePmxMesh(await (await blobOf(src)).arrayBuffer())
  } catch {
    return null
  }
}

/** Decoded straight to GRID size — never a full-resolution RGBA copy in memory.
 *  UAs without resize options return the full bitmap; the draw call scales. */
async function bitmapOf(src: File | string): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(await blobOf(src), {
      resizeWidth: GRID,
      resizeHeight: GRID,
      resizeQuality: "high",
    })
  } catch {
    return null
  }
}

/** 3D area of triangle `t` (an index into indices, step 3), bind pose. */
function triArea(mesh: PmxMesh, t: number): number {
  const { positions, indices } = mesh
  const a = indices[t], b = indices[t + 1], c = indices[t + 2]
  const ux = positions[b * 3] - positions[a * 3]
  const uy = positions[b * 3 + 1] - positions[a * 3 + 1]
  const uz = positions[b * 3 + 2] - positions[a * 3 + 2]
  const vx = positions[c * 3] - positions[a * 3]
  const vy = positions[c * 3 + 1] - positions[a * 3 + 1]
  const vz = positions[c * 3 + 2] - positions[a * 3 + 2]
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2
}

/**
 * The palette this model belongs to, or null when it could not be read at all.
 * "silver" and "slate" are real verdicts — the light and dark kinds of
 * colourless — not fallbacks.
 */
export async function castColour(source: CastColourSource): Promise<CastPaletteId | null> {
  if (typeof document === "undefined") return null
  const mesh = await meshOf(source.pmx)
  if (!mesh) return null

  const canvas = document.createElement("canvas")
  canvas.width = GRID
  canvas.height = GRID
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null

  // Each referenced diffuse sheet, decoded once and in PARALLEL — these are the
  // slow half (network + image decode), and they are independent. Only the
  // shared-canvas readback is serial.
  const wanted = new Map<number, File | string>()
  for (const mat of mesh.materials) {
    const i = mat.textureIndex
    if (i < 0 || wanted.has(i)) continue
    const path = mesh.texturePaths[i]
    if (!path || !IMAGE.test(path)) continue
    const src = source.resolveTexture(path)
    if (src) wanted.set(i, src)
  }
  const texels = new Map<number, Uint8ClampedArray>()
  const decoded = await Promise.all(
    [...wanted].map(async ([i, src]) => ({ i, bmp: await bitmapOf(src) })),
  )
  for (const { i, bmp } of decoded) {
    if (!bmp) continue
    ctx.clearRect(0, 0, GRID, GRID)
    ctx.drawImage(bmp, 0, 0, GRID, GRID)
    bmp.close()
    texels.set(i, ctx.getImageData(0, 0, GRID, GRID).data)
  }

  const masses = new Float64Array(FAMILIES.length)
  // Colourless mass, split at mid-lightness. A mass comparison rather than a
  // mean, because the distribution is bimodal on real models — the white 托特
  // holds 17% of its colourless area in black boots and trim at L≈0.1 and 75%
  // in fabric and skin at 0.7–0.9. A mean wanders with the mix; whichever side
  // holds more mass is simply what the character is dressed in.
  let colourlessLight = 0
  let colourlessDark = 0

  const vote = (h: number, chroma: number, lum: number, weight: number) => {
    if (chroma < CHROMA_FLOOR) {
      if (lum >= 0.5) colourlessLight += weight
      else colourlessDark += weight
      return
    }
    let f = 0
    for (let i = 1; i < FAMILIES.length; i++) if (arc(h, FAMILIES[i].hue) < arc(h, FAMILIES[f].hue)) f = i
    masses[f] += weight
  }

  for (const mat of mesh.materials) {
    // A fully transparent material is a hidden part, not a colour.
    if (mat.diffuse[3] < 0.1) continue
    const scale = ROLE_WEIGHT[source.roleOf?.(mat.name) ?? ""] ?? 1
    if (scale <= 0) continue

    const path = mat.textureIndex >= 0 ? mesh.texturePaths[mat.textureIndex] : undefined
    const data = mat.textureIndex >= 0 ? texels.get(mat.textureIndex) : undefined

    // A decodable-format texture that failed to arrive (missing file, network):
    // abstain, before any geometry is walked. Guessing from the tint would
    // report the author's multiplier as the costume.
    if (!data && path && IMAGE.test(path)) continue

    if (!data) {
      // No texture at all, so the material colour is the whole of it: diffuse +
      // ambient, because MMD shades as diffuse×light + ambient and authors put
      // the colour in either term. Only a scalar area — no grid needed.
      let area = 0
      for (let t = mat.indexStart; t < mat.indexStart + mat.indexCount; t += 3) area += triArea(mesh, t)
      const r = Math.min(1, mat.diffuse[0] + mat.ambient[0]) * 255
      const g = Math.min(1, mat.diffuse[1] + mat.ambient[1]) * 255
      const b = Math.min(1, mat.diffuse[2] + mat.ambient[2]) * 255
      const [h, chroma, lum] = hueChromaLum(r, g, b)
      vote(h, chroma, lum, area * scale)
      continue
    }

    // Splat each triangle's bind-pose area into the UV cell its centroid maps
    // to. Cheap and slightly blurry at seams, which at 64² does not matter —
    // the point is that a texel's vote is the surface that wears it.
    const density = new Float64Array(GRID * GRID)
    const { uvs, indices } = mesh
    for (let t = mat.indexStart; t < mat.indexStart + mat.indexCount; t += 3) {
      const area = triArea(mesh, t)
      if (!(area > 0)) continue
      const a = indices[t], b = indices[t + 1], c = indices[t + 2]
      const u = (uvs[a * 2] + uvs[b * 2] + uvs[c * 2]) / 3
      const v = (uvs[a * 2 + 1] + uvs[b * 2 + 1] + uvs[c * 2 + 1]) / 3
      // UVs may tile; wrap into [0,1).
      const cu = Math.min(GRID - 1, Math.floor((((u % 1) + 1) % 1) * GRID))
      const cv = Math.min(GRID - 1, Math.floor((((v % 1) + 1) % 1) * GRID))
      density[cv * GRID + cu] += area
    }

    const [tr, tg, tb] = mat.diffuse
    for (let cell = 0; cell < GRID * GRID; cell++) {
      const w = density[cell] * scale
      if (w <= 0) continue
      const o = cell * 4
      if (data[o + 3] < 200) continue
      const [h, chroma, lum] = hueChromaLum(data[o] * tr, data[o + 1] * tg, data[o + 2] * tb)
      vote(h, chroma, lum, w)
    }
  }

  const colourless = colourlessLight + colourlessDark
  let top = 0
  for (let i = 1; i < FAMILIES.length; i++) if (masses[i] > masses[top]) top = i
  const verdict: CastPaletteId =
    masses[top] > 0 && colourless <= masses[top] * NEUTRAL_MARGIN
      ? FAMILIES[top].id
      : colourlessLight >= colourlessDark
        ? "silver"
        : "slate"

  if (process.env.NODE_ENV === "development") {
    const total = colourless + masses.reduce((a, b) => a + b, 0)
    const pct = (n: number) => `${((n / (total || 1)) * 100).toFixed(1)}%`
    const table = FAMILIES.map((f, i) => ({ id: f.id, m: masses[i] }))
      .filter(({ m }) => m > total * 0.001)
      .sort((a, b) => b.m - a.m)
      .map(({ id, m }) => `${id} ${pct(m)}`)
      .join(" · ")
    console.log(
      `[cast colour] colourless ${pct(colourless)} (light ${pct(colourlessLight)} / dark ${pct(colourlessDark)}) · ${table || "no colour"} → ${verdict}`,
    )
  }
  return verdict
}
