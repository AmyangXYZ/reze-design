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
// and the depth fade against the scene (a particle has no depth to read).

export type Curve = { mode?: number; lo: number; hi: number; curve?: number[]; curveLo?: number[] }
export type Colour = { mode: number; lo?: number[]; hi?: number[]; gradient?: number[][]; gradientLo?: number[][] }
export type ParticleSpec = {
  max: number
  scalingMode: number
  lifetime: Curve
  speed: Curve
  size3D: boolean
  size: [Curve, Curve, Curve]
  rotation: Curve
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
  renderer: { mode: number; pivot: [number, number, number]; lengthScale: number; velocityScale: number; linear: boolean }
  /** The CustomData module's vectors, "<stream>_<component>": stream 0 is
   *  Custom1, which the renderer hands the shader as TEXCOORD1. */
  custom?: Record<string, Curve> | null
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
export type ParticleClass = {
  name: string
  prefix: string
  emitters: number
  /** One of the game's units in the stage's metres. */
  metresPerUnit?: number
  spec: ParticleSpec
  material: ParticleMaterial
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
  const { spec: s, material: m } = cls
  const decls: string[] = []
  // how many of the pool each emitter keeps alive: its rate over a mean life plus
  // its bursts, capped where the game caps it
  const meanLife = (s.lifetime.lo + s.lifetime.hi) / 2
  const burst = s.emission.bursts.reduce((n, b) => n + b.count * Math.max(1, b.cycles), 0)
  const perEmitter = Math.max(1, Math.min(s.max, Math.round((s.emission.on ? s.emission.rate.hi * meanLife + burst : 1) || 1)))
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
  const col = colourExpr(s.colorOverLife, "cCol", "t", "rc.w", decls)
  const clampLim = s.clamp ? curveExpr(s.clamp.limit, "cClamp", "t", "rc.y", decls) : "0.0"
  const frame = s.uv ? curveExpr(s.uv.frame, "cFrame", "t", "rc.z", decls) : "0.0"
  // Custom1, per particle over its life
  const custom1 = [0, 1, 2, 3].map((i) => (s.custom?.[`0_${i}`] ? curveExpr(s.custom[`0_${i}`], `cCustom${i}`, "t", "rq.x", decls) : "0.0"))
  const readsCustom = Object.values(m.layers).some((l) => l?.custom)
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
  p.seed = fract(r0.z * 7.31 + r1.z);
  let rs = rzHash13(p.seed * 5.3 + 0.21);
  ${shapeCode}
  let sm = ${shapeMatrix(sh.rotation)};
  lp = sm * lp + ${v3(sh.position)};
  ld = normalize(sm * ld);
  ${sh.randomDirection > 0 ? `ld = normalize(mix(ld, normalize(rzHash13(seed * 9.1 + f32(id)) - vec3f(0.5)), ${f(sh.randomDirection)}));` : ""}
  let world = e.x * lp.x + e.y * lp.y + e.z * lp.z;
  let dir = e.x * ld.x + e.y * ld.y + e.z * ld.z;
  p.pos = e.o + world * e.shapeUnit;
  p.vel = dir * (${speed}) * e.unit;
  p.life = max(${life}, 1e-3);
  // staggered on the first spawn, so a scene does not open on every particle born at once
  p.age = select(0.0, r1.y * p.life, rzTime() < p.life);
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
  q.pos = q.pos + q.vel * dt;
  ${stretched ? "" : `q.rot = q.rot + (${rol}) * dt;`}
  // size over life, against the start size this particle drew
  q.size = 0.5 * max(${sizeX} * (${solX}), ${sizeY} * (${solY})) * unit;
  ${stretched ? `q.stretch = max(${f(s.renderer.lengthScale)} + ${f(s.renderer.velocityScale)} * length(q.vel) / max(2.0 * q.size, 1e-4), 1.0001);` : ""}
  return q;
}
${layerFn("mainLayer", m.layers.main ?? { scale: [1, 1], offset: [0, 0], rotation: 0, tiling: true, speed: [0, 0] }, 0, !!nz?.main)}
${m.layers.plus ? layerFn("plusLayer", m.layers.plus, 1, !!nz?.plus) : ""}
${m.layers.mask ? layerFn("maskLayer", m.layers.mask, 2, !!nz?.mask) : ""}

fn particleShade(p: Particle, quv: vec2f) -> vec4f {
  let t = clamp(p.age / max(p.life, 1e-3), 0.0, 1.0);
  let rc = rzHash13(p.seed * 11.7 + 0.5);
  let rs = rzHash13(p.seed * 5.3 + 0.21);
  // a card wider or taller than square is drawn inside the square quad
  let wh = vec2f(${sizeX} * (${solX}), ${sizeY} * (${solY}));
  var uv = (quv - vec2f(0.5)) * (max(wh.x, wh.y) / max(wh, vec2f(1e-5))) + vec2f(0.5);
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
  let mt = mainLayer(uv, n, c1);
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
  return vec4f(rgb / ${f(cover)}, a * ${f(cover)});`}
}
`
}
