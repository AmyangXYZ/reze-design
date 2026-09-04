// Recovering a camera from one frame of footage.
//
// The problem this solves: a scene standing in a plate has to agree with the
// camera that shot it, and matching a lens, a tilt and a lean by eye is genuinely
// hard — hard enough that doing it by hand is most of the reason compositing is a
// specialist job. The geometry, though, is closed form and a century old.
//
// WHAT IT USES. In a pinhole camera, world-parallel lines image as lines meeting
// at one point — the vanishing point of that direction. Two facts follow:
//
//   * The verticals of a built scene share a vanishing point (the ZENITH). Where
//     it sits relative to the image centre is the camera's lean and pitch.
//   * Horizontal directions vanish on the HORIZON. Two of them at right angles fix
//     the focal length outright: with the principal point p at the centre,
//     f² = −(v₁−p)·(v₂−p). Five lines of arithmetic, no fitting.
//
// NO LEARNING, and not as a limitation — this is what the professional tools do.
// 3DEqualizer, SynthEyes, Blender's own tracker are all classical. It also makes
// the whole thing DETERMINISTIC: one plate always yields one camera, which is what
// lets a scene re-open a month later on the shot its author left.
//
// WHAT IT CANNOT DO. A single view is scale-free — no algorithm recovers metres
// from pixels without a known length in frame. So this never guesses how far away
// anything is; the author places the cast, and their size sets the scale.
//
// Verified in `plate-calibrate.test.mts` against synthetic scenes rendered from a
// known camera, which is the only oracle that can say the answer is RIGHT rather
// than merely stable.

/** A frame to solve, as RGBA — an ImageData, or anything shaped like one. */
export type PlateFrame = { data: Uint8ClampedArray; width: number; height: number }

export type Calibration = {
  /** Vertical field of view, radians. */
  fov: number
  /** Pitch, radians. Positive looks DOWN, which is what a camera above a floor does. */
  pitch: number
  /** Lean about the view axis, radians. */
  roll: number
  /** Image y of the horizon in the ORIGINAL frame's pixels, for drawing it back.
   *  Null when only the lean was recoverable. */
  horizonY: number | null
  /**
   * How much of the answer the picture actually supported, 0–1.
   *
   * Reported rather than thresholded here: a weak solve on a plate with two
   * usable edges is still better than the stock camera, and whether to show it
   * as a suggestion or apply it silently is the caller's call, not the solver's.
   */
  confidence: number
  /** Which parts came from the image at all. A beach has no straight lines and
   *  no amount of effort will produce a lens from one; saying so is the honest
   *  result, and lets the UI leave those sliders alone rather than move them to
   *  a guess. */
  solved: { roll: boolean; fov: boolean; pitch: boolean }
}

/** Working resolution. The estimate comes from line ORIENTATIONS, which survive a
 *  downscale — and a 4K plate at full size is forty times the work for an answer
 *  that agrees to a tenth of a degree. */
const WORK_MAX = 640
/** Orientation bins over a half turn: 0.5° each. Finer than the lean is worth
 *  reporting, coarse enough that one edge's votes land in one bin. */
const THETA_BINS = 360
/** Keep this fraction of pixels as edges. A picture is mostly not an edge; the
 *  strongest few per cent are where the straight lines are. */
const EDGE_KEEP = 0.12

/** Grayscale at working size, box-filtered on the way down so a downscale cannot
 *  manufacture edges out of aliasing — which would then be voted on as real. */
function toGray(frame: PlateFrame): { g: Float32Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, WORK_MAX / Math.max(frame.width, frame.height))
  const w = Math.max(8, Math.round(frame.width * scale))
  const h = Math.max(8, Math.round(frame.height * scale))
  const g = new Float32Array(w * h)
  const sx = frame.width / w
  const sy = frame.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let sum = 0
      let n = 0
      for (let yy = y0; yy < y1 && yy < frame.height; yy++) {
        for (let xx = x0; xx < x1 && xx < frame.width; xx++) {
          const i = (yy * frame.width + xx) * 4
          // Rec.601 luma: the standard weighting, and the one an edge detector
          // wants — it tracks perceived lightness, so a red/green boundary of
          // equal brightness correctly reads as no edge.
          sum += 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2]
          n++
        }
      }
      g[y * w + x] = n ? sum / n : 0
    }
  }
  return { g: blur(g, w, h), w, h, scale }
}

