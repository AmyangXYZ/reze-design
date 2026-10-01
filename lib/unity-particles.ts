// The game's particle systems as engine effects — one per kind of system a stage
// carries (tools/stages/unity_particles.py writes them), generated here at load.
//
// Nothing in this file is a look someone chose. The spawn, the flight and the
// life are Unity's ParticleSystem rules on the modules the converter read; the
// picture is the game's own effect shader (ZTong/Effect_Common) on the game's
// own textures, as its decompiled fragment has it — main raised and mixed by
// _MainPow and times _Color, the second picture mixed in by _PlusMode, the
// vertex colour (start colour × colour over life) multiplied in, the mask's
// channel cutting the alpha, laid over by _DstBlend. It exists because the
// splashes drawn by hand-written effects were a guess at every property, and
// each guess was wrong in its own way.
//
// EMITTERS ARE POINT PAIRS. Each emitter is two named points (ps<k>_NNN): the
// even one runs along its local +Z, as long as one of the game's units at the
// emitter's size scale; the odd one along its local +X, as long as one unit at
// its shape scale. From them the effect has the emitter's whole frame.
//
// Not drawn: dissolve (the systems on X348 drive it from custom data that is 0)
// and the depth fade against the scene (a particle has no depth to read). Not
// simulated: the noise module's rotation and size amounts, and velocity over
// life's speed modifier.

export type Curve = { mode?: number; lo: number; hi: number; curve?: number[]; curveLo?: number[] }
export type Colour = { mode: number; lo?: number[]; hi?: number[]; gradient?: number[][]; gradientLo?: number[][] }
export type NoiseSpec = {
  separate: boolean
  /** per axis (x only without `separate`), in the simulation space's units per second */
  strength: [Curve, Curve, Curve]
  frequency: number
  /** strength divided by frequency, so the field scales without changing how it moves */
  damping: boolean
  octaves: number
  octaveMultiplier: number
  octaveScale: number
  scroll: Curve
  /** the noise (-1..1) remapped through these curves, over 0..1 */
  remap: [Curve, Curve, Curve] | null
  positionAmount: Curve
  rotationAmount: Curve
  sizeAmount: Curve
}
export type VelocitySpec = {
  linear: [Curve, Curve, Curve]
  /** radians per second about the system's own axes, through its centre + offset */
  orbital: [Curve, Curve, Curve]
  offset: [Curve, Curve, Curve]
  radial: Curve
  speedModifier: Curve
  world: boolean
}
export type ParticleSpec = {
  max: number
  /** false: one shot — the system plays from its start, not from a random point of a loop */
  looping?: boolean
  scalingMode: number
  lifetime: Curve
  speed: Curve
  size3D: boolean
  size: [Curve, Curve, Curve]
  rotation: Curve
  rotation3D?: boolean
  /** With rotation3D: the start turn about X and Y, radians (Unity applies Z, X, then Y). */
  rotationX?: Curve
  rotationY?: Curve
  color: Colour
  gravity: Curve
  emission: { on: boolean; rate: Curve; bursts: { time: number; count: number; cycles: number; interval: number }[] }
  shape: {
    on: boolean
    type: number
    radius: number
    radiusThickness: number
    angle: number
    arc: number
    length: number
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    randomDirection: number
  }
  sizeOverLife: { separate: boolean; x: Curve; y: Curve } | null
  rotationOverLife: { z: Curve } | null
  colorOverLife: Colour | null
  uv: { tiles: [number, number]; mode: number; row: number; frame: Curve; start: Curve; cycles: number } | null
  clamp: { limit: Curve; dampen: number } | null
  renderer: {
    mode: number
    pivot: [number, number, number]
    lengthScale: number
    velocityScale: number
    linear: boolean
    /** 0 View (faces the camera), 1 World, 2 Local (flat in the emitter's plane), 3 Facing, 4 Velocity */
    alignment?: number
  }
  /** The CustomData module's vectors, "<stream>_<component>": stream 0 is
   *  Custom1, which the renderer hands the shader as TEXCOORD1. */
  custom?: Record<string, Curve> | null
  noise?: NoiseSpec | null
  velocity?: VelocitySpec | null
}
export type ParticleLayer = {
  scale: [number, number]
  offset: [number, number]
  rotation: number
  tiling: boolean
  speed: [number, number]
  srgb?: boolean
  /** Slid by the particle's Custom1 instead of by time: its xy (main, plus) or zw (mask). */
  custom?: "xy" | "zw"
}
export type ParticleMaterial = {
  layers: { main?: ParticleLayer; plus?: ParticleLayer; mask?: ParticleLayer }
  noise?: { scale: [number, number]; offset: [number, number]; speed: [number, number]; strength: [number, number]; main: boolean; plus: boolean; mask: boolean; srgb?: boolean }
  mainPow: number[]
  color: number[]
  redAlphaMain: boolean
  plusPow: number[]
  plusColor: number[]
  redAlphaPlus: boolean
  plusStrength: number
  plusColorOn: number
  plusAlphaOn: number
  plusMode: number
  redAlphaMask: boolean
  maskStrength: number
  dstBlend: number
}
/** One picture of ZTong/Tong_jichu_Add (tools/stages/unity_effect_bake.tong_add_effect). */
export type TongLayer = {
  scale: [number, number]
  offset: [number, number]
  /** UV per second, (u, v) — unless Custom1 drives that axis */
  speed: [number, number]
  /** which axes the particle's Custom1 drives instead: xy for the picture, zw for the mask */
  customAxes: [boolean, boolean]
  /** turned by this many degrees about 0.5 — or spinning at `spin` rad/s */
  angle: number
  spin: number | null
  /** 0 the whole picture, 1 its alpha only (white), 2 its red everywhere */
  single: number
  srgb?: boolean
}
/** ZTong/Tong_jichu_Add: the plain additive sheet (X203a's light glows). */
export type TongMaterial = {
  kind: "tong_add"
  layers: { main: TongLayer; mask?: TongLayer }
  color: number[]
  alphaFromCustom: boolean
  /** _Vertex_Color: ON ignores the vertex colour (the shader's switch is that way round) */
  ignoreVertexColor: boolean
  worldMask?: boolean
  dstBlend: number
}
export type ParticleClass = {
  name: string
  prefix: string
  emitters: number
  /** One of the game's units in the stage's metres. */
  metresPerUnit?: number
  spec: ParticleSpec
  material: ParticleMaterial | TongMaterial
}

