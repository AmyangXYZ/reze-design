/// <reference types="@webgpu/types" />
"use client"

// LIVE effect previews: each card/inspector canvas runs the effect's REAL WGSL
//
// The engine mounts an effect by which entry points its code defines, and so does
// this — a foreground-only effect has no `background` to call, and wrapping every
// effect as though it did is a shader that will not compile and a card that stays
// blank. It also has to hand a foreground the things the engine does: a depth, a
// camera, and a world position built from them. So the preview carries a stand-in
// scene — a ground plane under a horizon — which is the least that makes fog and
// rain legible, since both are defined by what they sit in front of.

import { memo, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** Same detection the engine does at install time — `fn` and the name. */
const definesBackground = (wgsl: string) => /\bfn\s+background\s*\(/.test(wgsl)
const definesForeground = (wgsl: string) => /\bfn\s+foreground\s*\(/.test(wgsl)

// Same contract the engine's composite gives user code, over a stand-in scene.
const PREVIEW_HEAD = /* wgsl */ `
struct U { time: f32, _pad: f32, res: vec2f }
@group(0) @binding(0) var<uniform> u: U;
fn bgResolution() -> vec2f { return u.res; }

// The stand-in camera: about where a character is framed, at roughly the scale
// scenes use (a cast member is ~20 units tall and sits ~25 out), so distances
// written against a real scene read the same here.
const PV_CAM = vec3f(0.0, 8.0, -26.0);
fn bgCameraPos() -> vec3f { return PV_CAM; }
/**
 * FIXED. It used to yaw slowly, on the argument that a drifting view shows an
 * effect is anchored in the WORLD rather than painted on the frame.
 *
 * What it actually did, once the cards had a stand-in body to draw against, was
 * slide that body across the card — and a card is two centimetres across, so a
 * figure crossing it reads as the SUBJECT walking rather than as the camera
 * turning. The thing a card has to show is the effect; a moving stage says
 * something the effect never said.
 */
fn pvForward() -> vec3f { return vec3f(0.0, 0.0, 1.0); }
fn bgWorldPos(ray: vec3f, depth: f32) -> vec3f {
  let axis = max(dot(normalize(ray), pvForward()), 1e-4);
  return bgCameraPos() + normalize(ray) * (depth / axis);
}
fn rzResolution() -> vec2f { return u.res; }
fn rzCameraPos() -> vec3f { return PV_CAM; }
fn rzCamPos() -> vec3f { return PV_CAM; }
fn rzWorldPos(ray: vec3f, depth: f32) -> vec3f { return bgWorldPos(ray, depth); }
fn rzCameraForward() -> vec3f { return pvForward(); }
fn rzCameraRight() -> vec3f { let f = pvForward(); return vec3f(f.z, 0.0, -f.x); }
fn rzCameraUp() -> vec3f { return vec3f(0.0, 1.0, 0.0); }

// The exact inverse of the ray this preview builds per pixel, the same way the
// engine's rzProject inverts its own — so an effect that projects a world point
// and measures against it in 2D lands where it does in a real scene.
fn rzProject(p: vec3f) -> vec3f {
  let fwd = pvForward();
  let d = p - PV_CAM;
  let z = dot(d, fwd);
  let inv = 1.0 / select(z, 1e-4, z < 1e-4);
  let right = vec3f(fwd.z, 0.0, -fwd.x);
  let ndc = vec2f(dot(d, right) * inv / 0.9, d.y * inv / 0.55);
  return vec3f(ndc * 0.5 + 0.5, z);
}

// ── A stand-in CAST ──
//
// Effects that read the cast are the majority now, and every one of them failed
// to compile here — a missing rzSubject is a shader error, and a shader error is
// a blank card with nothing to say why. A stand-in scene needs a stand-in cast
// for the same reason it needs a floor: fog is invisible without something to
// sit in front of, and an aura is invisible without somebody to sit around.
//
// One figure, roughly the size and place a real cast member is framed at.
struct RzSubject {
  root: vec3f,
  center: vec3f,
  bounds: vec4f,
  /** How much of this character is still there. Cycled on the card rather than
   *  held at 1: an effect that draws what LEAVES a dissolving body has nothing
   *  to draw against a subject who never goes. */
  dissolve: f32,
  valid: bool,
}
struct RzAnchor {
  pos: vec3f,
  vel: vec3f,
  fwd: vec3f,
  valid: bool,
}
const PV_HIP = 10.0;
fn rzSubjectCount() -> i32 { return 1; }
fn bgSubjectCount() -> i32 { return 1; }
fn rzSubject(i: i32) -> RzSubject {
  var s: RzSubject;
  s.valid = i == 0;
  if (!s.valid) { return s; }
  s.root = vec3f(0.0, 0.0, 0.0);
  s.center = vec3f(0.0, PV_HIP, 0.0);
  s.bounds = vec4f(0.0, PV_HIP, 0.0, 14.0);
  // One teleport every eight seconds — the cycle the built-in Teleportation
  // declares, and the same four moments the engine samples from it.
  // The built-in Teleportation's own cycle: 3.0 whole, 0.5 apart, 0.65 gone,
  // 0.35 back. The same four durations the @dissolve directive takes, so a
  // change there is a change of the same four numbers here.
  let c = fract(u.time / 4.5) * 4.5;
  var d = 1.0;
  if (c >= 3.0 && c < 3.5) { d = 1.0 - (c - 3.0) / 0.5; }
  else if (c >= 3.5 && c < 4.15) { d = 0.0; }
  else if (c >= 4.15) { d = (c - 4.15) / 0.35; }
  s.dissolve = clamp(d, 0.0, 1.0);
  return s;
}
fn rzSubjectHip(i: i32) -> vec3f { return rzSubject(i).center; }
fn bgSubjectPos(i: i32) -> vec3f { return rzSubject(i).center; }

// Eight anchors spiralling up a body-sized column, swaying gently.
//
// The preview cannot know WHICH bone a slot asked for — that is the effect's
// own declaration order, and it is different in every file. What it can do is
// make every slot land somewhere plausible on a body, so an effect that rings
// limbs or burns off them has limb-shaped geometry to work with and the card
// shows its real character rather than nothing.
fn rzAnchor(subject: i32, slot: i32) -> RzAnchor {
  var a: RzAnchor;
  a.valid = subject == 0 && slot >= 0 && slot < 8;
  if (!a.valid) { return a; }
  let t = f32(slot) / 7.0;
  let sway = sin(u.time * 0.8 + t * 5.0) * 1.4;
  a.pos = vec3f(sin(t * 6.2) * 3.5 + sway, 2.5 + t * 15.0, cos(t * 6.2) * 1.5);
  a.vel = vec3f(cos(u.time * 0.8 + t * 5.0) * 1.1, 0.0, 0.0);
  a.fwd = vec3f(0.0, 0.0, -1.0);
  return a;
}

// And a stand-in PATH for each: a step cycle, so an effect looking for the
// moment a foot stopped descending finds real touchdowns rather than a
// straight line, and a ribbon has something curved to run along.
fn rzTrailCount(subject: i32, slot: i32) -> i32 {
  if (subject != 0 || slot < 0 || slot >= 8) { return 0; }
  return 48;
}
fn rzTrail(subject: i32, slot: i32, i: i32) -> vec4f {
  let n = rzTrailCount(subject, slot);
  if (i < 0 || i >= n) { return vec4f(0.0); }
  let age = f32(i) * (1.0 / 24.0);
  let ph = (u.time - age) * 1.7 + select(0.0, 3.14159, (slot % 2) == 1);
  let side = select(-2.6, 2.6, (slot % 2) == 1);
  return vec4f(side, max(0.0, sin(ph)) * 3.5, sin(ph * 0.5) * 7.0, age);
}

// ── A stand-in BODY, and the ids that name it ──
//
// The id attachment is how an effect masks itself to one character —
// rzObjectAt says which object drew a pixel — and a card that does not define
// it is a shader error, which is a blank card with nothing said anywhere. The
// stand-in cast above gives an effect somewhere to BE; this gives it something
// to COVER.
//
// A capsule in screen space, which is what a body's silhouette is: the figure
// the cast describes, projected, so an effect masking by id eats a shape the
// size and place of a real one.
const PV_ID: u32 = 7u;
fn pvBodyMask(uv: vec2f) -> f32 {
  let asp = u.res.x / max(u.res.y, 1.0);
  let foot = rzProject(vec3f(0.0, 1.5, 0.0));
  let head = rzProject(vec3f(0.0, 17.5, 0.0));
  // The radius measured where it is drawn, in uv.x, then carried into the
  // aspect-corrected space below with everything else.
  let r = abs(rzProject(vec3f(3.4, 9.0, 0.0)).x - rzProject(vec3f(0.0, 9.0, 0.0)).x) * asp;
  let p = vec2f(uv.x * asp, uv.y);
  let a = vec2f(foot.x * asp, foot.y);
  let b = vec2f(head.x * asp, head.y);
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return select(0.0, 1.0, length(pa - ba * h) < max(r, 1e-4));
}
/** Which model this is — what rzObjectAt is compared against. */
fn rzSubjectId(i: i32) -> u32 { return select(0u, PV_ID, i == 0); }
/** TOP-LEFT uv, exactly as the engine's takes it: it indexes the attachment
 *  with textureLoad, whose origin is the top-left texel, while every uv the
 *  effect API hands out has its origin bottom-left. An effect turns y over for
 *  the real one, so it must turn it over here — otherwise the card would show a
 *  mask the scene does not. */
fn rzObjectAt(uvTop: vec2f) -> u32 {
  return select(0u, PV_ID, pvBodyMask(vec2f(uvTop.x, 1.0 - uvTop.y)) > 0.5);
}
/** One material on that body — enough for an effect that masks by material to
 *  compile and to see a shape, which is what a card is for. */
fn rzMaterialAt(uvTop: vec2f) -> u32 { return select(0u, 1u, rzObjectAt(uvTop) != 0u); }

// ── Stand-in AUDIO ──
//
// A plain pulse with a bass-heavy spectrum. The real analysis is a whole song
// precomputed; a card two centimetres across only has to show that the effect
// moves with one.
fn rzAudioFrames() -> i32 { return 3600; }
fn rzAudioBandCount() -> i32 { return 32; }
fn rzAudioPlaying() -> f32 { return 1.0; }
fn rzAudioTime() -> f32 { return u.time; }
fn rzAudioLevelAt(o: f32) -> f32 { return 0.35 + 0.35 * sin((u.time + o) * 3.1); }
fn rzAudioLevel() -> f32 { return rzAudioLevelAt(0.0); }
fn rzAudioOnsetAt(o: f32) -> f32 { return pow(max(0.0, sin((u.time + o) * 6.2831853 * 2.0)), 8.0); }
fn rzAudioOnset() -> f32 { return rzAudioOnsetAt(0.0); }
fn rzAudioBandAt(i: i32, o: f32) -> f32 {
  let f = f32(i) / max(f32(rzAudioBandCount()), 1.0);
  return clamp((1.0 - f * 0.75) * (0.35 + 0.65 * abs(sin((u.time + o) * 2.0 + f * 9.0))), 0.0, 1.0);
}
fn rzAudioBand(i: i32) -> f32 { return rzAudioBandAt(i, 0.0); }

// The light struct, declared exactly as the engine declares it in every module
// it splices user code into.
//
// The preview never CALLS lightEmit — a card has no scene to light — but an
// effect that defines one still has to compile, and a missing struct is a
// shader error, which renders as a blank card with nothing said anywhere. That
// is precisely how Summoning Circle and Stage Lights came to preview as
// nothing: both draw a perfectly good foreground, and both were rejected for a
// type the wrapper had never heard of.
struct RzLight {
  pos: vec3f,
  color: vec3f,
  intensity: f32,
  radius: f32,
}

// The MIDI interface, over a stand-in score.
//
// Stubbed for the same reason the cast is: an effect that reads notes cannot
// COMPILE without these, and a shader error is a blank card rather than a
// visible failure — which is exactly how Note Fall came to preview as nothing
// at all. The notes are synthetic and deliberately regular: a scale walking up
// the keyboard, one per beat, so a falling-note effect has something moving to
// draw without a file behind it.
const PV_NOTES: i32 = 48;
const PV_BEAT: f32 = 0.5;
fn rzNoteCount() -> i32 { return PV_NOTES; }
fn rzMidiTime() -> f32 { return u.time; }
fn rzMidiPlaying() -> f32 { return 1.0; }
fn rzMidiDuration() -> f32 { return f32(PV_NOTES) * PV_BEAT; }
fn rzPitchLow() -> f32 { return 48.0; }
fn rzPitchHigh() -> f32 { return 84.0; }
fn rzNoteStart(i: i32) -> f32 { return f32(i) * PV_BEAT; }
fn rzNoteLength(i: i32) -> f32 { return PV_BEAT * 0.8; }
fn rzNotePitch(i: i32) -> f32 { return 48.0 + f32(i % 36); }
fn rzNoteVelocity(i: i32) -> f32 { return 0.55 + 0.35 * abs(sin(f32(i) * 1.7)); }
fn rzNoteAge(i: i32) -> f32 { return u.time - rzNoteStart(i); }
fn rzNoteHeld(i: i32) -> f32 {
  let age = rzNoteAge(i);
  return select(0.0, 1.0, age >= 0.0 && age < rzNoteLength(i));
}
fn rzKeyEnergy(pitch: f32) -> f32 {
  // Whichever note is sounding now, decaying after it — the same shape the
  // engine's per-pitch map has, without needing the map.
  let i = i32(floor(u.time / PV_BEAT));
  let hit = abs(pitch - rzNotePitch(i));
  return select(0.0, max(0.0, 1.0 - fract(u.time / PV_BEAT)), hit < 0.5);
}
fn rzPitchX(pitch: f32) -> f32 {
  return clamp((pitch - rzPitchLow()) / max(1.0, rzPitchHigh() - rzPitchLow()), 0.0, 1.0);
}

// The lyric interface, over one stand-in line.
//
// The words themselves live in a texture the host rasterises, which a preview
// card has no host for — so rzLyricText draws a legible BLOCK per character
// instead. An effect's layout, sweep and fades are what a card is showing off;
// the glyphs are the one part it can honestly fake.
const PV_LINE: f32 = 3.0;
fn rzLyricCount() -> i32 { return 8; }
fn rzLyricStart(i: i32) -> f32 { return f32(i) * PV_LINE; }
fn rzLyricEnd(i: i32) -> f32 { return f32(i + 1) * PV_LINE; }
fn rzLyricChars(i: i32) -> f32 { return 12.0; }
fn rzLyricIndex(t: f32) -> i32 { return i32(floor(t / PV_LINE)) % rzLyricCount(); }
fn rzLyricProgress(i: i32, t: f32) -> f32 { return clamp(fract(t / PV_LINE), 0.0, 1.0); }
fn rzLyricRect(i: i32) -> vec4f { return vec4f(0.0, 0.0, 1.0, 1.0); }
fn rzLyricHasText(i: i32) -> bool { return true; }
fn rzLyricAspect(i: i32) -> f32 { return 8.0; }
fn rzLyricPixels(i: i32) -> vec2f { return vec2f(768.0, 96.0); }
fn rzLyricText(i: i32, uv: vec2f) -> f32 {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
  let n = rzLyricChars(i);
  let cell = fract(uv.x * n);
  // A bar per character, with gaps between them and margins top and bottom —
  // enough for an outline, a wipe and a fade to read as they will on real text.
  let ink = step(0.18, cell) * step(cell, 0.82);
  return ink * step(0.22, uv.y) * step(uv.y, 0.78);
}

USER_CODE

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi & 1u) << 2u) - 1.0;
  let y = f32((vi & 2u) << 1u) - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = vec2f(fragCoord.x / u.res.x, 1.0 - fragCoord.y / u.res.y);
  let ndc = uv * 2.0 - 1.0;
  let fwd = pvForward();
  let right = vec3f(fwd.z, 0.0, -fwd.x);
  let dir = normalize(fwd + ndc.x * right * 0.9 + vec3f(0.0, ndc.y * 0.55, 0.0));

  // The stand-in scene: a floor at y=0, and nothing above the horizon. Depth is
  // measured along the VIEW AXIS, exactly as the engine hands it over, so an
  // effect's distances mean the same thing in both places.
  var hit = 100000.0;
  if (dir.y < -1e-4) {
    hit = -PV_CAM.y / dir.y;
  }
  var depth = clamp(hit * max(dot(dir, fwd), 1e-4), 0.05, 100000.0);

  // A dark base, then a hint of floor receding — a foreground needs something to
  // be in front of, or its whole point is invisible.
  var col = vec3f(0.075, 0.06, 0.1);
  if (hit < 100000.0) {
    col = mix(vec3f(0.16, 0.15, 0.19), col, clamp(hit / 140.0, 0.0, 1.0));
  }

  // The body the ids name, DRAWN as well as masked. An effect that dissolves a
  // character needs a character on the card to dissolve; without one it eats a
  // silhouette nobody can see and the card shows its sparks floating in a room.
  // Flat, and deliberately: this is a stand-in, and shading it would invite
  // reading the card as a render.
  if (pvBodyMask(uv) > 0.5) {
    col = vec3f(0.20, 0.19, 0.24);
    depth = max(rzProject(vec3f(0.0, 9.0, 0.0)).z, 0.05);
  }

  BACKGROUND_CALL
  FOREGROUND_CALL
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

// Both mounts composite the same way the engine's do: straight alpha OVER.
const BACKGROUND_CALL = /* wgsl */ `
  {
    let c = background(dir, uv, u.time);
    let a = clamp(c.a, 0.0, 1.0);
    col = clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a + col * (1.0 - a);
  }`
const FOREGROUND_CALL = /* wgsl */ `
  {
    let c = foreground(dir, uv, u.time, depth);
    let a = clamp(c.a, 0.0, 1.0);
    col = clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a + col * (1.0 - a);
  }`

function previewShader(wgsl: string): string {
  return PREVIEW_HEAD.replace("USER_CODE", wgsl)
    .replace("BACKGROUND_CALL", definesBackground(wgsl) ? BACKGROUND_CALL : "")
    .replace("FOREGROUND_CALL", definesForeground(wgsl) ? FOREGROUND_CALL : "")
}

type Entry = { canvas: HTMLCanvasElement; ctx: GPUCanvasContext; wgsl: string }

// Module-level singleton: device, per-code pipeline cache, registered canvases, one shared
const previews = new Map<HTMLCanvasElement, Entry>()
let device: GPUDevice | null = null
let deviceLost = false
let devicePromise: Promise<GPUDevice | null> | null = null
let format: GPUTextureFormat = "bgra8unorm"
let uniformBuffer: GPUBuffer | null = null
let bindGroupLayout: GPUBindGroupLayout | null = null
let bindGroup: GPUBindGroup | null = null
// Keyed by the shader text, so every edit that ever gets previewed mints a new
// entry — and a render pipeline is GPU memory that nothing else will reclaim
// while this Map holds it. Editing a draft would grow it a pipeline per save, for
// the life of the tab. Capped and evicted oldest-first: Map preserves insertion
// order, so the first key is the least recently added.
// Sized to hold a WHOLE library page, not a handful of it. At 24 a grid showing
// more shaders than that evicted pipelines while they were still on screen, and
// closing the library meant recompiling everything on the way back in — the
// compile is the expensive part, and a retained pipeline costs far less than
// making it twice. The cap still exists so a long session of editing WGSL (a
// new key per keystroke-settled edit) cannot grow without bound.
const PIPELINE_CACHE_MAX = 96
const pipelineCache = new Map<string, GPURenderPipeline | "failed" | "pending">()

function rememberPipeline(wgsl: string, value: GPURenderPipeline | "failed" | "pending") {
  pipelineCache.set(wgsl, value)
  while (pipelineCache.size > PIPELINE_CACHE_MAX) {
    const oldest = pipelineCache.keys().next().value
    if (oldest === undefined || oldest === wgsl) break
    pipelineCache.delete(oldest)
  }
}
let rafId = 0
const uniforms = new Float32Array(4)

async function getDevice(): Promise<GPUDevice | null> {
  if (device) return device
  if (deviceLost) return null
  devicePromise ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) return null
      const d = await adapter.requestDevice()
      format = navigator.gpu.getPreferredCanvasFormat()
      uniformBuffer = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      bindGroupLayout = d.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
      })
      bindGroup = d.createBindGroup({ layout: bindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] })
      void d.lost.then(() => {
        device = null
        deviceLost = true
      })
      device = d
      return d
    } catch {
      return null
    }
  })()
  return devicePromise
}

function pipelineFor(d: GPUDevice, wgsl: string): GPURenderPipeline | null {
  const cached = pipelineCache.get(wgsl)
  if (cached === "failed" || cached === "pending") return null
  if (cached) {
    // Touch it, so what is on screen is never what gets evicted.
    pipelineCache.delete(wgsl)
    pipelineCache.set(wgsl, cached)
    return cached
  }
  rememberPipeline(wgsl, "pending")
  d.pushErrorScope("validation")
  const shader = d.createShaderModule({ code: previewShader(wgsl) })
  void d
    .createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout!] }),
      vertex: { module: shader, entryPoint: "vs" },
      fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    })
    .then(
      (p) => rememberPipeline(wgsl, p),
      () => rememberPipeline(wgsl, "failed"),
    )
  void d.popErrorScope().catch(() => {})
  return null
}

function frame(now: number) {
  rafId = previews.size > 0 ? requestAnimationFrame(frame) : 0
  const d = device
  if (!d || previews.size === 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  for (const e of previews.values()) {
    if (!e.canvas.isConnected) continue
    const r = e.canvas.getBoundingClientRect()
    if (r.width < 1) continue
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (e.canvas.width !== w || e.canvas.height !== h) {
      e.canvas.width = w
      e.canvas.height = h
    }
    const pipeline = pipelineFor(d, e.wgsl)
    if (!pipeline) continue
    // One uniform buffer shared across canvases: write per pass.
    uniforms[0] = now / 1000
    uniforms[2] = w
    uniforms[3] = h
    d.queue.writeBuffer(uniformBuffer!, 0, uniforms)
    const pass = d.createCommandEncoder()
    const rp = pass.beginRenderPass({
      colorAttachments: [{ view: e.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    })
    rp.setPipeline(pipeline)
    rp.setBindGroup(0, bindGroup!)
    rp.draw(3)
    rp.end()
    d.queue.submit([pass.finish()])
  }
}

function register(canvas: HTMLCanvasElement, wgsl: string) {
  void getDevice().then((d) => {
    if (!d || !canvas.isConnected) return
    try {
      const ctx = canvas.getContext("webgpu")
      if (!ctx) return
      ctx.configure({ device: d, format, alphaMode: "opaque" })
      previews.set(canvas, { canvas, ctx, wgsl })
      if (!rafId) rafId = requestAnimationFrame(frame)
    } catch {
      // canvas already configured or context refused — leave the CSS fallback
    }
  })
}

function unregister(canvas: HTMLCanvasElement) {
  previews.delete(canvas)
}

export const EffectPreview = memo(function EffectPreview({ wgsl, className }: { wgsl: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    // ON SCREEN ONLY. Every card here runs its own fragment shader every frame,
    // so a library page draws all of them at once — including the ones scrolled
    // past, which cost exactly as much as the ones being looked at and show
    // nobody anything. Registering on entry also defers the pipeline compile
    // until a card is actually about to be seen, which is what makes opening
    // the library land quickly instead of after every shader in the list.
    //
    // The margin is deliberate: a card starts a frame before its edge appears,
    // so scrolling reveals moving effects rather than black squares filling in.
    if (typeof IntersectionObserver === "undefined") {
      register(canvas, wgsl)
      return () => unregister(canvas)
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) register(canvas, wgsl)
        else unregister(canvas)
      },
      { rootMargin: "200px" },
    )
    io.observe(canvas)
    return () => {
      io.disconnect()
      unregister(canvas)
    }
  }, [wgsl])
  // Fallback gradient shows until (unless) the pipeline lands.
  return <canvas ref={ref} className={cn("h-full w-full bg-gradient-to-br from-zinc-900 to-zinc-800", className)} />
})