/**
 * A small separable Gaussian, and the reason it is not optional.
 *
 * Every angle here comes from a Sobel gradient, and on a thin hard-edged line
 * that gradient QUANTISES TOWARD THE AXES: a line four degrees off horizontal
 * rasterises into a staircase whose every step reads as exactly horizontal, so
 * the whole family votes into the horizontal bin and the picture appears to be
 * full of parallel lines that in truth converge. That was measured on the
 * synthetic plates — three real vanishing points collapsed into one phantom at
 * infinity — and it is the same failure a photograph would show wherever the
 * lens is sharp and the edge is thin.
 *
 * σ≈1 is enough. The point is not to remove noise but to give the gradient a
 * ramp wide enough to have a direction, which is what makes an orientation
 * accurate to a fraction of a degree instead of to the nearest axis.
 */
function blur(src: Float32Array, w: number, h: number): Float32Array {
  const k = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136]
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0
      for (let i = -2; i <= 2; i++) a += k[i + 2] * src[y * w + Math.min(w - 1, Math.max(0, x + i))]
      tmp[y * w + x] = a
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0
      for (let i = -2; i <= 2; i++) a += k[i + 2] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]
      out[y * w + x] = a
    }
  }
  return out
}

/**
 * One detected line SEGMENT, in NORMALISED centred coordinates: origin at the
 * principal point, y down, both axes divided by the image half-diagonal.
 *
 * `nx,ny` is the unit normal and `rho` the signed offset, so the homogeneous line
 * is (nx, ny, −rho). `mx,my` is the midpoint of the pixels that actually support
 * it and `len` how far they run.
 *
 * THE MIDPOINT IS WHY THIS IS A SEGMENT AND NOT A LINE. A vanishing point is
 * tested by asking whether a segment POINTS AT it — the angle between its own
 * direction and the direction from its midpoint to the point. With only infinite
 * lines the best available test is the algebraic residual l·v, and that has a
 * degenerate attractor: the point at infinity in some direction scores every line
 * parallel to it, whether or not those lines converge anywhere. On a floor grid
 * the cross-lines bunch up near the horizon, all of them nearly horizontal, and
 * that phantom out-votes the real vanishing point every time. Measured, not
 * reasoned about — the synthetic plates returned a lens of exactly nothing until
 * the midpoints arrived.
 *
 * The normalisation is not cosmetic either: in raw pixels rho runs to the
 * hundreds while nx and ny are at most one, so any fit over the three would be
 * almost entirely a statement about rho. Dividing through is Hartley's
 * normalisation, and it is the difference between this working and not.
 */
type Line = { nx: number; ny: number; rho: number; mx: number; my: number; len: number; weight: number }


/**
 * How badly a segment misses pointing at a vanishing point, as |sin| of the angle.
 *
 * `v` is homogeneous, so the direction from midpoint m to it is v.xy − v.z·m —
 * which stays meaningful as v.z → 0 and the point runs off to infinity, where the
 * direction is simply v.xy. One expression, both regimes, and no special case for
 * the parallel families a level shot is full of.
 */
function vpResidual(l: Line, v: [number, number, number]): number {
  const dx = v[0] - v[2] * l.mx
  const dy = v[1] - v[2] * l.my
  const dl = Math.hypot(dx, dy)
  if (!(dl > 1e-12)) return Infinity
  // The segment runs along its normal turned a quarter: (−ny, nx). Cross it with
  // the direction to the point; the magnitude is the sine of the angle between.
  return Math.abs((-l.ny * dy - l.nx * dx) / dl)
}

