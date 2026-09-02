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
import { Vec3, parseDirectives, parseHDR, type DissolveCycle, type Engine } from "reze-engine"
import { type AppliedEffect } from "@/lib/effects"
import { resolveSpec, type GradeSpec } from "@/lib/grade"
import { CAMERA_DEFAULT_FOV, type SceneCamera } from "@/lib/scene"
import { GREEN, isCompositingBackground, type ExportBackground } from "@/lib/export-background"
import { azElToDirection, windVariation, hexToLinearVec3, hexToSrgbVec3, windDirection, type SceneSettings } from "@/lib/scene-settings"
import { windowToEngine } from "@/lib/effect-schedule"

/**
 * Every applied effect's timing onto its instance.
 *
 * BY INDEX, which is what makes it right: setEffects installs the list in
 * order, so instance i is entry i, and the same effect applied twice gets two
 * strips rather than one shared between them.
 *
 * Frames cross to the engine's seconds here and nowhere else.
 */
function applySchedules(engine: Engine, list: AppliedEffect[]): void {
  list.forEach((e, i) => {
    engine.setEffectInfluence(i, e.influence ?? 1)
    engine.setEffectSchedule(i, windowToEngine(e.window))
  })
}


/**
 * The dissolve an effect declares, or null.
 *
 * `#dissolve` says an effect takes the cast apart. FOUR CONSTANTS say when:
 *
 *   const DISSOLVE_APART = 0.5;   // seconds she takes to come apart
 *   const DISSOLVE_GONE  = 0.65;  // ...and how long there is nothing of her
 *   const DISSOLVE_BACK  = 0.35;  // ...to arrive again
 *   const DISSOLVE_WHOLE = 3.0;   // ...and to stand there before it repeats
 *
 * The numbers ride in CONSTANTS rather than in the directive, and that is a
 * usability decision rather than a technical one. They started as five moments
 * on the directive line, which made every edit arithmetic — quicker vanishing
 * meant moving three other numbers to keep the gaps. Four durations fixed the
 * arithmetic and left them still sitting in a comment, dim and unremarkable,
 * nowhere near the block of tunables an author actually edits. These are the
 * numbers this effect gets retuned on most, so they belong where the retuning
 * happens; the directive stays as the declaration, which is what a directive is
 * for.
 *
 * Durations, not moments, and the cycle STARTS whole — so the wait is the gap
 * you see between teleports rather than a tail nobody can find the start of.
 *
 * A missing constant is zero, not a failure: an effect asking for a dissolve
 * with no numbers gets one that happens instantly and never repeats, which is
 * visible and diagnosable, where refusing to install would lose the whole
 * effect over a typo in one of four lines.
 *
 * The FIRST effect that declares one wins. A scene that layers two effects both
 * taking the cast apart is asking for two answers to one question, and the
 * document's own order is the only honest tie-break.
 */
const dissolveConst = (wgsl: string, name: string): number => {
  const m = new RegExp(`^\\s*const\\s+${name}\\s*(?::\\s*f32\\s*)?=\\s*(-?[\\d.]+)`, "m").exec(wgsl)
  const v = m ? Number(m[1]) : 0
  return Number.isFinite(v) && v > 0 ? v : 0
}

