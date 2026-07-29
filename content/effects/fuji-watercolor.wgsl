// "Mt. Fuji Watercolor" by noztol (Shadertoy) — WGSL port, reveal
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
}
