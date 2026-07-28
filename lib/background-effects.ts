// Curated WGSL background effects — the seed of the Backgrounds library.

export type BackgroundEffectDef = {
  id: string
  name: string
  author: string
  description: string
  /** Library rail grouping ("Sky", "Nature", "Abstract"…). */
  category: string
  tags: string[]
  wgsl: string
}

/** What a scene stores when an effect is applied */
export type AppliedBackgroundEffect = {
  id: string
  name: string
  wgsl: string
}

export const applyDefaults = (def: BackgroundEffectDef): AppliedBackgroundEffect => ({
  id: def.id,
  name: def.name,
  wgsl: def.wgsl,
})

/** A built-in effect as an applied snapshot */
export function builtinEffect(id: string): AppliedBackgroundEffect {
  const def = BACKGROUND_EFFECTS.find((e) => e.id === id)
  if (!def) throw new Error(`unknown background effect: ${id}`)
  return applyDefaults(def)
}

/** The "New effect" starter: a terse contract reference, a replace-me body up top, and a small */
export const NEW_EFFECT_TEMPLATE = `// One function = one background effect, drawn behind the model over the
// background color/image.

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  // Drifting glow — replace me.
  let n = noise2(uv * 3.0 + vec2f(time * 0.15, 0.0));
  return vec4f(0.35, 0.55, 1.0, 0.22 * n);
}

// ── Toolbox (WGSL resolves in any order — helpers can live below main) ──

// Pseudo-random vec2 in 0..1 from any 2D point.
fn hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

// Smooth value noise in 0..1 — clouds, aurora, water.
fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i).x, hash2(i + vec2f(1.0, 0.0)).x, u.x),
             mix(hash2(i + vec2f(0.0, 1.0)).x, hash2(i + vec2f(1.0, 1.0)).x, u.x), u.y);
}
`

const SHINING_STARS: BackgroundEffectDef = {
  id: "shining-stars",
  name: "Shining Stars",
  author: "Amyang",
  description: "A twinkling starfield that pans with the camera. Transparent between stars — your background color (or image) stays the sky.",
  category: "Sky",
  tags: ["night", "calm"],
  // Two star layers on a ray-projected grid
  wgsl: `// Tunables — edit a value and hit ⌘⏎ to see it live.
const TINT = vec3f(1.0, 0.96, 0.88);  // star color
const DENSITY = 0.5;                  // 0..1 — how crowded the sky is
const TWINKLE = 0.5;                  // 0..1 — flicker speed
const INTENSITY = 1.2;                // overall brightness

fn bgHash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

fn starLayer(sph: vec2f, scale: f32, thresh: f32, time: f32, speed: f32) -> f32 {
  let cell = floor(sph * scale);
  let h = bgHash2(cell);
  // Star sits at a hashed point inside its cell — kills the grid look.
  let local = fract(sph * scale) - (0.15 + 0.7 * h);
  let d = length(local);
  let bright = bgHash2(cell + 7.31).x;
  if (bright < thresh) { return 0.0; }
  // Per-star period from its own hash: some stars breathe over seconds, some blink quickly
  let period = 0.25 + 2.75 * bgHash2(cell + 31.7).y;
  let tw = 0.55 + 0.45 * sin(time * speed * period + h.x * 40.0);
  let size = (bright - thresh) / (1.0 - thresh);
  // Tight core + faint halo — a hard point of light, not a blurry blob.
  let r = 0.03 + 0.045 * size;
  let core = smoothstep(r, r * 0.25, d);
  let halo = smoothstep(r * 4.0, r, d) * 0.18;
  return (core + halo) * tw * (0.45 + 0.75 * size);
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let d = normalize(ray);
  // Latitude/longitude projection
  let sph = vec2f(atan2(d.x, d.z) * 1.2, asin(clamp(d.y, -1.0, 1.0)) * 1.5);
  // Denser = MORE stars, not smaller ones (sizes untouched)
  let dens = mix(0.95, 0.82, clamp(DENSITY, 0.0, 1.0));
  var s = starLayer(sph, 30.0, dens, time, TWINKLE * 1.6);
  // Faint dust layer: denser, smaller, slower.
  s += 0.4 * starLayer(sph + 3.7, 70.0, mix(0.985, 0.9, clamp(DENSITY, 0.0, 1.0)), time, TWINKLE * 0.9);
  let a = clamp(s * INTENSITY, 0.0, 1.0);
  // Straight alpha — the engine's over-composite premultiplies.
  return vec4f(TINT, a);
}`,
}