/**
 * The point closest to lying on all of them, as a homogeneous 3-vector.
 *
 * Each line contributes lᵀv = 0, so the answer is the null space of the stacked
 * lines — the eigenvector of Σ w·llᵀ with the smallest eigenvalue. Homogeneous,
 * so it holds a vanishing point at infinity (z = 0) as comfortably as one in
 * frame, which matters: a level shot's verticals are exactly parallel and their
 * zenith IS at infinity.
 */
function nullDirection(lines: Line[]): [number, number, number] | null {
  if (lines.length < 2) return null
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const ln of lines) {
    const s = Math.hypot(ln.nx, ln.ny, ln.rho) || 1
    const v = [ln.nx / s, ln.ny / s, -ln.rho / s]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += ln.weight * v[i] * v[j]
  }
  const tr = m[0] + m[4] + m[8]
  if (!(tr > 0)) return null
  // Smallest eigenvector by inverse power iteration on (M + εI), started from
  // three seeds so a start orthogonal to the answer cannot decide it.
  const eps = tr * 1e-9
  const a = [m[0] + eps, m[1], m[2], m[3], m[4] + eps, m[5], m[6], m[7], m[8] + eps]
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
  if (!isFinite(det) || Math.abs(det) < 1e-30) return null
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ]
  let bestV: [number, number, number] | null = null
  let bestR = Infinity
  for (const seed of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    let v = seed.slice()
    for (let it = 0; it < 60; it++) {
      const n = [
        inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2],
        inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2],
        inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2],
      ]
      const len = Math.hypot(n[0], n[1], n[2])
      if (!(len > 0) || !isFinite(len)) break
      v = [n[0] / len, n[1] / len, n[2] / len]
    }
    const rq =
      v[0] * (m[0] * v[0] + m[1] * v[1] + m[2] * v[2]) +
      v[1] * (m[3] * v[0] + m[4] * v[1] + m[5] * v[2]) +
      v[2] * (m[6] * v[0] + m[7] * v[1] + m[8] * v[2])
    if (isFinite(rq) && rq < bestR) {
      bestR = rq
      bestV = [v[0], v[1], v[2]]
    }
  }
  return bestV
}

/**
 * The best vanishing point in a set of segments, by an EXHAUSTIVE pass over pairs.
 *
 * Two lines meet at exactly one point — their cross product — so every pair is a
 * hypothesis, and with the count capped there are few enough to try them all and
 * keep the one the most segments point at, weighted by length: a forty-pixel
 * scratch should not outvote a wall.
 *
 * Exhaustive rather than RANSAC on purpose. Sampling would give the same answer
 * on almost every plate and a different one now and then, and a scene has to
 * re-open on the shot its author left.
 */
function bestVp(lines: Line[], tol: number): { v: [number, number, number]; inliers: Line[]; rest: Line[] } | null {
  if (lines.length < 3) return null
  const H = lines.map((l): [number, number, number] => {
    const m = Math.hypot(l.nx, l.ny, l.rho) || 1
    return [l.nx / m, l.ny / m, -l.rho / m]
  })
  let bestScore = -1
  let bestV: [number, number, number] | null = null
  for (let i = 0; i < H.length; i++) {
    for (let j = i + 1; j < H.length; j++) {
      const a = H[i]
      const b = H[j]
      const v: [number, number, number] = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
      const len = Math.hypot(v[0], v[1], v[2])
      // Two copies of one line meet nowhere in particular.
      if (!(len > 1e-6)) continue
      v[0] /= len
      v[1] /= len
      v[2] /= len
      let score = 0
      for (let k = 0; k < lines.length; k++) if (vpResidual(lines[k], v) < tol) score += lines[k].weight
      if (score > bestScore) {
        bestScore = score
        bestV = v
      }
    }
  }
  if (!bestV) return null
  const inliers: Line[] = []
  const rest: Line[] = []
  for (const l of lines) (vpResidual(l, bestV) < tol ? inliers : rest).push(l)
  // The winning pair fixed the hypothesis; the whole inlier set fixes the value.
  const refined = inliers.length >= 2 ? nullDirection(inliers) : null
  if (process.env.PC_NO_REFINE) return { v: bestV, inliers, rest }
  return { v: refined ?? bestV, inliers, rest }
}

