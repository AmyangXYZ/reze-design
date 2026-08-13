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
fn pvForward() -> vec3f {
  let yaw = u.time * 0.06;
  return vec3f(sin(yaw), 0.0, cos(yaw));
}
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
  let depth = clamp(hit * max(dot(dir, fwd), 1e-4), 0.05, 100000.0);

  // A dark base, then a hint of floor receding — a foreground needs something to
  // be in front of, or its whole point is invisible.
  var col = vec3f(0.075, 0.06, 0.1);
  if (hit < 100000.0) {
    col = mix(vec3f(0.16, 0.15, 0.19), col, clamp(hit / 140.0, 0.0, 1.0));
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
const PIPELINE_CACHE_MAX = 24
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
    register(canvas, wgsl)
    return () => unregister(canvas)
  }, [wgsl])
  // Fallback gradient shows until (unless) the pipeline lands.
  return <canvas ref={ref} className={cn("h-full w-full bg-gradient-to-br from-zinc-900 to-zinc-800", className)} />
})