const f = (v: number) => (Number.isFinite(v) ? (Number.isInteger(v) ? `${v}.0` : `${v}`) : "0.0")
const v3 = (a: readonly number[]) => `vec3f(${f(a[0] ?? 0)}, ${f(a[1] ?? 0)}, ${f(a[2] ?? 0)})`
const arr = (a: readonly number[]) => `array<f32, ${a.length}>(${a.map(f).join(", ")})`

/** A curve's value at life t and random r, as WGSL. Constant and two-constant
 *  forms fold to an expression; sampled forms read a 16-entry table. */
function curveExpr(c: Curve | undefined, name: string, t: string, r: string, decls: string[]): string {
  if (!c) return "0.0"
  if (!c.curve) return c.lo === c.hi ? f(c.hi) : `mix(${f(c.lo)}, ${f(c.hi)}, ${r})`
  decls.push(`fn ${name}(t: f32) -> f32 { var a = ${arr(c.curve)}; return rzTable16(a, t); }`)
  if (c.curveLo && c.mode === 2) {
    decls.push(`fn ${name}Lo(t: f32) -> f32 { var a = ${arr(c.curveLo)}; return rzTable16(a, t); }`)
    return `mix(${name}Lo(${t}), ${name}(${t}), ${r})`
  }
  return `${name}(${t})`
}

/** A MinMaxGradient at life t and random r, rgba gamma. */
function colourExpr(c: Colour | null | undefined, name: string, t: string, r: string, decls: string[]): string {
  if (!c) return "vec4f(1.0)"
  if (c.gradient) {
    const table = (g: number[][], n: string) =>
      decls.push(`fn ${n}(t: f32) -> vec4f { var a = array<vec4f, ${g.length}>(${g.map((q) => `vec4f(${q.map(f).join(", ")})`).join(", ")}); return rzGradient16(a, t); }`)
    table(c.gradient, name)
    if (c.mode === 3 && c.gradientLo) {
      table(c.gradientLo, `${name}Lo`)
      return `mix(${name}Lo(${t}), ${name}(${t}), ${r})`
    }
    // mode 4 (random colour from the gradient) samples it at the random, not at life
    return c.mode === 4 ? `${name}(${r})` : `${name}(${t})`
  }
  const lo = c.lo ?? [1, 1, 1, 1]
  const hi = c.hi ?? lo
  return `mix(vec4f(${lo.map(f).join(", ")}), vec4f(${hi.map(f).join(", ")}), ${r})`
}

/** Unity's shape rotation (Euler degrees, applied Z then X then Y) as a 3x3. */
function shapeMatrix(rot: readonly number[]): string {
  const [ax, ay, az] = rot.map((d) => (d * Math.PI) / 180)
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az)
  // R = Ry · Rx · Rz, columns
  const m = [
    [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz],
    [-cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz],
    [sy * cx, -sx, cy * cx],
  ]
  return `mat3x3f(${m.map((c) => c.map(f).join(", ")).join(", ")})`
}

/** The effect's WGSL for one kind of system, emitting from `emitters` point pairs.
 *  `world` is one of the game's units in engine units — the scale gravity pulls
 *  in, where everything else scales with its own emitter. */
