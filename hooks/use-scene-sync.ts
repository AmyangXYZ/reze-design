"use client"

// Applies a scene document's LOOK to the engine: lighting, bloom, grade, ground,
// background colour, the WGSL effect layer, and the 360 skybox.
//
// Extracted from the editor page because a viewer needs exactly this and none of
// the editing around it — a published scene is these values pushed at an engine,
// with no docks, uploads or transport. Values in, engine mutated, no state of its
// own, so the editor can hand it live state and a viewer can hand it a fetched
// document and neither knows the difference.

import { useEffect, useMemo, useRef } from "react"
import {
  Vec3,
  parseHDR,
  type Engine,
} from "reze-engine"
import { effectParams, type AppliedEffect, type EffectSurface } from "@/lib/effects"
import { resolveSpec, type GradeSpec } from "@/lib/grade"
import { CAMERA_DEFAULT_FOV, type SceneCamera, type SceneLight } from "@/lib/scene"
import { GREEN, isCompositingBackground, type ExportBackground } from "@/lib/export-background"
import { azElToDirection, groundExtent, windVariation, hexToLinearVec3, hexToSrgbVec3, windDirection, type SceneSettings } from "@/lib/scene-settings"
import { windowToEngine } from "@/lib/effect-schedule"

/**
 * Which engine instance each entry of the list became.
 *
 * An entry that fails to compile installs nothing, and every entry after it
 * then sits one lower in the engine than in the document. Addressing instance i
 * as entry i put one effect's strips — and its dials — onto its neighbour, for
 * as long as the broken one stayed in the scene.
 */
function installedIndex(results: { ok: boolean }[]): (number | null)[] {
  let k = 0
  return results.map((r) => (r.ok ? k++ : null))
}

/**
 * Every applied effect's timing — and who it is on — onto its instance.
 *
 * The same effect applied twice gets two strips rather than one shared between
 * them: an instance is a copy, and its timing belongs to that copy. So does the
 * cast it plays to, which is the whole point of aiming one copy at one dancer.
 *
 * Frames cross to the engine's seconds here and nowhere else.
 */
