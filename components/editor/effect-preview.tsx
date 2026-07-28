/// <reference types="@webgpu/types" />
"use client"

// LIVE background-effect previews: each card/inspector canvas runs the effect's REAL WGSL

import { memo, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

// Same contract the engine's composite gives user code, minus the scene
const PREVIEW_WRAPPER = /* wgsl */ `
struct U { time: f32, _pad: f32, res: vec2f }
@group(0) @binding(0) var<uniform> u: U;
fn bgResolution() -> vec2f { return u.res; }

USER_CODE

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi & 1u) << 2u) - 1.0;
  let y = f32((vi & 2u) << 1u) - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = vec2f(fragCoord.x / u.res.x, 1.0 - fragCoord.y / u.res.y);
  let ndc = uv * 2.0 - 1.0;
  let yaw = u.time * 0.06;
  let fwd = vec3f(sin(yaw), 0.0, cos(yaw));
  let right = vec3f(cos(yaw), 0.0, -sin(yaw));
  let dir = normalize(fwd + ndc.x * right * 0.9 + vec3f(0.0, ndc.y * 0.55, 0.0));
  let c = background(dir, uv, u.time);
  // Composite over a neutral dark base so alpha (the layer mask) reads honestly.
  let base = vec3f(0.075, 0.06, 0.1);
  let a = clamp(c.a, 0.0, 1.0);
  return vec4f(clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a + base * (1.0 - a), 1.0);
}
`

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
  const shader = d.createShaderModule({ code: PREVIEW_WRAPPER.replace("USER_CODE", wgsl) })
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
