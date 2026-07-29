// One function = one background effect, drawn behind the model over the
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
