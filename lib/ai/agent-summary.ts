// What each step the AI took MEANS, in a line a person reads at a glance.
//
// The transcript is not the protocol. "capture" followed by four kilobytes of
// JSON says nothing to someone watching their scene change; "Looked at 2 views
// — reze: face +0.8 stops, 89% in sun" says what it found. Each tool gets a
// title (what it did, in the past tense) and, where the result has something
// worth reading, a detail line. Pure: input and result in, words out — so the
// panel can rebuild it from the history at any time.

type Data = Record<string, unknown> & { error?: unknown }

export type StepSummary = { title: string; detail?: string; failed?: boolean }

const n = (v: unknown, d = 1) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const signed = (v: unknown) => {
  const x = n(v)
  return x === null ? "?" : `${x > 0 ? "+" : ""}${x}`
}
const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "?")
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max}` : xs.join(", "))

/** "sun.strength 1.2, bloom.intensity 0.6" from a settings patch. */
function fields(applied: unknown): string[] {
  if (!applied || typeof applied !== "object") return []
  const out: string[] = []
  for (const [section, part] of Object.entries(applied as Record<string, unknown>)) {
    if (!part || typeof part !== "object") continue
    for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
      const shown = typeof v === "number" ? n(v, 2) : typeof v === "string" || typeof v === "boolean" ? v : "…"
      out.push(`${section}.${k} ${shown}`)
    }
  }
  return out
}

type Region = { name: string; kind: string; of?: string; coverage: number; stops: { p50: number }; light: { inSun: number }; cut: string[] }
type View = { label: string; regions?: Region[] | string; separation?: { name: string; stops: number }[]; warnings?: string[] }

/** One view's reading: each character's face (or whole figure) brightness,
 *  sun, separation and any cut. */
function viewLine(v: View): string {
  if (!Array.isArray(v.regions)) return v.label
  const parts: string[] = []
  for (const c of v.regions.filter((r) => r.kind === "character")) {
    const face = v.regions.find((r) => r.kind === "group" && r.of === c.name && /face|head|skin/i.test(r.name) && r.coverage > 0)
    const subject = face ?? c
    const sep = v.separation?.find((s) => s.name === c.name)
    const bits = [
      `${face ? "face" : "figure"} ${signed(subject.stops.p50)} stops`,
      `${pct(subject.light.inSun)} in sun`,
      ...(sep ? [`stands out ${signed(sep.stops)}`] : []),
      ...(c.cut.length ? [`cut ${c.cut.join("/")}`] : []),
    ]
    parts.push(`${c.name}: ${bits.join(" · ")}`)
  }
  if (v.warnings?.length) parts.push(v.warnings.join("; "))
  return parts.join("  ")
}

export function summarizeStep(name: string, input: Record<string, unknown>, data: unknown): StepSummary {
  const d = (data && typeof data === "object" ? data : {}) as Data
  if (d.error) return { title: titleOf(name), detail: String(d.error), failed: true }
  switch (name) {
    case "get_scene": {
      const chars = Array.isArray(d.characters) ? (d.characters as { name: string }[]).map((c) => c.name) : []
      const effects = Array.isArray(d.effects) ? d.effects.length : 0
      return { title: "Read the scene", detail: [list(chars), plural(effects, "effect"), plural(Number(d.lamps) || 0, "lamp")].filter(Boolean).join(" · ") }
    }
    case "set_settings": {
      const f = fields(d.applied)
      const clamped = Array.isArray(d.clamped) && d.clamped.length ? ` (${plural(d.clamped.length, "value")} clamped to range)` : ""
      return { title: "Adjusted the look", detail: list(f, 4) + clamped }
    }
    case "set_grade":
      return { title: "Regraded the colour", detail: input.shadows || input.highlights ? "by tonal range" : undefined }
    case "set_camera":
    case "frame_shot": {
      const c = d.camera as { yaw?: number; pitch?: number; distance?: number; fov?: number } | undefined
      const what = name === "frame_shot" ? `${input.shot ?? ""} ${input.angle ?? ""}`.trim() : "camera"
      return { title: name === "frame_shot" ? `Framed a ${what}` : "Moved the camera", detail: c ? `yaw ${n(c.yaw, 0)}° · pitch ${n(c.pitch, 0)}° · distance ${n(c.distance)} · fov ${n(c.fov, 0)}°` : undefined }
    }
    case "capture": {
      const views = (Array.isArray(d.views) ? d.views : []) as View[]
      return { title: views.length > 1 ? `Looked at ${views.length} views` : "Looked at the frame", detail: views.map(viewLine).filter(Boolean).join("\n") }
    }
    case "probe_light": {
      const lines: string[] = []
      for (const [who, parts] of Object.entries(d as Record<string, Record<string, { key?: string; sun?: string; sources?: { name: string; share: number }[] }>>)) {
        const face = Object.entries(parts ?? {}).find(([k]) => k.startsWith("face (toward"))?.[1]
        const rim = Object.entries(parts ?? {}).find(([k]) => k.startsWith("face (back"))?.[1]
        if (!face) continue
        const key = face.sources?.[0]
        const rimLamp = rim?.sources?.find((s) => s.name !== "world ambient" && s.name !== "sun")
        lines.push(`${who}: face ${face.sun}, key ${key ? `${key.name} ${pct(key.share)}` : "none"}${rimLamp ? ` · rim ${rimLamp.name}` : " · no rim light"}`)
      }
      return { title: "Measured the light", detail: lines.join("\n") }
    }
    case "effect_impact": {
      const fx = (Array.isArray(d.effects) ? d.effects : []) as { effect: string; frameChanged: number }[]
      return { title: "Weighed the effects", detail: list(fx.map((e) => `${e.effect} ${pct(e.frameChanged)} of frame`), 4) }
    }
    case "filmstrip": {
      const frames = (Array.isArray(d.frames) ? d.frames : []) as { label: string }[]
      return { title: `Scrubbed through the song`, detail: plural(frames.length, "moment") }
    }
    case "seek":
      return { title: `Went to ${n(d.time)}s` }
    case "read_console": {
      const lines = Array.isArray(d) ? d : Array.isArray(d.result) ? d.result : []
      return { title: "Checked the console", detail: lines.length ? plural(lines.length, "message") : "nothing logged" }
    }
    case "list_shaders":
      return { title: "Browsed the shader library" }
    case "assign_shader":
      return { title: `Put ${input.shader} on ${input.group}` }
    case "apply_look_pack":
      return { title: `Switched to the ${input.pack} look` }
    case "get_shader_inputs":
      return { title: `Opened the ${input.group} shader`, detail: Array.isArray(d.nodes) ? plural(d.nodes.length, "tunable node") : undefined }
    case "set_shader_inputs": {
      const a = (Array.isArray(d.applied) ? d.applied : []) as { node: string; socket: string }[]
      return { title: `Tuned the ${input.group} shader`, detail: list(a.map((x) => `${x.node}.${x.socket}`), 4) }
    }
    case "get_music": {
      const sections = Array.isArray(d.sections) ? d.sections.length : 0
      return { title: "Listened to the music", detail: [d.bpm ? `${n(d.bpm, 0)} bpm` : null, plural(sections, "section")].filter(Boolean).join(" · ") }
    }
    case "list_effects":
      return { title: "Browsed the effects library" }
    case "get_effects":
      return { title: "Checked the effects", detail: Array.isArray(data) ? list((data as { name: string }[]).map((e) => e.name), 4) : undefined }
    case "add_effect":
      return { title: `Added ${d.name ?? input.name}` }
    case "update_effect":
      return { title: `Changed ${input.effect}` }
    case "remove_effect":
      return { title: `Removed ${d.removed ?? input.effect}` }
    case "get_lamps":
      return { title: "Checked the lamps", detail: Array.isArray(data) ? plural(data.length, "lamp") : undefined }
    case "add_lamp":
      return { title: `Added the lamp ${d.name ?? ""}`.trim(), detail: typeof d.color === "string" ? `${d.color} · intensity ${n(d.intensity)}` : undefined }
    case "update_lamp":
      return { title: `Changed the lamp ${d.name ?? input.lamp}` }
    case "remove_lamp":
      return { title: `Removed the lamp ${d.removed ?? input.lamp}` }
    case "read_authoring_guide":
      return { title: `Read the ${input.topic === "graphs" ? "shader graph" : "effects"} guide` }
    case "read_effect_source":
      return { title: `Read the code of ${d.name ?? input.effect}` }
    case "write_effect": {
      if (d.saved) return { title: `Wrote the effect ${d.saved}`, detail: Array.isArray(d.dials) && d.dials.length ? `dials: ${list((d.dials as { name: string }[]).map((p) => p.name), 5)}` : "saved to your drafts" }
      const problems = (Array.isArray(d.diagnostics) ? d.diagnostics : Array.isArray(d.problems) ? d.problems : []) as string[]
      return { title: `Wrote ${input.name} — it needs fixing`, detail: problems[0] ?? String(d.error ?? ""), failed: true }
    }
    case "read_shader_graph":
      return { title: `Read the ${input.shader ?? input.group} shader graph`, detail: d.graph ? plural(((d.graph as { nodes?: unknown[] }).nodes ?? []).length, "node") : undefined }
    case "write_shader":
      if (d.saved) return { title: `Wrote the shader ${d.saved}`, detail: `on ${d.character} · ${d.group}` }
      return { title: `Wrote ${input.name} — it needs fixing`, detail: Array.isArray(d.diagnostics) ? String(d.diagnostics[0]) : String(d.error ?? ""), failed: true }
    case "get_visibility":
      return { title: "Checked who is on stage" }
    case "set_visibility":
      return { title: `Changed when ${d.name ?? input.model} is on stage` }
    default:
      return { title: titleOf(name) }
  }
}

/** A tool's name as a phrase, for a step no case above words better. */
export function titleOf(name: string): string {
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
}

/** What the spinner says while a tool runs: the work, in the present. */
export function doingOf(name: string | null): string | null {
  if (!name) return null
  const map: Record<string, string> = {
    get_scene: "Reading the scene",
    set_settings: "Adjusting the look",
    set_grade: "Grading the colour",
    set_camera: "Moving the camera",
    frame_shot: "Framing the shot",
    capture: "Looking closely",
    probe_light: "Measuring the light",
    effect_impact: "Weighing the effects",
    filmstrip: "Scrubbing through the song",
    seek: "Scrubbing",
    read_console: "Checking the console",
    list_shaders: "Browsing shaders",
    assign_shader: "Swapping a shader",
    apply_look_pack: "Restyling the scene",
    get_shader_inputs: "Opening a shader",
    set_shader_inputs: "Tuning a shader",
    get_music: "Listening to the music",
    list_effects: "Browsing effects",
    get_effects: "Checking the effects",
    add_effect: "Adding an effect",
    update_effect: "Adjusting an effect",
    remove_effect: "Removing an effect",
    get_lamps: "Checking the lamps",
    add_lamp: "Placing a lamp",
    update_lamp: "Adjusting a lamp",
    remove_lamp: "Removing a lamp",
    get_visibility: "Checking the stage",
    read_authoring_guide: "Reading the guide",
    read_effect_source: "Reading effect code",
    write_effect: "Writing an effect",
    read_shader_graph: "Reading a shader graph",
    write_shader: "Writing a shader",
    set_visibility: "Staging the cast",
  }
  return map[name] ?? titleOf(name)
}

/** While the model thinks between steps: rotated, so a long think does not
 *  sit on one word. */
export const THINKING_VERBS = ["Thinking", "Considering", "Squinting at the frame", "Weighing options", "Mixing light", "Composing", "Pondering"]