const FUJI_WATERCOLOR: BackgroundEffectDef = {
  id: "fuji-watercolor",
  name: "Fuji Watercolor",
  author: "noztol",
  description: "Mt. Fuji in sumi-e watercolor — red sun, inked mountain, a swaying blossom branch on textured paper. Full-scene background.",
  category: "Nature",
  tags: ["ink", "fuji", "scene"],
  // Port of "Mt. Fuji Watercolor" by noztol (Shadertoy). The ink-reveal intro is removed
  wgsl: `// "Mt. Fuji Watercolor" by noztol (Shadertoy) — WGSL port, reveal
// animation removed (final frame only, the branch still sways).
const SWAY = 0.02;
const ZOOM = 1.9;   // higher = smaller / further away
const LIFT = 0.25;  // raises the composition — a backdrop, not ground scenery
const SUN_POS = vec2f(1.05, 0.38);
const SUN_COLOR = vec3f(0.8, 0.15, 0.15);
const FLOWER_COLOR = vec3f(0.85, 0.1, 0.2);

fn fjHash(p0: vec2f) -> f32 {
  var p = fract(p0 * vec2f(123.34, 456.21));
  p += vec2f(dot(p, p + 45.32));
  return fract(p.x * p.y);
}

fn fjNoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = fjHash(i);
  let b = fjHash(i + vec2f(1.0, 0.0));
  let c = fjHash(i + vec2f(0.0, 1.0));
  let d = fjHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fjFbm(p0: vec2f) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var p = p0;
  for (var i = 0; i < 4; i++) {
    v += amp * fjNoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

// Organic calligraphy stroke from a to b: tapered radius, drooping bend.
fn brushStroke(p: vec2f, a: vec2f, b: vec2f, rStart: f32, rEnd: f32, droop: f32, rough: f32) -> f32 {
  var pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  var pBended = p;
  pBended.y += sin(h * 3.14159) * droop;
  pa = pBended - a;
  let d = length(pa - ba * h);
  let taper = smoothstep(1.0, 0.0, h);
  let r = mix(rEnd, rStart, taper);
  return d - r - rough;
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let res = bgResolution();
  var p = (uv - 0.5) * vec2f(res.x / res.y, 1.0) * ZOOM;
  p.y -= LIFT;

  // ── Paper. ──
  var col = vec3f(0.97, 0.95, 0.92);
  col -= vec3f(fjFbm(p * 15.0) * 0.04);

  // ── Red sun. ──
  let sunUV = p - SUN_POS;
  let sunDist = length(sunUV) - 0.15 + fjFbm(p * 20.0) * 0.03;
  var sunShape = smoothstep(0.01, -0.01, sunDist);
  sunShape *= fjFbm(p * 50.0) * 0.5 + 0.5;
  col = mix(col, SUN_COLOR, clamp(sunShape * 0.9, 0.0, 1.0));

  // ── Mountain: inked silhouette, ridge-lit side, snow cap. ──
  var mntUV = p;
  mntUV.x += fjFbm(p * 10.0) * 0.05;
  mntUV.y += fjFbm(p * 15.0) * 0.03;
  let fujiX = mntUV.x + 0.05;
  let mountainShape = -0.1 - pow(abs(fujiX), 0.8) * 0.6;
  let mountainMask = smoothstep(0.0, 0.02, mountainShape - mntUV.y);
  let outlineDist = abs(mountainShape - mntUV.y);
  let mntOutline = smoothstep(0.01, 0.002, outlineDist) * smoothstep(0.0, 0.05, mntUV.y + 0.15);
  let ridgeTexture = fjFbm(vec2f(mntUV.x * 25.0, mntUV.y * 5.0));
  let lightSide = smoothstep(-0.15, 0.25, fujiX + ridgeTexture * 0.1);
  var baseMnt = mix(vec3f(0.04, 0.04, 0.05), vec3f(0.6, 0.6, 0.65), lightSide);
  baseMnt *= 0.6 + 0.4 * fjFbm(p * 40.0);
  let snowLine = -0.22 + abs(fujiX) * 0.5 + fjFbm(p * 30.0) * 0.04;
  let snowCap = smoothstep(snowLine - 0.01, snowLine + 0.01, mntUV.y);
  var mountainColor = mix(baseMnt, vec3f(0.98, 0.99, 1.0), snowCap);
  mountainColor = mix(mountainColor, vec3f(0.02), mntOutline);
  col = mix(col, mountainColor, mountainMask);

  // ── Blossom branch, gently swaying. ──
  var bUV = p;
  bUV.x += 0.32; // sampling shift → the branch hangs further LEFT on screen
  bUV.x += sin(time * 1.5 + p.y * 3.0) * SWAY;
  bUV.y += cos(time * 1.2 + p.x * 2.0) * SWAY;

  let n0 = vec2f(-1.0, -0.2);
  let n1 = vec2f(-0.6, 0.0);
  let n2 = vec2f(-0.2, 0.1);
  let t1 = vec2f(0.2, 0.15);
  let t2 = vec2f(-0.2, -0.15);
  let t3 = vec2f(-0.0, 0.3);
  let t4 = vec2f(-0.6, -0.25);
  let t5 = vec2f(-0.1, -0.0);

  var bd = 10.0;
  let rough = fjFbm(bUV * 60.0) * 0.005; // shared stroke-edge roughness (see brushStroke)
  bd = min(bd, brushStroke(bUV, n0, n1, 0.020, 0.015, 0.03, rough));
  bd = min(bd, brushStroke(bUV, n1, n2, 0.015, 0.010, 0.03, rough));
  bd = min(bd, brushStroke(bUV, n2, t1, 0.010, 0.003, 0.02, rough));
  let s1Mid = vec2f(-0.4, -0.05);
  bd = min(bd, brushStroke(bUV, n1, s1Mid, 0.00, 0.006, -0.02, rough));
  bd = min(bd, brushStroke(bUV, s1Mid, t2, 0.006, 0.002, 0.01, rough));
  bd = min(bd, brushStroke(bUV, n2, t3, 0.01, 0.009, -0.02, rough));
  let s3Start = mix(n0, n1, 0.2);
  bd = min(bd, brushStroke(bUV, s3Start, t4, 0.008, 0.002, 0.01, rough));
  let s4Start = mix(n1, n2, 0.9);
  bd = min(bd, brushStroke(bUV, s4Start, t5, 0.006, 0.002, 0.01, rough));
  let branchMask = smoothstep(0.004, -0.002, bd);
  col = mix(col, vec3f(0.04, 0.03, 0.03), branchMask);

  // ── Blossoms: textured splotch clusters at every branch tip. ──
  var flowerMask = 0.0;
  // One shared petal grain for all 15 splotches (was 15 fbm calls)
  let petalGrain = fjFbm(bUV * 70.0) * 0.02;
  var targets = array<vec2f, 5>(t1, t2, t3, t4, t5);
  for (var i = 0; i < 5; i++) {
    let center = targets[i];
    for (var j = 0; j < 3; j++) {
      let fi = f32(i);
      let fj = f32(j);
      let offset = vec2f(fjNoise(vec2f(fi, fj * 10.0)) - 0.5, fjNoise(vec2f(fi, fj * 20.0)) - 0.5) * 0.03;
      let fpos = center + offset;
      let r = 0.012 + (fjHash(vec2f(fi, fj)) - 0.5) * 0.005;
      let fdist = length(bUV - fpos) - r - petalGrain;
      flowerMask = max(flowerMask, smoothstep(0.008, -0.005, fdist));
    }
  }
  col = mix(col, FLOWER_COLOR, flowerMask);

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}`,
}