function applySchedules(engine: Engine, list: AppliedEffect[], index: (number | null)[] | null): void {
  list.forEach((e, i) => {
    const k = index ? index[i] : i
    if (k == null) return
    engine.setEffectInfluence(k, e.influence ?? 1)
    engine.setEffectSchedule(k, windowToEngine(e.window))
    engine.setEffectSubjects(k, e.models ?? null)
  })
}


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
  /** The lamps the document places. The sun and the world are dials in
   *  `settings`; these are things standing somewhere, so they arrive as a list. */
  lights = [],
  /** A DOM image sits behind the canvas, so the canvas must stay transparent. */
  hasBackdrop = false,
  /** The 360 picture behind the scene, or null. Wallpaper — it lights nothing.
   *  Re-uploaded whenever the file changes. */
  skybox = null,
  /** The HDRI, or null. What LIGHTS the scene, and what you see when no skybox
   *  is set. A separate slot because the two answer different questions and a
   *  scene can want both.
   *
   *  `hdri`, not `world`: the scene's settings already own a `world` — the flat
   *  colour and the strength dial, Blender's naming — and this is the IMAGE
   *  that stands in for it. */
  hdri = null,
  /** Compositing preview: no ground surface, effect and skybox suspended — they
   *  render in-canvas and would cover the key or fill the alpha. "green" keys
   *  the hole, "alpha" leaves it empty. */
  exportBackground = "scene",
  /** The backdrop is a PLATE: footage the scene stands in rather than wallpaper
   *  behind it. Passed rather than read off the settings because it is not a
   *  preference — it is which seat the scene's one piece of background media is
   *  sitting in, and the document says that where it names the asset. */
  plate = false,
  /** The plate is a single photograph, so its grain does not move — and neither
   *  should the grain laid over the render that stands in it. */
  plateStill = false,
  /** Cast member ids, in order — stages excluded, the same list the engine's
   *  own subjects are drawn from. Only used to decide WHO an effect that
   *  declares a dissolve is about; the first of them is subject 0. */
  castIds = [],
  /** Each stage and the sun it carries for itself, or null: applied per stage
   *  the way the fill is per cast member. */
  stageSuns = [],
  /** What each applied effect exposes — its dials, and whether it reads the cast
   *  at all — keyed by uid, handed back after every install. The engine parsed
   *  the directives to build the uniform; reading them off the result is how the
   *  controls and the shader cannot disagree. */
  onEffectSurface,
}: {
  engineRef: React.RefObject<Engine | null>
  ready: boolean
  settings: SceneSettings
  lights?: SceneLight[]
  camera?: SceneCamera
  cameraVmd?: boolean
  /** Resolved by the caller: the scene stores a NAME, and drafts live client-side. */
  gradeSpec: GradeSpec
  backgroundEffects: AppliedEffect[]
  hasBackdrop?: boolean
  skybox?: File | null
  hdri?: File | null
  exportBackground?: ExportBackground
  plate?: boolean
  plateStill?: boolean
  castIds?: string[]
  stageSuns?: { id: string; sun: { color: string; strength: number } | null }[]
  onEffectSurface?: (byUid: Record<string, EffectSurface>) => void
}) {
  const compositing = isCompositingBackground(exportBackground)
  // Per-section identity guard: setSun dirties the shadow map (an extra full pass
  // per frame), so an unguarded push re-rendered shadows on every bloom tick.
  const prev = useRef<{
    /** WHICH ENGINE these were pushed to, and the reason this field exists.
     *
     * Every guard below asks "did this value change" and skips when it did not,
     * on the understanding that the engine was constructed with it. That holds
     * while one engine lives as long as this hook — and breaks the moment a NEW
     * engine appears without the hook remounting, which is what a hot reload of
     * use-engine does, and what a recovered device would do. The refs survive,
     * the settings compare equal, nothing is pushed, and the fresh engine keeps
     * its own defaults: outlines OFF while the document says on, until you
     * toggle something and it finally gets told.
     *
     * Comparing the engine turns that into a first run, which pushes everything.
     */
    engine: Engine
    settings: SceneSettings
    gradeSpec: GradeSpec
    backdrop: boolean
    green: ExportBackground
    plate: boolean
    plateStill: boolean
  } | null>(null)
  // addGround rebuilds GPU buffers and a bind group per call, so ground edits
  // coalesce to at most one rebuild per frame from the latest options.
  const groundOpts = useRef<Parameters<Engine["addGround"]>[0] | null>(null)
  const groundRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(groundRaf.current), [])

  useEffect(() => {
    const engine = engineRef.current
    if (!ready || !engine) return
    const { world, sun, bloom, dof, outline, background, ground, grade, physics, view, grain, stageGrade } = settings
    // A different engine is a first run, whatever the settings say.
    const p = prev.current?.engine === engine ? prev.current : null
    const modeChanged = !p || p.backdrop !== hasBackdrop || p.green !== exportBackground || p.plate !== plate

    if (modeChanged || p.settings.background !== background) {
      // Transparent joins the backdrop case: null IS the transparent canvas,
      // and it is what puts a real alpha channel in front of the encoder.
      engine.setBackgroundColor(
        exportBackground === "green"
          ? hexToSrgbVec3(GREEN)
          : exportBackground === "alpha" || hasBackdrop
            ? null
            : hexToSrgbVec3(background.color),
      )
    }
    if (!p || p.settings.world !== world) {
      engine.setWorld({ color: hexToLinearVec3(world.color), strength: world.strength })
    }
    if (!p || p.settings.sun !== sun) {
      engine.setSun({
        color: hexToLinearVec3(sun.color),
        strength: sun.strength,
        shadow: sun.shadow === false ? 0 : 1,
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
    if (modeChanged || p.settings.grain !== grain || p.plateStill !== plateStill) {
      engine.setFilmGrain(grain.amount, !plateStill)
    }
    // Before the grade, which is what the engine applies it to.
    if (!p || p.settings.view !== view) {
      engine.setViewTransformOptions({ transform: view.transform, exposure: view.exposure })
    }
    // The stage's own ambient, while the stage's own world is the world.
    const ambientSH = settings.stageAmbient && world.stage?.id === settings.stageAmbient.stage ? settings.stageAmbient.sh : null
    if (!p || (p.settings.stageAmbient !== settings.stageAmbient || p.settings.world !== world)) {
      engine.setWorldAmbient(ambientSH)
    }
    if (!p || p.settings.stageFog !== settings.stageFog) {
      const f = settings.stageFog?.fog
      const layer = (l: NonNullable<typeof f>) => ({
        color: { x: l.color[0], y: l.color[1], z: l.color[2] },
        amount: l.amount,
        distance: [l.distance[0], l.distance[1]] as [number, number],
        height: [l.height[0], l.height[1]] as [number, number],
      })
      engine.setSceneFog(f ? { ...layer(f), dyn: f.dyn ? layer(f.dyn) : null } : null)
    }
    if (!p || p.settings.stageGrade !== stageGrade) {
      engine.setStageGrade(
        stageGrade ? { size: stageGrade.size, data: Uint8Array.from(atob(stageGrade.lut), (ch) => ch.charCodeAt(0)) } : null,
      )
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
      engine.setPhysicsFloor(physics.floor)
      engine.setPhysicsEnabled(physics.enabled)
    }
    // The sun and the plate mode both reach into the ground's options — the
    // shadow's edge is the light's, and a floor drawn solid over footage is not
    // a floor the scene is standing on — so this block answers to all three.
    if (modeChanged || p.settings.ground !== ground || p.settings.sun !== sun) {
      // Before the options, and outside the rAF coalescing below: this is a
      // flag, not a buffer rebuild, and it is what a scene with no floor is
      // waiting on.
      engine.setGroundVisible(ground.enabled)
      groundOpts.current = {
        diffuseColor: hexToLinearVec3(ground.color),
        gridLineColor: hexToLinearVec3(ground.grid),
        // A plate joins the compositing modes here for the same reason they are
        // in it: the floor in the picture is the floor, and a surface painted
        // over it is one floor too many. The shadow survives at opacity 0 —
        // that IS the shadow catcher, and it is the whole trick.
        opacity: compositing || plate ? 0 : ground.opacity,
        // The SUN's switch, applied where the shadow is received. One flag now
        // reaches both the catcher and every material: turning it off on the
        // ground alone left the cast shadowed by a map they were still reading.
        shadowStrength: sun.shadow === false ? 0 : 1,
        // A property of the light, applied where the light lands.
        shadowSoftness: sun.softness ?? 0,
        gridLineOpacity: compositing || !ground.gridEnabled ? 0 : 0.4,
        // Square plane, its radial fade in proportion to it.
        ...groundExtent(ground),
      }
      if (!groundRaf.current) {
        groundRaf.current = requestAnimationFrame(() => {
          groundRaf.current = 0
          if (groundOpts.current) engineRef.current?.addGround(groundOpts.current)
        })
      }
    }
    prev.current = { engine, settings, gradeSpec, backdrop: hasBackdrop, green: exportBackground, plate, plateStill }
  }, [settings, gradeSpec, ready, engineRef, hasBackdrop, exportBackground, compositing, plate, plateStill])

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
  /** The engine `lastWgsl` describes. Same trap as `prev` above: a fresh engine
   *  has no effects installed, and a key left over from the previous one made
   *  the install skip itself. */
  const lastWgslEngine = useRef<Engine | null>(null)
  /** What the last install made of the list — see installedIndex. Null is
   *  one instance per entry, in order, which is every install that compiled. */
  const engineIndex = useRef<(number | null)[] | null>(null)
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    // The document's list, in layer order, and nothing else. A constant here
    // used to add the demo's other three, which meant a published URL rendered
    // four effects because this file said so rather than because the scene did
    // — so nobody else could author one, and the same link would have changed
    // if the constant did.
    //
    // GREEN suspends them; ALPHA keeps them. An effect renders in-canvas, so
    // over a key colour it is unrecoverable — you cannot pull a key back out
    // from under sparks. Over a transparent base there is nothing to recover:
    // the composite already folds an effect's own coverage into the canvas
    // alpha (`outA = fgFx.a + outA * (1 - fgFx.a)`), so a foreground lands in
    // the plate with the alpha it drew, and particles, trails and ribbons come
    // through the scene pass covered by scene alpha like any other geometry.
    // Which is the point: the glow around a dancer is what someone wants IN the
    // plate, to composite over their own background.
    //
    // A full-screen opaque `fn background` still fills the hole. That is the
    // author's call, and the checkerboard says so the moment it happens.
    const sources = (exportBackground === "green" ? [] : backgroundEffects).map((e) => e.wgsl)
    // One key for the whole list, so adding an effect recompiles and a
    // re-render with the same list does not.
    const wgsl = sources.length ? sources.join("\0") : null
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
      if (lastWgsl.current !== null && lastWgslEngine.current === engine) {
        lastWgsl.current = null
        void engine.setEffects(null)
      }
      return
    }
    // A NEW ENGINE STARTS EMPTY. Whatever the last one wore is not on this one,
    // so there is nothing to take off it — and asking anyway, which is what a
    // null install is, reached every fresh engine before init() had finished
    // whenever the scene had no effect of its own: a failure logged against an
    // effect that did not exist.
    if (lastWgslEngine.current !== engine) {
      lastWgsl.current = null
      lastWgslEngine.current = engine
    }
    if (wgsl === lastWgsl.current) return
    lastWgsl.current = wgsl
    let stale = false
    // Params ride the install so an effect's first frame is already at the
    // scene's settings — seeding after the fact would show the author's default
    // for a frame, which on a colour reads as a flash.
    const applied = exportBackground === "green" ? [] : backgroundEffects
    void engine
      .setEffects(
        sources.length
          ? sources.map((s, i) => ({
              wgsl: s,
              params: effectParams(s, applied[i]?.params),
              // WHO it is on rides the install for the reason the dials do: an
              // effect aimed at one dancer must not spend its first frame on all
              // of them, which on a ribbon or a sigil reads as a flash.
              subjects: applied[i]?.models ?? null,
            }))
          : null,
      )
      .then((rs) => {
        if (stale) return
        // An install builds fresh instances, so whatever was scheduled is gone
        // with the ones it was set on. Re-applied HERE as well as on change,
        // because the two arrive in either order: editing a strip does not
        // reinstall, and installing does not know a strip changed.
        engineIndex.current = installedIndex(rs)
        applySchedules(engine, backgroundEffects, engineIndex.current)
        // WHAT EACH EFFECT EXPOSES, read off the install rather than re-parsed.
        // The engine already read the directives to build the uniform, so parsing
        // the same lines again here would be a second answer free to disagree with
        // the one the shader is actually running.
        onEffectSurface?.(
          Object.fromEntries(
            rs
              .map((r, i) => [applied[i]?.uid ?? String(i), { params: r.params, readsCast: r.readsCast }] as const)
              .filter(([uid]) => uid !== undefined),
          ) as Record<string, EffectSurface>,
        )
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
      .catch((err: unknown) => {
        // AN INSTALL THAT THREW LEFT THE OLD LIST RUNNING. The engine swaps its
        // instances only once every effect has compiled, so a throw — a device
        // error during pipeline creation, a lost device — keeps the previous
        // effects on screen while this key says the new list is installed. The
        // next edit then removes an effect from a list the engine never took,
        // and the one taken off the list keeps rendering with no way to reach
        // it. Forgetting the key is what makes the next render try again.
        if (!stale) lastWgsl.current = null
        console.error("[effect] install failed:", err)
      })
    return () => {
      stale = true
    }
  }, [backgroundEffects, exportBackground, ready, engineRef, onEffectSurface])

  // ── Eyes on the camera ──
  //
  // Per cast model, and again as models land: the list is what changes when
  // one arrives, and a setting pushed before it existed reached nothing.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    for (const id of castIds) engine.setEyeTracking(id, settings.eyes.enabled ? {} : null)
  }, [engineRef, ready, castIds, settings.eyes])

  // ── The cast's fill ──
  //
  // The same shape: per cast model, and again as models land. Only the cast —
  // a stage or a prop wearing it would lift the room the fill exists to leave.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    const f = settings.fill
    const c = f && f.strength > 0 ? hexToLinearVec3(f.color) : null
    const fill = c ? new Vec3(c.x * f!.strength, c.y * f!.strength, c.z * f!.strength) : null
    for (const id of castIds) engine.setModelFill(id, fill)
  }, [engineRef, ready, castIds, settings.fill])

  // ── A stage's own sun ──
  //
  // The colour and strength the stage was lit by, in place of the scene's sun,
  // which stays the cast's. Keyed on the values so a re-render with the same
  // stages pushes nothing.
  const stageSunKey = stageSuns.map((s) => `${s.id}:${s.sun ? `${s.sun.color}@${s.sun.strength}` : ""}`).join("\u0000")
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    for (const { id, sun } of stageSuns) {
      const c = sun && sun.strength > 0 ? hexToLinearVec3(sun.color) : null
      engine.setModelSun(id, c ? new Vec3(c.x * sun!.strength, c.y * sun!.strength, c.z * sun!.strength) : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineRef, ready, stageSunKey])

  /**
   * A dial moved, without reinstalling.
   *
   * The install is a shader compile; a slider drag is sixty of them a second.
   * `setEffectParam` writes the uniform, which is what makes dragging a width
   * feel like dragging a width rather than like recompiling a shader.
   *
   * ONLY WHEN THE SHADER LIST IS THE ONE INSTALLED, and that guard is the whole
   * subtlety. This is keyed by INDEX into the effects the engine currently
   * holds, while the install above is async — so on a load, a scene swap, or any
   * change to WHICH effects are applied, this ran first and addressed index i of
   * the list still on screen. Best case a no-op; worst case it wrote one
   * effect's dial into the effect that happened to be sitting at that index.
   *
   * Nothing is lost by skipping: the install seeds every value itself, so the
   * effects that are arriving come up already set.
   */
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const applied = exportBackground === "green" ? [] : backgroundEffects
    const key = applied.length ? applied.map((e) => e.wgsl).join("\0") : null
    if (key !== lastWgsl.current || lastWgslEngine.current !== engine) return
    applied.forEach((e, i) => {
      // An entry that failed to compile installed nothing, so it has no dials to
      // write and the entries after it are not where the document puts them.
      const k = engineIndex.current ? engineIndex.current[i] : i
      if (k == null) return
      // The FULL set, defaults included — not just what this scene overrode.
      // Clearing an override (the reset button, or a dial put back) removes the
      // key, and a loop over the overrides alone would then write nothing at
      // all: the uniform would keep the value that was just taken away, and the
      // effect would not return to its declared default until it reinstalled.
      for (const [name, value] of Object.entries(effectParams(e.wgsl, e.params) ?? {})) {
        engine.setEffectParam(k, name, value)
      }
    })
  }, [backgroundEffects, exportBackground, engineRef])

  /**
   * Strips and targets onto instances, whenever one is edited.
   *
   * Separate from the install above because editing WHEN an effect plays — or WHO
   * it plays on — must not recompile it. The guard up there returns early when
   * the sources have not changed, which is exactly right for a shader and exactly
   * wrong for the settings beside it: the engine's mask is a uniform, so aiming
   * an effect somewhere else costs a write and not a pipeline.
   *
   * Keyed on the timing alone, so dragging a strip does not re-run on every
   * unrelated edit to the list, and re-running is harmless when it does: both
   * calls are idempotent writes of a number.
   */
  const scheduleKey = JSON.stringify(
    backgroundEffects.map((e) => [e.influence ?? 1, e.window ?? null, e.models ?? null]),
  )
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    applySchedules(engine, backgroundEffects, engineIndex.current)
    // `scheduleKey` IS the dependency — backgroundEffects is a fresh array on
    // every render, and depending on it would write these every frame the
    // editor re-renders for any reason at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, ready, engineRef])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (compositing || !skybox) {
      engine.setBackdropEquirect(null)
      return
    }
    let stale = false
    void createImageBitmap(skybox).then((b) => {
      if (!stale) engine.setBackdropEquirect(b)
    })
    return () => {
      stale = true
    }
  }, [skybox, compositing, engineRef])

  /**
   * The scene's lamps.
   *
   * Its own effect, and cheap to re-run: setLights rewrites one storage buffer,
   * with none of setSun's shadow-map consequence, so there is nothing to guard
   * against beyond React handing us the same array twice.
   *
   * A lamp switched OFF is dropped rather than dimmed to zero. Zero intensity
   * still costs the per-fragment distance test for every pixel it covers, and a
   * switch that quietly keeps paying is a switch that lies.
   */
  useEffect(() => {
    const engine = engineRef.current
    if (!ready || !engine) return
    const on = lights.filter((l) => l.on !== false)
    engine.setLights(
      on.map((l) => {
        const c = hexToLinearVec3(l.color)
        return {
          position: { x: l.position[0], y: l.position[1], z: l.position[2] },
          color: { x: c.x, y: c.y, z: c.z },
          intensity: l.intensity,
          radius: l.radius,
          ...(l.aim ? { aim: { x: l.aim[0], y: l.aim[1], z: l.aim[2] } } : {}),
          ...(l.angle !== undefined ? { angle: l.angle } : {}),
          ...(l.innerAngle !== undefined ? { innerAngle: l.innerAngle } : {}),
        }
      }),
    )
  }, [lights, ready, engineRef])

  /**
   * The HDRI world, on its own slot.
   *
   * Its own effect, and not a branch inside the skybox's: an HDRI is a
   * measurement of light and a 360 picture is wallpaper, and they were told
   * apart by FILE EXTENSION on one slot — so a scene could have one or the
   * other and never both, and a picture changed the lighting on the strength of
   * its filename.
   *
   * Suspended under compositing for the same reason the skybox is: an alpha
   * plate is the cast against nothing, and a world that went on lighting them
   * would put the room back into the plate.
   */
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (compositing || !hdri) {
      engine.setWorldEquirect(null)
      return
    }
    let stale = false
    // Through the engine's own parser: createImageBitmap cannot decode Radiance
    // files, and flattening one to 8 bits would throw away exactly the range
    // that makes it an HDRI.
    void hdri
      .arrayBuffer()
      .then((buf) => {
        if (stale) return
        const img = parseHDR(buf)
        engine.setWorldEquirect(img)
        // The install receipt: with this line and __reze.getWorldLighting(),
        // "is the sky lighting her" is a console question, not a guess.
        const wl = engine.getWorldLighting()
        // EVERYTHING THAT DECIDES BRIGHTNESS, on one line. The report this
        // answers is always the same shape — "it comes up bright on upload and
        // right after a reload" — and the two paths differ only in the ORDER
        // the sky, the dial and the document arrive in. One line from each
        // settles which of the three moved, instead of another round of guesses.
        console.info(
          `[world] HDRI installed (${img.width}x${img.height}) — ` +
            `ambient ${wl.source} x${wl.strength.toFixed(2)} up ${wl.up.map((v) => v.toFixed(3)).join()} ` +
            `down ${wl.down.map((v) => v.toFixed(3)).join()} · sun x${engine.getSun().strength.toFixed(2)}`,
        )
        // The trap that cost a debugging round: the sky's light rides the World
        // strength dial (the Blender semantic), and a scene with the dial at
        // zero installs a sky that lights nothing — silently, unless this says so.
        if (wl.strength === 0) {
          console.warn("[world] World strength is 0 — the sky lights nothing until it is raised (settings > World).")
        }
      })
      .catch((e) => console.error("[world] .hdr failed to parse:", e))
    return () => {
      stale = true
    }
  }, [hdri, compositing, engineRef])

  // The WGSL editor compiles straight to the engine for its live preview; telling
  // the sync pass what's already on screen keeps it from compiling it a second
  // time when the applied effect lands in state.
  return {
    noteAppliedWgsl: (wgsl: string) => {
      lastWgsl.current = wgsl
      engineIndex.current = null
    },
    /**
     * The editor installed a whole list itself: take it as what is on screen,
     * and put the timing back on the instances it just built. An install makes
     * fresh instances, and a fresh instance is unscheduled — so without this a
     * recompile in the shader editor left every strip on the timeline pointing
     * at nothing, and the effects played through the whole scene.
     */
    adoptInstall: (list: AppliedEffect[], results: { ok: boolean }[]) => {
      lastWgsl.current = list.map((e) => e.wgsl).join("\0")
      engineIndex.current = installedIndex(results)
      const engine = engineRef.current
      if (engine) applySchedules(engine, list, engineIndex.current)
    },
  }
}

/**
 * Who in a loaded scene is CAST, and what the stages bring — the per-model
 * inputs useSceneSync takes, derived one way for every page that shows a scene.
 *
 * Stages and props ride in `models` because their materials take the same
 * style-group path; the cast is everything else. `castIds` is memoised on its
 * CONTENTS: useSceneSync depends on it, and a fresh array every render would
 * reinstall the effect layer sixty times a second.
 */
export function useSceneCast<M extends { id: string }>(
  models: M[],
  stages: { id: string; sun?: { color: string; strength: number } | null }[],
  props: { id: string }[],
) {
  const stageIds = useMemo(() => new Set([...stages.map((s) => s.id), ...props.map((p) => p.id)]), [stages, props])
  const cast = useMemo(() => models.filter((m) => !stageIds.has(m.id)), [models, stageIds])
  const castKey = cast.map((m) => m.id).join("\u0000")
  const castIds = useMemo(() => (castKey ? castKey.split("\u0000") : []), [castKey])
  const stageSuns = useMemo(() => stages.map((s) => ({ id: s.id, sun: s.sun ?? null })), [stages])
  return { stageIds, cast, castIds, stageSuns }
}
