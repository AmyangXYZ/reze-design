// Adapted from a Shadertoy heart-outline study — heart curve by
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
}
