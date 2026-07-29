// The bundled demo — the scene a first-time visitor lands on.

import { builtinEffect } from "@/lib/background-effects"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"

export const DEFAULT_SCENE_DOC: SceneDoc = {
  models: [
    {
      id: "Thoth",
      model: "/models/托特-扉页之吻/苍鹭·托特「扉页之吻」白衣.pmx",
      animation: "/animations/One More Last Time.vmd",
      styleGroups: {
        body: ["手"],
        cloth_smooth: ["头巾白", "头巾小白", "头巾黑", "头带小", "胸口布", "胸口布1"],
        metal: ["指甲"],
      },
    },
  ],
  audio: "/audios/One More Last Time.wav",
  name: "My first scene",
  camera: { distance: 26.2, target: [0, 11.4, 0] },
  settings: {
    world: { color: "#ed6aff", strength: 0.66 },
    sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
    bloom: { enabled: true, threshold: 0.5, knee: 0.5, radius: 4.0, intensity: 0.05, color: "#ffc9c9" },
    background: { color: "#4b004f" },
    grade: { preset: "neutral", intensities: {}, custom: null },
    ground: { color: "#c800de", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
  },
  // The demo ships with the starfield
  backgroundEffect: "shining-stars",
  // model id → hidden material names
  hidden: {},
  // null/absent = auto-group at load, so the demo restyles itself when the model changes.
  groups: null,
}

export const DEFAULT_SCENE: Scene = parseSceneDoc(DEFAULT_SCENE_DOC, builtinEffect)