const QUIET_RAIN: BackgroundEffectDef = {
  id: "quiet-rain",
  name: "Quiet Rain",
  author: "Amyang",
  description: "Thin rain streaks in two depth layers with a slight slant. Low-alpha and cool — mood, not weather simulation.",
  category: "Nature",
  tags: ["rain", "mood", "overlay"],
  // Column-hashed streaks: every column gets its own speed/phase, a skew makes the fall read
  wgsl: `// Tunables — edit and ⌘⏎.
const RAIN_COLOR = vec3f(0.75, 0.85, 1.0);
const SPEED = 2.3;
const SLANT = 0.12;     // sideways drift
const AMOUNT = 0.55;    // 0..1 — fraction of columns raining

fn rnHash(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

fn rainLayer(p0: vec2f, time: f32, scale: f32, speed: f32) -> f32 {
  var p = p0;
  p.x += p.y * SLANT; // wind skew
  let q = vec2f(p.x * scale, p.y * scale * 0.14);
  let col = floor(q.x);
  let h = rnHash(col);
  if (h > AMOUNT) { return 0.0; }
  // Repeating fall coordinate, re-hashed EVERY cycle
  let fall = q.y + time * speed * (0.6 + 0.7 * h) + h * 9.0;
  let cyc = rnHash(col * 3.1 + floor(fall) * 7.7);
  let y = fract(fall);
  let len = 0.18 + 0.3 * cyc;
  let drop = smoothstep(len, 0.0, y) * smoothstep(0.0, 0.05, y);
  let cx = abs(fract(q.x) - 0.5 + (cyc - 0.5) * 0.3);
  return drop * smoothstep(0.09, 0.02, cx) * (0.35 + 0.65 * cyc);
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let res = bgResolution();
  let p = vec2f(uv.x * res.x / res.y, uv.y);
  var a = 0.2 * rainLayer(p, time, 90.0, SPEED * 0.8);
  a += 0.32 * rainLayer(p + 2.3, time, 55.0, SPEED);
  return vec4f(RAIN_COLOR, clamp(a, 0.0, 1.0));
}`,
}

