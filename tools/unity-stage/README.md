# Unity stage → PMX

Turns a scene from an AssetRipper export into a stage this app loads.

```sh
python3 tools/unity-stage/unity_to_pmx.py \
  --project "stages/x333/ExportedProject" \
  --scene   "Assets/ComScene/ABResources/Levels/X333.unity" \
  --out     stages/x333-stage --name X333
```

Needs Pillow, and nothing else. No Blender, no FBX: the exported project already
holds meshes, materials and a scene, and every hop through another format is a
hop that renames a material. The material **name** is what a person assigns a
look to in the app, so it is the one thing that must survive.

Upload the `--out` folder to the app as a stage.

## What comes out

| | |
|---|---|
| `X333.pmx` | geometry at MMD scale, one material per Unity material, and a `flame.NN` bone on every candle wick |
| `tex/` | the albedo each material samples, at the game's own resolution |
| `X333.hdr` | the scene's ambient gradient as an equirect, in linear, with the reflection probe ridden on top as structure |
| `maps/` | the relief map each material samples — the ripple map water scrolls among them |
| `X333.lights.json` | the lamps the game switches on and its sun, as the scene document holds them |

**Textures are copied, not resized.** A 2048 albedo arrives as a 2048 albedo, and
the same for normal maps. Downscaling was the default for a while and it cost the
thing the whole conversion is for — the frame this came out of is sharp, and a
stage that is nearly it reads as a worse stage rather than a cheaper one. Alpha
is dropped per TEXTURE rather than per material, so one material needing it keeps
it for every material that shares the file. `--albedo N` and `--normal N` cap the
longest edge when a stage really is too heavy; 0, the default, keeps the source.

The `.hdr` goes onto the World (HDRI) slot at strength 1 the moment the stage
loads, filled or
not — a stage is a place and the light in it belongs to it. It is the scene's own
ambient gradient with the reflection probe ridden on top as structure, so it
delivers the fill the scene declared while a mirror still sees the shape of the
room. Water reflects it. The World row is where a different sky is argued for.

**No sidecar.** A material's relief map is found by name: `tex/T_D.png` pairs
with `maps/T_N.png`, the set's own convention, so the folder states the pairing
where a person can read it. A material that samples no albedo — water, whose
colour its look computes — is named for itself. The converter writes each map
under that name rather than the source's own, because the game does not always
agree with itself: five materials across these stages sample a normal named for
a different texture than their albedo.

## The lighting rig

`X333.lights.json` goes into the scene document the moment the stage loads: its
lamps join the Lamps tab, each marked as the stage's, and the sun takes the
game's direction, colour and strength. Uploading another stage replaces the
lamps the last one brought; deleting the stage takes them with it. Lamps placed
by hand are never touched.

Position, aim, reach and the cone carry over as they are — the game's cone term
is the engine's. Brightness has to be fitted, because the falloffs differ in
shape: the game's is inverse-square, capped by each light's shape radius, and
ours is the brightness at the lamp falling to zero at its reach. Each lamp gets
the colour and intensity that land the same total light, per channel, on the
stage's own surfaces — the triangles the game lets it light, by layer and
rendering-layer mask, weighted by area, N·L and the cone. A cookie is sampled at
every triangle, so a spot projecting stained glass arrives carrying the glass's
colour and the fraction it lets through.

Three facts from the game's pipeline (`AGTools/AGSimPipeline.cs` in the rip)
decide the numbers:

- **Colour is `(colour × intensity).linear`.** The game runs with
  `lightsUseLinearIntensity` off, so intensity 17 is 17^2.2 in linear light.
- **The sun takes one π, the lamps none.** The engine's sun term is
  `sun·N·L/π`; URP's is `colour·N·L`. Neither side divides a lamp by π.
- **The inverse square is capped.** The game's shader takes
  `min(1/d², 1/shapeRadius)`, with the radius from the studio's
  `ReplicaAdditionalLightData` beside each Light — 0.1 on most lamps, so a lamp
  inside its own lantern does not blow the lantern out. The fit uses the same cap.
- **The ambient colours are linear.** The pipeline takes RenderSettings' sky,
  equator and ground through `.linear` before building the probe, so the bake
  does too; stored as they are, X340's night sky came out two to six times too
  bright. The bake keeps the gradient's own average, `(sky + 2·equator + ground) / 4`.
- **The game's lamps light only the stage.** Their culling mask is the stage's
  layer. Ours light everything, so a character under a bright fixture takes
  light the game never gave its cast — X340's warm spot over the centre fits to
  intensity 183.

### Candle flames

A flame in these stages is one particle system per wick — `huomiao` (火苗) in
the material name — and the converter writes each as a bone, `flame.01` up,
from the visible flame's foot to its tip. The *Candle Flames (wick bones)*
effect stands a flame on every bone with that prefix, so a hand-made stage
needs only a bone on each wick with its tail up the flame.

The game draws the flame on a stretched billboard that emits DOWNWARD at almost
no speed; a stretched card trails behind its velocity, so the card runs UP from
the particle. Measured on X340, every candle's wax top sits 0.30–0.43 of the
card above its particle — a card centred on the particle would bury the flame in
the wax. The flipbook (`sc_x331_huoyan`) draws its flame in rows 67–186 of each
256 tile, so the visible flame starts 26% up the card and is 47% of it long, and
that is the bone. Its width is a seventh of its height, which the game's bloom
and texture filtering fatten; the effect draws a real candle flame's third.

Left out, and listed when the converter runs: lights switched off in the game
(on themselves or through a parent), a second directional light, area lights,
LOD1 and below, baked-only lights, and renderers with no readable mesh.

## What the PMX carries instead

MMD already has words for most of what a stage states, so it says them there
rather than in a sidecar:

- **two-sided** from `_Cull`, and the shadow bits — without those a stage casts
  nothing, and a garden is mostly dappled shadow
- **ambient 1** on the sky dome and premultiplied glass, MMD's "draw as painted",
  which the app reads back as an Unlit group
- **a plant's vertical tint** folded into its material colour (see below)
- **the source shader in the material memo** — the free-text field MMD shows and
  nothing reads. The app's stage table consults it before its keyword guesses,
  which is how a pane of glass named `Terrain_X333_005` gets the glass look.

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
