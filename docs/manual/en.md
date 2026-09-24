# Reze Design — user manual

**English** · [简体中文](https://github.com/AmyangXYZ/reze-design/blob/main/docs/manual/zh.md)

Reze Design is an MMD scene editor in the browser, on its own WebGPU engine
([reze-engine](https://github.com/AmyangXYZ/reze-engine)). It reads the models
and motions the MMD community has made since 2008 and turns them into a video
file or a live page anyone can open and orbit.

**Section 1** is the editor, panel by panel. **Section 2** is the authoring
reference for grades, WGSL scene effects and material node graphs.

---

## Contents

- [0. MMD, in short](#0-mmd-in-short)
- [1. Making a scene](#1-making-a-scene)
  - [1.1 Getting started](#11-getting-started)
  - [1.2 Cast, motion and music](#12-cast-motion-and-music)
  - [1.3 Stage](#13-stage)
  - [1.4 Backdrop, sky and footage](#14-backdrop-sky-and-footage)
  - [1.5 Light](#15-light)
  - [1.6 Camera](#16-camera)
  - [1.7 The look](#17-the-look)
  - [1.8 Effects](#18-effects)
  - [1.9 Objects](#19-objects)
  - [1.10 Physics](#110-physics)
  - [1.11 Timeline](#111-timeline)
  - [1.12 Lyrics, lip sync and MIDI](#112-lyrics-lip-sync-and-midi)
  - [1.13 Export](#113-export)
  - [1.14 Publishing and the library](#114-publishing-and-the-library)
  - [1.15 When something goes wrong](#115-when-something-goes-wrong)
- [2. Authoring](#2-authoring)
  - [2.1 The rendering model](#21-the-rendering-model)
  - [2.2 Colour grades](#22-colour-grades)
  - [2.3 Scene effects in WGSL](#23-scene-effects-in-wgsl)
  - [2.4 Material shader graphs](#24-material-shader-graphs)
  - [2.5 Drafts, publishing and visibility](#25-drafts-publishing-and-visibility)
- [Appendix A. Control reference](#appendix-a-control-reference)
- [Appendix B. Finding models, motions and music](#appendix-b-finding-models-motions-and-music)
- [Appendix C. Glossary](#appendix-c-glossary)
- [Appendix D. Shader graph node reference](#appendix-d-shader-graph-node-reference)

---

# 0. MMD, in short

MikuMikuDance (**MMD**) is a free 3D animation program released by Yu Higuchi
(樋口優) in 2008. Its ecosystem is built from interchangeable parts: a model
(`.pmx`) from one author, a dance (`.vmd`) from another, a camera path from a
third, all working together because everyone follows the same bone names. A
motion from 2011 still drives a model made today.

The original program is a 32-bit Windows DirectX 9 application that stopped
development in the late 2010s. Reze Design runs the same files in a browser tab,
with a modern renderer, a timeline, and publishing to a permanent link. It is
part of a family that covers the rest of the workflow: reze-engine (rendering
and physics), [Reze Studio](https://github.com/AmyangXYZ/reze-studio)
(animation editing), [MiKaPo](https://github.com/AmyangXYZ/MiKaPo) (motion
capture) and [reze-rig](https://github.com/AmyangXYZ/reze-rig) (FBX → VMD).
[babylon-mmd](https://github.com/noname0310/babylon-mmd) is the other serious
MMD runtime on the web, built on Babylon.js.

---

# 1. Making a scene

## 1.1 Getting started

You need a browser with WebGPU: Chrome or Edge 113+, or Safari 26+.

Everything saves as you work — settings, uploads, drafts — in your browser's
local storage and IndexedDB. Close the tab and come back; the scene is where you
left it. Nothing reaches a server until you publish.

The left dock holds the scene, top to bottom: **Cast**, **Clips**, **Music**,
then the scene rows **Camera**, **Environment**, **Light**, **Effect**, **Post**,
**Physics** and **Objects**. The timeline sits under the viewport. **⌘K** (Ctrl+K)
opens the command palette, which reaches every action and setting by name.

The logo menu holds **New scene**, **Export scene** (one `.zip` with the scene and
every asset), **Import scene** and **Reset to default scene**.

## 1.2 Cast, motion and music

| Slot | Accepts |
| --- | --- |
| Model (**Cast → Add model**) | A folder holding a `.pmx`; zips inside it are unpacked. Several models can share a scene |
| Motion, Morph (**Clips**, per model) | `.vmd`. Morph replaces the motion's own face track |
| Camera (**Clips**) | `.vmd` camera motion, scene-wide |
| Music | mp3, m4a, aac, wav, ogg, opus, flac |
| MIDI, Lyrics (**Music** menu) | `.mid`, `.lrc` |

**Keep the model's folder intact.** A PMX finds its textures by relative path, so
a `.pmx` on its own loads white or grey. `.pmd` needs converting to PMX in PMX
Editor first.

Motion targets the standard skeleton and drives any model. Where proportions
differ, feet slide; a model closer in build to the one the motion was made for
fixes it. Hair and skirts are simulated and settle after a seek; exports render a
warm-up first, so the settling never reaches the file.

## 1.3 Stage

**Environment → Stage** loads one stage per scene, as either:

- **PMX folder** — a classic MMD stage. `.x` accessories convert to PMX on
  upload, ray-mmd `.fx`/`.emd` material files apply their materials, a
  `<name>.lights.json` beside the PMX brings its lamps, sun, world, grade and
  effects, and a `<name>.hdr` becomes the World light.
- **GLB file** — a stage exported from Blender, carrying its geometry, maps,
  lamps, sun and world. It is lit the way Blender lit it: inverse-square lamps,
  the same sun, glossy floors that take the lamps' highlights. Game stages come
  the same way — `tools/stages` reads a Unity export into Blender, and Blender
  writes the `.glb`.

A stage's materials are grouped into looks automatically — Wood, Stone, Glass,
Water, Foliage, Gold and so on, by material name in Japanese, Chinese or English.
A GLB brings its own *Stage PBR* looks. Regroup them in the Materials panel like a
character's.

While a stage is loaded, the built-in ground turns off; the stage brings its own
floor. A stage folder holding 2:1 sky panoramas asks which to use, and wick bones
named `flame…` get the *Candle Flames* effect automatically. Placement is scale
and position.

## 1.4 Backdrop, sky and footage

**Environment** has four tabs.

- **Ground** — colour, opacity, size, height, fade and grid lines. At opacity 0 it
  still catches shadows, which makes a shadow catcher for photographic
  backdrops.
- **Backdrop** — the background colour, plus one of: **Media** (an image, GIF or
  video behind the scene) or **Skybox** (a 360° panorama the camera looks out
  into). **World** takes an `.hdr` that lights the scene and shows in glossy
  surfaces, independently of what is displayed behind.
- **Footage** — video the character stands *in*. **Read camera from footage** and
  **Place her on the floor** match the camera and floor to the shot; camera
  height, FOV, elevation and roll fine-tune it, including the lean of footage
  shot on a phone. The ground becomes a shadow catcher while footage is loaded.

Media, Skybox and Footage share one seat: filling one empties the others.

## 1.5 Light

**Light** has three tabs.

- **World** — the ambient light everything sits in, plus **Cast fill**, a fill
  that lights the characters only.
- **Sun** — the key light and the shadow it casts, with colour, strength,
  azimuth and elevation. Low sun gives long shadows and strong rim separation.
- **Lamps** — point lights you place, shown as markers in the viewport. Stage
  rigs can also bring spot lamps.

A cool world against a warm sun (or the reverse) does most of the work.

## 1.6 Camera

Left-drag orbits, right-drag pans, the wheel zooms. **Camera → Lens** sets FOV,
distance, angles and target; **Focus** adds depth of field.

**Follow** binds the camera to a bone (the centre by default), so a motion that
travels stays in frame; the target then reads as an offset. A loaded camera
motion drives the view; the transport bar switches between it and free orbit
without stopping playback. **Eyes on camera** in the transport bar turns the
cast's eyes toward the lens.

## 1.7 The look

**Rendering styles.** Press ⌘K and type a style name — *Aether Gazer*,
*Wuthering Waves*, *Zenless Zone Zero*, *Honkai: Star Rail*. A style restyles
every group role for role and brings the view transform, exposure and world
light its ramps are tuned for (ZZZ also brings a sun and bloom). Your background,
outline, grade and ground stay where you put them. The choice is remembered for
the next model you load.

**Style groups.** A model's materials are sorted on load into groups — hair,
eyes, skin, cloth — and each group uses one shader graph. The **Materials** panel
lets you move materials between groups, hide one, create a group, or change its
graph. A group marked **edited** carries its own copy of the graph; picking a
look again is how a group takes a retuned built-in.

**Post** holds four tabs:

- **Grade** — *Neutral*, *Bloody*, *Cyberpunk*, *Divine*, *Moonlit*, *Sakura*, or
  anything from the library, with an intensity remembered per preset.
- **Tone** — Standard, Filmic or AgX, and exposure.
- **Bloom** — intensity, threshold and radius. Intensity 0 skips the pass.
- **Outline** — the MMD edge line, on or off.

Writing your own grade or graph is [Section 2](#2-authoring).

## 1.8 Effects

**Effect** applies scene effects: rain, petals, fireworks, ribbons on the hands,
stage lights, lyrics on screen, film looks and more. Pick one from the shortlist
or open the **Effect library**. Several run at once, in list order.

Each applied effect has:

- **Influence** — its strength.
- **Parameters** (the gear) — the dials the effect declares, with reset.
- **On models** (the gear, with more than one model) — which characters it
  follows. A hand ribbon aimed at one dancer follows only her.
- **Edit shader** — opens it in the WGSL editor as your own copy.

When an effect plays is set on the timeline's **Effect** lanes (§1.11).

## 1.9 Objects

**Objects** has two tabs.

- **Planes** — images, GIFs or videos standing in the scene as cards, with size,
  position and rotation.
- **Props** — a microphone, a fan, a sword: a PMX (or `.x`, or `.glb`) the cast
  holds or wears. **Attach to** hangs it from a bone of a character, like MMD's
  外部親; its position and rotation then become offsets in that bone's space. A
  prop keeps its own physics and outline.

On the timeline's **Objects** lane a prop can change hands over time: key which
bone it hangs from, and **Throw** it to another bone or a point, as a pass, a
toss or a lob.

## 1.10 Physics

**Physics** switches simulation on or off and sets gravity, wind and whether hair
and cloth collide with the floor. **Reset physics** (⌘K) restarts the simulation.

## 1.11 Timeline

The timeline edits what is playing, and every edit is written back into the
scene as VMD — it autosaves, publishes, and downloads from its row.

- **Tracks** — Motion, Morph, Camera, Effect, Visibility and Objects.
- **Posing** — double-click a bone on the character, drag the gizmo, and the pose
  is keyed at the playhead.
- **Timing and easing** — drag keys along the strip; the curve view shows the
  VMD's own bezier, with presets (Linear, In, Out, InOut, Slow In, Slow Out,
  Slow IO, Over).
- **Simplify** fits a dense track (captured or retargeted motion) with fewer keys.
- **Effect lanes** — one block per stretch of time an effect plays; the effect's
  clock starts at the block's left edge. Drag, trim, copy and paste blocks.
  A block's edges ramp smoothly (**Dissolve edges**) or in steps (**Stepped
  edges**). Deleting the last block removes the effect.
- **Visibility lanes** — take a cast member on and off stage over time.

⌘Z / ⇧⌘Z undo and redo. ←/→ jump between keys; ⌘C, ⌘X, ⌘V copy, cut and paste.

## 1.12 Lyrics, lip sync and MIDI

An `.lrc` beside the music does two things.

- **Lip sync from lyrics** (Clips menu) writes a mouth-morph VMD, syllable by
  syllable onto the five MMD vowel shapes, from kana, hangul, hanzi, romaji,
  pinyin or English. A bilingual `.lrc` sings the original line, not its
  translation.
- **Lyrics**, **Subtitles** and **Now Playing** effects draw it on screen;
  *Subtitles* stacks a bilingual line over its translation.

A `.mid` gives effects the notes — *Note Fall* draws them as a piano roll.

## 1.13 Export

**Render** sets the output, aspect (16:9, 9:16, 2.39:1, 1:1, 4:3), quality (up to
4K) and an optional range. While it is open, the viewport shows the frame that
will be recorded.

| Output | For |
| --- | --- |
| Scene · MP4 | The finished video, 60 fps |
| Green screen · MP4 | Pure `#00FF00` background, for keying |
| Alpha · PNG sequence | Transparent frames (Chrome: needs a folder) |
| Alpha · WebM | Transparent video |

Export renders frame by frame, offline, at 4× MSAA: a slow machine makes the same
file, just more slowly, and the music lands on the same frame every time. On
Chromium the file streams to disk as it encodes, so long 4K exports never need to
fit in memory. **AE composition script** writes an After Effects script that
rebuilds the camera for compositing.

**Capture PNG** saves the current frame — the intended way to make a thumbnail.

**Share export stats** (off by default) reports what a finished video was made
of — resolution, model filenames, effects, graphs and grade — and nothing about
who made it. The totals are public at
[reze.design/analysis](https://reze.design/analysis);
[reze.design/privacy](https://reze.design/privacy) lists exactly what is sent.

## 1.14 Publishing and the library

**Accounts.** Sign in with Google, GitHub, or a six-digit code sent to your email.
One email is one account however you sign in. On first sign-in you pick your
name, which appears in every link and can be set once.

**Publishing a scene** uploads its models, motion and music so it plays in other
browsers. Check each model's terms first: many ship with a 利用規約 (terms of
use), and **再配布禁止 — no redistribution — is common**; publishing counts as
redistribution, a rendered video does not. The dialog asks for a name, tags, a
thumbnail and a **借物表** (credits list) naming every model, motion, effect and
track with its author:

```
Model: Tda式初音ミク・アペンド by Tda
Motion: … by …
Camera: … by …
Music: … by …
```

A scene can be **public** or **private**. The link is `reze.design/<name>/<id>`
and never changes: renaming the scene or yourself keeps it working, and
republishing (**Update**) keeps its views and likes. Grades, effects and graphs
the scene uses must be published first, and a public scene cannot use private
ones.

**The library** holds grades, shader graphs, effects and scenes — built-in,
community and your own — filtered by All, Local, Community, Built-in, Yours and
Liked.

**The scene gallery** and a scene's page let anyone orbit, play and like it.
**Open in editor** brings the whole scene into your editor as your own copy
(named `… - fork`), with its credits. Each maker has a page at
`reze.design/<name>` listing their scenes, effects, graphs and grades.

## 1.15 When something goes wrong

| Symptom | Cause |
| --- | --- |
| The editor will not start | The browser has no WebGPU |
| Model loads white, grey or black | Textures not found — load the whole folder |
| Model will not load | It is `.pmd`; convert to PMX first |
| Motion plays, model stands still | Motion on another model's slot, or non-standard bone names |
| Feet slide or sink | Proportions differ from the model the motion was made for |
| Camera will not orbit | A camera motion is driving it — switch to free orbit |
| Publish is blocked | The scene uses an unpublished or private grade, effect or graph; the dialog names it |
| Publish fails | The error names the stage: packing (missing asset), uploading (bundle over 2 GB, connection), publishing (signed out) |

Export is slow by design: it renders every frame at full quality. Iterate at
1080p on a short range, then do the final pass at 4K.

---

# 2. Authoring

The look of a scene is programmable at three levels. **Grades** (§2.2) shape the
colour of the whole frame. **Scene effects** (§2.3) are WGSL programs that paint
around, over and among the cast. **Material graphs** (§2.4) define how each
surface responds to light. Each section states its full contract.

## 2.1 The rendering model

Back to front:

```
background colour → media / skybox → fn background (§2.3)
        ↓
the scene: cast, stage, props — each surface shaded by its GRAPH (§2.4),
lit by sun, world, lamps and effect lights; particles and trails drawn here
        ↓
bloom → view transform → COLOUR GRADE (§2.2)
        ↓
fn foreground (§2.3), holding the scene's depth
        ↓
filters (§2.3, rzSceneFrame) — last, over everything
```

A grade applies to every pixel. A graph governs one style group. An effect paints
at the mounts it defines. All three travel inside the scene document.

## 2.2 Colour grades

Grades are **ASC CDL** transforms — slope, offset and power per tonal range — the
standard of film post-production.

Open the grade library and choose **Edit** on a preset, or edit the applied one
from **Post → Grade**. The scene is the preview.

- **Split tone** (−1 to +1) pushes shadows and highlights apart on a warm/cool
  axis. Negative is teal shadows and orange highlights; positive is the reverse.
- **Three wheels** — shadows, midtones, highlights. Angle is the hue, distance
  from centre the amount, the rail beside it the lightness.
- **Contrast** (0.5–1.6) pivots on mid-grey; **Saturation** (0–2).

Fix the lighting first, set split tone, then crush or lift with the rails, push
hue one range at a time, and lower saturation last. Compare against *Neutral*
often. Grades export and import as JSON from the editor header.

## 2.3 Scene effects in WGSL

A scene effect is one WGSL file. **The functions it defines decide what it is and
where it draws** — there is no layer setting.

### Mounts

| Define | You get |
| --- | --- |
| `fn background(ray, uv, time)` | A layer behind the cast |
| `fn foreground(ray, uv, time, depth)` | A layer over the frame, holding the scene's depth |
| `fn particleInit` · `particleStep` · `particleShade` | A GPU particle pool, drawn inside the scene |
| `fn trailWidth` · `trailShade` | Ribbons along the recorded paths of bones |
| `fn lightEmit` | Point lights that shade the scene |
| `fn gridStep` | A simulation grid that persists between frames |
| `#mirror` | A planar mirror — no function at all |

`background` and `foreground` together are one effect (a storm: dark sky, rain in
front). A file uses **field** mounts (`background`/`foreground`) **or** particles
and trails, not both; lights and grids combine with either.

### Directives

`#` lines at the top of the file. They are syntax: the engine parses them and
reports an unknown one with its line number. Text after `—`, `--`, `//` or ` # `
is a note.

```wgsl
#anchor 頭                 a bone by name        -> rzAnchor(subject, 0)
#anchor 左手首 trail       ...and record its path -> rzTrail(subject, 1, i)
#points flame              every bone starting "flame" -> rzPoint(i)
#particles 4096            pool size (default 1024)
#blend additive            particles add light
#blend cutout              particles write depth, alpha as coverage (grass)
#bloom                     particles / ribbons reach bloom
#layer additive            the FIELD adds light instead of covering
#halfres                   field mounts at half resolution
#lights 4                  light slots, with fn lightEmit
#grid 768                  grid resolution, with fn gridStep
#param float speed 1.0 0 4 a dial: float name default [min max]
#param color tint #3b82f6  a colour dial, hex default
#param vec3 offset 0 1 0   a vector dial
#duration 3.0              one firing lasts 3 s — the effect is a HIT
#dissolve                  takes subject 0 apart and back
#ground #202020 grain 0.3  replaces the floor while installed
#mirror                    the effect is a mirror
```

- **`#layer additive`** is right for anything that is light rather than matter.
  The default composites alpha-over, so two crossing glows occlude each other.
- **`#anchor`** slots are in declaration order. `.valid` is false on a rig that
  names the bone differently — check it.
- **`#halfres`** suits soft effects. Avoid it when alpha has a hard edge, such as
  a foreground compared against `depth` along every silhouette.
- **`#duration`** makes the effect a hit with an arc; without it the effect is
  ambient (rain, stars, fog).
- **`#param`** values are read as `params.<name>`. The app builds the controls, so
  what the panel offers and what the shader reads never come apart.
- **`#dissolve`** timings come from `const DISSOLVE_APART/GONE/BACK/WHOLE` or
  `#param` dials of those names.
- **`#mirror`** places its plane from dials named `POS_X/Y/Z`, `ROT_X/Y/Z`,
  `WIDTH`, `HEIGHT`, `TINT`, `BLUR`, `FRAME`, `FRAME_COLOR`.

### The field contract

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f
fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f
```

| Parameter | Meaning |
| --- | --- |
| `ray` | World-space view direction; turns with the camera, so anything built from it is pinned to the world |
| `uv` | Screen position 0–1, origin bottom-left |
| `time` | Seconds on the effect's clock (from its clip's start) |
| `depth` | `foreground` only — distance to what the scene drew here, the far plane where nothing |

Return **sRGB with straight alpha**: 0 leaves what is behind untouched, 1 replaces
it.

**`ray` or `uv`** decides behaviour under camera motion. From `uv`, the effect is
glued to the frame — right for weather, vignettes and grain. From `ray`, it
belongs to the world — stars built from `uv` slide when the camera orbits. For
anything pointing *up* on a character (flames, a column of light), project a
world-up vector from the subject; screen up tilts with the camera.

**`depth`** does three jobs. Compare against it (feathered, or silhouettes
staircase) so drops pass behind a shoulder. Read it directly — `1 - exp(-depth *
density)` is fog. Turn it into a place with `rzWorldPos(ray, depth)`, so a
pattern stays put when the camera moves. For something the character stands
*inside*, march the ray between `rzCameraPos()` and that point.

### Reading the scene

| Helper | Gives you |
| --- | --- |
| `rzResolution()` · `rzViewportHeight()` | Canvas size in pixels |
| `rzTime()` · `rzDt()` | The clock and the frame step |
| `rzCameraPos()` · `rzCameraRight()` · `rzCameraUp()` · `rzCameraForward()` | The camera |
| `rzSubjectCount()` · `rzSubject(i)` | The characters this effect is on: `{ root, center, bounds, dissolve, gaze, looking, valid }` |
| `rzSubjectHip(i)` · `rzSubjectId(i)` | Hip position; a stable id per model |
| `rzAnchor(s, slot)` | A declared bone: `{ pos, vel, fwd, valid }` |
| `rzTrailCount(s, slot)` · `rzTrail(s, slot, i)` | That bone's recent path — `xyz` position, `w` seconds ago |
| `rzTrailAt` · `rzTangentAt` · `rzSpline` · `rzSplineTangent(s)` · `rzKnot` · `rzTurnRadius` | Smooth sampling of a path |
| `rzPointCount()` · `rzPoint(i)` | Bones matched by `#points`: `{ pos, tip }` |
| `rzWorldPos(ray, depth)` | This pixel's depth as a world point |
| `rzProject(p)` | A world point on screen: `xy` uv, `z` distance, comparable to `depth`, negative behind the camera |
| `rzCastDistance(uv)` | Screen pixels to the cast's silhouette — 0 on her, positive outside |
| `rzObjectAt(uv)` · `rzMaterialAt(uv)` | Which object and material drew this pixel (field mounts) |
| `rzShadow(p)` · `rzWorldAmbient(n)` · `rzLightsDiffuse(p, n)` | The scene's sun shadow, world light and lamp light at a point |
| `rzLightCount()` · `rzLightPos/Color/Radius/Aim/Cone(i)` | The scene's lamps |
| `rzHash11/21/31/13` · `rzValueNoise(p)` · `rzCurlNoise(p)` · `rzFalloff(d, r)` | Hashes, noise, and a falloff that is exactly 0 at `r` |

**Which characters an effect is on is the scene's call** (§1.8, *On models*).
`rzSubject(0)` is the first of those, so write the loop and let the scene aim it.
Loop to the count functions, never to constants.

`rzSubject().bounds` is a generous cull sphere; size things by hip height
(`center.y - root.y`). `rzProject` makes world-anchored drawing cheap: project
points once and measure in 2D, with occlusion as one compare against `depth`.

The older `bg*` names (`bgWorldPos`, `bgResolution`, …) still work.

### Reading the frame — filters

| Helper | Gives you |
| --- | --- |
| `rzScene(uv)` · `rzSceneAlpha(uv)` | The scene layer in linear HDR, and how much of the pixel it covers |
| `rzSceneDisplay(uv)` | The scene in display space — exposure, view transform and grade applied |
| `rzSceneDepth(uv)` · `rzSceneHit(uv)` · `rzSceneFar()` | Depth at any pixel, whether anything was drawn, the far plane |
| `rzBackground()` | The background colour |
| `rzSceneFrame(uv)` | The finished frame, other effects included |

These read the frame at any uv — refraction, heat haze, CRT curvature, a
pixelated cast. **Calling `rzSceneFrame` makes the effect a filter**: it runs
after every other effect and absorbs them (*Holo Card*, *World Slash*).

### Music, score and words

The whole track is analysed once, ahead of time, so an export matches the editor
and an effect can read the future.

| Helper | Gives you |
| --- | --- |
| `rzAudioLevel()` · `rzAudioOnset()` | Loudness 0–1; how hard the bass is rising (the kick) |
| `rzAudioBandCount()` · `rzAudioBand(i)` | Log-spaced spectrum, 0–1 |
| `rzAudioLevelAt(o)` · `rzAudioOnsetAt(o)` · `rzAudioBandAt(i, o)` | The same, `o` seconds away — negative past, positive future |
| `rzAudioTime()` · `rzAudioPlaying()` · `rzAudioFrames()` | Song position, playing, analysis length |
| `rzMidiTime()` · `rzMidiDuration()` · `rzMidiPlaying()` | The score's clock |
| `rzNoteCount()` · `rzNoteStart(i)` · `rzNoteLength(i)` | Notes, sorted by start — binary-search the live window |
| `rzNotePitch(i)` · `rzNoteVelocity(i)` · `rzNoteAge(i)` · `rzNoteHeld(i)` | Pitch, velocity 0–1, age, sounding now |
| `rzPitchLow()` · `rzPitchHigh()` · `rzPitchX(p)` · `rzKeyEnergy(p)` | The range the file uses, a pitch as 0–1 across it, a decaying key level |
| `rzLyricCount()` · `rzLyricIndex(t)` | Lines; which is live at `t` (`-1` between) |
| `rzLyricStart(i)` · `rzLyricEnd(i)` · `rzLyricProgress(i, t)` | A line's window and the karaoke sweep |
| `rzLyricText(i, uv)` · `rzLyricHasText(i)` · `rzLyricChars(i)` | Glyph coverage over the line's own box |
| `rzLyricAspect(i)` · `rzLyricPixels(i)` · `rzLyricRect(i)` · `rzLyricWidest()` | Its shape, atlas size and place; the widest line's aspect |

Text is rasterised by the app; sample coverage across a pixel (using
`rzLyricPixels`) rather than at a point, or small type shimmers. Everything
reads zero, `-1` or `false` when the scene has no music, `.mid` or `.lrc`.

### Lights

```wgsl
#lights 4
fn lightEmit(i: u32, time: f32) -> RzLight {
  var l: RzLight;
  l.pos = vec3f(0.0, 12.0, 0.0);  // world space
  l.color = vec3f(1.0, 0.85, 0.6);
  l.intensity = 0.0;               // 0 retires the slot
  l.radius = 8.0;                  // falloff distance
  return l;
}
```

Called per slot per frame; set every field. Effect lights are point lights, up to
128. This is the mount that changes how the *cast* looks — bloom spreads bright
pixels after shading and lights nothing.

### Particles

```wgsl
#particles 4096
fn particleInit(i: u32, seed: f32) -> Particle
fn particleStep(p: Particle, dt: f32) -> Particle
fn particleShade(p: Particle, uv: vec2f) -> vec4f      // billboard, uv 0–1
fn particleCover(p: Particle, uv: vec2f) -> f32        // optional, with #blend cutout
fn particleCount() -> u32                              // optional, live count
```

`Particle` holds `pos`, `vel`, `age`, `life`, `size`, `rot`, `seed`, `stretch`.
`life = 0` retires one and it respawns through `particleInit`. `stretch` is the
aspect along travel — a raindrop is 10–20. Particles are drawn in the scene pass,
so the cast hides them for free. The pool goes up to 2,097,152; `particleCount()`
runs fewer when fewer are needed (*Field of Flowers*).

### Trails

```wgsl
#anchor 右手首 trail
fn trailWidth(u: f32, age: f32) -> f32                                   // pixels
fn trailShade(u: f32, v: f32, age: f32, weight: f32, slot: i32) -> vec4f
```

`u` runs along the ribbon, `v` across it. The path is sampled on the scene clock,
so it is identical in the editor and every export, smoothed into a spline, and
drawn at constant screen width. Ribbons max-blend in their own layer, so a ribbon
crossing itself does not stack into white.

### A simulation grid

```wgsl
#grid 768
fn gridStep(uv: vec2f, prev: vec4f, dt: f32) -> vec4f {
  if (rzGridFrame() == 0) { return vec4f(0.0); }   // seed on frame 0
  let left = rzGridPrev(uv - vec2f(rzGridTexel(), 0.0));
  return prev;                                      // four floats, yours
}
```

| Helper | Gives you |
| --- | --- |
| `rzGrid(uv)` · `rzGridPrev(uv)` | This frame's cell; last frame's |
| `rzGridTexel()` · `rzGridSize()` · `rzGridFrame()` | Texel size in uv, resolution, frames since applied |

Default 256, maximum 1024. The one stateful mount: an export starting mid-scene
starts from an empty grid. *Dry Ice* and *Water* are fluids built on it.

### Making it fast

This runs every frame behind a full character render, at up to 4K.

- **Cull first, hierarchically** — reject pixels far from the cast, then per limb,
  before per mark.
- **Derive cull radii** from what actually reaches (offset plus spread); a guessed
  radius clips as a straight line across the effect.
- **Bound every glow** — `smoothstep(REACH, 0.0, d)` or `rzFalloff`, never a bare
  `1/r`, which has no edge to cull at and turns a cut into a bloom ring.
- **March volumes**; do not shade the depth buffer — density at the floor's depth
  cannot wrap around someone standing in it.
- **Keep loops fixed and small**; use `fwidth` only in uniform control flow.
- **Drive motion from `time`** — it is what makes an export reproducible.
- **Brightness is opacity** — keep width and brightness as separate dials.

### The editing loop

**Effect library → New effect** starts from a commented template; **Edit shader**
on any effect forks it. **⌘Enter compiles and applies.** On failure the previous
shader stays live and diagnostics point at your line and column.

### The built-ins as worked examples

Every built-in is commented with the mistake it avoids.

| Effect | Demonstrates |
| --- | --- |
| *Rain* · *Snow* · *Sakura Drift* | Particle pools, depth-tested against the cast |
| *Floating Stars* · *Ember Drift* · *Ember Motes* | Additive particles with bloom and lights |
| *Hand Ribbon* · *Hand Threads* | Trails along a bone's recorded path |
| *Hand Sparks* · *Fuse Sparks* · *Hand Blossoms* · *Divine Ribbon* | Particles emitted from anchors |
| *Teleportation* · *Divine Teleportation* | `#dissolve` with `#duration` — a body taken apart and rebuilt |
| *Candle Flames* | `#points` — one flame per matching bone |
| *Field of Flowers* | `#blend cutout`, `particleCover`, `particleCount`, a grid, `rzShadow` |
| *Dry Ice* · *Water* | Persistent grids: fluid on the floor, a rippling pool |
| *Footprints* | Reading a trail in world space |
| *Vyke's Dragonbolt* | Screen-space arcs carrying real depth |
| *Summoning Circle* | Ray–plane intersection under a declared bone |
| *Stage Lights* | Volumetric beams marched through their own cylinder |
| *Gojo* · *World Slash* | Hits with `#duration`; a filter over the frame |
| *Laser Eyes* · *Laser Stare* | `rzSubject().gaze`, lights on the face |
| *Sticker Outline* · *Holy Light* · *Bloody Ash* | `rzCastDistance` — outlines and rims off the silhouette |
| *Holo Card* | `rzSceneFrame` — a filter carrying every other effect |
| *CRT Glitch* · *Line Art* · *Manga* · *8-Bit* | Rereading the frame; *8-Bit* uses `rzObjectAt` |
| *Mirror* | `#mirror` |
| *Waveform* | The audio interface |
| *Note Fall* | The MIDI interface as geometry |
| *Lyrics* · *Subtitles* · *Now Playing* | The lyric interface |
| *Shining Stars* · *Galaxy Sky* | World-space skies from `ray` |
| *Fireworks* | World-anchored ballistics with lights |
| *REZE DESIGN* · *Signature* | Signed-distance glyphs |
| *Finger Shapes* | Hulls around both hands and the shape the fingers close |

## 2.4 Material shader graphs

A shader graph defines how one style group responds to light: Blender-style
nodes with typed sockets, compiled to WGSL and applied live. From **Materials**,
click a group's graph, **Browse all…**, then **Edit graph**.

### The built-in sets

| Set | Graphs | Built around |
| --- | --- | --- |
| **AG** — Aether Gazer | Body, Eye, Face, Hair, Metal, Rough Cloth, Smooth Cloth, Stockings | The lighting closure into a ramp |
| **WuWa** — Wuthering Waves | Body, Cloth, Hair, Face, Metal, Eye | Half-Lambert through a narrow threshold, a warm band, sphere map, rim |
| **ZZZ** — Zenless Zone Zero | Body, Cloth, Eye, Face, Hair, Metal | The closure quantised into a mask, lit and shadow branches tinted apart |
| **HSR** — Honkai: Star Rail | Body, Face, Hair, Cloth, Metal, Eye | The `light` node and the sphere map |
| **Stage** | Tile, Emissive, Wood, Brick, Plastic, Glass, Concrete, Stone, Fabric, Rubber, Leather, Paper, Water, Gold, Mapped PBR, Foliage, Stage Surface | Principled PBR; *Water* uses `time` and `environment`, *Foliage* hashed alpha |

An ungrouped material renders the neutral default graph, which is also where a
new graph starts. No built-in carries an image: they read the material's own
texture and sphere map, so they work on any model.

### Building

- **Add a node** — right-click the canvas, or the searchable add menu.
- **Connect** — drag output to input; incompatible types refuse the link.
- **Unlinked inputs** use the literal on the node.
- **Set as output** — one per graph; must resolve to a colour or a float.
- **Preview output** routes any socket to the screen. When a graph looks wrong,
  preview backwards from the output; the first wrong socket is the bug.
- **Generated WGSL** shows what the graph compiles to.

Node positions are layout only. Graphs import and export as JSON from the header.

### The graph document

```jsonc
{
  "version": 1,
  "name": "My Graph",
  "nodes": [
    { "id": "tex", "type": "texture" },
    { "id": "diff", "type": "material_diffuse" },
    { "id": "base", "type": "mix/multiply", "inputs": { "fac": 1.0 } },
    { "id": "shade", "type": "shader_to_rgb_diffuse" },
    { "id": "band", "type": "ramp_constant_aa",
      "inputs": { "edge": 0.35, "color0": [0.62, 0.58, 0.72, 1], "color1": [1, 1, 1, 1] } },
    { "id": "lit", "type": "mix/multiply", "inputs": { "fac": 1.0 } }
  ],
  "links": [
    { "from": { "node": "tex",   "socket": "color" }, "to": { "node": "base", "socket": "a" } },
    { "from": { "node": "diff",  "socket": "color" }, "to": { "node": "base", "socket": "b" } },
    { "from": { "node": "shade", "socket": "value" }, "to": { "node": "band", "socket": "fac" } },
    { "from": { "node": "base",  "socket": "color" }, "to": { "node": "lit",  "socket": "a" } },
    { "from": { "node": "band",  "socket": "color" }, "to": { "node": "lit",  "socket": "b" } }
  ],
  "output": { "node": "lit", "socket": "color" }
}
```

A complete cel shader: texture × material tint, times diffuse light quantised to
two bands. An optional `params` array exposes node inputs as live sliders; `tags`
help library search. Every node type and socket is in
[Appendix D](#appendix-d-shader-graph-node-reference).

### Two spines

**The closure** (AG): `texture` × `material_diffuse` (a `mix/multiply` at `fac 1`
— without it untextured materials render white), then `shader_to_rgb_diffuse`
into `ramp_constant_aa` for bands or `ramp_linear` for a soft falloff, multiplied
over the base. Add a rim with `layer_weight/facing` into `mix/add_emit`.

**Your own term** (WuWa, HSR): `light.direction` · `geometry.normal` through
`vector_math/dot`, then `math/multiply_add` (0.5, 0.5) for a half-Lambert;
`map_range` over a narrow window (say 0.46–0.54) for a hard terminator;
`ramp_linear_3` from shadow through a warm band to lit; multiply over the
texture. Then fold in the scene's light — `light.color × (band × light.shadow ÷
π) + light.ambient`, mixed halfway toward white — so the material responds to sun
colour, world light and cast shadows without taking on the world's hue. Finish
with `sphere_map` for the model's own highlight.

### Rules the compiler checks

- `version` is 1. Node ids are unique and match `/^[a-z0-9_]+$/`; `type` is an
  exact registry id (`math/power`).
- One link per input; no cycles; `output` resolves to a colour or float.
- At most **64 nodes** and **16 params**.
- A literal must fit its socket: a scalar splats onto colour and vector, a vector
  on a float is an error. Ramp stop colours are `vec4` literals and take no links.
- Sockets that carry the processed value (`invert.color`, `separate_xyz.vector`,
  `principled.base_color`, a ramp's `fac`) need a link or an explicit literal.
- Params target unlinked inputs, one per socket, `float` or `color` — to expose a
  ramp stop, drive it through a `mix/*` and expose that.
- Types convert implicitly: colour → float is BT.601 luminance, float → colour
  splats, vector → float is rejected (use `separate_xyz`).
- **Coordinates are left-handed, Y-up.** Blender's `(x, y, z)` is `(x, z, y)`
  here; the vertical of a normal is `separate_xyz.y`.

**Import graph JSON** validates a file before it reaches the canvas. Outside the
editor, reze-engine exports `validateGraph(graph)` and `compileGraph(graph)` →
`{ ok, wgsl, diagnostics }`; cycles and missing links are found by the compile.

### Coming from Blender

Node semantics track **Blender 5.2**: Principled uses v2 socket names, and the
math (39), vector math (24) and mix (20) operations are Blender's own, safeguards
included. A node's mode is part of its type — Math set to Power is `math/power`,
a Color Ramp's interpolation picks the `ramp_*` type.

| Blender | reze |
| --- | --- |
| Principled BSDF | `principled` |
| Shader to RGB | `shader_to_rgb` (colour) · `shader_to_rgb_diffuse` (scalar) |
| Image Texture | `texture` (the material's map) · `tex_image/0…3` (the group's maps) |
| Texture Coordinate, Geometry | `geometry` |
| Color Ramp | `ramp_constant`, `ramp_linear`, `ramp_cardinal`; `ramp_linear_3` for three stops |
| Math, Vector Math, Mix Color | `math/…`, `vector_math/…`, `mix/…` |
| Layer Weight | `layer_weight/fresnel`, `layer_weight/facing` |
| Mix Shader, Add Shader | `mix_shader`, `add_shader` — on colours |

Differences that change values:

- **Lighting** — no screen-traced GI, virtual shadow maps or probes. `principled`
  does include indirect specular from the World, so do not add an `environment`
  node on top of it.
- **View transform** — match the source under **Post → Tone**. AgX is Blender's
  base AgX; its Looks (High Contrast and others) have no equivalent.
- **Principled** — coat, transmission, subsurface, anisotropy and thin film are
  absent. At `ior` 1.5 a 3.6 material's Specular transfers unchanged.
  `spec_clamp` is EEVEE's light clamp; `reflection_lod` and `unity_direct` are
  for converted game stages.
- **Shading is colour** — `mix_shader` is `mix(a, b, fac)` on `vec3f`. A tree that
  mixes closures and evaluates afterwards has to be rewritten Shader-to-RGB
  style: evaluate each branch to a colour, then combine.
- **Too many nodes** — fold constant subtrees, drop reroutes and frames, flatten
  node groups. Normal Map, Displacement and AOV Output have no equivalent.
- **Per-character images** (highlight maps, ID masks, face SDFs) do not transfer.
  Where an ID mask picks regions, use style groups instead.

Say what did not survive a port: a silently degraded material reads as a
renderer bug to whoever inherits it.

### The MMD idiom

- **Toon bands** from a constant or anti-aliased constant ramp on the lighting
  term — two or three bands, not a gradient.
- **Rim light** — fresnel or facing into emission, kept faint.
- **Eyes** want their own graph: flatter, more saturated, less lit.
- **Hair** wants a banded sheen along its rest position; uniform specular reads
  as plastic.
- **Stockings** need hashed alpha to sort through layers — the group's role
  handles it; start from *AG Stockings*.

A graph runs for every pixel of its group every frame, so it costs more on a
costume filling the frame than on the eyes. Check a close-up and a wide shot.

## 2.5 Drafts, publishing and visibility

Grades, effects and graphs share one lifecycle.

- **Your drafts save as you work**, locally, in the library's **Local** filter.
- **Anything else you edit is a scratchpad** — a built-in, someone else's item, a
  look built on a style group. On close you choose to keep it as a draft or
  discard it (the scene returns to what it was).
- **Publishing** makes a draft a library item under your name, **public** or
  **private**. A private item is visible only to you; a public one cannot be
  made private again. Names are unique per author per kind.
- **Publishing over your own item replaces it**, and scenes that reference it by
  id follow: retune your grade or effect and scenes using it retune too.
- **Graphs are the exception.** A style group keeps its own copy of the graph, so
  a scene keeps the look it was published with. Pick the look again to take a
  retune.
- **Built-ins** travel as references resolved from the app, so a scene using only
  built-ins renders with no network or database.

---

# Appendix A. Control reference

**Scene**

| Section | Control | Range |
| --- | --- | --- |
| Light → World | colour, strength; cast fill colour, strength | 0–2; 0–4 |
| Light → Sun | shadow, colour, strength, azimuth, elevation | 0–6, 0–360°, 0–90° |
| Light → Lamps | on, colour, intensity, radius, X/Y/Z | — |
| Post → Grade | preset, intensity | 0–1, remembered per preset |
| Post → Tone | Standard / Filmic / AgX, exposure | — |
| Post → Bloom | intensity, threshold, radius | 0 = off |
| Environment → Ground | show, colour, opacity, size, height, fade, grid lines | opacity 0–1 |
| Environment → Stage | PMX folder / GLB file, scale, position | 0.05–10×, ±50 |
| Camera → Lens | follow + bone, FOV, distance, azimuth, elevation, target | — |
| Camera → Focus | depth of field, strength | — |
| Physics | simulate, gravity, ground collision, wind, frequency, direction | — |

**Render**

| Control | Options |
| --- | --- |
| Output | Scene · MP4, Green screen · MP4, Alpha · PNG sequence, Alpha · WebM |
| Aspect | 16:9, 9:16, 2.39:1, 1:1, 4:3 |
| Quality | 1080p, 1440p, 4K |
| Range | `m:ss` – `m:ss`, blank = whole clip |
| Audio | Music track, None |
| Watermark | on / off |
| Also | Capture PNG, AE composition script, Share export stats |

**Limits**

| Limit | Value |
| --- | --- |
| Scene name | 60 characters |
| Description | 500 characters |
| Tags | 5, of 16 characters each |
| Credits | 4,000 characters |
| Published bundle | 2 GB |
| Thumbnail | 20 MB — capture at 1080p |

---

# Appendix B. Finding models, motions and music

- **BOOTH** (`booth.pm`) — pixiv's marketplace, where most maintained models
  live. Search `MMD モデル`.
- **Niconi Solid** (`3d.nicovideo.jp`) — Niconico's model host, including official
  Crypton models.
- **BowlRoll** (`bowlroll.net`) — where most motion is hosted, often linked from a
  Niconico video or a post, sometimes behind a password given there.
- **Aplaybox** (`aplaybox.com`) — a large Chinese model site used by the bilibili
  MMD and VTuber communities.
- **DeviantArt** — the long-time Western hub; prefer the original author's page.

Body and camera motion usually come together per song: search the song title plus
`モーション配布`. For music, VOCALOID producers often allow non-commercial
derivative use and libraries such as DOVA-SYNDROME (`dova-s.jp`) are explicit
about it. Publishing uploads the audio, so treat music as the most
rights-sensitive part of a scene.

---

# Appendix C. Glossary

**ASC CDL** — the slope/offset/power colour transform behind grades.

**借物表 (karimono-hyō)** — the credits list naming every model, motion, effect
and track with its author. Required when publishing.

**Bone** — a joint in a model's skeleton; motion files address bones by name.

**Cel / toon shading** — lighting quantised into flat bands.

**Equirectangular** — a 2:1 panorama, used for skyboxes and HDR worlds.

**外部親 (external parent)** — MMD's way of hanging one object from another's
bone; props use it.

**GLB** — binary glTF, the format stages come in from Blender.

**Grade** — a colour transform over the whole finished image.

**MME (MikuMikuEffect)** — desktop MMD's DirectX 9 effect plugin. Its
counterparts here are scene effects and shader graphs.

**Morph** — a named blend shape, usually an expression.

**PMX / PMD** — MMD model formats; PMX is current.

**Shader graph** — a node graph defining how a surface responds to light.

**Style group** — materials sharing one shader graph.

**利用規約 (riyō kiyaku)** — a model's terms of use. Read them before publishing.

**VMD** — Vocaloid Motion Data: body, morph or camera motion.

**WGSL** — the WebGPU shading language; effects are written in it and graphs
compile to it.

---

# Appendix D. Shader graph node reference

Every node type the compiler accepts, with its exact socket names, from
reze-engine's registry (151 types). A graph holds at most 64 nodes and 16 params.

## Families

One type id per operation, written `family/operation`.

| Type | In | Out | Operations |
| --- | --- | --- | --- |
| `math/…` | `a` `b` `c` | `value` | `absolute` `sqrt` `inversesqrt` `exponent` `sign` `round` `floor` `ceil` `truncate` `fraction` `sine` `cosine` `tangent` `arcsine` `arccosine` `arctangent` `radians` `degrees` `subtract` `divide` `logarithm` `minimum` `maximum` `less_than` `modulo` `floored_modulo` `snap` `pingpong` `arctan2` `multiply_add` `compare` `smooth_min` `smooth_max` `wrap` `add` `multiply` `power` `greater_than` `clamp01` |
| `vector_math/…` | `a` `b` `c` `scale` | `vector` | `normalize` `absolute` `floor` `ceil` `fraction` `add` `subtract` `multiply` `divide` `cross` `project` `reflect` `minimum` `maximum` `modulo` `snap` `scale` `multiply_add` `faceforward` `wrap` |
| `vector_math/…` | `a` `b` `c` `scale` | `value` | `dot` `distance` `length` |
| `vector_math/…` | `a` `b` `c` `ior` `scale` | `vector` | `refract` |
| `mix/…` | `a` `b` `fac` | `color` | `add` `subtract` `darken` `difference` `exclusion` `screen` `soft_light` `dodge` `burn` `divide` `hue` `saturation` `value` `color` `blend` `overlay` `multiply` `lighten` `linear_light` |
| `mix/…` | `a` `b` | `color` | `add_emit` |
| `vector_transform/…` | `vector` | `vector` | `world_to_camera` `camera_to_world` `point_world_to_camera` |
| `tex_image/…` | `uv` | `color` `alpha` | `0` `1` `2` `3` |
| `separate_color/…` | `color` | `h` `s` `v` | `hsv` |
| `separate_color/…` | `color` | `h` `s` `l` | `hsl` |
| `combine_color/…` | `h` `s` `v` | `color` | `hsv` |
| `combine_color/…` | `h` `l` `s` | `color` | `hsl` |
| `map_range/…` | `from_max` `from_min` `to_max` `to_min` `value` | `value` | `linear` `smoothstep` |
| `vector_rotate/…` | `angle` `axis` `center` `rotation` `vector` | `vector` | `axis_angle` `euler_xyz` |
| `layer_weight/…` | `blend` `normal` | `value` | `fresnel` `facing` |
| `bump/…` | `height` `normal` `strength` | `vector` | `world` |
| `tex_voronoi/…` | `scale` `vector` | `value` | `f1` |
| `tex_voronoi/…` | `scale` `vector` | `color` | `color` |

## Nodes

| Type | In | Out |
| --- | --- | --- |
| `texture` | — | `color` `alpha` |
| `time` | — | `value` |
| `geometry` | — | `normal` `view` `world_pos` `rest_pos` `uv` `reflection` `footprint` |
| `light` | — | `direction` `color` `ambient` `shadow` |
| `head_basis` | — | `forward` `right` `up` |
| `material_alpha` | — | `value` |
| `material_specular` | — | `color` |
| `material_shininess` | — | `value` |
| `material_diffuse` | — | `color` |
| `sphere_map` | `base` `strength` | `color` |
| `rgb_curve` | `color` `fac` `y0` `y1` `y2` `y3` `y4` | `color` |
| `uv_map` | — | `uv` |
| `normal_map` | `color` `strength` | `normal` |
| `bsdf_transparent` | — | `color` |
| `bsdf_diffuse` | `color` | `color` |
| `attribute` | — | `color` `fac` |
| `object_info` | — | `location` `color` `random` |
| `light_path` | — | `is_camera_ray` `is_shadow_ray` `ray_depth` |
| `separate_color` | `color` | `r` `g` `b` |
| `combine_color` | `r` `g` `b` | `color` |
| `combine_xyz` | `x` `y` `z` | `vector` |
| `gamma` | `color` `gamma` | `color` |
| `map_range` | `value` `from_min` `from_max` `to_min` `to_max` | `value` |
| `value` | `value` | `value` |
| `rgb` | `color` | `color` |
| `hue_sat` | `hue` `saturation` `value` `fac` `color` | `color` |
| `bright_contrast` | `color` `bright` `contrast` | `color` |
| `invert` | `fac` `color` | `color` |
| `ramp_constant` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_linear` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_cardinal` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_constant_aa` | `fac` `edge` `color0` `color1` | `color` `alpha` `fac_out` |
| `ramp_linear_3` | `fac` `pos0` `color0` `pos1` `color1` `pos2` `color2` | `color` `alpha` `fac_out` |
| `ramp_tri` | `fac` | `value` |
| `emission` | `color` `strength` | `color` |
| `add_shader` | `a` `b` | `color` |
| `mix_shader` | `fac` `a` `b` | `color` |
| `fresnel` | `ior` | `value` |
| `environment` | `vector` `roughness` | `color` |
| `shader_to_rgb_diffuse` | — | `value` |
| `shader_to_rgb` | — | `color` |
| `separate_xyz` | `vector` | `x` `y` `z` |
| `vect_cross` | `a` `b` | `vector` |
| `mapping` | `vector` `loc` `rot` `scl` | `vector` |
| `bump` | `strength` `height` `normal` | `vector` |
| `tex_noise` | `vector` `scale` `detail` `roughness` `distortion` | `value` |
| `tex_gradient` | `vector` | `value` |
| `principled` | `base_color` `metallic` `roughness` `ior` `specular_ior_level` `sheen_weight` `sheen_tint` `emission_color` `emission_strength` `normal` `spec_clamp` `reflection_lod` `unity_direct` | `color` |
