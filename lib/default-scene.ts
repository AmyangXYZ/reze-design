// The bundled demo — the scene a first-time visitor lands on.

import { FOLLOW_BONE } from "@/components/scene/scene-sidebar"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import { DEFAULT_DOF, DEFAULT_OUTLINE, DEFAULT_PHYSICS, DEFAULT_VIEW } from "@/lib/scene-settings"

/**
 * Whether this build boots into the demo scene.
 *
 * `NEXT_PUBLIC_USE_DEFAULT_SCENE=true` opts in, and the deployments at
 * reze.design set it. Everything else — a clone, a fork, a packaged desktop
 * build — boots `EMPTY_SCENE_DOC` instead.
 *
 * It picks between two whole scenes rather than emptying the cast out of one.
 * The demo's magenta world, purple ground and two background effects are a
 * stage set built around one character; leaving them standing with nobody in
 * them is a stranger first impression than either scene on its own.
 *
 * Off by default because the demo's assets are not in this repository. They
 * stream from `DEMO` below, one account's bucket behind an origin allowlist, so
 * a clone that loaded them would be serving its pages off someone else's
 * infrastructure, and a fork on any other origin would fail the CORS check.
 *
 * Read at build time (the NEXT_PUBLIC_ prefix inlines it), so a downstream
 * packager sets it in the environment rather than patching this file.
 */
// Parsed leniently, so a `1` or an `on` opts in as readily as a `true`.
const YES = ["true", "1", "on", "yes"]
export const USE_DEFAULT_SCENE = YES.includes((process.env.NEXT_PUBLIC_USE_DEFAULT_SCENE ?? "").trim().toLowerCase())

/**
 * Where the demo model, motion and music are served from.
 *
 * R2, whose egress is free, so the ~18MB a first-time visitor downloads costs
 * nothing to serve and never touches the deployment's transfer budget. Keys are
 * versioned by path, which is what lets them carry a one-year immutable cache
 * header: rename, never overwrite in place.
 *
 * Upload with `scripts/r2-upload-demo.mjs` — see its header.
 */
const DEMO = "https://assets.reze.one/demo/reze-design"

const DEMO_SCENE_DOC: SceneDoc = {
  version: 1,
  name: "My first scene",
  assets: {
    models: [
      {
        model: `${DEMO}/models/托特-扉页之吻/苍鹭·托特「扉页之吻」白衣.pmx`,
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
        animation: `${DEMO}/animations/Demo.vmd`,
        morph: `${DEMO}/animations/Demo_morph.vmd`,
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
    audio: `${DEMO}/audios/Demo.mp3`,
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
    background: { color: "#4b004f", effects: [{ source: "Shining Stars" }, { source: "Hand Ribbon" }] },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { color: "#c800de", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
    physics: DEFAULT_PHYSICS,
  },
}

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
    camera: DEMO_SCENE_DOC.settings.camera,
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

/**
 * The curated scene: one character, the dance, the track and the look built
 * around them. What Reset restates, whether or not this build OPENS on it —
 * "reset to default" names the scene that was designed, and a build that boots
 * empty still has one.
 */
export const DEMO_SCENE: Scene = parseSceneDoc(DEMO_SCENE_DOC, builtinEffect, libraryGraph)

/** The scene this build opens on. */
export const DEFAULT_SCENE_DOC: SceneDoc = USE_DEFAULT_SCENE ? DEMO_SCENE_DOC : EMPTY_SCENE_DOC
export const DEFAULT_SCENE: Scene = parseSceneDoc(DEFAULT_SCENE_DOC, builtinEffect, libraryGraph)