const REZE_NEON: BackgroundEffectDef = {
  id: "reze-neon",
  name: "REZE DESIGN",
  author: "Amyang",
  description: "A flickering neon sign spelling REZE DESIGN — glyphs are plain line segments with an exponential glow. Transparent around the tubes.",
  category: "Abstract",
  tags: ["neon", "text", "overlay"],
  // Entry-level SDF text: every glyph is a handful of straight segments (baked below)
  wgsl: `// Tunables — edit and ⌘⏎.
const NEON_COLOR = vec3f(0.96, 0.45, 0.71);  // tube color (brand pink)
const NEON_COLOR_B = vec3f(0.45, 0.65, 0.98); // second hue the shimmer travels to
const GLOW = 0.8;                            // halo strength
const FLICKER = 0.1;                         // 0 = steady sign
const TEXT_SCALE = 0.075;                    // sign size on screen
const POS_Y = 0.24;                          // height above center

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// "REZE DESIGN" as 40 pre-baked segments (glyph boxes 0..0.9 × 0..1, advance 1.2, word gap
fn sdText(p: vec2f) -> f32 {
  // Coarse reject: pixels far from the sign's bounding box skip the letters entirely (the halo
  let toBox = vec2f(max(abs(p.x - 6.20) - 6.20, 0.0), max(abs(p.y - 0.5) - 0.5, 0.0));
  let boxD = length(toBox);
  if (boxD > 1.0) { return boxD; }
  var d = 1e5;
  d = min(d, sdSegment(p, vec2f(0.0, 0), vec2f(0.0, 1)));
  d = min(d, sdSegment(p, vec2f(0.0, 1), vec2f(0.8, 1)));
  d = min(d, sdSegment(p, vec2f(0.8, 1), vec2f(0.8, 0.5)));
  d = min(d, sdSegment(p, vec2f(0.8, 0.5), vec2f(0.0, 0.5)));
  d = min(d, sdSegment(p, vec2f(0.4, 0.5), vec2f(0.9, 0)));
  d = min(d, sdSegment(p, vec2f(1.2, 0), vec2f(1.2, 1)));
  d = min(d, sdSegment(p, vec2f(1.2, 1), vec2f(2.1, 1)));
  d = min(d, sdSegment(p, vec2f(1.2, 0.5), vec2f(1.9, 0.5)));
  d = min(d, sdSegment(p, vec2f(1.2, 0), vec2f(2.1, 0)));
  d = min(d, sdSegment(p, vec2f(2.4, 1), vec2f(3.3, 1)));
  d = min(d, sdSegment(p, vec2f(3.3, 1), vec2f(2.4, 0)));
  d = min(d, sdSegment(p, vec2f(2.4, 0), vec2f(3.3, 0)));
  d = min(d, sdSegment(p, vec2f(3.6, 0), vec2f(3.6, 1)));
  d = min(d, sdSegment(p, vec2f(3.6, 1), vec2f(4.5, 1)));
  d = min(d, sdSegment(p, vec2f(3.6, 0.5), vec2f(4.3, 0.5)));
  d = min(d, sdSegment(p, vec2f(3.6, 0), vec2f(4.5, 0)));
  d = min(d, sdSegment(p, vec2f(5.5, 0), vec2f(5.5, 1)));
  d = min(d, sdSegment(p, vec2f(5.5, 1), vec2f(6.15, 1)));
  d = min(d, sdSegment(p, vec2f(6.15, 1), vec2f(6.4, 0.75)));
  d = min(d, sdSegment(p, vec2f(6.4, 0.75), vec2f(6.4, 0.25)));
  d = min(d, sdSegment(p, vec2f(6.4, 0.25), vec2f(6.15, 0)));
  d = min(d, sdSegment(p, vec2f(6.15, 0), vec2f(5.5, 0)));
  d = min(d, sdSegment(p, vec2f(6.7, 0), vec2f(6.7, 1)));
  d = min(d, sdSegment(p, vec2f(6.7, 1), vec2f(7.6, 1)));
  d = min(d, sdSegment(p, vec2f(6.7, 0.5), vec2f(7.4, 0.5)));
  d = min(d, sdSegment(p, vec2f(6.7, 0), vec2f(7.6, 0)));
  d = min(d, sdSegment(p, vec2f(8.8, 1), vec2f(7.9, 1)));
  d = min(d, sdSegment(p, vec2f(7.9, 1), vec2f(7.9, 0.5)));
  d = min(d, sdSegment(p, vec2f(7.9, 0.5), vec2f(8.8, 0.5)));
  d = min(d, sdSegment(p, vec2f(8.8, 0.5), vec2f(8.8, 0)));
  d = min(d, sdSegment(p, vec2f(8.8, 0), vec2f(7.9, 0)));
  d = min(d, sdSegment(p, vec2f(9.55, 0), vec2f(9.55, 1)));
  d = min(d, sdSegment(p, vec2f(11.2, 1), vec2f(10.3, 1)));
  d = min(d, sdSegment(p, vec2f(10.3, 1), vec2f(10.3, 0)));
  d = min(d, sdSegment(p, vec2f(10.3, 0), vec2f(11.2, 0)));
  d = min(d, sdSegment(p, vec2f(11.2, 0), vec2f(11.2, 0.45)));
  d = min(d, sdSegment(p, vec2f(11.2, 0.45), vec2f(10.8, 0.45)));
  d = min(d, sdSegment(p, vec2f(11.5, 0), vec2f(11.5, 1)));
  d = min(d, sdSegment(p, vec2f(11.5, 1), vec2f(12.4, 0)));
  d = min(d, sdSegment(p, vec2f(12.4, 0), vec2f(12.4, 1)));
  return d;
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let res = bgResolution();
  var p = (uv - 0.5) * vec2f(res.x / res.y, 1.0);
  p.y -= POS_Y;
  // The sign breathes and sways — quiet motion that says "live shader", not GIF.
  let wobble = 0.05 * sin(time * 0.9);
  let breathe = 1.0 + 0.05 * sin(time * 1.7);
  let c = cos(wobble);
  let si = sin(wobble);
  p = mat2x2f(c, -si, si, c) * p;
  // Screen space → text space (centered).
  let tp = p / (TEXT_SCALE * breathe) + vec2f(12.4 * 0.5, 0.5);
  let d = sdText(vec2f(tp.x, tp.y));

  // Neon = crisp tube + inner hot line + tight halo.
  let aa = fwidth(d) * 1.5;
  let tube = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, d);
  let hot = 1.0 - smoothstep(0.02 - aa, 0.02 + aa, d);
  let core = tube * 0.75 + hot * 0.45;
  let halo = exp(-d * 5.0) * GLOW;
  // Gentle electrical shimmer (two incommensurate frequencies, shallow depth).
  let flicker = 1.0 - FLICKER * (0.5 + 0.5 * sin(time * 7.3) * sin(time * 3.1));
  let s = (core + halo) * flicker;

  // A hue gradient travels along the sign — the "this is a shader" tell.
  let hue = mix(NEON_COLOR, NEON_COLOR_B, 0.5 + 0.5 * sin(time * 1.1 + tp.x * 0.45));
  let color = hue + vec3f(0.35) * core; // core burns toward white
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), clamp(s, 0.0, 1.0));
}`,
}

