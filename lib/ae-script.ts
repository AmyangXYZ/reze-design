// The shot, written out as an After Effects script.
//
// A .jsx AE runs to build a composition holding the camera the shot was taken
// with, plus a null per character. What it is for: taking a finished render
// into AE and having the 3D space still be there — put a flare where her hand
// was, a title that sits behind her, a light that tracks the shot — without any
// of it drifting.
//
// THE RIG IS NOT INVENTED HERE. It is the one MMD2AE has produced for a decade,
// down to the layer names and the print format, because AE projects and muscle
// memory are built around it: two nulls and a camera, parented Y → X → camera.
//
//   layNully.position      the point the shot orbits
//   layNully.yRotation     yaw
//   layNullx.xRotation     pitch
//   layNullx.zRotation     roll
//   layNullx.anchorPoint.z HOW FAR BACK
//   layCam.zoom            the lens
//
// Distance as the child null's ANCHOR POINT is the piece worth understanding.
// A layer's own transform is T(position) · R · T(−anchorPoint), so the anchor is
// SUBTRACTED before the rotations apply: an anchor of +z puts the camera z back
// along the axis the nulls just aimed. A VMD states its distance as a negative
// number — the camera sits behind its target — so what goes in the anchor is
// −distance. Written straight through, the camera came out mirrored through its
// own target: in front of the shot instead of behind it, at exactly the right
// remove, which is the sort of wrong that reads as a scene problem.
//
// Nothing is composed into a matrix, so every channel stays separately keyable
// in AE, and an animator can grab the yaw without touching the rest.
//
// THE SAMPLES COME FROM THE ENGINE, stepped one exact frame at a time, not from
// re-reading the camera VMD. Whatever actually drove the shot — a camera clip,
// an orbit, a follow, a framing override — is what lands in the script. A pass
// over the VMD would be a second opinion, and the two would part company the
// first time anything but the clip moved the camera.

/** One rendered frame's shot, in MMD's own terms. */
export type ShotSample = {
  /** The point the camera orbits, in MMD units. */
  target: [number, number, number]
  /** Euler radians: pitch, yaw, roll. */
  rotation: [number, number, number]
  /** Negative — the camera sits behind its target, as a VMD states it. */
  distance: number
  /** Vertical field of view, radians. */
  fov: number
}

/** One character's place at one frame. */
export type CastSample = {
  position: [number, number, number]
  /** Euler radians, applied in AE's own order (see rotation notes below). */
  rotation: [number, number, number]
}

export type AeScriptInput = {
  /** Exactly the video's — the comp is built from these, so it lines up by
   *  construction rather than by the person remembering to match them. */
  width: number
  height: number
  fps: number
  /** Frames actually written. Duration follows from it and the rate. */
  frames: number
  /** Where in the clip the render started, seconds. The comp starts at zero
   *  either way; this only names the file. */
  startTime: number
  camera: ShotSample[]
  /** A null per character, each with one sample per frame. */
  cast: { name: string; samples: CastSample[] }[]
  /**
   * MMD units to AE pixels.
   *
   * A free parameter: scale the camera and everything it looks at by the same
   * number and the projection is identical, because the lens is set from the
   * comp's own height rather than from the world. It decides only how big an MMD
   * unit is next to AE 3D layers of your own.
   */
  scale: number
}

const DEG = 180 / Math.PI
/** AE writes times in seconds, and a keyframe landing a hair off its frame is a
 *  keyframe AE may snap somewhere else. Eight places is what the reference uses. */
const t = (n: number) => n.toFixed(8)
const f = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(3)

/**
 * The lens, as AE states it.
 *
 * AE has no field-of-view field: zoom is the distance in PIXELS from the camera
 * to the comp plane, so the same shot is a different number on a different comp
 * height. Deriving it from the comp we are about to create is what keeps the
 * two agreeing.
 */
const zoomFor = (fov: number, height: number) => height / (2 * Math.tan(fov / 2))

