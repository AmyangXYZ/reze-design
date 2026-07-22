# Reze Design

Web-native scene composing and styling for MMD — the consumer app of the [reze-engine](https://github.com/AmyangXYZ/reze-engine) family. Bring a model, a motion, and a track; style the materials, light the scene, and ship a finished "MMD" as a video and a permanent live-3D link.

![Reze Design](screenshot.png)

It's a **finishing tool, not an animation editor** — you drop in a finished VMD and a pre-cut song and compose the look. (Motion authoring lives in the sibling app, [reze-studio](https://github.com/AmyangXYZ/reze-studio).) The engine stays headless; this repo owns all the UI.

## v0 — the immersive composer

The WebGPU viewport is the page; a Figma-style shell floats over it — two full-height docks that collapse together, plus a bottom transport.

- **Materials** — every PMX material maps to a **style slot** (hair · body · face · eye · smooth/rough cloth · stockings · metal). Each slot is a **Blender-style material node graph** validated and compiled to **WGSL at runtime** and applied live: instant uniform writes for exposed params, an async pipeline swap for topology changes, so a broken graph never blanks the frame. Undo/redo, edge rewiring, inline values, a generated-WGSL view, and double-click-to-preview a node's output on the model.
- **Scene** — world / sun / bloom / ground / colors, sliders live to the engine; one-tap reset to the engine's neutral defaults.
- **Assets** — load a model (PMX folder), a motion (VMD), and music (audio), each with high-level metadata (verts · bones · materials, duration · keyframes, size). A bundled demo scene loads on first open.
- **Transport** — persistent play/pause · scrub · loop, with the music synced to the motion clock; <kbd>Space</kbd> toggles playback. Audio starts on first interaction (browser autoplay policy), so motion and sound begin together.

## Dev

```bash
npm install
npm run dev
```

Requires a WebGPU-capable browser (recent Chrome/Edge).

## Roadmap

Single-model by design. From here:

- **Video export** — frame-accurate WebCodecs capture + encode (a basic `MediaRecorder` webm path first).
- **Accounts + persistence** — a DB holding uploaded models and scene configs, unlocking a permanent, always-on live scene at `reze.design/<user>/<scene>` (the Share button's promise).
- **Gallery & library** — browse shared scenes and drop-in node-graph packs per slot (placeholder pages already exist).
- **Environment nodes** — particles / weather / sky / water effects, once `reze-engine` grows the shader nodes for them.

This repo owns all UI and, eventually, the ecosystem's only backend.
