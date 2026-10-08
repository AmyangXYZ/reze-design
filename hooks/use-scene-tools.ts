"use client"

// The editor's handles for lib/ai/scene-tools, kept current every render.
//
// Tools run later than the render that built them — after a model's reply, or
// from the console — so they read the scene through a ref that always holds the
// latest state, never a closure from when they were defined.
//
// In development the tools are also on window.rezeTools, so each one can be
// driven by hand before any model is involved:
//   await rezeTools.run("get_scene")
//   await rezeTools.run("set_settings", { patch: { sun: { elevation: 15 } } })
//   await rezeTools.run("capture", { shots: [{ shot: "closeup", angle: "front" }] })

import { useCallback, useEffect, useRef } from "react"
import { SCENE_TOOLS, runSceneTool, type SceneToolHandles, type ToolResult } from "@/lib/ai/scene-tools"

export function useSceneTools(handles: SceneToolHandles) {
  const ref = useRef(handles)
  useEffect(() => {
    ref.current = handles
  })

  // A tool's change reaches the handles only after React renders and the
  // effect above refreshes the ref. Run back to back, the next tool would read
  // the scene from BEFORE this one — an effect just added that update_effect
  // cannot find, a second grade built on the first's starting point. So every
  // run waits out a render before handing back: whoever calls next sees the
  // scene this one left.
  const run = useCallback(async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const result = await runSceneTool(name, args, ref.current)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return result
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    const w = window as unknown as { rezeTools?: unknown }
    w.rezeTools = {
      list: () => SCENE_TOOLS.map((t) => `${t.name} — ${t.description}`),
      run,
      /** Open a capture's images in new tabs, to see what the agent would see. */
      show: (result: ToolResult) => result.images?.forEach((im) => window.open()?.document.write(`<img src="${im.dataUrl}">`)),
    }
    return () => {
      delete w.rezeTools
    }
  }, [run])

  return { tools: SCENE_TOOLS, run }
}
