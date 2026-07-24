# Reze Design

Turn an MMD dance into a live, shareable 3D performance. Bring a model, a motion, and a song — style the character, light it, and publish an interactive 3D link, not a flat video. Built on the MMD WebGPU engine [reze-engine](https://github.com/AmyangXYZ/reze-engine).

![Reze Design](./screenshot.png)

## Features

- **Compose a scene** — load a model (PMX), a motion (VMD), and a music track; a demo loads on first open.
- **Style every material** — group materials into looks and apply them in one click from the shader library.
- **Author shaders visually** — build looks in a Blender-style node graph, compiled to WGSL and applied live.
- **Light the scene** — tune the sun, bloom, ground, and world color, all live in the viewport.
- **Play it back** — scrub and loop with the music synced to the motion; Space toggles playback.

## Development

```bash
npm install
npm run dev
```

## Roadmap

reze-design is a curated MMD platform — an aesthetic with built-in looks (think camera filters), not a general 3D DCC. The focus is the character and its dance, presented well. Next up:

- **Share a live link** — publish your scene as a real-time, interactive 3D page at `reze.design/<user>/<scene>`, not a flat video.
- **Backdrops** — tasteful backgrounds so the character has a setting instead of a debug grid.
- **More built-in looks** — a growing shader-graph library and post filters tuned for the MMD aesthetic.
- **Gallery** — browse and remix shared scenes and looks.

## License

[AGPL-3.0-or-later](LICENSE).