function parseDissolveCycle(sources: string[]): DissolveCycle | null {
  for (const wgsl of sources) {
    // The engine's own parser, not a regex of this file's: two readers of one
    // declaration is how they come to disagree about what it said, which is
    // exactly what the `// @` era cost.
    if (!parseDirectives(wgsl).directives.dissolve) continue
    const out = dissolveConst(wgsl, "DISSOLVE_APART")
    const away = dissolveConst(wgsl, "DISSOLVE_GONE")
    const back = dissolveConst(wgsl, "DISSOLVE_BACK")
    const wait = dissolveConst(wgsl, "DISSOLVE_WHOLE")
    // A cycle has to CONTAIN something. All four at zero is not a dissolve that
    // never fires, it is a period of zero, and the engine would divide by it.
    if (out + away + back + wait <= 0.01) {
      console.warn("[effect] #dissolve needs a cycle longer than nothing — every DISSOLVE_ constant is zero")
      continue
    }
    const breakAt = wait
    const hiddenAt = breakAt + out
    const backAt = hiddenAt + away
    const doneAt = backAt + back
    return { period: doneAt, breakAt, hiddenAt, backAt, doneAt }
  }
  return null
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
  /** Cast member ids, in order — stages excluded, the same list the engine's
   *  own subjects are drawn from. Only used to decide WHO an effect that
   *  declares a dissolve is about; the first of them is subject 0. */
  castIds = [],
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
  hdri?: File | null
  exportBackground?: ExportBackground
  castIds?: string[]
}) {
  const compositing = isCompositingBackground(exportBackground)
  // Per-section identity guard: setSun dirties the shadow map (an extra full pass
  // per frame), so an unguarded push re-rendered shadows on every bloom tick.
  const prev = useRef<{
    settings: SceneSettings
    gradeSpec: GradeSpec
    backdrop: boolean
    green: ExportBackground
  } | null>(null)
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
    const modeChanged = !p || p.backdrop !== hasBackdrop || p.green !== exportBackground

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
      engine.setPhysicsFloor(physics.floor)
    }
    if (modeChanged || p.settings.ground !== ground) {
      // Before the options, and outside the rAF coalescing below: this is a
      // flag, not a buffer rebuild, and it is what a scene with no floor is
      // waiting on.
      engine.setGroundVisible(ground.enabled)
      groundOpts.current = {
        diffuseColor: hexToLinearVec3(ground.color),
        gridLineColor: hexToLinearVec3(ground.grid),
        opacity: compositing ? 0 : ground.opacity,
        shadowStrength: ground.shadow ? 1 : 0,
        gridLineOpacity: compositing || !ground.gridEnabled ? 0 : 0.4,
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
    prev.current = { settings, gradeSpec, backdrop: hasBackdrop, green: exportBackground }
  }, [settings, gradeSpec, ready, engineRef, hasBackdrop, exportBackground, compositing])

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
      if (lastWgsl.current !== null) {
        lastWgsl.current = null
        void engineRef.current?.setEffects(null)
      }
      return
    }
    if (wgsl === lastWgsl.current) return
    lastWgsl.current = wgsl
    // ── An effect that takes the cast apart ──
    //
    // "// @dissolve period breakAt hiddenAt backAt doneAt", in seconds. The
    // effect declares the TIMING and the engine performs it: the material shell
    // is what actually throws the model away, and no shader can reach that from
    // a field or particle mount. Handing the numbers over here rather than
    // ticking them per frame is what keeps one clock — the engine samples the
    // cycle where it samples everything else time-driven, writes the value into
    // every material AND into the cast, and the effect reads it back as
    // rzSubject(i).dissolve. So the sparks cannot drift from the body.
    //
    // Subject 0 only, deliberately: the effect drawing the sparks spawns them
    // off subject 0's skeleton, and dissolving a character nobody is drawing
    // sparks for would be a model that vanishes with no explanation.
    const cycle = parseDissolveCycle(sources)
    const subject = castIds[0] ?? null
    if (subject) engine.setModelDissolveCycle(subject, cycle)
    let stale = false
    void engine.setEffects(sources.length ? sources.map((s) => ({ wgsl: s })) : null).then((rs) => {
      if (stale) return
      // An install builds fresh instances, so whatever was scheduled is gone
      // with the ones it was set on. Re-applied HERE as well as on change,
      // because the two arrive in either order: editing a strip does not
      // reinstall, and installing does not know a strip changed.
      applySchedules(engine, backgroundEffects)
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
  }, [backgroundEffects, exportBackground, ready, engineRef, castIds])

  /**
   * Strips onto instances, whenever one is edited.
   *
   * Separate from the install above because editing WHEN an effect plays must
   * not recompile it — the guard up there returns early when the sources have
   * not changed, which is exactly right for a shader and exactly wrong for the
   * timing beside it.
   *
   * Keyed on the timing alone, so dragging a strip does not re-run on every
   * unrelated edit to the list, and re-running is harmless when it does: both
   * calls are idempotent writes of a number.
   */
  const scheduleKey = JSON.stringify(backgroundEffects.map((e) => [e.influence ?? 1, e.window ?? null]))
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    applySchedules(engine, backgroundEffects)
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
        console.info(`[world] HDRI installed (${img.width}x${img.height}) — lighting:`, wl)
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
    },
  }
}
