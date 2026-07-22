"use client"

// Engine lifecycle for the scene page: boot once with the user's stored scene
// settings (so nothing flashes defaults), load the demo model in bind pose,
// surface the material list, and forward raycast picks. Selection highlight is
// imperative (engine.setSelectedMaterial) — the caller decides what "selected"
// means; hover temporarily overrides it.

import { useCallback, useEffect, useRef, useState } from "react"
import { Engine, Vec3 } from "reze-engine"
import { MODEL_ID, MODEL_PATH, MODEL_PRESETS } from "@/lib/materials"
import { azElToDirection, hexToLinearVec3, type SceneSettings } from "@/lib/scene-settings"

export type MaterialRow = {
  name: string
  /** PMX base diffuse — used as the row swatch in the sidebar. */
  diffuse: [number, number, number, number]
  visible: boolean
}

export function useEngine(
  onPick: (material: string | null) => void,
  /** Stored scene settings applied AT BOOT (constructor options + first
   *  addGround) so the first frame already matches the user's config. */
  initialSettings: SceneSettings,
) {
  const initialSettingsRef = useRef(initialSettings)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  // The currently loaded model — the demo model until the user uploads their own.
  const [modelName, setModelName] = useState(MODEL_ID)
  const modelNameRef = useRef(MODEL_ID)

  // Raycast fires from inside the engine's event handlers; route through a ref
  // so the boot effect never depends on the callback identity.
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  })

  useEffect(() => {
    let disposed = false
    const boot = async () => {
      if (!canvasRef.current) return
      try {
        const s = initialSettingsRef.current
        const engine = new Engine(canvasRef.current, {
          camera: { distance: 28, target: new Vec3(0, 12.5, 0) },
          world: { color: hexToLinearVec3(s.world.color), strength: s.world.strength },
          sun: {
            color: hexToLinearVec3(s.sun.color),
            strength: s.sun.strength,
            direction: azElToDirection(s.sun.azimuth, s.sun.elevation),
          },
          bloom: { ...s.bloom, color: hexToLinearVec3(s.bloom.color) },
          onRaycast: (_model, material) => onPickRef.current(material),
        })
        engineRef.current = engine
        await engine.init()
        if (disposed) return
        const model = await engine.loadModel(MODEL_ID, MODEL_PATH)
        if (disposed) return
        engine.setMaterialPresets(MODEL_ID, MODEL_PRESETS)
        engine.addGround({
          diffuseColor: hexToLinearVec3(s.colors.ground),
          gridLineColor: hexToLinearVec3(s.colors.grid),
        })
        setMaterials(model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })))
        // Bind pose until the user loads a VMD — material evaluation doesn't need motion.
        engine.runRenderLoop()
        setReady(true)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void boot()
    return () => {
      disposed = true
      engineRef.current?.dispose?.()
      engineRef.current = null
    }
  }, [])

  const highlight = useCallback((material: string | null) => {
    engineRef.current?.setSelectedMaterial(material ? modelNameRef.current : null, material)
  }, [])

  const toggleVisible = useCallback((name: string) => {
    engineRef.current?.toggleMaterialVisible(modelNameRef.current, name)
    setMaterials((rows) => rows.map((r) => (r.name === name ? { ...r, visible: !r.visible } : r)))
  }, [])

  /** Swap in a user-uploaded model from a folder pick (loadModel resolves the
   *  PMX's relative texture paths against the picked files). The old model is
   *  removed only after the new one loads, so a failed upload keeps the scene. */
  const loadFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File) => {
    const engine = engineRef.current
    if (!engine) return
    const name = pmxFile.name.replace(/\.pmx$/i, "") || "custom"
    try {
      if (name === modelNameRef.current) engine.removeModel(name)
      const model = await engine.loadModel(name, { files, pmxFile })
      if (name !== modelNameRef.current) engine.removeModel(modelNameRef.current)
      modelNameRef.current = name
      setModelName(name)
      setMaterials(model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  /** Load a local .vmd onto the current model (object URL) and play it.
   *  Returns the clip name on success. */
  const loadVmdFile = useCallback(async (file: File): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelNameRef.current)
    if (!model) return null
    const url = URL.createObjectURL(file)
    try {
      await model.loadVmd(file.name, url)
      model.play(file.name)
      return file.name
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [])

  const stopAnimation = useCallback(() => {
    engineRef.current?.getModel(modelNameRef.current)?.stopAnimation()
  }, [])

  return {
    canvasRef,
    engineRef,
    ready,
    error,
    materials,
    modelName,
    highlight,
    toggleVisible,
    loadFromFiles,
    loadVmdFile,
    stopAnimation,
  }
}