/**
 * Segments, by GROWING REGIONS of agreeing gradient — the core of LSD, and the
 * reason the real match-move tools use a detector of this family.
 *
 * Start at the strongest unused pixel, then repeatedly absorb neighbours whose
 * gradient points the same way as the region's running average. What comes out
 * is a connected patch of pixels that genuinely belong to one edge; fitting a
 * line to it gives that edge's direction, position, length AND width, all
 * measured rather than inferred.
 *
 * WHY NOT A HOUGH TRANSFORM, which is what this was first: an accumulator says
 * how many pixels are consistent with a line, never which ones or whether they
 * are contiguous. Every real edge lands in several neighbouring cells, so one
 * wall arrived as five parallel walls and outvoted the rest of the room. Trying
 * to suppress the copies with a threshold relative to the strongest cell made
 * the whole detector turn on whichever edge happened to be longest — leaning the
 * same camera eight degrees took the line count from thirty-five to six. Growing
 * a region marks its pixels used, so an edge can only be found once, and nothing
 * downstream depends on a magic number.
 */
function detectLines(g: Float32Array, w: number, h: number, norm: number): Line[] {
  const cx = w / 2
  const cy = h / 2
  const n = w * h
  const gx = new Float32Array(n)
  const gy = new Float32Array(n)
  const mag = new Float32Array(n)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = g[i - w - 1], t = g[i - w], tr = g[i - w + 1]
      const l = g[i - 1], r = g[i + 1]
      const bl = g[i + w - 1], b = g[i + w], br = g[i + w + 1]
      const dx = tr + 2 * r + br - tl - 2 * l - bl
      const dy = bl + 2 * b + br - tl - 2 * t - tr
      gx[i] = dx
      gy[i] = dy
      const m = Math.hypot(dx, dy)
      mag[i] = m
      if (m > maxMag) maxMag = m
    }
  }
  // A flat picture — a blank wall, a clear sky — has no edges to find.
  if (maxMag < 1e-3) return []
  // Below this a gradient is texture or noise, and its direction says nothing.
  // Relative to the strongest so it travels between a bright plate and a dim one;
  // region growing is what does the real selecting, so this only has to be low.
  const floorMag = maxMag * 0.04

  // Seeds strongest first, so each region is grown from its own clearest pixel
  // rather than from whichever edge the scan happened to reach first. Bucketed
  // rather than sorted: the order only has to be approximately by strength.
  const BUCKETS = 1024
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => [])
  for (let i = 0; i < n; i++) {
    if (mag[i] < floorMag) continue
    buckets[Math.min(BUCKETS - 1, Math.floor((mag[i] / maxMag) * BUCKETS))].push(i)
  }

  const used = new Uint8Array(n)
  const stack = new Int32Array(n)
  const region = new Int32Array(n)
  const out: Line[] = []
  // How far a pixel's gradient may sit from the region's average and still join.
  const TOL = (22 * Math.PI) / 180

  for (let bi = BUCKETS - 1; bi >= 0 && out.length < 300; bi--) {
    for (const seed of buckets[bi]) {
      if (used[seed]) continue
      // Angles live MODULO π: the two sides of a bright line have gradients
      // pointing opposite ways and belong to the same edge. Averaged as doubled
      // angles, which is the only way to average a direction that wraps at π.
      let sumC = Math.cos(2 * Math.atan2(gy[seed], gx[seed]))
      let sumS = Math.sin(2 * Math.atan2(gy[seed], gx[seed]))
      let count = 1
      used[seed] = 1
      region[0] = seed
      let rN = 1
      stack[0] = seed
      let sp = 1
      while (sp > 0) {
        const p = stack[--sp]
        const px = p % w
        const py = (p / w) | 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const qx = px + dx
            const qy = py + dy
            if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= h - 1) continue
            const q = qy * w + qx
            if (used[q] || mag[q] < floorMag) continue
            const mean = Math.atan2(sumS / count, sumC / count) / 2
            const qa = Math.atan2(gy[q], gx[q])
            let d = Math.abs(qa - mean) % Math.PI
            if (d > Math.PI / 2) d = Math.PI - d
            if (d > TOL) continue
            used[q] = 1
            sumC += Math.cos(2 * qa)
            sumS += Math.sin(2 * qa)
            count++
            region[rN++] = q
            stack[sp++] = q
          }
        }
      }
      if (rN < 16) continue

      // Fit: the principal axis of the region, weighted by gradient strength —
      // the direction along which the patch is longest, which for an edge is the
      // edge. Length and WIDTH both fall out, and the width is what tells a line
      // apart from a blob.
      let sw = 0
      let mx = 0
      let my = 0
      for (let k = 0; k < rN; k++) {
        const i = region[k]
        const m = mag[i]
        sw += m
        mx += m * (i % w)
        my += m * ((i / w) | 0)
      }
      mx /= sw
      my /= sw
      let sxx = 0
      let syy = 0
      let sxy = 0
      for (let k = 0; k < rN; k++) {
        const i = region[k]
        const m = mag[i]
        const ax = (i % w) - mx
        const ay = ((i / w) | 0) - my
        sxx += m * ax * ax
        syy += m * ay * ay
        sxy += m * ax * ay
      }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
      const dxu = Math.cos(th)
      const dyu = Math.sin(th)
      let tMin = Infinity
      let tMax = -Infinity
      let uMin = Infinity
      let uMax = -Infinity
      for (let k = 0; k < rN; k++) {
        const i = region[k]
        const ax = (i % w) - mx
        const ay = ((i / w) | 0) - my
        const t = ax * dxu + ay * dyu
        const u = -ax * dyu + ay * dxu
        if (t < tMin) tMin = t
        if (t > tMax) tMax = t
        if (u < uMin) uMin = u
        if (u > uMax) uMax = u
      }
      const len = tMax - tMin
      const wid = Math.max(uMax - uMin, 1)
      // Long enough to state a direction, and thin enough to be an edge rather
      // than a smear. A patch three times as long as it is wide is a line; the
      // same pixel count in a blob is a texture.
      if (len < 18 || len / wid < 3) continue

      // Into the Line convention: normal n = (dy, −dx), folded so ny ≥ 0 the way
      // the rest of the module expects, and rho measured from the principal
      // point in half-diagonals.
      let nx = dyu
      let ny = -dxu
      if (ny < 0 || (ny === 0 && nx < 0)) {
        nx = -nx
        ny = -ny
      }
      const ccx = mx - cx
      const ccy = my - cy
      out.push({
        nx,
        ny,
        rho: (nx * ccx + ny * ccy) / norm,
        mx: ccx / norm,
        my: ccy / norm,
        len: len / norm,
        // Length is the whole weight now. A region is found once, so there is no
        // duplication left for a density term to discount.
        weight: len / norm,
      })
      if (out.length >= 300) break
    }
  }
  out.sort((a, b) => b.len - a.len)
  return out.slice(0, 120)
}

