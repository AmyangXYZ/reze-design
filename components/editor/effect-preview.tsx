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
const pipelineCache = new Map<string, GPURenderPipeline | "failed" | "pending">()
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
  if (cached) return cached
  pipelineCache.set(wgsl, "pending")
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
      (p) => pipelineCache.set(wgsl, p),
      () => pipelineCache.set(wgsl, "failed"),
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
