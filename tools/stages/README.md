# Stages, by way of Blender

A stage is a `.glb`: what Blender's glTF exporter writes, from a scene built by
hand there or from a game's export read by the scripts here. Two entry points:

- **`export_stage.py`** — any `.blend` to a stage, with what the stock export
  leaves behind (see "Exporting from Blender" below).
- **`unity_to_glb.py`** — a Unity scene from an AssetRipper export, through
  Blender, to the same file.

## Exporting from Blender

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b "Stage.blend" \
  --python tools/stages/export_stage.py -- "stages/Stage/Stage.glb"
```

Blender's own exporter writes the file; the script sets it up so the stage
arrives as the `.blend` renders it: modifiers applied (a ring from a Bezier
circle and geometry nodes exports as nothing otherwise), only what is visible
and renders, lights with area lights as points of the same power, the world
(its colour or its environment image, packed or on disk) and the view under
`extras.reze`, node-driven emission colours folded to constants or baked to an
image at the current frame, and fog volumes left out. A plain export from the
dialog also loads, when "Punctual Lights" is ticked; it brings no world and no
view, and a fog cube comes through as a solid box.

### Candle flames

glTF has no particles, so a flame travels as its ANCHOR: an empty named
`flame.01`, `flame.02`, … at the wick, its local Z running from the flame's
base to its tip and scaled to the flame's length — an unrotated empty scaled
to the length is the hand-built form. The loader reads each as a bone and the
app stands the *Candle Flames (wick bones)* effect on every bone with that
prefix. The Unity pre-pass writes them from the game's flame particle systems
(x340: 53 of them); a stage built in Blender needs only the empties.

## Unity stage → Blender → glTF

Turns a scene from an AssetRipper export into a stage this app loads, by way of
Blender.

```sh
python3 tools/stages/unity_to_glb.py \
  --project "stages/x323-unity/ExportedProject" \
  --scene   "Assets/ComScene/ABResources/Levels/X323.unity" \
  --out     stages/X323.glb --name X323
