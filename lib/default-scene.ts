// The bundled demo — the scene a first-time visitor lands on.

import { FOLLOW_BONE } from "@/components/scene/scene-sidebar"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { parseSceneDoc, type Scene, type SceneDoc } from "@/lib/scene"
import {
  DEFAULT_AUDIO,
  DEFAULT_DOF,
  DEFAULT_GRAIN,
  DEFAULT_OUTLINE,
  DEFAULT_PHYSICS,
  DEFAULT_VIEW,
} from "@/lib/scene-settings"

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
 * R2, whose egress is free, so what a first-time visitor downloads costs
 * nothing to serve and never touches the deployment's transfer budget. Keys are
 * versioned by path, which is what lets them carry a one-year immutable cache
 * header: rename, never overwrite in place.
 *
 * Hence `demo-cat` rather than a second upload to `reze-design`. That header is
 * a promise for a year, and an overwritten key is served from the edge long
 * after the bucket has forgotten it — a new path is the only reliable way to
 * change what a returning visitor sees.
 *
 * Upload with `scripts/r2-upload-demo.mjs` — see its header.
 */
const DEMO = "https://assets.reze.one/demo/demo-cat"
// The cast, shared by every site rather than copied into each one's folder.
const MODEL = "https://assets.reze.one/demo/reze"

const DEMO_SCENE_DOC: SceneDoc = {
  version: 1,
  name: "My first scene",
  assets: {
    models: [
      {
        model: `${MODEL}/reze.pmx`,
        // 人は猫 — a dance, the expressions that go with it, and the track they
        // were timed to. A first-time visitor should land on a scene doing all
        // three at once: a character dancing in silence, staring straight ahead,
        // is a demo of a loader.
        //
        // 29 seconds, and it opens on the downbeat — no standing around at the
        // top of the take, which is the part a visitor watches before deciding
        // whether to stay.
        animation: `${DEMO}/animations/Demo.vmd`,
        morph: `${DEMO}/animations/Demo_morph.vmd`,
        materials: {
          groups: [
            { label: "Body", materials: ["skin"], graph: "AG Body" },
            {
              label: "Smooth Cloth",
              materials: ["shirt", "shorts", "ribbon", "choker", "bozi", "cloth01", "cloth01.001"],
              graph: "AG Smooth Cloth",
            },
            { label: "Rough Cloth", materials: ["Rubber", "Leather"], graph: "AG Rough Cloth" },
            { label: "Stockings", materials: ["socks"], graph: "AG Stockings" },
            { label: "Hair", materials: ["头发"], graph: "AG Hair", role: "hair" },
            { label: "Face", materials: ["face01", "唇", "齿", "口腔", "舌"], graph: "AG Face" },
            {
              label: "Eye",
              // The brows and lashes ride with the eyes, as they did on the last
              // model: they are drawn as eye features rather than as skin.
              materials: ["目白", "瞳1", "瞳2", "eyebrow", "eyelash", "eyelash_crease"],
              graph: "AG Eye",
              role: "eye",
            },
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
    // MP3, not the WAV the scene was authored against: 29 seconds of 1536kbps
    // PCM is 5.6MB, and the same track at 192k is 0.7MB. Nobody can hear the
    // difference over a dance loop, and everybody waits for the download.
    audio: `${DEMO}/audios/Demo.mp3`,
    midi: null,
    // The track is sung, so the demo shows the lyric line doing its work rather
    // than describing it — this is the one scene most visitors will ever see.
    lyrics: `${DEMO}/audios/Demo.lrc`,
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
      target: [0, 3.0, 0],
      follow: FOLLOW_BONE,
      fov: Math.PI / 4,
    },
    world: { color: "#ed6aff", strength: 0.66 },
    sun: { color: "#ffffff", strength: 2.0, azimuth: 205, elevation: 21 },
    bloom: { enabled: true, threshold: 0.5, knee: 0.5, radius: 4.0, intensity: 0.05, color: "#ffc9c9" },
    dof: DEFAULT_DOF,
    outline: { enabled: true },
    grain: DEFAULT_GRAIN,
    view: DEFAULT_VIEW,
    audio: DEFAULT_AUDIO,
    // All three are ADDITIVE — Floating Stars around the cast, Hand Sparks off
    // her wrists, the Lyrics line over everything — so they sum wherever they
    // overlap and their order is free. It is not free in general: a full-cover
    // backdrop has to come first or it erases what is under it, and Water is
    // one, which is why the library entry says to put it first.
    //
    // STICKER OUTLINE IS NOT HERE, though it was. It runs a jump flood over the
    // whole frame to build rzCastDistance, and the first paint of the site is
    // the one frame that has to be quick on whatever machine arrives. It is one
    // click away in the library.
    //
    // Shining Stars is the SKY and stays in the library rather than the demo: it
    // is a background field, so it is read through whatever the scene's own
    // background colour leaves it, and on a light ground that is nothing.
    //
    // TELEPORTATION IS NOT IN THE DEMO, though it is the effect this build is
    // for. It costs seven thousand particles, three lights and a material
    // dissolve that runs in three passes, and the first paint of the site is the
    // one frame that has to be quick on whatever machine arrives. It is one
    // click away in the library, which is where somebody who wants it will be.
    // Named, not pinned by id. The scene this came from carried a hand-edited
    // "Sticker Outline 2" inline, which would ship a draft nobody maintains and
    // freeze it against the library entry it was forked from; the demo is the
    // one place a shipped effect should be the shipped effect.
    background: {
      color: "#f6cfff",
      effects: [
        { source: "Floating Stars" },
        { source: "Hand Sparks" },
        { source: "Lyrics" },
      ],
    },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { enabled: true, color: "#c800de", size: 160, opacity: 0.48, shadow: true, grid: "#fafaf9", gridEnabled: true },
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
    grain: DEFAULT_GRAIN,
    view: DEFAULT_VIEW,
    audio: DEFAULT_AUDIO,
    background: { color: "#1c1c1e", effects: [] },
    grade: { preset: "Neutral", intensity: 1 },
    ground: { enabled: true, color: "#3a3a3d", size: 160, opacity: 0.42, shadow: true, grid: "#fafaf9", gridEnabled: true },
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