/** Unit direction from the principal point toward a vanishing point. Homogeneous,
 *  so a point at infinity (z→0) is simply its own direction and needs no case. */
function dirOf(v: [number, number, number]): [number, number] {
  const dx = Math.abs(v[2]) > 1e-9 ? v[0] / v[2] : v[0]
  const dy = Math.abs(v[2]) > 1e-9 ? v[1] / v[2] : v[1]
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

/** The image point of a vanishing point, or null when it lies at infinity — where
 *  it constrains a direction but cannot be one of a focal-length pair. */
function pointOf(v: [number, number, number]): [number, number] | null {
  if (Math.abs(v[2]) < 1e-7) return null
  return [v[0] / v[2], v[1] / v[2]]
}

/**
 * Solve one frame.
 *
 * `focalPrior` is a focal length in the SAME normalised units the solve works in
 * (pixels divided by the image half-diagonal) — device metadata, or the lens
 * already on the scene's camera. Used only when the picture cannot answer for
 * itself, never to overrule it: a plate with two clean perpendicular families
 * knows its own lens better than a lookup table does.
 */
export function calibratePlate(frame: PlateFrame, focalPrior?: number | null): Calibration {
  const none: Calibration = {
    fov: 0,
    pitch: 0,
    roll: 0,
    horizonY: null,
    confidence: 0,
    solved: { roll: false, fov: false, pitch: false },
  }
  const { g, w, h, scale } = toGray(frame)
  // Half-diagonal: the unit everything below is measured in.
  const norm = Math.hypot(w, h) / 2
  const lines = detectLines(g, w, h, norm)
  if (lines.length < 6) return none
  // In normalised coordinates this is roughly "a couple of pixels' worth of
  // slack" on a 640-wide working image, expressed as the sine of an angle.
  const TOL = 0.012

  // ── The directions the picture supports, strongest first ──────────────────
  //
  // NOT split by which way they lean in frame, which was the first cut and was
  // wrong in a way worth recording: a camera tilted down at a floor images the
  // lines running AWAY from it as near-vertical, so filtering "uprights" by image
  // orientation swept an entire horizontal family in with the wall corners.
  //
  // A built scene has directions at right angles — Manhattan's own grid, and the
  // reason the assumption carries the city's name. Take the strongest vanishing
  // point, remove what agreed with it, repeat.
  const vps: { v: [number, number, number]; n: number; d: [number, number]; p: [number, number] | null }[] = []
  let pool = lines
  for (let i = 0; i < 5 && pool.length >= 4; i++) {
    const r = bestVp(pool, TOL)
    // A direction two lines agree on is a coincidence, not a structure.
    if (!r || r.inliers.length < 3) break
    const pt = pointOf(r.v)
    vps.push({
      v: r.v,
      n: r.inliers.length,
      d: dirOf(r.v),
      p: pt,
    })
    pool = r.rest
  }
  if (!vps.length) return none

  // ── The Manhattan frame: three directions at right angles, chosen together ─
  //
  // Scoring vanishing points ONE AT A TIME cannot resolve the case that matters.
  // With the camera tilted down, a floor line running away from it points
  // up-screen — and the vertical vanishing point sits straight down-screen, so
  // the line lies along BOTH. A line has no polarity, so the two give an
  // identical residual and no amount of re-assigning tells them apart. The
  // zenith took the depth family, the depth direction was left in the wrong
  // place, and a fifty-degree lens came back as seventy-six.
  //
  // What does tell them apart is the rest of the picture. Every candidate PAIR
  // fixes a focal length, and a focal length turns each vanishing point into a
  // 3D direction — so the third direction is determined too, as the cross
  // product. Score the whole triplet by how much of the picture it explains and
  // take the best. The wrong reading leaves a family homeless; the right one
  // accounts for all three.
  //
  // Exhaustive over pairs, so the same plate always gives the same frame.
  const vpOf = (d: number[], fc: number): [number, number, number] => {
    // Direction (dx,dy,dz) images at (f·dx/dz, f·dy/dz), which as a homogeneous
    // point is (f·dx, f·dy, dz) — and stays right as dz → 0 and it runs to
    // infinity, which is what a level camera's verticals do.
    const v: [number, number, number] = [fc * d[0], fc * d[1], d[2]]
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  let frame3: { dirs: number[][]; f: number } | null = null
  let bestExplained = -1
  for (let i = 0; i < vps.length; i++) {
    for (let j = i + 1; j < vps.length; j++) {
      const pi = vps[i].p
      const pj = vps[j].p
      if (!pi || !pj) continue
      // TOO FAR IS THE SAME AS INFINITELY FAR — for a LENS. A vanishing point
      // four half-diagonals out is off the picture by more than its own width and
      // its position there is almost entirely noise, because the lines that made
      // it were within a fraction of a degree of parallel. Squaring one into a
      // focal length is how a real room came back at fifteen degrees and full
      // confidence. The bound belongs here and not on the point itself: the
      // horizon reads the zenith's position too, and a mild twelve-degree pitch
      // puts that nearly five half-diagonals out, perfectly well determined.
      if (Math.hypot(pi[0], pi[1]) > 8 || Math.hypot(pj[0], pj[1]) > 8) continue
      // f² = −(v₁−p)·(v₂−p), with p at the origin because the coordinates are
      // centred. Two world directions at right angles put the camera centre on
      // the circle through their vanishing points; a non-negative dot product is
      // that condition failing — rejected rather than square-rooted into a lens.
      const dot = pi[0] * pj[0] + pi[1] * pj[1]
      if (dot >= -1e-9) continue
      const fc = Math.sqrt(-dot)
      const norm3 = (v: number[]) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1
        return [v[0] / l, v[1] / l, v[2] / l]
      }
      const d1 = norm3([pi[0], pi[1], fc])
      const d2 = norm3([pj[0], pj[1], fc])
      const d3 = norm3([
        d1[1] * d2[2] - d1[2] * d2[1],
        d1[2] * d2[0] - d1[0] * d2[2],
        d1[0] * d2[1] - d1[1] * d2[0],
      ])
      const tri = [vpOf(d1, fc), vpOf(d2, fc), vpOf(d3, fc)]
      let explained = 0
      for (const l of lines) {
        let r = Infinity
        for (const v of tri) r = Math.min(r, vpResidual(l, v))
        if (r < TOL) explained += l.weight
      }
      if (explained > bestExplained) {
        bestExplained = explained
        frame3 = { dirs: [d1, d2, d3], f: fc }
      }
    }
  }

  // ── Which of the three is up ──────────────────────────────────────────────
  // A handheld camera leans; it does not lie on its side. So the vertical is the
  // direction whose vanishing point points nearest to up-screen.
  let f: number | null = null
  let fromImage = false
  let up: number[] | null = null
  if (frame3) {
    f = frame3.f
    fromImage = true
    let best = -1
    for (const d of frame3.dirs) {
      const [, dy] = dirOf(vpOf(d, frame3.f))
      if (Math.abs(dy) > best) {
        best = Math.abs(dy)
        up = d
      }
    }
  } else if (focalPrior && focalPrior > 0) {
    // One family and a lens from outside the picture still fixes a lean: the
    // most upright direction the picture showed is the vertical.
    f = focalPrior
    let best = -1
    for (const c of vps) {
      const a2 = Math.abs(c.d[1])
      if (a2 > best) {
        best = a2
        const pt = c.p
        up = pt ? [pt[0], pt[1], f] : [c.d[0], c.d[1], 0]
      }
    }
  }

  // ── The lean ──────────────────────────────────────────────────────────────
  //
  // A lean is a DIRECTION, and needs no lens. The reference room is the case that
  // makes this worth saying: shot square-on to a wall, it is in one-point
  // perspective, which does not determine its own focal length at all — only one
  // horizontal family converges and the other is parallel. There is no frame to
  // find and no lens to find, and the verticals still say plainly which way is
  // up. Requiring f before reporting a lean threw that away and returned nothing
  // for a picture that had answered the question.
  let leanDir: [number, number] | null = up ? dirOf(vpOf(up, f ?? 1)) : null
  if (!leanDir) {
    let best = -1
    for (const c of vps) {
      // A handheld camera leans; it does not lie on its side.
      if (Math.abs(c.d[1]) < Math.cos((40 * Math.PI) / 180)) continue
      if (c.n > best) {
        best = c.n
        leanDir = c.d
      }
    }
  }
  let roll = 0
  let rollOk = false
  if (leanDir) {
    let [dx, dy] = leanDir
    // Point it up-screen, so a vertical found "below" the camera does not report
    // a lean of half a turn.
    if (dy > 0) {
      dx = -dx
      dy = -dy
    }
    roll = Math.atan2(dx, -dy)
    rollOk = true
  }

  // ── The horizon ───────────────────────────────────────────────────────────
  //
  // The vanishing line of every horizontal plane is the set of image points whose
  // ray is perpendicular to the vertical: (x, y, f) · up = 0. At x = 0 that is
  // y = −f·up.z / up.y — which stays correct as the camera levels out, where up
  // lies in the image plane, up.z is zero and the horizon passes through the
  // principal point. Which is the truth about a level camera.
  let horizon: number | null = null
  if (up && f !== null && Math.abs(up[1]) > 1e-6) horizon = (-f * up[2]) / up[1]

  // Sanity, because a solve that cannot be right should say so rather than move
  // three sliders to a number. Nobody shoots a plate at three degrees or at a
  // hundred and forty, and a phone pointed more than sixty degrees off level is
  // photographing the floor or the ceiling, not a scene to stand a figure in.
  const fovRaw = f !== null ? 2 * Math.atan(h / 2 / norm / f) : 0
  const sane = f !== null && f > 0.05 && fovRaw > (10 * Math.PI) / 180 && fovRaw < (130 * Math.PI) / 180
  const fovOk = sane && fromImage
  const pitchOk = sane && horizon !== null && Math.abs(Math.atan2(-horizon, f as number)) < (60 * Math.PI) / 180
  // A camera looking down puts the horizon ABOVE the centre, which with y down is
  // a negative offset — so this sign flip is what makes a positive pitch mean
  // what the rest of the app means by it.
  const pitch = pitchOk ? Math.atan2(-(horizon as number), f as number) : 0
  const fov = fovOk ? fovRaw : 0

  // How much of the picture agreed, not how neat the arithmetic came out. A
  // perpendicular pair found ON ITS OWN is the strong case; a lens taken from a
  // prior is not evidence about this plate and does not count as such.
  const support = Math.min(1, lines.length / 24)
  const parts = (rollOk ? 0.34 : 0) + (fovOk ? 0.33 : 0) + (pitchOk ? 0.33 : 0)
  return {
    fov,
    pitch,
    roll: rollOk ? roll : 0,
    // Back to the ORIGINAL frame's pixels: the caller draws on the plate, not on
    // the working copy, and a horizon off by the downscale factor is a horizon in
    // the wrong place.
    horizonY: pitchOk ? ((horizon as number) * norm + h / 2) / scale : null,
    confidence: parts * (0.5 + 0.5 * support),
    solved: { roll: rollOk, fov: fovOk, pitch: pitchOk },
  }
}

/** Internals, for the synthetic tests only — the numbers behind a solve, so a
 *  failure says WHICH stage lost the picture rather than only that one did. */
export function __debugCalibrate(frame: PlateFrame) {
  const { g, w, h } = toGray(frame)
  const norm = Math.hypot(w, h) / 2
  const lines = detectLines(g, w, h, norm)
  const TOL = 0.012
  const vps: { v: [number, number, number]; n: number; d: [number, number]; p: [number, number] | null }[] = []
  let pool = lines
  for (let i = 0; i < 5 && pool.length >= 4; i++) {
    const r = bestVp(pool, TOL)
    if (!r || r.inliers.length < 3) break
    vps.push({ v: r.v, n: r.inliers.length, d: dirOf(r.v), p: pointOf(r.v) })
    pool = r.rest
  }
  let zen: (typeof vps)[number] | null = null
  for (const c of vps) {
    if (Math.abs(c.d[1]) < Math.cos((40 * Math.PI) / 180)) continue
    if (!zen || c.n > zen.n) zen = c
  }
  return {
    lines: lines.length,
    vps: vps.map((c, i) => {
      const tag = c === zen ? "ZENITH" : "horiz"
      const pos = c.p ? `(${c.p[0].toFixed(2)},${c.p[1].toFixed(2)}) |p|=${Math.hypot(c.p[0], c.p[1]).toFixed(1)}` : "inf"
      return `${i}:${tag} ${pos} dir=(${c.d[0].toFixed(2)},${c.d[1].toFixed(2)}) n=${c.n}`
    }),
  }
}
