# Reze Design

Design MMD scenes in the browser, then publish them. Bring a model, a motion and a song, decide how it all looks — material shaders you build as node graphs, colour grading, background effects, lighting and framing — and export the result as video or publish it to a permanent link anyone can open and orbit in real time. Rendering runs on [reze-engine](https://github.com/AmyangXYZ/reze-engine), a WebGPU MMD engine.

A published scene is a live 3D page at `reze.design/<handle>/<id>` — real-time, orbitable, and openable in the editor as your own copy to take further, credits carried along.

**[User manual](./docs/manual/en.md)** · [简体中文](./docs/manual/zh.md) — what MMD is, every panel, and how to author grades, WGSL background effects and shader graphs.

![The editor](./screenshots/home.png)

## Features

- **Material shader graph** — build material looks in a Blender-style node graph editor, compiled to WGSL and applied live.
- **Colour grading** — ASC CDL with curated presets and a wheel-based editor, previewed on your own scene.
- **Background effects** — WGSL shaders behind the model, edited in-app and applied with ⌘⏎.
- **Scene lighting** — sun, world light and bloom over a background colour, image backdrop or 360° skybox.
- **Multi-model support** — each with its own motion, plus a shared camera VMD and audio track.
- **Playback** — scrub and loop with audio synced to the motion, and a free or VMD-driven camera.
- **Video export** — 60 fps mp4 up to 4K, from 2.39:1 cinemascope to vertical, with a green-screen mode.
- **Still capture** — one PNG at the same framing and resolution as the video, for a scene's thumbnail.
- **Publishing** — a scene becomes a live 3D page at a permanent URL, with its uploaded assets packed into one archive.
- **Gallery** — browse what people have published, sorted by hot, new or top, narrowed by tag or by what you liked.
- **Accounts** — sign in with GitHub or Google, take a handle, and own what you publish.
- **Undo and redo** — ⌘/Ctrl+Z anywhere, scoped to the panel or editor you are working in.

![Video export](./screenshots/video-export.png)

## Authoring shaders

A **style group** is a set of materials that share one look, and a **shader
graph** is the node graph defining it. A **colour grade** applies to the whole
scene, from the Grade section of the Scene panel.

Both shader systems produce self-contained values that travel inside the scene
document, so a shared scene carries everything it needs to render.

### Shader graphs (materials)

![Shader graph editor](./screenshots/shader-graph.png)

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

![Background effect editor](./screenshots/effect-editor.png)

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
`effects.json`) so a clone runs with no server; community items come from the
database and merge in at runtime — ids can't collide, so there is no dedup step.

Published items are **immutable versions**. Publishing over your own item writes
version _n+1_ rather than replacing version _n_, and a scene pins the exact
`{ id, version }` it used, so nobody's scene changes under them when an author
retunes a preset. Built-in pins resolve from the app bundle, which is why a
clone with no database still renders a scene that uses them.

The library shows **published** content only. Editing a preset does not create a
library entry: the edit lives in the scene, travelling by value inside the scene
document so a shared link reproduces exactly what you made, while unmodified
built-ins travel as a bare id and stay retunable. Publishing is what mints a new
library item under your name.

## Publishing a scene

**Share** collects the models, motions and audio you uploaded, packs them into a
single archive, uploads it straight to object storage from the browser, and
publishes the document that points at it. A scene needs a name, a description,
tags, a thumbnail and **credits** — naming the artists behind the model, the
motion and the music is required, not optional.

The URL is `reze.design/<handle>/<short-id>`. The short id is what resolves, so
renaming a scene or an author never breaks a link.

## Development

```bash
npm install
npm run dev
```

No configuration is needed to run the editor. Without a database the app still
builds and boots: models load, materials and shader graphs work, video and PNG
export work, and every built-in grade, effect and graph is browsable. The parts
that need a server — accounts, publishing, the gallery — report that they are
unavailable instead of failing.

To run the full platform, copy the environment keys the app reads:

| Key | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon), pooled endpoint |
| `DATABASE_URL_UNPOOLED` | Same database, direct — used by migrations |
| `BETTER_AUTH_SECRET` | Session signing key; different per environment |
| `BETTER_AUTH_URL` | Absolute origin, for OAuth callbacks |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub sign-in (omit to hide it) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (omit to hide it) |
| `R2_*` | Cloudflare R2 bucket for scene bundles and thumbnails |
| `ADMIN_EMAILS` | Comma-separated; moderation access, checked server-side |

## Roadmap

A curated MMD platform built around the character and its dance. Next up:

- **More built-ins** — a growing shader-graph and colour-grade library tuned for the MMD aesthetic.
- **Mobile layout** — a proper small-screen shell (the editor already runs there).
- **Camera bone-follow** — frame the shot on a model's head or centre bone.

## License

[AGPL-3.0-or-later](LICENSE).
