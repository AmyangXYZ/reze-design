// The bundled demo — the scene a first-time visitor lands on.

import { FOLLOW_BONE } from "@/components/scene/scene-sidebar"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { DEFAULT_DOF, DEFAULT_OUTLINE, DEFAULT_PHYSICS, DEFAULT_VIEW } from "@/lib/scene-settings"

/**
 * Whether this build ships the demo model, motion and music.
 *
 * A desktop or self-hosted build may want none of them — `public/models` is by far
 * the largest thing in the repo, and a packaged app has no reason to carry someone
 * else's character. `NEXT_PUBLIC_USE_DEFAULT_ASSETS=false` boots the editor into an empty
 * scene: the lighting, ground, colour grade and background effect are all defined
 * in code, so the starting scene still looks like something and the user brings
 * their own model to it.
 *
 * Read at build time (the NEXT_PUBLIC_ prefix inlines it), so a downstream packager
 * sets it in the environment rather than patching this file — which is the point.
 */
// Absent means on: the demo is what the web build ships, and only a packager opting
// out has any reason to set this. Parsed leniently so a `0` or an `off` still reads
// as off rather than silently shipping assets the packager meant to drop.
const NO = ["false", "0", "off", "no"]
export const USE_DEFAULT_ASSETS = !NO.includes((process.env.NEXT_PUBLIC_USE_DEFAULT_ASSETS ?? "").trim().toLowerCase())

export const DEFAULT_SCENE_DOC: SceneDoc = {
  version: 1,
  name: "My first scene",
  assets: {
    // Empty, not a placeholder: every consumer already tolerates a cast of none.
    models: !USE_DEFAULT_ASSETS
      ? []
      : [
      {
        model: "/models/托特-扉页之吻/苍鹭·托特「扉页之吻」白衣.pmx",
        // The Classic set, cut for the demo: a dance, the expressions that go
        // with it, and the track they were timed to. A first-time visitor should
        // land on a scene doing all three at once — a character dancing in
        // silence, staring straight ahead, is a demo of a loader.
        //
        // CUT AT FRAME 81, which is 2.7 seconds of standing still at the top of
        // the take. That is a long time to hold somebody who has not yet decided
        // to stay, and it is most of what they see before they decide. The pose
        // at the cut is carried into a key at frame 0, so the dance opens
        // mid-movement rather than snapping to it — see scripts/cut-vmd.mjs.
        // The full-length Classic files are still in public/, untouched.
        animation: "/animations/Demo.vmd",
        morph: "/animations/Demo_morph.vmd",
        materials: {
          groups: [
            { label: "Body", materials: ["皮肤", "手"], graph: "AG Body" },
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
              graph: "AG Smooth Cloth",
            },
            { label: "Metal", materials: ["指甲"], graph: "AG Metal" },
            { label: "Hair", materials: ["头发"], graph: "AG Hair", role: "hair" },
            { label: "Face", materials: ["脸", "牙齿", "舌头", "口腔"], graph: "AG Face" },
            { label: "Eye", materials: ["眼白", "眉毛", "眼睛", "眼睛1"], graph: "AG Eye", role: "eye" },
          ],
          hidden: [],
        },
      },
    ],
    // NO CAMERA MOTION. The demo shipped with a VMD shot, and a cut every few
    // seconds is the wrong frame for a scene whose point is what the effects do
    // to the cast — half of every effect landed off screen or mid-cut. The
    // follow orbit below holds her instead, which is also the framing a visitor
    // gets the moment they drag the viewport, so what they see first is what
    // they keep.
    cameraAnimation: null,
    // Cut to match, by scripts/cut-mp3.py — frame-aligned rather than exact, and
    // 9ms of a 33ms video frame is the closest an MP3 boundary can land.
    audio: USE_DEFAULT_ASSETS ? "/audios/Demo.mp3" : null,
    midi: null,
    lyrics: null,
    backdrop: null,
    skybox: null,
  },
  settings: {
    // FOLLOW, so the orbit centre rides センター and a travelling motion cannot
    // walk out of frame. `target` is then the OFFSET from that bone rather than
    // a point in the world — the three sliders mean the same thing either way,
    // which is why it reads as it did. Distance 33: far enough to hold the whole
    // of her and the ribbons, now that the cast no longer sits wherever a shot
    // put it.
    camera: {
      distance: 33,
      alpha: Math.PI,
      beta: Math.PI / 2.5,
      target: [0, 2.0, 0],
      follow: FOLLOW_BONE,
    },
    world: { color: "#ed6aff", strength: 0.66 },
    sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
    bloom: { enabled: true, threshold: 0.5, knee: 0.5, radius: 4.0, intensity: 0.05, color: "#ffc9c9" },
    dof: DEFAULT_DOF,
    outline: DEFAULT_OUTLINE,
    view: DEFAULT_VIEW,
    // Both are ADDITIVE-friendly and sit on different mounts — Shining Stars is
    // a background field, Hand Ribbon is particles and trails — so neither can
    // paint over the other and the order here is free. It is not free in
    // general: a full-cover backdrop has to come first or it erases what is
    // under it.
    //
    // TELEPORTATION IS NOT IN THE DEMO, though it is the effect this build is
    // for. It costs seven thousand particles, three lights and a material
    // dissolve that runs in three passes, and the first paint of the site is the
    // one frame that has to be quick on whatever machine arrives. It is one
    // click away in the library, which is where somebody who wants it will be.
    background: { color: "#4b004f", effects: ["Shining Stars", "Hand Ribbon"] },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { color: "#c800de", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
    physics: DEFAULT_PHYSICS,
  },
}

export const DEFAULT_SCENE: Scene = parseSceneDoc(DEFAULT_SCENE_DOC, builtinEffect, libraryGraph)

/**
 * A blank scene — no model, no motion, no music, no background effect, no grade.
 *
 * The settings split by what they encode. Colour, the effect and the grade are TASTE:
 * the bundled demo is a stage set built around one character, and starting a new scene
 * inside someone else's art direction is wrong. Camera distance, target height and the
 * sun's angle are CONVENTION: they encode MMD's scale (a model stands ~20 units) and
 * basic key-light placement, and dropping a user at the engine's raw defaults would
 * leave them staring at an unlit model from the wrong distance, which reads as broken.
 *
 * So: the demo's structure and conventions, with the palette neutralised. A lit studio,
 * neither a black void nor a finished look.
 */
export const EMPTY_SCENE_DOC: SceneDoc = {
  version: 1,
  name: "Untitled scene",
  assets: { models: [], cameraAnimation: null, audio: null, midi: null, lyrics: null, backdrop: null, skybox: null },
  settings: {
    camera: DEFAULT_SCENE_DOC.settings.camera,
    world: { color: "#ffffff", strength: 0.35 },
    sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
    bloom: { enabled: true, threshold: 0.8, knee: 0.5, radius: 4.0, intensity: 0.03, color: "#ffffff" },
    dof: DEFAULT_DOF,
    outline: DEFAULT_OUTLINE,
    view: DEFAULT_VIEW,
    background: { color: "#1c1c1e", effects: [] },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { color: "#3a3a3d", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
    physics: DEFAULT_PHYSICS,
  },
}

export const EMPTY_SCENE: Scene = parseSceneDoc(EMPTY_SCENE_DOC, builtinEffect, libraryGraph)
