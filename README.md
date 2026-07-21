# Reze Design

Web-native scene composing and styling for MMD — the consumer app of the [reze-engine](https://github.com/AmyangXYZ/reze-engine) family.

**v0: node graph editor.** Blender-style material node graphs, validated and compiled to WGSL at runtime, applied live to a WebGPU MMD renderer:

- Preset graphs for every material slot (hair / body / cloth / stockings / metal / …), ported node-for-node from Blender NPR presets
- Two edit tiers: instant uniform writes for exposed params, ~100 ms async pipeline swap for topology changes — a broken graph never blanks the frame
- Double-click any node to preview its output on the model (Blender viewer-node workflow)
- Import/export graphs as JSON (`<slot>.graph.json`) — the file format is `reze-engine`'s `StyleGraph` schema
- Undo/redo, edge rewiring, inline value editing, generated-WGSL view with node markers

## Dev

```bash
npm install
npm run dev
```

## Roadmap

Composer MVP (multi-model scenes, one-tap style packs, share links, WebCodecs video export) → gallery → full pro-mode editor. The engine stays headless; this repo owns all UI and, eventually, the ecosystem's only backend.