```

Two steps, one command. The pre-pass reads the export — meshes, materials,
lights, the scene's own settings — and writes a build folder; then Blender,
headless, builds the scene from it, saves `X323.blend` for a person to open,
and exports `X323.glb` with its own glTF exporter, the same exporter a stage
built by hand in Blender goes through. Last, its textures become WebP at
quality 90, same resolution (`EXT_texture_webp`, see `glb_webp.py`; `--png`
keeps them PNG) — about five times smaller, X340 went from 260 MB to 47.
Upload the `.glb` as a stage: it is the whole stage, one file.

Needs Pillow, numpy and Blender — `$BLENDER`, or the usual install on macOS or
Windows. No FBX and no
PMX in between: every hop through another format is a hop that renames a
material or loses a map, and the material **name** is what a person assigns a
look to in the app.

`python3 tools/stages/glb_webp.py <stage.glb>` does the WebP pass alone, for
a .glb exported some other way.

## What comes out

| | |
|---|---|
| `X323.glb` | the whole stage: geometry in metres, one material per Unity material with its albedo, its occlusion-roughness-metal map in glTF's order, its normal map and its emissive map; the lamps and the sun as `KHR_lights_punctual`; and under `extras.reze` the world, the cast's fill, the view the game forms its frame with, and its colour grade (`grading`, below) |
| `build/x323/X323.blend` | the same scene, textures packed, viewed under Filmic +0.6 as the app views it |
| `build/x323/` | what Blender was built from: `scene.json`, geometry, the maps as packed |

Every stage is one `.glb` side by side in `stages/`, and everything it was made
from sits under `stages/build/<stage>/`, out of the way: the build's textures
include the game's sky panoramas, which are inputs and not part of the stage.

**Textures are copied, not resized.** A 2048 albedo arrives as a 2048 albedo.
The property map is repacked, once per material remap: the game keeps metal in
R, roughness in G and occlusion in B, remapped per material by
`_PropertyMin`/`_PropertyMax`; glTF wants occlusion R, roughness G, metal B and
no remap, so the remap is baked and the channels swapped. Emission lives in
that map's alpha (see below) and becomes an emissive map with
`KHR_materials_emissive_strength`.

**Units are metres.** Aether Gazer's unit is not a metre — its props run 1.55×
life size read as one — and a PMX unit is 8 cm, so 1 Unity unit = 0.64 m and
the app scales by 12.5 on load. The mirror between Unity's left hand and
glTF's right turns every triangle's winding, which the pre-pass turns back.
UVs go to Blender as Unity stores them, bottom-up; the exporter flips V once.
Flipped in the pre-pass as well, every island lands mirrored: the stool's
seat wore the atlas's ribbed strip.

**The rig.** Lamps carry the game's own numbers: `(colour × intensity).linear`
as radiance, `range` as reach, the cone as it is; a cookie is folded in as its
mean colour × coverage. The sun's radiance is its strength in W/m², which is
also how the engine lights (`strength·albedo·N·L/π`, Blender's law), so the
number carries as it is through the `.blend` and the app. The game's directional
light lights only the stage — its character shaders never read it — so the app
gives the stage its own sun and leaves the scene's to the cast, sharing only
the direction and the shadow. The cast's fill is `_probeLightingBase`.

**Emission.** `PBR/Standard` keeps it in the property map's alpha:
`e = max((a − min.a) / (max.a − min.a), 0)`, and where e passes 1 the pixel is
the albedo times it and lighting has no say. X203a's paper lamp reaches 2.6, its
monitors more. The global `_EmissionIntensity` that would dim it is 0.

**The world.** The scene's baked reflection probe, at the level the game baked
it. A probe is a BC6H cube — half floats, values far above white, which is where
a room's windows and lamps live — and its blocks travel in the `.asset` as
`_typelessdata`; Blender decodes them, so the file is read with the decoder the
pipeline already has. The PNG an AssetRipper export writes beside it is that
cube flattened to 8 bits, and a room lit by what survived that reads as muddy:
what makes a dark room look lit is its highlights.

Unity lights with two separate things, a trilight ambient for diffuse and the
probe for what speculars mirror, and this engine has one world doing both jobs,
so the image is the probe plus, per direction, whatever the ambient asks for
above what the probe already gives — `probe + max(0, gradient − smooth)`, where
smooth is the probe's own harmonics through l=2. Diffuse lands on the ambient
the scene declares; a highlight brighter than the gradient is left as the game
baked it. X333's world carries 0.35% of the sphere above white, to 7.5.

The cube is looked up at the Unity direction for the engine direction it fills:
X mirrors on the way to glTF and Z on the way in, so a probe sampled as-is is
the room reflected half a turn against itself.

**The grade.** The game grades every frame through a LUT its pipeline bakes
from the volume stack — white balance, colour adjustments, split toning, channel
mixer, shadows/midtones/highlights, lift/gamma/gain — with
`Hidden/RenderPipeline/Lut`; `SceneSetting._colorGraddingLut` is never read.
`unity_grading.py` resolves the scene's global volumes as ag-rip's
`AGVolumes.cs` does and bakes the same cube, the decompiled shader line for
line, into `extras.reze.grading`: `size`³ texels (16, or 32 with
`lutSize32`), 8-bit sRGB, red fastest, and `from`, the overrides it was baked
from. The Final pass looks up its tonemapped colour, linear, and the app looks
up its view transform's output the same way. It keeps the game's integer
division (`_LutParams.w` = 1), so white lands at 15/16 as it does in the game.
A stage whose SceneSetting has tonemapping off shows no grade in the game and
carries none; a local volume is left out and listed.

**The ambient and the fog.** Read from the Unity project's
`ag_render_manifest.json`, as the sim set them. The game lights surfaces with
`_Replica_SH*` — Unity's ambient probe of the scene's trilight, a dim blue L2
SH — and not with its reflection probe, which feeds reflections alone. The
nine coefficients go to `extras.reze.ambient.sh` (glTF axes), the app states
them as the world's diffuse, and the world picture is then the bare probe.
Its fog, `sim_FogColor`/`sim_FogParams` and the darkening `sim_DynFog*`, goes
to `extras.reze.fog` in metres; the engine lays it PER VERTEX as the game does,
which is most of what a floor of long triangles shows of it.

**Surfaces the game builds differently.** `ZTong/Effect_Common` — a sky
layer or a decal on the ground — is baked through the shader's own arithmetic
at time 0: its mask, its HDR second picture, add or blend, and each slot's
tiling switch (off clamps rather than repeats). `PBR/Detailed` (constants over a
mask and a tiling detail picture) is baked to an albedo and an ORM map;
`ZTong/Tong_jichu_AB` (a projection, a soft shadow) to one unlit RGBA picture
at `_Color.a × mask × alpha`; a `Scene/Transparent` coat with nothing of its
own to paint — a view-dependent sheen the app cannot draw — is left out.

**Opaque means opaque.** An OPAQUE material's albedo loses its alpha (an
`_rgb.png` copy beside the original): the game keeps other things there, and a
PMX renderer reads any alpha as see-through. **Draw order is the game's:** each
material carries its render queue (`extras.reze.queue`) and the app draws a
stage's materials in that order, so a stain at 3001 lies on the glass at 3000.

**Left out, and listed when the converter runs:** renderers and lights the game
switches off (on themselves or through a parent), a second directional light,
area lights, LOD1 and below, baked-only lights, an effect decal that cannot be
baked and whose own picture has no coverage, renderers with no readable mesh. A sky layer is
kept whatever its switch says.

## Read the game's shaders

`Assets/Packages/com.p08.render/RenderPipeline/SimPipeline/Shader/` holds the
real shaders (decompiled DXBC — huge, but the property block at the top is clean
and the maths is followable by grepping a property name and tracing the `tmp`
registers). This beats every inference from property names, and settled three
things that had been guessed wrong:

- **`Scene/Plant` tints by the world normal**, not by height:
  `colour = lit * lerp(_BottomColor, _TopColor, n.y*0.5+0.5) * 2`. Averaged over a
  leaf cluster that is `top + bottom`, a constant — which is what a PMX material
  colour holds. It never reads `_AlbedoColor`.
- **`OPAQUE` in the keywords is not opacity.** It tracks the `RenderType` tag.
  X333's pool carries it while its pass reads `QUEUE = Transparent-1` and blends
  `SrcAlpha OneMinusSrcAlpha` at 7% — reading the keyword as opacity exported the
  pool as a solid teal slab.
- **`Scene/Ripplet` is one normal map sampled twice**, scrolled in opposite
  directions, over a cubemap reflection, with a per-pixel alpha.

Key the behaviour off the **shader**, never off a keyword: `_TopColor` appears
zero times in `PBR/Standard`, yet three materials there carry it as leftovers.

## Traps

- **Static batching** bakes transforms into a combined mesh and points each
  renderer at a *range* of submeshes. Read only the first half and parts of the
  scene appear twice while a plaza floor never appears at all.
- **A mesh's `dimension` is a packed byte** — low nibble is the component count,
  high nibble is flags. Reading `0x34` as 52 computes a stride five times too
  wide.
- **Scale is 8, not 12.5.** MMD's unit is 8 cm so metres convert at 12.5 — right
  if a Unity unit is a metre, and in Aether Gazer it is not: the props run about
  1.55× life size. A game whose unit IS a metre wants `--scale 12.5`.
- **Textures are decoded PNGs beside the project** under `_png_textures`,
  mirroring the asset tree. A `Texture2D` asset is not an image.