/**
 * WHICH SAMPLES A CHANNEL ACTUALLY NEEDS.
 *
 * A shot sampled every frame is mostly straight line: a camera holding still
 * writes the same number sixty times a second, and one panning evenly writes a
 * ramp AE can draw from its two ends. A key on every frame put tens of thousands
 * of them on a single property — enough to make AE crawl, and impossible to
 * adjust afterwards, which is the whole reason a compositor wants the rig rather
 * than a baked render.
 *
 * Douglas–Peucker over (frame, value): keep the two ends, take the sample
 * furthest from the line between them, and split there while anything is further
 * off than `eps`. What comes back reconstructs the original by LINEAR
 * interpolation to within eps, which is exactly how AE reads these keys — the
 * script turns spatial auto-bezier off at every one.
 *
 * Judged on the WHOLE value, not per component: a position is one property and
 * one keyframe carries all three numbers, so dropping a key has to be safe for
 * the worst of them.
 */
function corners(samples: number[][], eps: number): number[] {
  const n = samples.length
  if (n <= 2) return samples.map((_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: number[][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const u = (i - a) / (b - a)
      let d = 0
      for (let c = 0; c < samples[i].length; c++) {
        d = Math.max(d, Math.abs(samples[i][c] - (samples[a][c] + (samples[b][c] - samples[a][c]) * u)))
      }
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > eps) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/**
 * Degrees made CONTINUOUS, each sample snapped to the turn nearest the last.
 *
 * An AE rotation property is unbounded — 370° is a real value, and a full turn
 * is what "one full turn" reads as. The euler out of a VMD wraps instead, so a
 * pan through the back of the shot steps 179° → −179°, and AE draws that as most
 * of a turn the other way. Frame for frame it was one wrong frame; between two
 * kept keys it would be a whole wrong second, so decimation cannot be sound
 * without this.
 */
function unwrap(deg: number[][]): number[][] {
  const out = deg.map((v) => v.slice())
  for (let i = 1; i < out.length; i++) {
    for (let c = 0; c < out[i].length; c++) {
      out[i][c] -= 360 * Math.round((out[i][c] - out[i - 1][c]) / 360)
    }
  }
  return out
}

/**
 * What a dropped keyframe may cost — HALF THE LAST DIGIT THE FILE PRINTS, in
 * every channel, because every channel is written to three decimals.
 *
 * Which makes the decimation as good as free: a key it drops was carrying a
 * number the surviving keys already interpolate to inside the file's own
 * rounding. A held stretch collapses to its two ends, so does an evenly moving
 * one, and only real curvature spends keys. On a 600-frame shot that orbits,
 * rolls, dollies and zooms at once it is 2216 keys instead of 4800, and the
 * camera it rebuilds lands within 0.15 px of the one that went in.
 *
 * Tightening them buys nothing: past here the error is the three decimals, not
 * the dropped keys.
 */
const EPS_POS = 5e-4
const EPS_ROT = 5e-4
const EPS_ZOOM = 5e-4

/**
 * Write the script.
 *
 * One string, no I/O — so it can be tested against a known shot without a
 * browser, an engine or a file system.
 */
export function aeScript(input: AeScriptInput): string {
  const { width, height, fps, frames, camera, cast, scale } = input
  const duration = frames / fps
  const out: string[] = []
  const w = (s: string) => out.push(s)

  w("// Generated by reze-design — the camera and cast of a shot.")
  w("//")
  w(`// ${width}x${height} @ ${fps}fps, ${frames} frames (${duration.toFixed(3)}s)`)
  w(`// MMD units x ${scale} = AE pixels.`)
  w("//")
  w("// Run it from File > Scripts > Run Script File. It builds its own comp, so")
  w("// nothing in your project is touched.")
  w("")
  w(`var Width       = ${width};`)
  w(`var Height      = ${height};`)
  w("var AspectRatio = 1.0;")
  w(`var Duration    = ${duration.toFixed(6)};`)
  w(`var FPS         = ${fps};`)
  w("")
  w("app.beginUndoGroup(\"reze-design camera\");")
  w("")
  w('var newComp  = app.project.items.addComp( "MMD CAMERA", Width, Height, AspectRatio, Duration, FPS );')
  w('var layCam   = newComp.layers.addCamera( "MMD CAMERA", [ 0, 0 ] );')
  w("var layNullx = newComp.layers.addNull();")
  w("var layNully = newComp.layers.addNull();")
  w("")
  w('layNully.name        = "MMD CAMERA CONTROL Y";')
  w("layNully.threeDLayer = true;")
  w("layNully.anchorPoint.setValue( [ 0.0, 0.0, 0.0 ] );")
  w("layNully.position.setValue( [ 0.0, 0.0, 0.0 ] );")
  w("")
  w("layNullx.parent      = layNully;")
  w('layNullx.name        = "MMD CAMERA CONTROL X";')
  w("layNullx.threeDLayer = true;")
  w("layNullx.anchorPoint.setValue( [ 0.0, 0.0, 0.0 ] );")
  w("layNullx.position.setValue( [ 0.0, 0.0, 0.0 ] );")
  w("")
  w("layCam.parent = layNullx;")
  w("layCam.anchorPoint.setValue( [ 0.0, 0.0, 0.0 ] );")
  w("layCam.position.setValue( [ 0.0, 0.0, 0.0 ] );")
  if (camera.length) w(`layCam.property( "zoom" ).setValue( ${f(zoomFor(camera[0].fov, height))} );`)
  w("")

  /**
   * One AE property, keyed only where it turns.
   *
   * `spatial` is for the two properties AE treats as a motion path — a position
   * and an anchor point — where a key also carries tangent handles it will curve
   * through unless told otherwise. The index that call takes is the key's ORDINAL
   * IN THIS PROPERTY: the frame number only ever stood in for it because every
   * frame used to be a key.
   */
  const channel = (prop: string, samples: number[][], eps: number, spatial = false) => {
    const one = samples[0]?.length === 1
    corners(samples, eps).forEach((i, k) => {
      const v = samples[i]
      const value = one ? f(v[0]) : `[ ${f(v[0])}, ${f(v[1])}, ${f(v[2])} ]`
      w(`${prop}.setValueAtTime( ${t(i / fps)}, ${value} );`)
      if (spatial) w(`${prop}.setSpatialAutoBezierAtKey( ${k + 1}, false );`)
    })
    w("")
  }

  // Y IS FLIPPED, here and on every position below. AE's y axis points down the
  // screen and MMD's points up, and this is the one place the two spaces
  // disagree — get it wrong and the shot is upside down in a way that looks like
  // a rotation bug.
  channel(
    "layNully.position",
    camera.map((s) => [s.target[0] * scale, -s.target[1] * scale, s.target[2] * scale]),
    EPS_POS * scale,
    true,
  )
  // Yaw is negated with it: flipping one axis reverses the handedness, and a
  // rotation about the flipped axis has to reverse to match. Pitch and roll turn
  // about axes the flip leaves alone.
  channel("layNully.yRotation", unwrap(camera.map((s) => [-s.rotation[1] * DEG])), EPS_ROT)
  channel(
    "layNullx.anchorPoint",
    camera.map((s) => [0, 0, -s.distance * scale]),
    EPS_POS * scale,
    true,
  )
  channel("layNullx.xRotation", unwrap(camera.map((s) => [s.rotation[0] * DEG])), EPS_ROT)
  channel("layNullx.zRotation", unwrap(camera.map((s) => [s.rotation[2] * DEG])), EPS_ROT)
  // KEYED, not set once. A shot whose lens never moves comes out as one key,
  // which is what the decimation is for; a shot that zooms and was written once
  // is simply wrong, and nothing in AE would say so.
  channel(
    'layCam.property( "zoom" )',
    camera.map((s) => [zoomFor(s.fov, height)]),
    EPS_ZOOM,
  )

  cast.forEach((member, n) => {
    const v = `layCast${n}`
    w(`var ${v} = newComp.layers.addNull();`)
    w(`${v}.name        = ${JSON.stringify(member.name)};`)
    w(`${v}.threeDLayer = true;`)
    w(`${v}.anchorPoint.setValue( [ 0.0, 0.0, 0.0 ] );`)
    channel(
      `${v}.position`,
      member.samples.map((s) => [s.position[0] * scale, -s.position[1] * scale, s.position[2] * scale]),
      EPS_POS * scale,
      true,
    )
    // AE takes orientation as [x, y, z] degrees. Same two flips as the camera,
    // for the same reason.
    channel(
      `${v}.orientation`,
      unwrap(member.samples.map((s) => [s.rotation[0] * DEG, -s.rotation[1] * DEG, s.rotation[2] * DEG])),
      EPS_ROT,
    )
  })

  w("")
  w("app.endUndoGroup();")
  w("")
  return out.join("\n")
}
