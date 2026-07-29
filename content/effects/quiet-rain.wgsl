// Tunables — edit and ⌘⏎.
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
}
