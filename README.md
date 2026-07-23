# Reze Design

Compose and style MMD scenes, then ship them. Bring a model, a motion, and a song — style the materials, light the scene, and export a finished "MMD" as a video and a permanent live-3D link. Built on the MMD WebGPU engine [reze-engine](https://github.com/AmyangXYZ/reze-engine).

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

- **Video export** — frame-accurate capture and encode.
- **Accounts** — save models and scenes behind a permanent, always-on link at `reze.design/<user>/<scene>`.
- **Gallery & library** — browse shared scenes and drop-in shader-graph packs.
- **Environment effects** — particles, weather, sky, and water as the engine gains the nodes.

## License

[AGPL-3.0-or-later](LICENSE).
