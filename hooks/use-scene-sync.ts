"use client"

// Applies a scene document's LOOK to the engine: lighting, bloom, grade, ground,
// background colour, the WGSL effect layer, and the 360 skybox.
//
// Extracted from the editor page because a viewer needs exactly this and none of
// the editing around it — a published scene is these values pushed at an engine,
// with no docks, uploads or transport. Values in, engine mutated, no state of its
// own, so the editor can hand it live state and a viewer can hand it a fetched
// document and neither knows the difference.

import { useEffect, useRef } from "react"
import { Vec3, parseHDR, type Engine } from "reze-engine"
import { type AppliedEffect } from "@/lib/effects"
import { resolveSpec, type GradeSpec } from "@/lib/grade"
import { CAMERA_DEFAULT_FOV, type SceneCamera } from "@/lib/scene"
import { azElToDirection, windVariation, hexToLinearVec3, hexToSrgbVec3, windDirection, type SceneSettings } from "@/lib/scene-settings"

const GREEN = "#00ff00"

export function useSceneSync({
  engineRef,
  ready,
  settings,
  /** The document's framing. Only the LENS is applied here — distance, angles and
   *  target go through useEngine's applyCamera, which is also what a drag moves.
   *  Omit it and the fov is left alone entirely. */
  camera,
  /** Whether a camera VMD is loaded. Not read, only WATCHED: the engine backs the
   *  orbit fov up when a clip takes the shot and restores it when the clip lets
   *  go, so the document's lens has to be pushed again the moment that happens. */
  cameraVmd = false,
  gradeSpec,
  backgroundEffects,
  /** A DOM image sits behind the canvas, so the canvas must stay transparent. */
  hasBackdrop = false,
  /** 360 skybox source, or null. Re-uploaded whenever the file changes. */
  skybox = null,
  /** Chroma-key preview: green background, no ground surface, effect and skybox
   *  suspended — they render in-canvas and would cover the key. */
  greenScreen = false,
}: {
  engineRef: React.RefObject<Engine | null>
  ready: boolean
  settings: SceneSettings
  camera?: SceneCamera
  cameraVmd?: boolean
  /** Resolved by the caller: the scene stores a NAME, and drafts live client-side. */
  gradeSpec: GradeSpec
  backgroundEffects: AppliedEffect[]
  hasBackdrop?: boolean
  skybox?: File | null
  greenScreen?: boolean
}) {
  // Per-section identity guard: setSun dirties the shadow map (an extra full pass
  // per frame), so an unguarded push re-rendered shadows on every bloom tick.
  const prev = useRef<{ settings: SceneSettings; gradeSpec: GradeSpec; backdrop: boolean; green: boolean } | null>(null)
  // addGround rebuilds GPU buffers and a bind group per call, so ground edits
  // coalesce to at most one rebuild per frame from the latest options.
  const groundOpts = useRef<Parameters<Engine["addGround"]>[0] | null>(null)
  const groundRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(groundRaf.current), [])

  useEffect(() => {
    const engine = engineRef.current
    if (!ready || !engine) return
    const { world, sun, bloom, dof, outline, background, ground, grade, physics, view } = settings
    const p = prev.current
    const modeChanged = !p || p.backdrop !== hasBackdrop || p.green !== greenScreen

    if (modeChanged || p.settings.background !== background) {
      engine.setBackgroundColor(
        greenScreen ? hexToSrgbVec3(GREEN) : hasBackdrop ? null : hexToSrgbVec3(background.color),
      )
    }
    if (!p || p.settings.world !== world) {
      engine.setWorld({ color: hexToLinearVec3(world.color), strength: world.strength })
    }
    if (!p || p.settings.sun !== sun) {
      engine.setSun({
        color: hexToLinearVec3(sun.color),
        strength: sun.strength,
        direction: azElToDirection(sun.azimuth, sun.elevation),
      })
    }
    if (!p || p.settings.bloom !== bloom) {
      // Intensity 0 IS off — the panel has no switch, so the slider is the only
      // authority and a stored `enabled: false` can't lock bloom off forever.
      engine.setBloomOptions({
        enabled: bloom.intensity > 0,
        threshold: bloom.threshold,
        knee: bloom.knee,
        radius: bloom.radius,
        intensity: bloom.intensity,
        color: hexToLinearVec3(bloom.color),
      })
    }
    if (!p || p.settings.dof !== dof) {
      // Focus mode is stated on every push rather than stored: "auto" is the
      // only mode this app offers, so it is a property of the caller, not of
      // the document.
      engine.setDepthOfField({ enabled: dof.enabled, focusMode: "auto", aperture: dof.aperture })
    }
    if (!p || p.settings.outline !== outline) {
      engine.setOutlineEnabled(outline.enabled)
    }
    // Before the grade, which is what the engine applies it to.
    if (!p || p.settings.view !== view) {
      engine.setViewTransformOptions({ transform: view.transform, exposure: view.exposure })
    }
    if (!p || p.settings.grade !== grade || p.gradeSpec !== gradeSpec) {
      const cdl = resolveSpec(gradeSpec, grade.intensity)
      engine.setColorGrading({
        shadows: hexToSrgbVec3(cdl.shadows),
        midtones: hexToSrgbVec3(cdl.midtones),
        highlights: hexToSrgbVec3(cdl.highlights),
        contrast: cdl.contrast,
        saturation: cdl.saturation,
      })
    }
    if (!p || p.settings.physics !== physics) {
      // Gravity points down; the slider is its magnitude, since a tilted world
      // is a different feature from a heavy one and nobody reached for it.
      engine.setGravity(new Vec3(0, -physics.gravity, 0))
      engine.setWind(
        physics.wind > 0
          ? {
              direction: windDirection(physics.windAzimuth, physics.windElevation),
              strength: physics.wind,
              turbulence: windVariation(physics.wind, physics.windFrequency),
              frequency: physics.windFrequency,
            }
          : null,
      )
    }
    if (modeChanged || p.settings.ground !== ground) {
      groundOpts.current = {
        diffuseColor: hexToLinearVec3(ground.color),
        gridLineColor: hexToLinearVec3(ground.grid),
        opacity: greenScreen ? 0 : ground.opacity,
        shadowStrength: ground.shadow ? 1 : 0,
        gridLineOpacity: greenScreen || !ground.gridEnabled ? 0 : 0.4,
        // Square plane; the radial fade scales with it (engine defaults are 10/80 at size 160).
        width: ground.size,
        height: ground.size,
        fadeStart: ground.size * (10 / 160),
        fadeEnd: ground.size * (80 / 160),
      }
      if (!groundRaf.current) {
        groundRaf.current = requestAnimationFrame(() => {
          groundRaf.current = 0
          if (groundOpts.current) engineRef.current?.addGround(groundOpts.current)
        })
      }
    }
    prev.current = { settings, gradeSpec, backdrop: hasBackdrop, green: greenScreen }
  }, [settings, gradeSpec, ready, engineRef, hasBackdrop, greenScreen])

  // The lens, on its own effect and keyed on the VALUE: `camera` is a new object
  // every time a target slider moves, and the fov has no business being pushed
  // for that.
  const fov = camera ? (camera.fov ?? CAMERA_DEFAULT_FOV) : null
  useEffect(() => {
    const engine = engineRef.current
    if (!ready || !engine || fov === null) return
    // A camera VMD animates fov itself, frame by frame — writing the orbit value
    // underneath it would be overwritten anyway, and then clobbered again by the
    // backup the engine restores on release. `cameraVmd` in the deps is what
    // brings us back here at that release.
    if (engine.isCameraVmdEnabled()) return
    engine.setCameraFov(fov)
  }, [fov, cameraVmd, ready, engineRef])

  // Recompile only when the shader itself (or its suspension) actually changes.
  const lastWgsl = useRef<string | null>(null)
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    // The document's list, in layer order, and nothing else. A constant here
    // used to add the demo's other three, which meant a published URL rendered
    // four effects because this file said so rather than because the scene did
    // — so nobody else could author one, and the same link would have changed
    // if the constant did.
    const sources = (greenScreen ? [] : backgroundEffects).map((e) => e.wgsl)
    // One key for the whole list, so adding an effect recompiles and a
    // re-render with the same list does not.
    const wgsl = sources.length ? sources.join(" ") : null
    // REMOVING one does not wait for `ready`. That flag is off for the whole
    // scene swap — every model still to arrive — and gating removal on it left
    // the outgoing scene's effect running over the incoming one until the last
    // of them landed. Installing still waits: there is nothing to put an effect
    // on yet, and the compile is better spent once the scene is there.
    if (!ready && wgsl !== null) {
      // Mid-swap, with another effect due once the scene lands. Installing has to
      // wait — there is nothing to put it on — but the OUTGOING one must not: it
      // is still rendering every frame over a scene that is still arriving, and a
      // heavy one starves the very frames the swap needs to finish. Reset to the
      // demo hit this, because the demo has an effect of its own: the early
      // return meant a costly foreground kept running for the whole swap and the
      // reset appeared to hang.
      if (lastWgsl.current !== null) {
        lastWgsl.current = null
        void engineRef.current?.setEffects(null)
      }
      return
    }
    if (wgsl === lastWgsl.current) return
    lastWgsl.current = wgsl
    let stale = false
    void engine.setEffects(sources.length ? sources.map((s) => ({ wgsl: s })) : null).then((rs) => {
      if (stale) return
      rs.forEach((r, i) => {
        // Named, not numbered: every entry is one the scene asked for now, and
        // a name is what the person reading the console can go and look at.
        // Diagnostics also arrive on a SUCCESSFUL install — a directive that
        // parsed but will never fire — so ok is what decides the level.
        const name = backgroundEffects[i]?.name ?? `effect ${i + 1}`
        if (!r.ok) console.error(`[effect] "${name}" failed to install:`, r.diagnostics)
        else if (r.diagnostics.length) console.warn(`[effect] "${name}":`, r.diagnostics.join(" "))
      })
    })
    return () => {
      stale = true
    }
  }, [backgroundEffects, greenScreen, ready, engineRef])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (greenScreen || !skybox) {
      engine.setBackdropEquirect(null)
      return
    }
    let stale = false
    if (/\.hdr$/i.test(skybox.name)) {
      // An HDRI world: scene-linear radiance through the engine's own parser —
      // createImageBitmap cannot decode Radiance files, and flattening one to
      // 8-bit would throw away exactly the range that makes it an HDRI.
      void skybox
        .arrayBuffer()
        .then((buf) => {
          if (!stale) engine.setBackdropEquirect(parseHDR(buf))
        })
        .catch((e) => console.error("[skybox] .hdr failed to parse:", e))
    } else {
      void createImageBitmap(skybox).then((b) => {
        if (!stale) engine.setBackdropEquirect(b)
      })
    }
    return () => {
      stale = true
    }
  }, [skybox, greenScreen, engineRef])

  // The WGSL editor compiles straight to the engine for its live preview; telling
  // the sync pass what's already on screen keeps it from compiling it a second
  // time when the applied effect lands in state.
  return {
    noteAppliedWgsl: (wgsl: string) => {
      lastWgsl.current = wgsl
    },
  }
}