export function particleEffectWgsl(cls: ParticleClass, world: number): string {
  const s = cls.spec
  // Two of the game's shaders draw particles: Effect_Common (most of them) and
  // the plain additive Tong_jichu_Add. The spawn and flight are the same; only
  // the picture differs, so the second runs the same code with a neutral
  // Effect_Common stand-in and swaps its own layers and shading in below.
  const tong = (cls.material as { kind?: string }).kind === "tong_add" ? (cls.material as TongMaterial) : null
  const m: ParticleMaterial = tong
    ? { layers: {}, mainPow: [1, 1, 1, 0], color: [1, 1, 1, 1], redAlphaMain: false, plusPow: [1, 1, 1, 0], plusColor: [1, 1, 1, 1], redAlphaPlus: false, plusStrength: 0, plusColorOn: 0, plusAlphaOn: 0, plusMode: 0, redAlphaMask: false, maskStrength: 0, dstBlend: 1 }
    : (cls.material as ParticleMaterial)
  const decls: string[] = []
  // how many of the pool each emitter keeps alive: its rate over a mean life plus
  // its bursts, capped where the game caps it. A rate random between two
  // constants emits at their mean (X340's glow: 0.5..3 a second keeps 7 alive)
  const meanLife = (s.lifetime.lo + s.lifetime.hi) / 2
  const burst = s.emission.bursts.reduce((n, b) => n + b.count * Math.max(1, b.cycles), 0)
  const rate = s.emission.rate.mode === 3 ? (s.emission.rate.lo + s.emission.rate.hi) / 2 : s.emission.rate.hi
  const perEmitter = Math.max(1, Math.min(s.max, Math.round((s.emission.on ? rate * meanLife + burst : 1) || 1)))
  const pool = perEmitter * cls.emitters
  const additive = m.dstBlend <= 1.0001
  const cover = Math.max((m.dstBlend - 1) / 9, 1e-3)

  const life = curveExpr(s.lifetime, "cLife", "0.0", "r0.x", decls)
  const speed = curveExpr(s.speed, "cSpeed", "0.0", "r0.y", decls)
  const sizeX = curveExpr(s.size[0], "cSizeX", "0.0", "rs.x", decls)
  const sizeY = s.size3D ? curveExpr(s.size[1], "cSizeY", "0.0", "rs.y", decls) : sizeX
  const rot = curveExpr(s.rotation, "cRot", "0.0", "rs.z", decls)
  const grav = curveExpr(s.gravity, "cGrav", "0.0", "r1.x", decls)
  const startCol = colourExpr(s.color, "cStart", "0.0", "rc.x", decls)
  const solX = s.sizeOverLife ? curveExpr(s.sizeOverLife.x, "cSolX", "t", "rc.y", decls) : "1.0"
  const solY = s.sizeOverLife ? (s.sizeOverLife.separate ? curveExpr(s.sizeOverLife.y, "cSolY", "t", "rc.y", decls) : solX) : "1.0"
  const rol = s.rotationOverLife ? curveExpr(s.rotationOverLife.z, "cRol", "t", "rc.z", decls) : "0.0"
  // rzHash13 has three components, all taken: a fourth random, folded from them
  const col = colourExpr(s.colorOverLife, "cCol", "t", "fract(rc.x * 7.31 + rc.y * 3.17)", decls)
  const clampLim = s.clamp ? curveExpr(s.clamp.limit, "cClamp", "t", "rc.y", decls) : "0.0"
  const frame = s.uv ? curveExpr(s.uv.frame, "cFrame", "t", "rc.z", decls) : "0.0"
  // Custom1, per particle over its life
  const custom1 = [0, 1, 2, 3].map((i) => (s.custom?.[`0_${i}`] ? curveExpr(s.custom[`0_${i}`], `cCustom${i}`, "t", "rq.x", decls) : "0.0"))
  const readsCustom =
    Object.values(m.layers).some((l) => l?.custom) ||
    (!!tong && (tong.alphaFromCustom || [tong.layers.main, tong.layers.mask].some((l) => l?.customAxes.some(Boolean))))
  const startFrame = s.uv ? curveExpr(s.uv.start, "cStartFrame", "0.0", "rc.z", decls) : "0.0"

  const sh = s.shape
  const sp = sh.on ? sh : { ...sh, type: -1 }
  // the spawn in the shape's own space (Unity's), then its transform
  const shapeCode = (() => {
    const a = (sp.angle * Math.PI) / 180
    const arc = (sp.arc * Math.PI) / 180
    switch (sp.type) {
      case 4: case 7: case 8: case 9: {
        // CONE: from the base disc, each direction leaning out by where it left
        const shell = sp.type === 7 || sp.type === 9
        const volume = sp.type === 8 || sp.type === 9
        return `
  let phi = ${f(arc)} * rb.x;
  let rr = ${shell ? "1.0" : `sqrt(mix(${f((1 - sp.radiusThickness) ** 2)}, 1.0, rb.y))`};
  let ring = vec2f(cos(phi), sin(phi));
  var lp = vec3f(ring * rr * ${f(sp.radius)}, 0.0);
  let lean = ${f(Math.sin(a))} * rr;
  var ld = normalize(vec3f(ring * lean, ${f(Math.cos(a))}));
  ${volume ? `lp = lp + ld * (${f(sp.length)} * rb.z);` : ""}`
      }
      case 5: case 15: case 16:
        return `
  var lp = (rb - vec3f(0.5)) * ${v3(sp.scale)};
  var ld = vec3f(0.0, 0.0, 1.0);`
      case 0: case 1: case 2: case 3: {
        const hemi = sp.type === 2 || sp.type === 3
        return `
  let u = rb.x * 2.0 - 1.0;
  let phi = 6.2831853 * rb.y;
  var ld = vec3f(sqrt(max(1.0 - u * u, 0.0)) * vec2f(cos(phi), sin(phi)), ${hemi ? "abs(u)" : "u"});
  var lp = ld * ${f(sp.radius)} * ${sp.type === 1 || sp.type === 3 ? "1.0" : `pow(mix(${f((1 - sp.radiusThickness) ** 3)}, 1.0, rb.z), 1.0 / 3.0)`};`
      }
      case 10: case 11:
        return `
  let phi = ${f(arc)} * rb.x;
  var ld = vec3f(cos(phi), sin(phi), 0.0);
  var lp = ld * ${f(sp.radius)} * ${sp.type === 11 ? "1.0" : `sqrt(mix(${f((1 - sp.radiusThickness) ** 2)}, 1.0, rb.y))`};`
      default:
        return `
  var lp = vec3f(0.0);
  var ld = vec3f(0.0, 0.0, 1.0);`
    }
  })()

  // THE SHAPE'S SCALE stretches a cone, sphere or circle — where it spawns and
  // the way it sends — as Unity's shape transform does (a box is its scale
  // already). X340's glow cone, scaled (1, 0, 27.5), is flat and runs along Z.
  const scaled = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].includes(sp.type) && sh.scale.some((v) => v !== 1)
  const shapeTransform = scaled
    ? `
  lp = sm * (lp * ${v3(sh.scale)}) + ${v3(sh.position)};
  ld = sm * (ld * ${v3(sh.scale)});
  ld = select(sm * vec3f(0.0, 0.0, 1.0), normalize(ld), dot(ld, ld) > 1e-12);`
    : `
  lp = sm * lp + ${v3(sh.position)};
  ld = normalize(sm * ld);`

  // THE DRIFT over a life, on top of the flight: velocity over lifetime (linear,
  // orbital about the system's centre, radial) and the noise module. Both work
  // in the emitter's own frame, so a particle carries its emitter's index in its
  // seed's whole part (particleStep has no id of its own).
  const nzm = s.noise ?? null
  const vm = s.velocity ?? null
  const nonZero = (c: Curve) => c.lo !== 0 || c.hi !== 0
  const linear = !!vm && vm.linear.some(nonZero)
  const orbital = !!vm && vm.orbital.some(nonZero)
  const radial = !!vm && nonZero(vm.radial)
  const noisy = !!nzm && (nzm.separate ? nzm.strength : [nzm.strength[0]]).some(nonZero) && nonZero(nzm.positionAmount)
  const drifts = linear || orbital || radial || noisy
  const driftCode = (() => {
    if (!drifts) return ""
    const out: string[] = [`
  // the drift, in the emitter's frame (its index rides in the seed's whole part)
  let e = emitter(u32(p.seed));
  let su = max(e.shapeUnit, 1e-6);`]
    if (linear && vm) {
      const [x, y, z] = vm.linear.map((c, i) => curveExpr(c, `cVel${"XYZ"[i]}`, "t", `rv.${"xyz"[i]}`, decls))
      // world space: the game's axes, x and z turned over as everything else is
      out.push(`
  // velocity over lifetime, linear: added to the flight, not kept in it
  let rv = rzHash13(p.seed * 19.7 + 0.37);
  let lv = vec3f(${x}, ${y}, ${z});
  q.pos = q.pos + ${vm.world ? `vec3f(-lv.x, lv.y, -lv.z) * ${f(world)}` : "(e.x * lv.x + e.y * lv.y + e.z * lv.z) * unit"} * dt;`)
    }
    if ((orbital || radial) && vm) {
      const [ox, oy, oz] = vm.offset.map((c, i) => curveExpr(c, `cOrbOff${"XYZ"[i]}`, "t", "ro.w", decls))
      out.push(`
  let ro = vec4f(rzHash13(p.seed * 29.3 + 0.61), fract(p.seed * 41.9 + 0.23));
  let centre = e.o + (e.x * (${ox}) + e.y * (${oy}) + e.z * (${oz})) * su;`)
      if (orbital) {
        const [x, y, z] = vm.orbital.map((c, i) => curveExpr(c, `cOrb${"XYZ"[i]}`, "t", `ro.${"xyz"[i]}`, decls))
        out.push(`
  // orbital: turned about the centre at this many radians a second, per axis
  let ow = vec3f(${x}, ${y}, ${z});
  let axis = ${vm.world ? "vec3f(-ow.x, ow.y, -ow.z)" : "e.x * ow.x + e.y * ow.y + e.z * ow.z"};
  let th = length(axis) * dt;
  if (th > 1e-9) {
    let k = axis / length(axis);
    let r = q.pos - centre;
    q.pos = centre + r * cos(th) + cross(k, r) * sin(th) + k * dot(k, r) * (1.0 - cos(th));
  }`)
      }
      if (radial) {
        const rad = curveExpr(vm.radial, "cRadial", "t", "ro.w", decls)
        out.push(`
  // radial: away from the centre
  let away = q.pos - centre;
  q.pos = q.pos + select(vec3f(0.0), normalize(away), dot(away, away) > 1e-12) * (${rad}) * unit * dt;`)
      }
    }
    if (noisy && nzm) {
      const axes = nzm.separate ? nzm.strength : [nzm.strength[0], nzm.strength[0], nzm.strength[0]]
      const [sx, sy, sz] = axes.map((c, i) => curveExpr(c, `cNoise${"XYZ"[i]}`, "t", nzm.separate ? `rn.${"xyz"[i]}` : "rn.x", decls))
      const amount = curveExpr(nzm.positionAmount, "cNoiseAmount", "t", "rn.w", decls)
      const scroll = (nzm.scroll.lo + nzm.scroll.hi) / 2
      const octaves: string[] = []
      for (let k = 0, amp = 1, fq = 1; k < Math.max(1, Math.min(nzm.octaves, 4)); k++, amp *= nzm.octaveMultiplier, fq *= nzm.octaveScale)
        octaves.push(`${k ? "nv = nv + " : "var nv = "}${amp === 1 ? "" : `${f(amp)} * `}unityNoise(np${fq === 1 ? "" : ` * ${f(fq)}`});`)
      const remap = nzm.remap
        ? (() => {
            const [rx, ry, rz] = nzm.remap.map((c, i) => curveExpr(c, `cRemap${"XYZ"[i]}`, `(nv.${"xyz"[i]} * 0.5 + 0.5)`, "0.0", decls))
            return `\n  nv = vec3f(${rx}, ${ry}, ${rz});`
          })()
        : ""
      decls.push(`// the noise module's field: a value noise per axis, -1..1
fn unityNoise(p: vec3f) -> vec3f {
  return vec3f(rzValueNoise(p), rzValueNoise(p + vec3f(31.4, 17.1, 5.3)), rzValueNoise(p + vec3f(11.7, 43.2, 23.9))) * 2.0 - 1.0;
}`)
      out.push(`
  // NOISE: the field at where the particle is in its emitter's space, times the
  // frequency${scroll ? ", scrolled" : ""}; its strength a velocity, in the emitter's units a second${nzm.damping ? `,
  // over the frequency (damping: the field scales and moves the same)` : ""}
  let rn = vec4f(rzHash13(p.seed * 23.9 + 0.13), fract(p.seed * 37.1 + 0.71));
  let rel = q.pos - e.o;
  let np = vec3f(dot(rel, e.x), dot(rel, e.y), dot(rel, e.z)) / su * ${f(nzm.frequency)}${scroll ? ` + vec3f(rzTime() * ${f(scroll)})` : ""};
  ${octaves.join("\n  ")}${remap}
  let ns = vec3f(${sx}, ${sy}, ${sz}) * (${amount})${nzm.damping ? ` / ${f(Math.max(nzm.frequency, 1e-4))}` : ""};
  q.pos = q.pos + (e.x * (nv.x * ns.x) + e.y * (nv.y * ns.y) + e.z * (nv.z * ns.z)) * su * dt;`)
    }
    return out.join("")
  })()

  const tex = (slot: number) => slot
  const layerFn = (name: string, l: ParticleLayer, slot: number, bent: boolean) => {
    const th = 2 * Math.PI * ((((l.rotation / 360) % 1) + 1) % 1)
    const c = Math.cos(th), sn = Math.sin(th)
    const nz = m.noise
    return `
fn ${name}(q: vec2f, n: f32, c1: vec4f) -> vec4f {
  // (u + t·speed.y, v + t·speed.x) — or (u, v) + the particle's Custom1 — turned
  // about 0.5, then tiled: the vertex shader's order
  ${l.custom ? `let w = q + c1.${l.custom} - vec2f(0.5);` : `let w = vec2f(q.x + rzTime() * ${f(l.speed[1])}, q.y + rzTime() * ${f(l.speed[0])}) - vec2f(0.5);`}
  var uv = vec2f(${f(c)} * w.x + ${f(sn)} * w.y, ${f(c)} * w.y - ${f(sn)} * w.x) + vec2f(0.5);
  uv = uv * vec2f(${f(l.scale[0])}, ${f(l.scale[1])}) + vec2f(${f(l.offset[0])}, ${f(l.offset[1])});
  ${bent && nz ? `uv = uv + vec2f(${f(nz.strength[0])}, ${f(nz.strength[1])}) * (vec2f(n) - uv);` : ""}
  ${l.tiling ? "" : "uv = clamp(uv, vec2f(0.0), vec2f(1.0));"}
  return rzTexture(${tex(slot)}u, vec2f(uv.x, 1.0 - uv.y));
}`
  }
  // Tong_jichu_Add's UV, from its vertex shader: slid by time · (_U, _V) or, per
  // axis, by Custom1; turned about 0.5 (u' = cos·x + sin·y, v' = cos·y − sin·x)
  // by _Ang degrees, or spinning at _Rotate_speed rad/s; then _ST.
  const tongLayerFn = (name: string, l: TongLayer, slot: number, axes: "xy" | "zw") => `
fn ${name}(q: vec2f, c1: vec4f) -> vec4f {
  let tm = rzTime();
  let off = vec2f(${l.customAxes[0] ? `c1.${axes[0]}` : `tm * ${f(l.speed[0])}`}, ${l.customAxes[1] ? `c1.${axes[1]}` : `tm * ${f(l.speed[1])}`});
  let w = q + off - vec2f(0.5);
  let ang = ${l.spin !== null ? `tm * ${f(l.spin)}` : f((l.angle * Math.PI) / 180)};
  let c = cos(ang);
  let sn = sin(ang);
  let uv = (vec2f(c * w.x + sn * w.y, c * w.y - sn * w.x) + vec2f(0.5)) * vec2f(${f(l.scale[0])}, ${f(l.scale[1])}) + vec2f(${f(l.offset[0])}, ${f(l.offset[1])});
  let t = rzTexture(${slot}u, vec2f(uv.x, 1.0 - uv.y));
  ${l.single >= 2 ? "return t.rrrr;" : l.single === 1 ? "return vec4f(1.0, 1.0, 1.0, t.a);" : "return t;"}
}`
  const nz = m.noise
  const powMix = (x: string, p: number[]) => {
    const [px, py, pz, pw] = p
    if (!pw) return px === 1 ? x : `(${x} * ${f(px)})`
    return `mix(${x} * ${f(px)}, pow(max(${x}, vec3f(0.0)), vec3f(${f(Math.max(pz, 0.01))})) * ${f(py)}, ${f(pw)})`
  }
  const kc = m.plusColorOn * m.plusStrength
  const ka = m.plusAlphaOn * m.plusStrength
  const plusCode = m.layers.plus
    ? (() => {
        const pa = m.redAlphaPlus ? "pt.r" : "pt.a"
        const prgb = `${powMix(`pt.rgb * ${pa}`, m.plusPow)} * ${v3(m.plusColor)}`
        const pA = `${pa} * ${f(m.plusColor[3] ?? 1)}`
        if (m.plusMode === 2)
          return `
  let pt = plusLayer(uv, n, c1);
  rgb = mix(rgb, ${prgb}, ${f(kc)});
  a = mix(a, ${pA}, ${f(ka)});`
        if (m.plusMode === 1)
          return `
  let pt = plusLayer(uv, n, c1);
  rgb = rgb + ${prgb} * ${f(kc)};
  a = a + ${pA} * ${f(ka)};`
        return `
  let pt = plusLayer(uv, n, c1);
  rgb = rgb * mix(vec3f(1.0), ${prgb}, ${f(kc)});
  a = a * mix(1.0, ${pA}, ${f(ka)});`
      })()
    : ""
  // Tong_jichu_Add's fragment: the picture times _Color and both alphas, times
  // the mask's luminance · alpha, then — unless _Vertex_Color says ignore it —
  // the vertex colour and its alpha twice (the second Custom1.x under
  // _Color_Alpha_X). Added whole: Blend One One.
  const tongBody = tong
    ? `  let mt = tongMain(uv, c1);
  var rgb = mt.rgb * ${v3(tong.color)} * mt.a * ${f(tong.color[3] ?? 1)};
  ${tong.layers.mask ? "let mk = tongMask(uv, c1);\n  rgb = rgb * (dot(mk.rgb, vec3f(0.3, 0.59, 0.11)) * mk.a);" : ""}
  ${tong.ignoreVertexColor ? "" : `var vc = ${startCol} * ${col};
  ${s.renderer.linear ? "vc = vec4f(pow(max(vc.rgb, vec3f(0.0)), vec3f(2.2)), vc.a);" : ""}
  rgb = rgb * vc.rgb * vc.a * ${tong.alphaFromCustom ? "c1.x" : "vc.a"};`}
  return vec4f(max(rgb, vec3f(0.0)), inside);`
    : ""
  const effectBody = `  let mt = mainLayer(uv, n, c1);
  var rgb = ${powMix("mt.rgb", m.mainPow)};
  var a = ${m.redAlphaMain ? "rgb.r" : "mt.a"};
  rgb = rgb * ${v3(m.color)};
  a = a * ${f(m.color[3] ?? 1)};
  ${plusCode}
  rgb = max(rgb, vec3f(0.0));
  // the vertex colour: start colour times colour over life${s.renderer.linear ? ", made linear as the game's renderer makes it" : ""}
  var vc = ${startCol} * ${col};
  ${s.renderer.linear ? "vc = vec4f(pow(max(vc.rgb, vec3f(0.0)), vec3f(2.2)), vc.a);" : ""}
  rgb = rgb * vc.rgb;
  a = a * vc.a;
  ${m.layers.mask ? `let mk = maskLayer(uv, n, c1);\n  a = a * (${m.redAlphaMask ? "mk.r" : "mk.a"} - ${f(m.maskStrength)});` : ""}
  a = clamp(a, 0.0, 1.0) * inside;
  ${additive ? "return vec4f(rgb, a);" : `// laid over as _DstBlend says: a·rgb added, what it covers dimmed by a·${f(cover)}
  return vec4f(rgb / ${f(cover)}, a * ${f(cover)});`}`
  // THE CARD'S PLANE (particleOrient): a Local card lies flat in its emitter's
  // own X-Y plane — its turn about Z is the corner rotation the engine already
  // applies — leaned by its start turns about X, then Y (Unity's Z, X, Y order,
  // drawn here per particle from its seed); a World card in the world's X-Y.
  // View, Facing and Velocity face the eye, the engine's own billboard.
  const align = s.renderer.alignment ?? 0
  const rx3 = s.rotation3D && s.rotationX ? curveExpr(s.rotationX, "cRotX", "0.0", "ro.x", decls) : "0.0"
  const ry3 = s.rotation3D && s.rotationY ? curveExpr(s.rotationY, "cRotY", "0.0", "ro.y", decls) : "0.0"
  const orientFn =
    align === 2
      ? `
fn particleOrient(p: Particle, id: u32) -> mat3x3f {
  let e = emitter(id);
  let ro = rzHash13(p.seed * 17.3 + 0.9);
  let ax = ${rx3};
  let ay = ${ry3};
  // Ry · Rx in the emitter's frame, then the frame itself
  let cx = cos(ax);
  let sx = sin(ax);
  let cy = cos(ay);
  let sy = sin(ay);
  let r = vec3f(cy, 0.0, -sy);
  let u = vec3f(sy * sx, cx, cy * sx);
  let n = vec3f(sy * cx, -sx, cy * cx);
  let frame = mat3x3f(e.x, e.y, e.z);
  return mat3x3f(frame * r, frame * u, frame * n);
}`
      : align === 1
        ? `
fn particleOrient(p: Particle, id: u32) -> mat3x3f {
  return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
}`
        : ""
  const uvs = s.uv
  const tilesX = uvs ? uvs.tiles[0] : 1
  const tilesY = uvs ? uvs.tiles[1] : 1
  const stretched = s.renderer.mode === 1

  return `#particles ${pool}
#points ${cls.prefix}
#textures 4
#bloom
${additive ? "#blend additive\n" : ""}
// ${cls.name}: generated from the game's particle system and its material
// (lib/unity-particles.ts). ${cls.emitters} emitters, ${perEmitter} alive on each.

fn rzTable16(a: array<f32, 16>, t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0) * 15.0;
  let i = min(u32(x), 14u);
  var b = a;
  return mix(b[i], b[i + 1u], x - f32(i));
}
fn rzGradient16(a: array<vec4f, 16>, t: f32) -> vec4f {
  let x = clamp(t, 0.0, 1.0) * 15.0;
  let i = min(u32(x), 14u);
  var b = a;
  return mix(b[i], b[i + 1u], x - f32(i));
}
${decls.join("\n")}

// The emitter's frame from its two points: origin, its axes, and how many engine
// units one of the game's units is at its size scale and at its shape scale.
struct Emitter { o: vec3f, x: vec3f, y: vec3f, z: vec3f, unit: f32, shapeUnit: f32 }
fn emitter(id: u32) -> Emitter {
  var e: Emitter;
  let n = rzPointCount() / 2u;
  if (n == 0u) { return e; }
  let k = (id % n) * 2u;
  let zp = rzPoint(k);
  let xp = rzPoint(k + 1u);
  let z = zp.tip - zp.pos;
  let x = xp.tip - xp.pos;
  e.o = zp.pos;
  e.unit = length(z);
  e.shapeUnit = length(x);
  e.z = z / max(e.unit, 1e-6);
  e.x = normalize(x - e.z * dot(x, e.z));
  e.y = cross(e.z, e.x);
  return e;
}

fn particleInit(id: u32, seed: f32) -> Particle {
  var p: Particle;
  if (rzPointCount() < 2u) { return p; }
  let e = emitter(id);
  let r0 = rzHash13(seed + f32(id) * 0.371);
  let r1 = rzHash13(seed * 1.93 + f32(id) * 0.113);
  let rb = rzHash13(seed * 3.17 + f32(id) * 0.557);
  p.seed = fract(r0.z * 7.31 + r1.z);${drifts ? "\n  p.seed = p.seed + f32(id % max(rzPointCount() / 2u, 1u));" : ""}
  let rs = rzHash13(p.seed * 5.3 + 0.21);
  ${shapeCode}
  let sm = ${shapeMatrix(sh.rotation)};${shapeTransform}
  ${sh.randomDirection > 0 ? `ld = normalize(mix(ld, normalize(rzHash13(seed * 9.1 + f32(id)) - vec3f(0.5)), ${f(sh.randomDirection)}));` : ""}
  let world = e.x * lp.x + e.y * lp.y + e.z * lp.z;
  let dir = e.x * ld.x + e.y * ld.y + e.z * ld.z;
  p.pos = e.o + world * e.shapeUnit;
  p.vel = dir * (${speed}) * e.unit;
  p.life = max(${life}, 1e-3);
  ${s.looping === false
    ? "// one shot: born when the system starts, as the game plays it (staggered, a\n  // card was born mid-life and a second one came inside its window)\n  p.age = 0.0;"
    : "// staggered on the first spawn, so a scene does not open on every particle born at once\n  p.age = select(0.0, r1.y * p.life, rzTime() < p.life);"}
  let rc = rzHash13(p.seed * 11.7 + 0.5);
  let t = 0.0;
  p.size = 0.5 * max(${sizeX} * (${solX}), ${sizeY} * (${solY})) * e.unit;
  ${s.renderer.pivot[1] ? `p.pos = p.pos + vec3f(0.0, ${f(-s.renderer.pivot[1])} * max(${sizeX}, ${sizeY}) * e.unit, 0.0);` : ""}
  // THE EMITTER'S SCALE rides in a field the engine ignores for this particle:
  // a square card's stretch (anything at or below 1 is square), a stretched
  // card's rotation (the velocity is its orientation)
  ${stretched ? `p.rot = e.unit;
  p.stretch = ${f(Math.max(s.renderer.lengthScale, 1.0001))};` : `p.rot = ${rot};
  p.stretch = -e.unit;`}
  return p;
}

${orientFn}
fn particleStep(p: Particle, dt: f32) -> Particle {
  var q = p;
  let t = clamp(p.age / max(p.life, 1e-3), 0.0, 1.0);
  let rc = rzHash13(p.seed * 11.7 + 0.5);
  let rs = rzHash13(p.seed * 5.3 + 0.21);
  let unit = ${stretched ? "p.rot" : "-p.stretch"};
  let r1 = rzHash13(p.seed * 2.9 + 0.7);
  // gravity pulls in the WORLD's units, not the emitter's: a system scaled up
  // does not fall faster (Unity's Physics.gravity times the modifier)
  q.vel.y = q.vel.y - (${grav}) * 9.81 * ${f(world)} * dt;
  ${s.clamp ? `
  // ClampVelocity: the excess over the limit is let go by dampen, frame by frame
  let lim = (${clampLim}) * unit;
  let sp = length(q.vel);
  if (sp > lim) { q.vel = q.vel * mix(1.0, lim / sp, 1.0 - pow(1.0 - ${f(s.clamp.dampen)}, dt * 60.0)); }` : ""}
  q.pos = q.pos + q.vel * dt;${driftCode}
  ${stretched ? "" : `q.rot = q.rot + (${rol}) * dt;`}
  // size over life, against the start size this particle drew
  q.size = 0.5 * max(${sizeX} * (${solX}), ${sizeY} * (${solY})) * unit;
  ${stretched ? `q.stretch = max(${f(s.renderer.lengthScale)} + ${f(s.renderer.velocityScale)} * length(q.vel) / max(2.0 * q.size, 1e-4), 1.0001);` : ""}
  return q;
}
${tong
  ? `${tongLayerFn("tongMain", tong.layers.main, 0, "xy")}
${tong.layers.mask ? tongLayerFn("tongMask", tong.layers.mask, 2, "zw") : ""}`
  : `${layerFn("mainLayer", m.layers.main ?? { scale: [1, 1], offset: [0, 0], rotation: 0, tiling: true, speed: [0, 0] }, 0, !!nz?.main)}
${m.layers.plus ? layerFn("plusLayer", m.layers.plus, 1, !!nz?.plus) : ""}
${m.layers.mask ? layerFn("maskLayer", m.layers.mask, 2, !!nz?.mask) : ""}`}

fn particleShade(p: Particle, quv: vec2f) -> vec4f {
  let t = clamp(p.age / max(p.life, 1e-3), 0.0, 1.0);
  let rc = rzHash13(p.seed * 11.7 + 0.5);
  let rs = rzHash13(p.seed * 5.3 + 0.21);
  ${stretched ? `// A STRETCHED card carries its picture's U along the stretch, as Unity lays
  // it (a streak texture points sideways): the engine's card runs V along the
  // velocity, and taken as it came the beams showed their thin cross-section
  // drawn long — flat slabs with hard ends, a fan of rectangles
  let card = vec2f(1.0 - quv.y, quv.x);` : "let card = quv;"}
  // a card wider or taller than square is drawn inside the square quad
  let wh = vec2f(${sizeX} * (${solX}), ${sizeY} * (${solY}));
  var uv = (card - vec2f(0.5)) * (max(wh.x, wh.y) / max(wh, vec2f(1e-5))) + vec2f(0.5);
  // outside the card, masked rather than returned from: the pictures must be
  // sampled in uniform control flow, which an early return breaks
  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
  ${uvs ? `
  // the flipbook: frame over life, counted from the sheet's top left
  let frames = ${f(tilesX * tilesY)};
  let fi = u32(floor(fract((${frame}) * ${f(uvs.cycles)} + (${startFrame}) / frames) * frames)) % u32(frames);
  let cell = vec2f(f32(fi % ${tilesX}u), f32(${tilesY - 1}u - fi / ${tilesX}u));
  uv = (uv + cell) / vec2f(${f(tilesX)}, ${f(tilesY)});` : ""}
  ${nz ? `
  let nuv = (uv + rzTime() * vec2f(${f(nz.speed[0])}, ${f(nz.speed[1])})) * vec2f(${f(nz.scale[0])}, ${f(nz.scale[1])}) + vec2f(${f(nz.offset[0])}, ${f(nz.offset[1])});
  let n = rzTexture(3u, vec2f(nuv.x, 1.0 - nuv.y)).r;` : "let n = 0.0;"}
  ${readsCustom ? `let rq = rzHash13(p.seed * 13.1 + 0.3);
  let c1 = vec4f(${custom1.join(", ")});` : "let c1 = vec4f(0.0);"}
${tong ? tongBody : effectBody}
}
`
}
