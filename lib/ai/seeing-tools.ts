// How the agent sees: captures measured by region, light read at a point,
// what each effect does to the frame, and the scene through the song.
//
// A picture is the last word, not the only one. Most of what a lighting artist
// checks is a number the frame already computed — which pixels are her face,
// whether they are in the sun's shadow, which lamp carries them, how far she
// stands out from what is behind her — and the engine now hands those back
// (Engine.readAovs, Engine.probeLight). The agent steers by them and looks at
// the picture for what numbers cannot say: whether it is good.

import type { Engine } from "reze-engine"
import { captureViews, type CaptureView, type CapturedFrame } from "@/lib/video-export"
import { measureFrame } from "@/lib/ai/image-metrics"
import { measureRegions, type RegionReport, type RegionSpec } from "@/lib/ai/region-metrics"
import { contactSheet } from "@/lib/ai/sheet"
import { primeAudioAnalysis } from "@/lib/audio-analysis"
import { summarizeMusic } from "@/lib/ai/music"
import { oklab } from "@/lib/ai/image-metrics"
import { figureOf, subjectId, type SceneTool, type SceneToolHandles, type ToolImage } from "@/lib/ai/scene-tools"

const r2 = (v: number) => Math.round(v * 100) / 100
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** The capture size for a frame's aspect: the long side at `long` pixels. */
export function captureSize(aspect: number, long: number) {
  return aspect >= 1
    ? { width: long, height: Math.round(long / aspect) }
    : { width: Math.round(long * aspect), height: long }
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/**
 * The regions to measure: each character, each of her material groups, and the
 * background (everything that is not a character — stages, floor, sky).
 * Ids come from the engine's legend; a group is the materials it names.
 */
export function regionsFor(h: SceneToolHandles, engine: Engine): RegionSpec[] {
  const legend = engine.getIdLegend()
  const castIds = new Set<number>()
  const out: RegionSpec[] = []
  for (const c of h.cast) {
    const entry = legend.find((l) => l.model === c.id)
    if (!entry) continue
    const obj = entry.objectId
    castIds.add(obj)
    out.push({ name: c.name, kind: "character", has: (o) => o === obj })
    const idOf = new Map(entry.materials.map((m) => [m.name, m.id]))
    for (const g of h.groups[c.id] ?? []) {
      const mats = new Set(g.materials.map((m) => idOf.get(m)).filter((v): v is number => v !== undefined))
      if (mats.size === 0) continue
      out.push({ name: g.label ?? g.id, kind: "group", of: c.name, has: (o, m) => o === obj && mats.has(m) })
    }
  }
  out.push({ name: "background", kind: "background", has: (o) => !castIds.has(o) })
  return out
}

/** A region report trimmed for reading: groups that are not on screen dropped. */
function readable(report: RegionReport) {
  return { ...report, regions: report.regions.filter((r) => r.kind !== "group" || r.coverage > 0) }
}

export type MeasuredFrame = { label: string; frame: CapturedFrame; regions: RegionReport | null }

/** Render `requests` (null view = the camera as it is), read each back, and
 *  measure it by region. The scene's camera is not moved. */
export async function captureMeasured(
  h: SceneToolHandles,
  requests: { label: string; view: CaptureView | null }[],
  long: number,
): Promise<MeasuredFrame[] | { error: string }> {
  const engine = h.engine()
  const canvas = h.canvas()
  if (!engine || !canvas) return { error: "the scene is not ready" }
  const { width, height } = captureSize(h.aspect, long)
  const frames = await captureViews({
    engine,
    canvas,
    width,
    height,
    backdrop: h.backdrop,
    backgroundColor: h.backgroundColor,
    atTime: h.time(),
    views: requests.map((r) => r.view),
    aovs: true,
  })
  const regions = regionsFor(h, engine)
  const sun = engine.getSun()
  const sunLight: [number, number, number] = [sun.color.x * sun.strength, sun.color.y * sun.strength, sun.color.z * sun.strength]
  return frames.map((frame, i) => ({
    label: requests[i].label,
    frame,
    regions: frame.aovs ? measureRegions(frame.aovs, frame.pixels.data, sunLight, regions) : null,
  }))
}

/** Images for the model: one each, or one contact sheet when there are several. */
export async function imagesOf(measured: MeasuredFrame[], sheet: boolean, cols?: number): Promise<ToolImage[]> {
  if (sheet && measured.length > 1) {
    const dataUrl = await contactSheet(
      measured.map((m) => ({ blob: m.frame.blob, label: m.label })),
      cols,
    )
    return [{ dataUrl, label: measured.map((m) => m.label).join(" | "), metrics: measureFrame(measured[0].frame.pixels.data, measured[0].frame.pixels.width, measured[0].frame.pixels.height) }]
  }
  const out: ToolImage[] = []
  for (const m of measured) {
    out.push({ dataUrl: await blobToDataUrl(m.frame.blob), label: m.label, metrics: measureFrame(m.frame.pixels.data, m.frame.pixels.width, m.frame.pixels.height) })
  }
  return out
}

/** What each frame says, for the model to read beside the picture. */
export function frameData(m: MeasuredFrame) {
  const px = m.frame.pixels
  const metrics = measureFrame(px.data, px.width, px.height)
  const warnings: string[] = []
  if (metrics.luminance.p95 < 0.02) warnings.push("the frame is black")
  if (m.regions && m.regions.regions.some((r) => r.kind === "character" && r.coverage === 0)) {
    warnings.push(`not in frame: ${m.regions.regions.filter((r) => r.kind === "character" && r.coverage === 0).map((r) => r.name).join(", ")}`)
  }
  return {
    label: m.label,
    frame: metrics,
    ...(m.regions ? readable(m.regions) : { regions: "unavailable on this device" }),
    ...(warnings.length ? { warnings } : {}),
  }
}

/** Lamp names in the engine's lamp order: the stage's daylight (its
 *  positional part), then the lamps that are on, as the scene sync hands them
 *  over (use-scene-sync), then any an effect emits. */
function lampNames(h: SceneToolHandles, documentLamps: number, total: number): string[] {
  const mine = h.lamps.filter((l) => l.on !== false)
  const fixed = Math.max(0, documentLamps - mine.length)
  return Array.from({ length: total }, (_, i) =>
    i < fixed ? `stage light ${i + 1}` : i < documentLamps ? (mine[i - fixed]?.name ?? `lamp ${i + 1}`) : `effect light ${i - documentLamps + 1}`,
  )
}

/** Moments through the song: the middle of each loudness section, else evenly. */
async function defaultMoments(h: SceneToolHandles, count: number): Promise<{ time: number; label: string }[]> {
  if (h.musicUrl) {
    const analysis = await primeAudioAnalysis(h.musicUrl)
    if (analysis) {
      const sections = summarizeMusic(analysis).sections
      if (sections.length) {
        const step = Math.max(1, sections.length / count)
        const picked: typeof sections = []
        for (let k = 0; k < sections.length && picked.length < count; k += step) picked.push(sections[Math.floor(k)])
        return picked.map((s) => ({ time: r2((s.start + s.end) / 2), label: `${r2((s.start + s.end) / 2)}s ${s.loudness}` }))
      }
    }
  }
  const d = h.duration || 0
  return Array.from({ length: count }, (_, i) => {
    const t = r2((d * (i + 0.5)) / count)
    return { time: t, label: `${t}s` }
  })
}

export const SEEING_TOOLS: SceneTool[] = [
  {
    name: "probe_light",
    description:
      "Read the light on a character's face and chest: whether the sun reaches it (lit, in a cast shadow, or turned away), how bright the sun, the world's ambient and EACH LAMP are there, which one is the key, and what lights her from behind (rim). Use it to find which light to change before changing it.",
    parameters: {
      type: "object",
      properties: { subject: { type: "string", description: "Character name or id; every character when omitted." } },
    },
    run: async (args, h) => {
      const engine = h.engine()
      if (!engine) return { data: { error: "the scene is not ready" } }
      const ids = typeof args.subject === "string" ? [subjectId(h, args.subject)].filter((v): v is string => Boolean(v)) : h.cast.map((c) => c.id)
      const eye = engine.getCameraPosition()
      const points: { position: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }[] = []
      const labels: { who: string; part: string; side: "front" | "back" }[] = []
      for (const id of ids) {
        const fig = figureOf(engine, id)
        if (!fig) continue
        const who = h.cast.find((c) => c.id === id)?.name ?? id
        for (const [part, p] of [["face", fig.head], ["chest", fig.chest]] as const) {
          const toEye = [eye.x - p[0], eye.y - p[1], eye.z - p[2]]
          const len = Math.hypot(toEye[0], toEye[1], toEye[2]) || 1
          const n = { x: toEye[0] / len, y: toEye[1] / len, z: toEye[2] / len }
          // The bones are INSIDE her: probed there, her own head shadows the
          // point and every answer is "in a cast shadow". Out to about where
          // the skin is, on each side — a head is ~2.5 units across at MMD
          // scale (she is ~18 tall), a chest a little deeper.
          const out = part === "face" ? 1.4 : 1.8
          const along = (s: number) => ({ x: p[0] + n.x * out * s, y: p[1] + n.y * out * s, z: p[2] + n.z * out * s })
          // The side the camera sees, and the side away from it — the second is
          // where a rim or back light lands.
          points.push({ position: along(1), normal: n })
          labels.push({ who, part, side: "front" })
          points.push({ position: along(-1), normal: { x: -n.x, y: -n.y, z: -n.z } })
          labels.push({ who, part, side: "back" })
        }
      }
      if (points.length === 0) return { data: { error: "no character with standard MMD bones to probe" } }
      const probes = await engine.probeLight(points)
      const result: Record<string, Record<string, unknown>> = {}
      probes.forEach((p, i) => {
        const { who, part, side } = labels[i]
        const names = lampNames(h, p.documentLamps, p.lamps.length)
        const sunHere = lum(p.sun) * Math.max(p.sunFacing, 0) * p.sunShadow
        const sources = [
          { name: "sun", light: sunHere },
          { name: "world ambient", light: lum(p.ambient) },
          ...p.lamps.map((c, k) => ({ name: names[k], light: lum(c) })),
        ].filter((s) => s.light > 1e-4)
        const total = sources.reduce((a, s) => a + s.light, 0) || 1
        sources.sort((a, b) => b.light - a.light)
        const entry = {
          sun: p.sunFacing <= 0 ? "turned away" : p.sunShadow < 0.5 ? "in a cast shadow" : "lit",
          total: r2(total),
          sources: sources.map((s) => ({ name: s.name, light: r2(s.light), share: r2(s.light / total) })),
          ...(side === "front" ? { key: sources[0]?.name ?? "none" } : {}),
        }
        result[who] ??= {}
        result[who][`${part} ${side === "front" ? "(toward camera)" : "(back, rim)"}`] = entry
      })
      return { data: result }
    },
  },
  {
    name: "effect_impact",
    description:
      "What each effect in the scene does to the frame at this moment: how much of the picture and of each character it changes, and how much brighter or darker it makes her. Catches an effect that buries the character or does nothing. Renders the frame with each effect switched off in turn; nothing in the scene changes.",
    parameters: {
      type: "object",
      properties: { effect: { type: "string", description: "One effect by id or name; all (up to 6) when omitted." } },
    },
    run: async (args, h) => {
      const engine = h.engine()
      if (!engine) return { data: { error: "the scene is not ready" } }
      // An effect just added is still compiling: give the install a moment
      // before deciding the list and the engine disagree for good.
      for (let i = 0; i < 40 && engine.getEffectCount() !== h.effects.length; i++) await new Promise((r) => setTimeout(r, 100))
      if (engine.getEffectCount() !== h.effects.length) {
        return { data: { error: "an effect is still installing or failed to, so effects cannot be matched to the frame — try again, or read_console" } }
      }
      const wanted = typeof args.effect === "string" ? String(args.effect).toLowerCase() : null
      const targets = h.effects
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => !wanted || e.uid === args.effect || e.name.toLowerCase() === wanted)
        .slice(0, 6)
      if (targets.length === 0) return { data: { error: wanted ? `no effect "${args.effect}" in the scene` : "the scene has no effects" } }

      const base = await captureMeasured(h, [{ label: "as is", view: null }], 384)
      if ("error" in base) return { data: base }
      const ref = base[0]
      const ids = ref.frame.aovs?.ids
      const before = ref.frame.pixels.data
      const out = []
      for (const { e, index } of targets) {
        const was = engine.getEffectInfluence(index)
        engine.setEffectInfluence(index, 0)
        let off: Awaited<ReturnType<typeof captureMeasured>>
        try {
          off = await captureMeasured(h, [{ label: "without", view: null }], 384)
        } finally {
          engine.setEffectInfluence(index, was)
        }
        if ("error" in off) return { data: off }
        const after = off[0].frame.pixels.data
        // Changed = a visible colour difference, judged in Oklab.
        let changed = 0
        const perChar = new Map<number, { n: number; changed: number }>()
        const n = before.length / 4
        for (let i = 0; i < n; i++) {
          const p = i * 4
          const a = oklab(before[p], before[p + 1], before[p + 2])
          const b = oklab(after[p], after[p + 1], after[p + 2])
          const diff = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.04
          if (diff) changed++
          const obj = ids ? ids[i] >>> 16 : 0
          if (obj) {
            const c = perChar.get(obj) ?? { n: 0, changed: 0 }
            c.n++
            if (diff) c.changed++
            perChar.set(obj, c)
          }
        }
        const legend = engine.getIdLegend()
        const characters = h.cast.flatMap((c) => {
          const obj = legend.find((l) => l.model === c.id)?.objectId
          const s = obj ? perChar.get(obj) : undefined
          if (!s) return []
          const withIt = ref.regions?.regions.find((r) => r.kind === "character" && r.name === c.name)
          const without = off[0].regions?.regions.find((r) => r.kind === "character" && r.name === c.name)
          return [{
            name: c.name,
            changed: r2(s.changed / s.n),
            stops: withIt && without ? r2(withIt.stops.p50 - without.stops.p50) : null,
          }]
        })
        out.push({ effect: e.name, id: e.uid, influence: r2(was), frameChanged: r2(changed / n), characters })
      }
      return { data: { time: r2(h.time()), effects: out } }
    },
  },
  {
    name: "filmstrip",
    description:
      "Look at the scene through the song: one contact sheet of moments (default: the middle of each loudness section, up to 6) from the camera as it is, with each moment's brightness and how each character reads. For anything timed — effects, lamps, who is on stage. The scene's time is put back afterwards.",
    parameters: {
      type: "object",
      properties: {
        times: { type: "array", items: { type: "number" }, maxItems: 6, description: "Seconds to look at; omit for the song's sections." },
      },
    },
    run: async (args, h) => {
      const engine = h.engine()
      if (!engine) return { data: { error: "the scene is not ready" } }
      const moments = Array.isArray(args.times) && args.times.length
        ? (args.times as unknown[]).filter((t): t is number => typeof t === "number" && Number.isFinite(t)).slice(0, 6).map((t) => ({ time: r2(Math.max(0, Math.min(h.duration || 0, t))), label: `${r2(t)}s` }))
        : await defaultMoments(h, 6)
      const back = h.time()
      const measured: MeasuredFrame[] = []
      try {
        for (const m of moments) {
          h.seek(m.time)
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          const shot = await captureMeasured(h, [{ label: m.label, view: null }], 384)
          if ("error" in shot) return { data: shot }
          measured.push(shot[0])
        }
      } finally {
        h.seek(back)
      }
      const frames = measured.map((m, i) => {
        const px = m.frame.pixels
        const metrics = measureFrame(px.data, px.width, px.height)
        return {
          time: moments[i].time,
          label: m.label,
          brightness: metrics.luminance.p50,
          characters: (m.regions?.regions ?? [])
            .filter((r) => r.kind === "character")
            .map((r) => ({ name: r.name, coverage: r.coverage, stops: r.stops.p50, inSun: r.light.inSun, cut: r.cut })),
          separation: m.regions?.separation ?? [],
        }
      })
      return { data: { frames }, images: await imagesOf(measured, true, 3) }
    },
  },
]
