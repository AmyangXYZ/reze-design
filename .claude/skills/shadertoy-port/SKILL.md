---
name: shadertoy-port
description: Port a Shadertoy (or any GLSL multipass demo) into a reze-engine WGSL effect faithfully — build the original in numpy first and LOOK at it, convert its units instead of reinterpreting its intent, then verify the port against the same picture. Use whenever asked to bring a shader demo into the effects library, to fix an effect that "looks wrong" versus its reference, or to judge which of a shader's constants are load-bearing.
---

# Porting a shader demo faithfully

The failure this exists to prevent: reading the reference, understanding what it
is *doing*, and rewriting that understanding. The result compiles, animates, and
is wrong in ways nobody can name — because at no point did anyone put the two
pictures side by side.

Everything below came out of porting xjorma's "Dry Ice" twice. The first attempt
was a competent reinterpretation and looked bad. The second was a unit
conversion and looked like the original.

## 1. Build the reference in numpy first, and look at it

There is no headless WebGPU here and no network. But numpy + Pillow runs a
fullscreen fragment shader fine at 512×288, and **a picture you can look at is
worth more than any amount of reading**.

`harness.py` in this directory has the pieces: clamp-to-edge `bilinear`,
`shift` for `texelFetch` neighbours, GLSL-compatible hashes and value noise,
`save_png` with the y-flip. Port each Buffer as one function over whole arrays.

- Multipass order matters. Shadertoy runs Buffer A→B→C→D per frame, and a buffer
  reading one that already ran **this** frame sees this frame's values; reading
  one that runs later sees last frame's. Get this wrong and the feedback loop
  changes character.
- Sim at the reference's own resolution. Its look often depends on it (see §2).
- Run it to steady state, not 60 frames. Advection-driven structure takes
  hundreds of frames to build. Print `mean/max` of each field every 50 frames and
  watch them level off — those numbers are also your port's acceptance test.
- Budget ~1.5–3 s/frame at 512×288. Run it in the background and work meanwhile.

Save the raw field as `.npy` too. Re-rendering from it is seconds, so camera and
lighting experiments do not re-run the sim.

## 2. Convert units. Do not reinterpret them.

A Shadertoy is written in **pixels and frames**, in a uv normalised by the
viewport height. None of those exist in an engine: a sim grid is a fixed number
of texels, and `dt` is whatever the machine managed. So every constant is the
original's number times a conversion.

| the original says | it means | multiply by |
|---|---|---|
| `x *= 0.99` per frame | a decay rate | `-ln(0.99)·60` → `exp(-r·dt)` |
| `d += k·n` per frame | a rate | `k·60`, then `·dt` |
| `v += k·n` per frame, v in px/frame | an **acceleration** | `k·60/H` **and** `·60`, then `·dt` |
| `pos -= v` (v in px/frame) | a displacement | `v·dt` with v in fields/s |
| `uv*40` where uv spans 2 | cycles across the field | `·2` → 80 |

**The trap, and it is the one that cost the most:** an `+=` into a quantity that
is *itself* per-frame is an acceleration, so **both** 60s apply. Convert it as a
velocity — which is how it reads — and the fluid comes out 60× too slack. It
still churns, because the noise fields keep moving underneath it, so it survives
a look. Only measuring `mean|v|` against the reference's caught it.

**Pin the conversion to one resolution** (`H` above, e.g. 288) and say so in a
comment. Many demos are genuinely resolution-dependent — at 1080p the same source
runs a slower, finer fluid, because "one pixel" is a smaller share of the screen.
Pinning it is what makes the port resolution-independent, so raising the grid
buys sharpness and changes nothing else.

## 3. Find which internal ratios are the composition

Measure the reference's own proportions before changing any absolute size: fog
depth over field width, emitter radius over fog depth, light height over fog
depth, noise cell size over fog depth. **Those ratios are the look**; the
absolute numbers are just its window size.

Then ask which ones survive the move. They will not all survive, because the
reference is scaled around whatever it draws — Dry Ice around a ball 3% of its
field — and an MMD model is 12% of the stage and has to stay visible. Decide
deliberately, and write down which ratio you broke and why:

- Tie to the **subject** what has a real size (a foot is 2.6 units and does not
  grow when the stage does).
- Tie to the **feature being lit** what shapes the look — light height and noise
  cell size belong to the fog's DEPTH, not the pool's width. Hang the lamp at a
  share of the span instead and the 1/d² goes flat across the whole floor and
  every shadow gets too short to see: a white sheet instead of a lit pool.
- Tie to the **field** only what is genuinely a share of it (the rim fade).

## 4. Run controlled experiments on the one thing you doubt