const ORBITING_HEARTS: BackgroundEffectDef = {
  id: "orbiting-hearts",
  name: "Orbiting Hearts",
  author: "Amyang",
  description: "Heart outlines drifting around the center. Transparent between the lines — a worked example of a decoration layer over your background color.",
  category: "Abstract",
  tags: ["cute", "overlay"],
  // Adapted from a Shadertoy distance-field study (heart curve via IQ / Dave_Hoskins)
  wgsl: `// Adapted from a Shadertoy heart-outline study — heart curve by
// Inigo Quilez, improved by Dave_Hoskins; audio-reactive pulse → sine.
const OPACITY = 0.9;
const PULSE_SPEED = 1.8;
const PI = 3.14159265;

// heart(p) = 0 traces a heart-shaped curve (x² + (1.2y − √|x|)² − 1).
fn heartCurve(p0: vec2f) -> f32 {
  var p = p0;
  p.y += 0.6;
  let k = 1.2 * p.y - sqrt(abs(p.x) + 0.3);
  return p.x * p.x + k * k - 1.0;
}

// Central-difference gradient — turns the curve value into a screen distance.
fn heartGrad(p: vec2f) -> vec2f {
  let h = vec2f(0.01, 0.0);
  return vec2f(heartCurve(p + h.xy) - heartCurve(p - h.xy),
               heartCurve(p + h.yx) - heartCurve(p - h.yx)) / (2.0 * h.x);
}

// 1 on the outline, 0 elsewhere; line width scales with the pulse.
fn heartLine(p: vec2f, pulse: f32) -> f32 {
  let de = abs(heartCurve(p)) / length(heartGrad(p));
  let eps = (15.0 + pulse * 3.0) / bgResolution().x;
  return 1.0 - smoothstep(eps, 2.0 * eps, de);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let q = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(vec3f(1.0), clamp(q - vec3f(1.0), vec3f(0.0), vec3f(1.0)), c.y);
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let res = bgResolution();
  let p = (uv - 0.5) * vec2f(1.0, res.y / res.x);
  let pulse = 0.35 + 0.25 * sin(time * PULSE_SPEED);

  var col = vec3f(0.0);
  var a = 0.0;
  for (var i = 0; i < 7; i++) {
    var hue: vec3f;
    var ang: f32;
    var offset: vec2f;
    var scale = 0.7;
    if (i == 0) {
      hue = vec3f(1.0, 0.3, 0.3);
      ang = -time * 0.3;
      offset = vec2f(cos(ang), sin(ang)) * 0.03;
    } else if (i == 1) {
      hue = vec3f(0.6, 0.6, 1.0);
      ang = PI - time * 0.3;
      offset = vec2f(cos(ang), sin(ang)) * 0.03;
    } else {
      hue = hsv2rgb(vec3f(f32(i) / 5.0 + time * 0.2, 0.4, 0.9));
      ang = PI * f32(i - 2) * (2.0 / 5.0) + time * 0.3;
      offset = vec2f(cos(ang), sin(ang)) * 0.2;
      scale = 0.3 + f32(i) * 0.05;
    }
    let q = (p + offset) / (scale * (1.0 + pulse * 0.3) * 0.8);
    let line = heartLine(q * 10.0, pulse);
    col += line * hue;
    a = max(a, line);
  }
  // Straight alpha: only the lines cover the background behind this layer.
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), a * OPACITY);
}`,
}

export const BACKGROUND_EFFECTS: BackgroundEffectDef[] = [SHINING_STARS, FUJI_WATERCOLOR, QUIET_RAIN, REZE_NEON, ORBITING_HEARTS]
