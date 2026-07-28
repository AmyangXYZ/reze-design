// The bundled demo — the scene a first-time visitor lands on. It is an ordinary
// `Scene` document (lib/scene.ts), the same shape a user's own scene exports as,
// so there is no separate "default" code path to keep in sync.
//
// SWAPPING THE DEMO MODEL is an edit to `assets.model` and nothing else — no
// other module names a model. Drop the folder in `public/models/`, then set:
//   source/file — must match the on-disk names exactly (case included: macOS
//               hides a mismatch, Vercel 404s on it). Textures resolve relative
//               to the folder, so it ships as the artist packed it.
//   id        — internal engine key; ASCII, arbitrary, never shown to the user.
//   presets   — OPTIONAL. autoStyleGroups resolves these first, then falls back
//               to its own JP/CN/EN name hints, which already catch the standard
//               names (头发, 脸, 皮肤, 眼睛, 衣服…). List a material only when
//               the hints miss it or guess wrong.
// Then re-check `state.camera` against the new model's height.

import { builtinEffect } from "@/lib/background-effects"
import { assetFromPath, SCENE_FORMAT_VERSION, type Scene } from "@/lib/scene"

export const DEFAULT_SCENE: Scene = {
  version: SCENE_FORMAT_VERSION,
  assets: {
    models: [
      {
        model: {
          id: "Thoth",
          // Folder, not zip: it ships from /public behind HTTP/2 with long cache
          // headers, so textures stream in and stay cached across visits.
          source: { kind: "folder", dir: "/models/托特-扉页之吻" },
          file: "苍鹭·托特「扉页之吻」白衣.pmx",
          // Just the names the engine's hints don't get right on this model.
          presets: {
            body: ["手"],
            cloth_smooth: ["头巾白", "头巾小白", "头巾黑", "头带小", "胸口布", "胸口布1"],
            metal: ["指甲"],
          },
        },
        animation: assetFromPath("/animations/One More Last Time.vmd"),
      },
    ],
    cameraAnimation: null,
    audio: assetFromPath("/audios/One More Last Time.wav"),
    background: null,
  },
  state: {
    name: "Untitled Scene",
    // Model stands 20.1 units tall.
    camera: { distance: 26.2, target: [0, 11.4, 0] },
    // The curated first-open look — deliberately richer than the engine's neutral
    // defaults, which stay in lib/scene-settings.ts as what "Reset" restores.
    settings: {
      world: { color: "#ed6aff", strength: 0.66 },
      sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
      bloom: { enabled: true, threshold: 0.5, knee: 0.5, radius: 4.0, intensity: 0.05, color: "#ffc9c9" },
      background: { color: "#4b004f" },
      ground: { color: "#c800de", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
    },
    // The demo ships with the starfield on — the first-open scene shows the
    // effect layer working over the purple base.
    backgroundEffect: builtinEffect("shining-stars"),
    // null = auto-group at load, so the demo restyles itself when the model changes.
    groups: null,
  },
}
