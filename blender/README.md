# REZE DESIGN Stage Export — the Blender add-on

Any `.blend` to a stage reze-design loads: one `.glb`, with what a plain glTF
export loses — lights in the app's units, glowing surfaces that light the
room, the room's ambient and haze, the world and the view, instances made
real, particles as live effects.

- `reze_stage_export.py` — the add-on, one file, Blender 4.2+.
- `blender_manifest.toml` — its extension manifest.
- `build_extension.py` — packs the two as an extension zip:
  `python blender/build_extension.py` writes `blender/dist/reze_stage_export-<version>.zip`,
  checked and zipped by Blender's own `extension build`.

## Install

Blender → Edit → Preferences → Add-ons → ▾ (top right) → **Install from Disk…**
→ the zip (or `reze_stage_export.py` itself). Then **File → Export → REZE DESIGN Stage
(.glb)**, and upload the `.glb` in the app as a stage. Your `.blend` is never
changed: the add-on saves a temporary copy and exports that in a background
Blender, showing its progress in the status bar (Esc cancels).

## From a terminal

```sh
blender -b "Stage.blend" --python blender/reze_stage_export.py -- "stages/Stage.glb" \
  [--quality 90] [--png]
```

Blender's own exporter writes the file; the add-on sets the scene up first so
the stage arrives as the `.blend` renders it, and lists what it did in the
stage's notes (the app shows them on load). A plain export from the dialog also
loads when "Punctual Lights" is ticked, but its lamps reach 10 m, glowing
surfaces light nothing, and it brings no world, ambient, haze or particles.

**Materials go out as Blender's own glTF exporter writes them.** What the
add-on adds is the scene around them — how the stage is lit, its air and its
glow — which glTF does not carry.

**Instances are made real** — geometry-node scatters (realized at the end of
the stack first, or the conversion drops them), hair scatters of objects, and
collection instances. glTF has no instances, and a scatter exported as its
base plane.

**Lights**, unit for unit. The loader reads Blender's watts back through glTF's
candela and lux (683 lm/W) and divides by π into the engine's Unity units; the
rest of how a Cycles light behaves rides on each light under `extras.reze`:

- `range` — glTF writes none, and the app fades a lamp to nothing at its range
  (10 m by default) by (1 − (d/R)⁴)². Each lamp states where it falls under
  0.002 of white instead.
- `near` — the app's bulb, inside which the inverse square is held flat. A
  sphere light's is its radius; an area light's is √(A/π), so a wall beside a
  panel peaks at the panel's radiance as it does in Cycles instead of blowing
  out.
