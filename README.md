# Reze Design

Turn an MMD dance into a live, shareable 3D performance. Bring a model, a motion, and a song — style the character, light it, and publish an interactive 3D link, not a flat video. Built on the MMD WebGPU engine [reze-engine](https://github.com/AmyangXYZ/reze-engine).

Reze Design

## Features

- **Compose a scene** — load a model (PMX folder or zip — drag & drop works too), a motion + camera VMD, and a music track; a demo loads on first open. Swapping models keeps the current dance.
- **Style every material** — group materials into looks and apply them in one click from the shader library.
- **Author shaders visually** — build looks in a Blender-style node graph (localized node names, Blender-style shortcuts, node rename), compiled to WGSL and applied live.
- **Set the scene** — sun, world light, and bloom; a background color, a flat image backdrop, or a **360° panorama skybox** that follows the camera; ground with opacity (the shadow stays — a shadow catcher), shadow and grid toggles.
- **Background effects** — live WGSL shaders layered between the background and the model (starfield, sakura, rain, neon…): pick from the library, tweak the code in the built-in editor, ⌘⏎ to see it on the scene. Live thumbnails run the real shader.
- **Play it back** — scrub and loop with the music synced to the motion; Space toggles playback; camera VMD follow/free toggle.
- **Render to video** — frame-accurate 60 fps mp4 export in the browser (WebCodecs hardware encode): aspect 16:9 / 9:16 / 1:1 / 4:3 × quality 1080p / 1440p / 4K, a **green-screen mode** for compositing in external editors (live-previewed in the viewport), and an optional watermark.

## Authoring shaders

Two custom-shader systems, one philosophy: everything the user makes is a
self-contained value that travels inside the scene document. These sections are
deliberately terse but complete — enough for a person to start, or to paste
into an AI agent as the spec for generating one.

### Shader graphs (materials)

A material look is a **Blender-style node graph compiled to WGSL** by
reze-engine. Users author them in the node editor (open the library from a
material group → pick a look → hover the preview → *Edit graph*); style groups
bind any set of materials to one graph.

A graph is plain JSON (`ShaderGraph` from `reze-engine`):

```jsonc
{
  "version": 1,
  "name": "My Look",
  "nodes": [
    // id: unique /^[a-z0-9_]+$/; type: a NODE_REGISTRY key;
    // inputs: literal defaults for unlinked sockets
    { "id": "tex", "type": "diffuse_texture" },
    { "id": "ramp", "type": "toon_ramp", "inputs": { "steps": 3 } }
  ],
  "links": [{ "from": { "node": "tex", "socket": "color" }, "to": { "node": "ramp", "socket": "color" } }],
  "output": { "node": "ramp", "socket": "color" },   // must resolve to vec3f/float
  "params": [],  // optional "exposed param" sliders (adjust without recompiling)
  "tags": ["hair"]  // soft hints for library filtering / auto-grouping
}
```

The node vocabulary is `NODE_REGISTRY` (exported by reze-engine) — texture
fetches, toon ramps, rim/fresnel, HSV, math/mix, noise, Principled BSDF inputs.
The engine compiles the graph into its 7-stage material shell (NPR stack over a
Principled GGX core) and reports `Diagnostic[]` instead of throwing. Built-in
looks live in `lib/node-library.ts`; pass integration (stencil hair/eye, alpha
mode) is *not* part of a graph — it lives on the style group's `renderClass`.

### Background effects (WGSL)

A background effect is **one WGSL file** rendered per-pixel between the
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
(`lib/background-effects.ts`): hash-grid particle fields (*Shining Stars*),
falling/swaying cells (*Sakura Fall*), column streaks (*Quiet Rain*),
SDF glyphs + exp glow (*REZE Neon*), disc + polar-fbm scene composition
(*Dark Moon*), implicit-curve outlines (*Orbiting Hearts*).

Workflow: Library → *New effect* (commented starter template) or fork any
preset; **⌘/Ctrl+Enter compiles and applies** — the scene is the live preview,
failed compiles keep the previous shader and list `line:col` diagnostics.
Applied effects persist with the scene and travel in shared scene documents.

## Development

```bash
npm install
npm run dev
```

## Roadmap

reze-design is a curated MMD platform — an aesthetic with built-in looks (think camera filters), not a general 3D DCC. The focus is the character and its dance, presented well. Next up:

- **Share a live link** — publish your scene as a real-time, interactive 3D page at `reze.design/<user>/<scene>`, not a flat video.
- **More built-in looks** — a growing shader-graph library and post filters tuned for the MMD aesthetic.
- **Gallery** — browse and remix shared scenes and looks.
- **Mobile layout** — a proper small-screen shell (the editor already runs there).

## License

[AGPL-3.0-or-later](LICENSE).