When a design decision is expensive (does this need a real pressure solve, or
will curl noise do?), vary exactly that in the numpy reference, render the field
as a PNG, and look. For Dry Ice: 20 Jacobi iterations/frame (‖div‖ 0.023),
1/frame (0.032), none (0.098) — and the pictures showed one/frame keeps the
spirals while none gives a blobby smear. That settled a whole class of "should I
also…" questions in one 5-minute run of four background processes.

## 5. Mirror the port in the same harness and compare

Write the WGSL, then mirror *its* arithmetic in numpy with the same constants and
render it with the same camera. This is the only step that actually verifies the
port, and it is where the real bugs surfaced:

- The projection was subtracted from the backtrace direction but not from the
  velocity being **stored** — so the divergent half never left the grid.
- The density decay was being applied to velocity as well, damping exactly the
  circulation the effect is for.
- Both stirring rates were 60× too slack (§2).

Compare `mean`, `max` and `mean|v|` against the reference's numbers, not just the
pictures. Matching within ~10% is the bar.

## 6. Shader-porting traps worth checking every time

- **`fbm` centring.** An fbm of k octaves averages `0.5·(1-2⁻ᵏ)`, not 0.5.
  Subtracting a flat 0.5 biases every sample low by the same amount — and a
  constant added to a *velocity* field every frame is a wind that nothing
  removes, because a uniform flow has no divergence for the solve to find.
  Subtract the actual mean; it makes the octave count a free parameter.
- **Sub-texel octaves.** On a grid, an octave finer than a texel cannot be
  advected — it is re-randomised every frame, so it is not grain that flows, it
  is white noise stirred into the field 60×/s. It lands on screen as wet sand.
  Stop the octaves at ~1 texel. (In the original they are sub-*pixel* and read as
  film grain, which is why the count looks safe to copy.)
- **Gamma.** A demo ending in `sqrt(col)` is gamma-encoding a linear radiance.
  The `foreground`/`background` mounts return display-space sRGB, so that `sqrt`
  must survive the port or everything arrives about half as bright.
- **Straight alpha.** Many demos do `mix(scene, fogColor, 1-T)` where `fogColor`
  already has coverage folded in — double-counting it. Returning a straight-alpha
  layer means dividing the accumulated energy by alpha.
- **`smoothstep(hi, lo, x)`** is undefined in WGSL when `low >= high`. Write
  `1.0 - smoothstep(lo, hi, x)`. It is the kind of undefined that works locally.
- **Linear vs Beer–Lambert.** `T *= 1 - density` is the small-step approximation.
  At engine step sizes a grazing ray can carry density past 1 in one step, and it
  returns a *negative* transmittance. Use `1 - exp(-d)`.
- **Sine hashes.** `fract(sin(x)*43758.5)` in float32 degenerates into concentric
  rings and oil-slick swirls once `x` reaches six figures — which world
  coordinates do immediately. Use a sine-free hash.
- **Jitter amplitude.** A dither of a whole march step is right at the original's
  resolution and slice count. At full resolution, feeding the shadow march too, it is
  a speckle over the whole effect rather than a dither along its contours. Half a
  step still breaks the banding.
- **The reference's boundary may be hidden by its own scenery.** Dry Ice's buffer
  edge *is* its floor slab's edge, so its hard cut never shows. On a stage of the
  user's own size, the field has to end on its own — fade the INJECTION, not the
  field: a mask multiplied in every frame compounds into `inject/(1-keep·mask)`,
  so halving it divides the result by fifty rather than by two.

## 7. Engine contract (reze-engine)

Read `node_modules/reze-engine/src/shaders/passes/sim.ts` and `composite.ts` for
the current truth. In brief:

- `#sim N` gives one `rgba16float` grid, ping-ponged, stepped once per frame
  by `fn simStep(uv, prev, dt) -> vec4f`. Four channels, that is all — a solve
  needing more passes has to fit in one, or be reformulated.
- `rzSimFrame() == 0` is the only chance to seed. `dt` is clamped to 0.1.
- Field mounts run at FULL resolution by default. `#halfres` opts out, and is
  right for anything soft. Do not declare it when the effect's ALPHA has a hard
  edge — reading scene depth gives it one along every silhouette.
- `#anchor <bone>` per slot, `trail` only if you need the path — `rzAnchor`
  already gives pos/vel/fwd, which is what an emitter wants.
- Directives are SYNTAX, not comments: `#tag args`, one per line at the top,
  parsed and stripped by the engine, with a line-numbered error for anything it
  does not recognise. Text after a `—` or `//` on the same line is a note.
- `fn foreground(ray, uv, time, depth)` returns display-space sRGB + straight
  alpha; `depth` is the scene's, in metres along the view axis.
- The whole effect file is spliced into *every* module it has a mount in, so
  `simStep` gets compiled inside the field shader too. Everything it calls has to
  resolve in both.

## 8. Do not test in the browser yourself

Report from code and hand off — the user tests in their own browser. What you owe
them is the numbers and the side-by-side, not a screenshot you took.