- An area light becomes a spot at four times the power (a panel's on-axis
  intensity is `P/π`, a point's `P/4π`) with `angle` 179° and `innerAngle`
  74.5° — the app's aim² cone fitted to a panel's cos θ falloff.
- A light's exposure, colour temperature and an unnormalised area's size fold
  into its colour and power.

Checked against Cycles on a grey diffuse floor under one lamp, Standard view,
region by region: point and sun match to 0.01, an area light to 0.03, a spot
within 0.06 at its edge (Blender's smoothstep blend against the app's cone).

**Glowing surfaces light the room.** Cycles lights a stage from its neon, LED
strips and screens; the app only blooms an emissive surface. Each one brings
lamps, named `<object> glow N`: a surface of emission strength S and colour c
has radiance L = S·c and a patch of area A on-axis intensity L·A. A broad
panel (a screen, a slab glowing on both faces) becomes a spot per face with the
panel cone and its bulb √(A/π); tubes, strips and bulbs become points carrying
L·A/4 (a closed surface's mean), gathered into 1 m cells, the strongest kept up
to the app's 256-lamp cap. A glow from nodes (a picture, a gradient) only
blooms, with a note.

**Ambient** (`extras.reze.ambient.sh`). Cycles renders the room from where the
cast stands (1.2 m above the origin) as a small panorama, with every light and
glow as Blender has them; the irradiance it delivers is integrated over a
spread of normals and the nine coefficients the loader evaluates are fitted
to it (glTF axes, irradiance/π: Unity's units). Indirect only: the lights and
glowing meshes are hidden from the probe's camera rays (they still light what
it sees), because the app adds each of them as a lamp of its own — counting
them here as well lit every shadow twice. It is what the room, the world and
the haze send back — a pink rig's pink shadows.

**Haze → fog** (`extras.reze.fog`). The largest volume (Principled Volume or
Volume Scatter in a box, or the world's volume) becomes the app's distance
fog: extinction σ = its density, starting where the scene camera enters the
box. Its colour is MEASURED, with Blender's own rig before any light is
converted: Cycles renders the scene camera's view with the haze and without,
each pixel solves C₁ = C₀·T + L·(1 − T) (T over the ray's length inside the
box, to the first surface), and the fog takes the per-pixel median of L — a
haze that glows by the lamps and is dim in the stalls is one colour in the
app, and a mean would lift every shadow with the glow. Uniform: a beam through
the haze is not drawn, and haze dense enough to dim the lamps' own light on
its way to the walls measures dark (the app's fog only knows the camera's
side). The volume itself is left out, as glTF would make it a solid box.

**The sky through the haze.** Where nothing stands behind the haze, Cycles
shows it glowing over the world; the app's fog tints surfaces only. So with a
haze the world picture is Cycles' render from where the cast stands with every
surface hidden from camera rays — the world plus what the haze scatters of the
(still shining) lights.

**The world** goes under `extras.reze.world` as a picture: a flat colour as a
tiny HDR of that colour (the app shows a world picture behind the stage, a
world colour only as light), an environment image (`.hdr`/`.exr`, packed or on
disk) as it is, and a world built from nodes — a Sky Texture, a gradient —
rendered by Cycles to a 1024×512 HDR panorama, centre +X and up +Z as
Blender's Environment Texture reads one.

**The view** (`extras.reze.view`): transform, look and exposure, and the
transform itself as Blender computes it. AgX's curve is a LUT inside Blender's
colour config, not a formula, so the add-on asks Blender's colour management
what each colour becomes — a 33³ cube of scene-linear inputs over the engine's
fixed log2 range (2^-12.5 to 2^7) saved through the scene's view transform and
look at exposure 0 — and the app shows the stage through it in place of its
nearest curve (the engine's `setViewLut`; exposure still applies before it).
Checked: within 0.006 of Blender on grey and saturated test colours.

**Pictures that cannot travel** are listed: a video texture, or a file neither
packed nor on disk. Cycles draws a missing one magenta and the app white.

**Bloom** (`extras.reze.bloom`). Blender 4.2+ blooms only through a
compositor Glare node, so the stage carries the .blend's own: a Fog Glow or
Bloom glare's threshold, strength (the app's intensity), tint and size (the
app's scatter); no Glare node — or compositing off — is no bloom. Glowing
materials carry their emission strength (`KHR_materials_emissive_strength`).

**Lights with glossy visibility off** light diffuse only in the app
(`specular: false`): a stage rig fills a shiny floor without flaring it.

### Particles

An EMITTER system becomes the app's generated particle effect, the same one a
Unity stage's systems draw through (`lib/unity-particles.ts`): its spec in
Unity's ParticleSystem terms under `extras.reze.particlesJson`, and each
emitter as a pair of empties `ps<k>_NNN` — its emitting axis, then its sideways
axis, one metre each (`metresPerUnit` 1). What carries: count over the frame
range as a looping rate, lifetime and its random, normal velocity and its
random, velocity along the object's axes, gravity (scene gravity times the
system's field weight), size and its random (times the instanced object's size),
random rotation and spin, and prewarm when the system starts before the scene.
The emitter's shape is its mesh's bounds: a flat mesh is a box across it that
emits along its normal, a round one a sphere emitting outward, anything else a
box sending every way. The picture is the instanced object's image texture, or a
soft dot of its colour; an emissive instance is added (it glows), anything else
laid over. "Show Emitter" off hides the emitter mesh, as Blender renders it.

Not carried, and noted: halo, line and path rendering (Blender's renderers draw
nothing for a halo), physics other than Newtonian or none, forces besides
gravity, brownian motion and damping, children, and anything a particle does
over its life in nodes. A HAIR system of objects is a scatter that stands still,
and is made real instead.

### Candle flames

glTF has no particles, so a flame travels as its ANCHOR: an empty named
`flame.01`, `flame.02`, … at the wick, its local Z running from the flame's
base to its tip and scaled to the flame's length — an unrotated empty scaled
to the length is the hand-built form. The loader reads each as a bone and the
app stands the *Candle Flames (wick bones)* effect on every bone with that
prefix. The Unity pre-pass writes them from the game's flame particle systems
(x340: 53 of them); a stage built in Blender needs only the empties.

