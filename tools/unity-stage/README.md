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
| `X333.pmx` | geometry at MMD scale, one material per Unity material |
| `tex/` | the albedo each material samples |
| `X333.hdr` | the scene's reflection probe as an equirect |
| `X333.maps.json` + `maps/` | water only — the ripple normal map its shader scrolls |

The `.hdr` is **written, never installed**: drop it on the World (HDRI) slot when
you want the room's fill and reflections. Water reflects it, so without it the
ripples have nothing to mirror.

## What is deliberately left behind

**The lighting rig.** A game's sun, ambient, exposure and lamps were authored for
its renderer and its subject. Carried across they fight defaults calibrated for a
character standing in frame — and they are rarely what you want anyway: X305's
four lamps stand *inside a piano* and reach 0.7 m.

**The PBR maps.** A look per material sampling normal, metal, roughness and AO
plus an environment reflection cost a garden stage its frame rate, and the albedo
alone reads as the same garden. Water's ripple map is the one exception, because
those ripples *are* that texture.

**LOD1 and below**, baked-only lights, and renderers with no readable mesh.

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
