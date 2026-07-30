// The bundled demo — the scene a first-time visitor lands on.

import { builtinEffect } from "@/lib/background-effects"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"

export const DEFAULT_SCENE_DOC: SceneDoc = {
  version: 1,
  name: "My first scene",
  assets: {
    models: [
      {
        model: "/models/托特-扉页之吻/苍鹭·托特「扉页之吻」白衣.pmx",
        animation: "/animations/One More Last Time.vmd",
        materials: {
          groups: [
            { label: "Body", materials: ["皮肤", "手"], graph: "Body" },
            {
              label: "Smooth Cloth",
              materials: [
                "裤子",
                "衣服",
                "衣饰",
                "裙带",
                "裙带1",
                "胸口布",
                "胸口布1",
                "头巾白",
                "衣花白",
                "衣花白1",
                "衣服白",
                "手套",
                "袖子",
                "鞋子白",
                "鞋子带白",
                "头巾小白",
                "裙子白",
                "裙子白1",
              ],
              graph: "Smooth Cloth",
            },
            { label: "Metal", materials: ["指甲"], graph: "Metal" },
            { label: "Hair", materials: ["头发"], graph: "Hair", role: "hair" },
            { label: "Face", materials: ["脸", "牙齿", "舌头", "口腔"], graph: "Face" },
            { label: "Eye", materials: ["眼白", "眉毛", "眼睛", "眼睛1"], graph: "Eye", role: "eye" },
          ],
          hidden: [],
        },
      },
    ],
    cameraAnimation: null,
    audio: "/audios/One More Last Time.wav",
    backdrop: null,
    skybox: null,
  },
  settings: {
    camera: { distance: 26.2, target: [0, 11.4, 0] },
    world: { color: "#ed6aff", strength: 0.66 },
    sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
    bloom: { enabled: true, threshold: 0.5, knee: 0.5, radius: 4.0, intensity: 0.05, color: "#ffc9c9" },
    background: { color: "#4b004f", effect: "Shining Stars" },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { color: "#c800de", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
  },
}

export const DEFAULT_SCENE: Scene = parseSceneDoc(DEFAULT_SCENE_DOC, builtinEffect, libraryGraph)
