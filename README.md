# Reze Design

Render MMD in the browser with WebGPU. Load models and motions, style materials with node-based shaders, grade the colour, and export 4K video or share a live 3D link. Built on the MMD WebGPU engine [reze-engine](https://github.com/AmyangXYZ/reze-engine).

![The editor](./screenshots/home.png)

| ![Shader graph editor](./screenshots/shader-graph.png) | ![Background effect editor](./screenshots/effect-editor.png) |
| :-: | :-: |
| Node editor compiled to WGSL, applied live | WGSL background effects edited in-app |

![Video export](./screenshots/video-export.png)

## Features

- **Multiple models per scene** — load as many characters as you like (PMX folder or zip, drag & drop), each with its own motion, plus a shared camera VMD and music track. A demo loads on first open, and swapping a model keeps its dance.
- **Style every material** — collect materials into **style groups** and apply a **shader graph** to each in one click from the library.
- **Author shaders visually** — build shader graphs in a Blender-style node editor (localized node names, Blender-style shortcuts, node rename), compiled to WGSL and applied live.
- **Grade the look** — ASC CDL colour grading with curated presets (Bloody, Cyberpunk, Divine, Moonlit, Sakura), each with its own remembered intensity; open the grade editor for split tone, three tonal-range wheels and contrast/saturation, previewed on a live capture of your own scene.
- **Set the scene** — sun, world light, and bloom; a background color, a flat image backdrop, or a **360° panorama skybox** that follows the camera; ground with opacity (the shadow stays — a shadow catcher), shadow and grid toggles.
- **Background effects** — live WGSL shaders layered between the background and the model (starfield, sakura, rain, neon…): pick from the library, tweak the code in the built-in editor, ⌘⏎ to see it on the scene. Live thumbnails run the real shader.
- **Play it back** — scrub and loop with the music synced to the motion; Space toggles playback; camera VMD follow/free toggle.
- **Undo/redo everywhere** — ⌘/Ctrl+Z and ⇧⌘/Ctrl+Z, routed to whichever panel or editor you are working in (the code editor keeps native text undo).
- **High-quality video export** — frame-accurate 60 fps mp4 rendered in the browser with WebCodecs hardware encoding, streamed straight to disk so length is not capped by memory. 2.39:1 cinemascope, 16:9, 9:16, 1:1 and 4:3 at up to 4K, a **green-screen mode** previewed live in the viewport for compositing elsewhere, and an optional watermark.

## Authoring shaders

A **style group** is a set of materials that share one look, and a **shader
graph** is the node graph defining it. A **colour grade** applies to the whole
scene, from the Grade section of the Scene panel.

Both shader systems produce self-contained values that travel inside the scene
document, so a shared scene carries everything it needs to render.

### Shader graphs (materials)

A shader graph is a **Blender-style node graph compiled to WGSL** by
reze-engine. Users author them in the node editor (open the library from a
style group → pick a graph → hover the preview → _Edit graph_); style groups
bind any set of materials to one graph.

A graph is plain JSON (`ShaderGraph` from `reze-engine`):

```jsonc
{
  "version": 1,
  "name": "My Graph",
  "nodes": [
    // id: unique /^[a-z0-9_]+$/; type: a NODE_REGISTRY key;
    // inputs: literal defaults for unlinked sockets
    { "id": "tex", "type": "diffuse_texture" },
    { "id": "ramp", "type": "toon_ramp", "inputs": { "steps": 3 } },
  ],
  "links": [
    {
      "from": { "node": "tex", "socket": "color" },
      "to": { "node": "ramp", "socket": "color" },
    },
  ],
  "output": { "node": "ramp", "socket": "color" }, // must resolve to vec3f/float
  "params": [], // optional "exposed param" sliders (adjust without recompiling)
  "tags": ["hair"], // soft hints for library filtering / auto-grouping
}
```

The node vocabulary is `NODE_REGISTRY` (exported by reze-engine) — texture
fetches, toon ramps, rim/fresnel, HSV, math/mix, noise, Principled BSDF inputs.
The engine compiles the graph into its 7-stage material shell (NPR stack over a
Principled GGX core) and reports `Diagnostic[]` instead of throwing. Built-in
graphs live in `content/graphs.json`; pass integration (stencil hair/eye, alpha
mode) is _not_ part of a graph — it lives on the style group's `renderClass`.

### Background effects (WGSL)

A background effect is **one WGSL function** rendered per-pixel between the
background (color / image / 360°) and the model. The whole contract:

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f
```

- `ray` — the pixel's world-space view direction (normalized, LH, +Z forward).
  It pans with the camera orbit; project it to pin an effect to the sky
  (`vec2f(atan2(ray.x, ray.z), asin(ray.y))` — the skybox's own mapping), or
  ignore it for a screen-space effect.
- `uv` — 0..1, origin bottom-left. Aspect-correct via `bgResolution()` (canvas
  px): `(uv - 0.5) * vec2f(res.x / res.y, 1.0)`.
- `time` — seconds since applied. Drive all motion from it; keep no state.
- Returns sRGB + **straight alpha** — alpha is the layer mask: 0 shows the
  background behind, 1 covers it. Overlay effects (petals, rain, neon) keep it
  near 0 between marks; full-scene effects return 1 everywhere.

Conventions: tunables as commented `const`s at the top (code is the only
surface — no parameter UI); fully self-contained (no textures or custom
bindings; helpers can sit below `background()`, WGSL is order-independent);
prefer proportional or `fwidth`-based `smoothstep` bands for crisp edges —
but `fwidth` only in uniform control flow (not after a data-dependent early
return). Keep loops small and fixed; this runs behind a full character render.

Patterns, each with a worked example in the built-in library
(`content/effects.json`): hash-grid particle fields (_Shining Stars_), column
streaks (_Quiet Rain_), SDF glyphs + exp glow (_REZE DESIGN_), implicit-curve
outlines (_Orbiting Hearts_), and sumi-e scene composition (_Fuji Watercolor_).

Workflow: Library → _New effect_ (commented starter template) or fork any
preset; **⌘/Ctrl+Enter compiles and applies** — the scene is the live preview,
failed compiles keep the previous shader and list `line:col` diagnostics.
Applied effects persist with the scene and travel in shared scene documents.

## Content library

Grades, shader graphs and background effects are the same kind of thing, so they
wear one envelope (`lib/library.ts`) and travel as data rather than code:

```jsonc
{
  "id": "moonlit",
  "kind": "grade", // "grade" | "graph" | "effect"
  "name": "Moonlit",
  "author": "Amyang",
  "description": "…", // shown in the library inspector
  "tags": ["night", "cool", "blue"], // free-form; search, not a taxonomy
  "version": 1,
  "payload": { "spec": {} }, // { spec } | { graph, role? } | { wgsl }
}
```

Built-ins ship in the repo (`content/grades.json`, `graphs.json`,
`effects.json`) so a clone runs with no server; community items will come from
the database and merge in at runtime — ids can't collide, so there is no seeding
step and no dedup.

The library shows **published** content only. Editing a preset does not create a
library entry: the edit lives in the scene, travelling by value inside the scene
document so a shared link reproduces exactly what you made, while unmodified
built-ins travel as a bare id and stay retunable. Publishing is what mints a new
library item under your name.

## Development

```bash
npm install
npm run dev
```

## Roadmap

A curated MMD platform built around the character and its dance, with a growing set of shader graphs and colour grades tuned for the look. Next up:

- **Share a live link** — publish a scene as a real-time, interactive 3D page at `reze.design/<user>/<scene>`.
- **More built-ins** — a growing shader-graph and colour-grade library tuned for the MMD aesthetic.
- **Gallery** — browse and remix shared scenes, shader graphs and grades.
- **Mobile layout** — a proper small-screen shell (the editor already runs there).

## License

[AGPL-3.0-or-later](LICENSE).
