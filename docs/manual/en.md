# Reze Design — user manual

**English** · [简体中文](https://github.com/AmyangXYZ/reze-design/blob/main/docs/manual/zh.md)

Reze Design is an MMD design, rendering and sharing platform. It runs in the
browser: it reads the models and motions the MikuMikuDance community has been
making since 2008, renders them on WebGPU, and turns the result into a video file
or a live page anyone can open and orbit.

It renders on its own engine — reze-engine, a WebGPU renderer built for this
platform — and that is where its reach comes from: materials are node graphs
compiled straight to WGSL, background effects are shaders you edit against the
live scene, and video export steps the clock offline, frame by frame, so a 4K
60 fps render comes out pixel-identical on any machine. Around the engine sits a
modern editor that keeps your work across sessions, and a platform where every
published scene is a live page others can open, orbit and fork.

The manual follows the same path your work will: **Section 0** is background, for
anyone who has never heard of MMD. **Section 1** walks the whole journey once —
assets in, shot framed, lit, styled, exported, published. **Section 2** goes
deeper into the three authoring surfaces — colour grades, WGSL background
shaders, and material node graphs — each complete enough to write from without
reading anything else. [Appendix B](#appendix-b-finding-models-motions-and-music)
covers where to find models, motion and music.

---

## Contents

- [0. MMD, in short](#0-mmd-in-short)
- [1. Making a scene](#1-making-a-scene)
  - [1.1 The shape of the work](#11-the-shape-of-the-work)
  - [1.2 A model, a motion, a song](#12-a-model-a-motion-a-song)
  - [1.3 The shot](#13-the-shot)
  - [1.4 Light](#14-light)
  - [1.5 What sits behind the character](#15-what-sits-behind-the-character)
  - [1.6 A stage](#16-a-stage)
  - [1.7 The look](#17-the-look)
  - [1.8 Export](#18-export)
  - [1.9 Publishing](#19-publishing)
  - [1.10 The gallery](#110-the-gallery)
  - [1.11 When something goes wrong](#111-when-something-goes-wrong)
- [2. Authoring your own look](#2-authoring-your-own-look)
  - [2.1 The rendering model](#21-the-rendering-model)
  - [2.2 Colour grades](#22-colour-grades)
  - [2.3 Scene effects in WGSL](#23-scene-effects-in-wgsl)
  - [2.4 Material shader graphs](#24-material-shader-graphs)
  - [2.5 Drafts, publishing and versions](#25-drafts-publishing-and-versions)
- [Appendix A. Control reference](#appendix-a-control-reference)
- [Appendix B. Finding models, motions and music](#appendix-b-finding-models-motions-and-music)
- [Appendix C. Glossary](#appendix-c-glossary)

---

# 0. MMD, in short

MikuMikuDance — **MMD** — is a free 3D animation program written by Yu Higuchi
(樋口優) and released in February 2008 for animating Hatsune Miku. What grew around
it is an ecosystem of interchangeable parts: a model is one file by one author, a
dance is another file by someone else, a camera path is a third, and they combine
because everyone follows the same bone-naming convention. A finished MMD video is
typically the work of five to fifteen people who never met, which is why credits
lists became a cultural institution and why a motion file from 2011 still works
today. The program itself is a 32-bit DirectX 9 Windows application whose
development stopped in the late 2010s, out of reach of phones and tablets
entirely; those wanting modern rendering exported into Blender or Unity, where the
rendering is excellent and the composability stops at the import step, since
converted assets and hand-rebuilt materials are no longer parts anyone else can
pick up.

The look MMD popularised has since gone mainstream. Genshin Impact, Aether Gazer
and Wuthering Waves all render 3D characters to read as hand-drawn 2D anime — what
the Chinese community calls 三渲二 — and each carries a fan community
producing enormous quantities of derivative work, much of it still made with MMD
models and motion. WebGPU is what lets that aesthetic run properly in a browser,
and the browser has been a serious target for some time:
[**babylon-mmd**](https://github.com/noname0310/babylon-mmd) brought PMX models,
VMD motion, physics and MMD-compatible shading into Babylon.js, and remains the
reference for what the web can already do with MMD.
[**reze-engine**](https://github.com/AmyangXYZ/reze-engine) takes the other route:
a renderer written for MMD specifically rather than layered onto a general-purpose
engine. Two applications sit on it — **Reze Design**, described here, for
designing, rendering and publishing scenes; and
[**Reze Studio**](https://github.com/AmyangXYZ/reze-studio), an animation editor
with a timeline, dope sheet and Bézier curve editing. Both run on any machine with
a current browser, read the ecosystem's files as they are, and turn a scene into a
URL somebody else can open, orbit and take further.

---

# 1. Making a scene

## 1.1 The shape of the work

A scene comes together in one pass, and the order matters less than the fact that
each step is reversible: everything you set stays live, and nothing is baked until
you export.

> Load a model → give it a motion → add the music → decide the shot → light it →
> pick a look → export a video, or publish the scene.

The rest of this section follows that arc. Controls that speak for themselves —
file pickers, colour chips, the play button — are left to speak for themselves;
[Appendix A](#appendix-a-control-reference) lists every control with its range.

You need a browser with WebGPU: Chrome or Edge 113+, or Safari 26+. If the editor
reports that it cannot start, that is almost always why. Nothing is uploaded while
you work — files stay in the tab until you choose to publish.

## 1.2 A model, a motion, a song

Open **Assets** and load a model, either as the folder containing its `.pmx` or as
the `.zip` you downloaded. Drag and drop works for both.

| Format | What it is |
| --- | --- |
| `.pmx` | A model: mesh, materials, textures, skeleton, physics |
| `.pmd` | The original model format. Convert to PMX in PMX Editor first |
| `.vmd` | Keyframes — the same extension carries **body motion** and **camera motion**, which load in separate slots |
| `.fx` | A MikuMikuEffect shader for DirectX 9. The counterparts here are [scene effects](#23-scene-effects-in-wgsl) and [shader graphs](#24-material-shader-graphs), in WGSL |

**Keep the model's folder intact.** A PMX references its textures by relative
path, so a `.pmx` pulled out on its own loads white or grey. This is the single
most common thing that goes wrong on a first attempt.

Load a body motion into the same slot and the transport bar appears; press play.
Add a second model and it gets its own slot and its own motion, while the cast
shares one camera, one light rig and one look. Music binds to the timeline, so
scrubbing and looping move the audio with the dance. Motion targets a standard
skeleton and will drive any model — where proportions differ you will see feet
sliding or floating, and a model closer in build to the one the motion was
authored for resolves it.

Hair and skirts are simulated, and settle over the first moments after a seek.
That settling never reaches an exported file, because the exporter renders a
warm-up before it starts recording.

## 1.3 The shot

Left-drag orbits, right-drag pans, the wheel zooms.

Most distributed dance motions come with a **camera motion** — a second `.vmd`
that carries the choreographer's own framing. Load it into **Assets → Camera** and
it drives the shot exactly as authored, taking the mouse out of the loop; the
toggle in the transport bar hands control back whenever you want to look around,
without stopping playback.

For framing by hand, **Scene → Camera** is more precise than the mouse. Target Y
is the control you will reach for most: a character stands about 10 units tall, so
a target height near 10 frames the face, near 5 the torso, and 0 puts the camera
on the floor looking up. Any slider value can be typed exactly — double-click the
number.

**Follow center** binds the orbit to the character's centre bone, so a motion that
travels across the stage stays framed instead of dancing out of shot; the target
sliders then read as an offset from the character rather than a point in the
world. A loaded camera motion still takes priority while it is on.

## 1.4 Light

Three sections compose the lighting, and the interesting decisions are few.

**Sun** is the key light, and the shadow map is cast from the same direction it
lights from, so shading and shadows always agree. **Elevation** is the expressive
control: low sun gives long shadows and strong rim separation, high sun flattens
the figure and shortens shadows to nothing.

**World** is the ambient fill — everything the sun does not reach. At strength 0
unlit surfaces go black; raised too far, the image flattens. Most looks want a
cool world against a warm sun, or the reverse. The colour contrast between key and
fill does more work than either does alone.

**Bloom** is the glow around bright areas. Intensity 0 is off, and the pass is
skipped entirely at that value. A threshold near 1.0 blooms genuine highlights
only; drop it toward 0.3 and the whole image hazes, which is a strong and
deliberate look.

**Ground** is worth one note beyond the obvious: opacity fades the surface while
the shadow stays. At opacity 0 with shadow on you have a shadow catcher — the
character's shadow floating on the background with no floor plane fighting a
photographic backdrop.

## 1.5 What sits behind the character

Back to front: the **background colour**, then either a **backdrop** (a flat image
behind the scene) or a **skybox** (a 360° equirectangular panorama projected as a
dome, which follows the camera so that orbiting looks out into an environment),
and then a **scene effect** — a shader that can paint on either side of the
character. Stars and auroras go behind; rain, petals, sparks and fog go in front,
and the ones in front know how far away the character is, so a raindrop passing
behind a shoulder is hidden by it.

Pick an effect from **Scene → Background**, or open the library for the full set.
Writing your own is [§2.3](#23-scene-effects-in-wgsl).

## 1.6 A stage

A backdrop is a picture behind the character. A **stage** is geometry the
character stands in — a shrine, a street, a concert floor — distributed as a PMX
like any model, and loaded from **Assets → Stage**, as a folder or a zip.

A scene holds one stage, so uploading another replaces it. Under it:

**Placement.** Position, rotation and uniform scale. Stage PMX are authored
facing whatever direction the artist worked in and at wildly different scales, so
expect to turn and resize one before it sits right. Reset returns the block to
its defaults.

**Switches.** Stage artists rig options as morphs — a roof on or off, a banner
swapped, a neon set recoloured. No motion drives these; the weight you pick is
the scene's, and it is saved with the document. Only morphs the renderer can
actually move are listed, so a slider here always does something.

**The ground turns off.** A stage brings its own floor, and the built-in ground
plane sits at the same height — drawing both makes them fight for every pixel.
The Ground section goes inert while a stage is loaded and says so; its settings
are kept and return when you remove the stage.

Background effects still run behind a stage, so petals or stars drift past a
shrine the same way they drift past a backdrop.

A stage's materials are ordinary materials: they appear in the Materials tab and
take style groups and shader graphs like a character's. They are **not**
auto-grouped, because the automatic grouping matches names like hair and skin —
meaningless on architecture, and occasionally wrong in ways that reorder the
whole scene. A fresh stage renders on the neutral default graph; group it by hand
when you want more.

Many stages ship with their lighting **baked into the textures**. Those shadows
are part of the image and will not move when you change the sun, and they will
not match the live shadow your character casts. That is a property of the stage,
not a setting.

## 1.7 The look

Two systems decide how the scene reads, and they work at different scales.

A **colour grade** transforms the whole finished image, after lighting and before
export. It is the difference between "the render" and "the look": the same scene
graded warm and lifted reads as a summer afternoon, and graded cool with crushed
shadows reads as night. **Scene → Grade** offers the built-ins — *Neutral*,
*Bloody*, *Cyberpunk*, *Divine*, *Moonlit*, *Sakura* — with an intensity slider
that is remembered per preset, so trying several looks and coming back restores
the strength you chose for each. Building your own is
[§2.2](#22-colour-grades).

**Style groups** decide how surfaces respond to light, and this is the part with
no MMD equivalent:

> A **style group** is a set of materials that share one look. A **shader graph**
> is the program that defines that look. Each group uses exactly one graph.

A PMX model carries between ten and sixty materials — one for the face, one for
the hair, several for the costume. Setting each individually would be intolerable,
so on load they are sorted into groups automatically by name and property: hair to
a hair group, eyes to an eye group, skin to a body group. On unusual models the
sort places something oddly, and the **Materials** tab is where you correct it —
drag a material to another group, create a group, hide a stray accessory, or
change which graph a group uses.

Two behaviours to expect. A group shows an **edited** marker once its graph
diverges from the library entry it came from, and that divergence travels inside
your scene, so a published scene reproduces exactly what you made. And some groups
carry a **role** that changes how the renderer treats them beyond shading — hair
and eyes get special pass handling, stockings get alpha hashing so they sort
correctly through layers. Roles are inferred, which is why a hair group behaves
differently from a cloth one.

Building a graph node by node is [§2.4](#24-material-shader-graphs).

## 1.8 Export

The **Render** tab sets aspect and quality — 2.39:1 cinemascope through vertical
9:16, at up to 4K — and optionally a range, so you can export `0:12` to `0:30`
instead of the whole clip. While the tab is open the viewport shows the framing
preview, drawn over the live scene: what you see framed is what will be recorded.

**Render video** produces 60 fps H.264 MP4. On Chromium desktop you choose where
to save first and frames stream to that file as they encode, so a long 4K export
never has to fit in memory.

Two things about the exporter are worth knowing. It renders **offline**, frame by
frame, so export quality is independent of your display and of whether the tab is
in focus — a slow machine produces the same file, it just takes longer. And your
live camera, light and grade are exactly what gets recorded; there is no second
set of render settings to keep in step.

**Capture PNG** writes a single frame at the same aspect and resolution,
honouring the same watermark and green-screen settings. It captures the pose on
screen without seeking or resetting anything, needs no motion, and is the intended
way to produce the thumbnail a published scene requires. Capture thumbnails at
1080p — a 4K PNG of a detailed scene can exceed the 20 MB limit.

**Green screen** replaces the background with pure `#00FF00` for compositing
elsewhere, the classic MMD PV route.

**Exporting the scene itself** lives in the scene menu — click the logo at the top
of the left rail (or on the floating pill when the panels are collapsed). **Export
scene** writes one zip holding the scene document and every uploaded asset: model,
motion, music, backdrop. **Import scene** opens such a zip on any machine and the
scene arrives whole. The same menu holds **New scene**, which starts from a blank,
neutrally lit stage, and **Reset to default scene**, which brings back the bundled
demo.

**Your work persists.** Every change is saved the moment you make it — settings
and material work, and the models, motion and music you uploaded, all stored in
your own browser (localStorage and IndexedDB; nothing is sent to a server until
you publish). Refresh mid-edit, close the tab, come back tomorrow: the editor
reopens exactly where you left off, uploads included. Only four actions change
what loads — New scene, Reset, importing a scene file, and opening someone
else's scene in the editor.

## 1.9 Publishing

Publishing turns your scene into a page anyone can open — a live 3D render they
can orbit.

Before you press **Share**, check what you are allowed to share. Nearly every
model ships with a 利用規約 (*riyō kiyaku*, terms of use) in its download, and
**再配布禁止 — redistribution prohibited — is very common**. Publishing packs the
model, motion and audio you loaded and uploads them so the scene can render in
other browsers, which under most terms counts as redistribution. Rendering a video
is a different matter, since the model file is not in the video. Terms also
commonly cover editing, R-18 depiction, political and religious use, and
commercial use.

The community's own convention sits alongside the licence: the **借物表**
(*karimono-hyō*, "borrowed items list") names every model, motion, effect and
track used, with its author, so a viewer can trace a part back to the person who
made it. Reze Design requires one:

```
Model: Tda式初音ミク・アペンド by Tda / Modified by …
Motion: … by …
Camera: … by …
Music: … by …
```

Beyond the credits, the dialog asks for a name, a description, up to five tags,
and a thumbnail. Progress is reported per stage — packing, uploading, publishing —
and failures name the stage and the underlying cause. Your text is saved as you
type, so going away to capture a thumbnail keeps the description you just wrote.

The result is a permanent link of the form `reze.design/<your-name>/<id>`. The
short id is what resolves, so renaming the scene, or renaming yourself, keeps
every link already shared working.

## 1.10 The gallery

The gallery button, below the Scene tab, opens what everyone has published,
browsable by hot, new, top, yours or liked, and narrowed by tag.

On a scene's page you can orbit, play, and like it. **Open in editor** brings the
whole scene into your editor as **your own copy** — every model, motion, light,
grade and material assignment, ready to take somewhere else. The copy is
independent, so publishing it creates a new scene and leaves the original
untouched. Its credits come with it; extend them as you go.

Accounts exist to own what you publish. On first sign-in you choose your name,
which appears in every scene link you create and can be set only once — permanence
is what keeps a shared link working forever.

## 1.11 When something goes wrong

**The model loads white, grey or black.** Textures were not found, almost always
because the `.pmx` was loaded without its folder. Load the whole folder or the
original `.zip`.

**The model will not load.** Check that it is `.pmx` rather than `.pmd`; convert
older models in PMX Editor first.

**Motion plays but the model stands still.** The motion is on a different model
slot, or the model's bone names depart from the standard convention — common with
models converted from other games.

**Feet slide or sink through the floor.** Proportion mismatch between the model
and the one the motion was authored for.

**The camera does not respond.** A camera motion is driving it. Toggle to free
orbit in the transport bar.

**Export takes a while.** It renders every frame offline: a 4K three-minute export
is thousands of full-quality frames. Iterate at 1080p on a short range, then go to
4K for the final pass.

**Publishing fails.** The error names the stage. *Packing* points at a missing
asset; *uploading* at a bundle over 200 MB or a dropped connection; *publishing*
at a signed-out session or a name collision.

---

# 2. Authoring your own look

Section 1 covered choosing from what exists. This section covers making your own,
and it is the part of the platform that has no counterpart in other MMD tools:
the look of a scene here is programmable, live, at three levels of one pipeline.
**Grades** (§2.2) shape the whole frame's colour. **Scene effects** (§2.3) are
WGSL functions painting the layers behind and in front of the character. **Material
graphs** (§2.4) define how each surface responds to light, as nodes that compile
to WGSL. Each section states its full contract — read one and you can author in
it, in the editor or by writing the document directly. §2.5 explains how drafts,
publishing and versions work for all three.

## 2.1 The rendering model

Knowing where each thing you author actually acts explains most of what follows.
From the camera's point of view, back to front:

```
  background colour  →  backdrop / skybox  →  fn background  (§2.3)
                                                       ↓
                                            the character, shaded by
                                            MATERIAL SHADER GRAPHS (§2.4)
                                            per style group
                                                       ↓
                                                    bloom
                                                       ↓
                                            COLOUR GRADE (§2.2)
                                            applied to the whole image
                                                       ↓
                                            fn foreground  (§2.3)
                                            over the finished frame,
                                            holding the scene's depth
                                                       ↓
                                                  your screen,
                                              the video, the PNG
```

So:

- A **scene effect** is one file that can paint at two points in that stack, and
  which of them it uses is decided by the functions it defines — `fn background`
  behind the character, `fn foreground` over the finished frame. It may define
  both, which is how one file is a whole weather system.
- A **shader graph** governs one style group on one model, and works from that
  surface's own data — its texture, its normal, the view direction.
- A **grade** applies last, to every pixel uniformly, when the image is already
  final.

All three travel *inside* the scene document, so a published scene reproduces your
look exactly, whether or not the viewer has the presets you used.

## 2.2 Colour grades

Grades are **ASC CDL** transforms — the American Society of Cinematographers'
Color Decision List, the primitive film post-production runs on. Three tonal
ranges, each with a slope, an offset and a power, manipulated through a colour
wheel. The vocabulary transfers to and from every other grading tool.

### The editor

Open the grade library, hover a preset and choose **Edit**, or edit the applied
grade from **Scene → Grade**. The scene behind the editor is the preview — every
adjustment lands live on your own character, in your own light, which is the only
reliable way to judge a grade.

**Split tone** (−1 to +1) comes first, deliberately — it is the single move that
expresses most grading intent. It pushes shadows and highlights in opposite
directions along a warm/cool axis. Negative gives cool shadows against warm
highlights, the "teal and orange" of modern film; positive inverts it, warm
shadows against cool highlights, which reads as candlelight, sunset, or nostalgia.

**Three wheels** — shadows, midtones, highlights — control the tonal ranges
independently:

- **Angle** — the hue that range is pushed toward.
- **Distance from centre** — how far it is pushed.
- **The rail beside the wheel** — lightness for that range. Pulling the shadow
  rail down crushes the blacks; pushing the highlight rail up lifts them.

**Contrast** (0.5 – 1.6) pivots around mid-grey. **Saturation** (0 – 2) scales
colour intensity, 0 giving monochrome.

### Working method

The order that produces predictable results:

1. **Fix the lighting first.** A grade builds on what the light gives it. If the
   character reads flat, adjust sun elevation and world strength before touching
   the grade.
2. **Set split tone**, then stop for a moment. Very often this alone is the grade,
   and everything after it is refinement.
3. **Crush or lift with the rails, then push hue** — contrast decisions are more
   visible than colour ones and constrain them. Push one range at a time, and less
   than you think: a wheel at half distance is already a strong look.
4. **Saturation last**, usually downward, and judge at intensity 1 before setting
   the strength you want in the Scene tab. Grading at half strength invites
   overcorrection.

Two habits pay for themselves. **Compare against Neutral often** — prolonged
looking normalises anything, and two seconds on Neutral tells you whether the
grade is earning its place. And **grade at your export resolution**, since a bloom
threshold that looked right in a small window can bloom readily at 4K.

### Saving and sharing

Editing a preset opens a scratchpad. Close it and you are asked whether to keep
the result as a **draft** of your own — stored locally in your browser, free to
rename, keep working on, and apply to as many scenes as you like. Once it is a
draft it saves as you work, so there is nothing to confirm the next time. Drafts
are private and stay on your machine.

A grade also **exports and imports as JSON** from the editor's header, so a look
can be written by hand, generated, or passed to someone else without a scene or
an account. The same buttons sit in the shader-graph editor.

**Publish** turns a draft into a library item under your name, visible to
everyone. See [§2.5](#25-drafts-publishing-and-versions) for what that implies.

## 2.3 Scene effects in WGSL

A scene effect is a shader that paints a layer of the frame, per pixel, from the
view direction and the clock. Rain, snow, stars, an aurora, fog on the ground, a
moving gradient, a title card.

The library ships six worked examples, each demonstrating a different technique:
*Shining Stars* (hash-grid particle fields), *Quiet Rain* (column streaks, cut by
the character's silhouette), *REZE DESIGN* (signed-distance glyphs with
exponential glow), *Orbiting Hearts* (implicit-curve outlines), *Fireworks*
(ballistics with a decaying streak) and *Ground Mist* (a volume walked along the
view ray). Reading them is the fastest way into the idiom.

### The contract

Two functions, and **you write whichever ones you want**. There is no layer
setting anywhere in the app: the code says where it goes.

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f
fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f
```

`background` paints between the backdrop and the character — a sky, and anything
belonging to the world behind. `foreground` paints over the finished frame, which
is where weather lives. Define both and they are one effect: a storm is a dark sky
and the rain in front of it, in one file.

| Parameter | Meaning |
| --- | --- |
| `ray` | The pixel's world-space view direction, normalised. It **pans with the camera orbit**, so anything computed from it is pinned to the world rather than the screen |
| `uv` | Screen coordinates, 0 – 1, origin **bottom-left** |
| `time` | Seconds since the effect was applied |
| `depth` | **`foreground` only.** How far away, in scene units, whatever the scene drew at this pixel is — the far plane where it drew nothing |

Three helpers are in scope for both:

| Helper | Gives you |
| --- | --- |
| `bgResolution()` | The canvas size in pixels, for aspect correction |
| `bgCameraPos()` | Where the camera is, in world space |
| `bgWorldPos(ray, depth)` | The world point the scene drew at this pixel |

The return value is **sRGB colour with straight alpha**, and the alpha is the
interesting part: it is the mask over everything behind you.

- `alpha = 0` — transparent; whatever is behind shows through untouched.
- `alpha = 1` — opaque; your effect replaces it.

A sparse effect — rain, petals, sparks — holds alpha near 0 between its marks and
raises it where a mark lands. A covering one — a gradient sky, a painted backdrop —
returns alpha 1 everywhere.

### What `depth` is for

A foreground is not stuck in front. `depth` is what lets it decide, per pixel, and
there are two ways to use it.

**Compare against it.** A particle knows its own distance. If the scene is nearer,
the scene wins that pixel and the particle is hidden — so drops pass behind a
shoulder and in front of a face in the same frame. Feather the comparison over a
unit or so, or the silhouette comes out as a staircase:

```wgsl
// How much of a curtain hanging `dist` away survives at this pixel.
fn curtain(dist: f32, depth: f32) -> f32 {
  return smoothstep(dist - 0.6, dist + 0.6, depth);
}
```

**Read it directly.** Fog needs no comparison at all — its opacity simply *is* a
function of distance, so `1.0 - exp(-depth * density)` is already fog, and pixels
the scene never drew report the far plane, which is why it closes over the sky on
its own.

For anything that belongs to a *place* rather than to a distance — mist pooling
where the cast is standing, a pattern that must not swim as the camera orbits —
turn the depth into a position with `bgWorldPos(ray, depth)` and work in world
coordinates.

One caution worth knowing before you reach for it: a foreground evaluated at that
single depth is a function of the surface the scene drew, which is a texture ON
that surface. It cannot know about the air *between* the camera and it. If you
want something the character stands inside rather than behind — real volumetric
fog — walk the ray yourself between `bgCameraPos()` and `bgWorldPos(...)`,
accumulating as you go. *Ground Mist* does exactly this, and its comments explain
why the simpler version reads as a dirty lens.

### Two orientations

`ray` or `uv` is the first decision, and it decides how the effect behaves when
the camera moves.

**Screen-space**, from `uv` — glued to the frame. Rain falls down the screen
regardless of where the camera looks. Correct for weather, vignettes and film
grain. (Note that this is a separate decision from which function you write:
`uv` is what makes something screen-*aligned*, `foreground` is what puts it in
front. Weather usually wants both.)

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  // Aspect-correct so circles come out round.
  let res = bgResolution();
  let p = (uv - 0.5) * vec2f(res.x / res.y, 1.0);
  let d = length(p);
  let vignette = smoothstep(0.8, 0.2, d);
  return vec4f(vec3f(0.02, 0.03, 0.08), 1.0 - vignette);
}
```

**World-space**, from `ray` — part of the environment. Orbit the camera and it
stays put, as a real sky would. Project the ray to spherical coordinates using the
same mapping the skybox samples by:

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  // Longitude/latitude — the skybox's own projection.
  let sky = vec2f(atan2(ray.x, ray.z), asin(clamp(ray.y, -1.0, 1.0)));
  let band = smoothstep(0.0, 0.35, sky.y);          // horizon → zenith
  let dusk = mix(vec3f(0.85, 0.45, 0.30), vec3f(0.06, 0.09, 0.22), band);
  return vec4f(dusk, 1.0);
}
```

Choose deliberately: stars built from `uv` slide across the sky when the camera
orbits, which reads as wrong immediately even to a viewer who cannot say why.

### A worked overlay

Drifting motes, using the hash helper from the starter template:

```wgsl
const COUNT: i32 = 48;
const FALL_SPEED: f32 = 0.04;
const RADIUS: f32 = 0.006;

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let res = bgResolution();
  let p = (uv - 0.5) * vec2f(res.x / res.y, 1.0);

  var acc = 0.0;
  for (var i = 0; i < COUNT; i = i + 1) {
    // A stable pseudo-random home for each mote.
    let seed = hash2(vec2f(f32(i), 7.0));
    // Descends, wraps at the bottom, drifts sideways on its own phase.
    let y = fract(seed.y - time * FALL_SPEED) - 0.5;
    let x = (seed.x - 0.5) * 1.8 + sin(time * 0.6 + seed.x * 30.0) * 0.02;
    let d = length(p - vec2f(x, y));
    // Proportional falloff keeps the edge crisp at any resolution.
    acc = acc + smoothstep(RADIUS, 0.0, d);
  }

  let glow = clamp(acc, 0.0, 1.0);
  return vec4f(vec3f(1.0, 0.94, 0.82), glow * 0.85);
}
```

Note the idioms: tunables as named `const`s at the top, `fract` to wrap motion so
nothing accumulates over a long take, and `smoothstep` for edges.

### The editing loop

Open **Scene → Background → Library**, then **New effect** for a commented starter
template, or right-click any preset and **Edit shader** to fork it.

**<kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> compiles and applies.** The scene is the
preview — no separate render button, no preview window. On success the effect is
live immediately. On failure the previous shader stays applied and you get
diagnostics with `line:column` positions rebased to your own code, so iterating
never leaves you looking at a black screen.

### Rules

- **Self-contained.** Everything comes from `ray`, `uv` and `time` — no textures,
  no external bindings, no state between frames.
- **Drive all motion from `time`.** It is the only clock, and what makes an
  exported video reproducible.
- **Keep loops small and fixed.** This runs behind a full character render, every
  frame, at up to 4K; fifty iterations is comfortable. Export multiplies the cost
  by thousands of frames, so if one is unexpectedly slow, setting the effect to
  *None* for a single export tells you how much of the time is yours.
- **`fwidth` only in uniform control flow.** `fwidth`-based `smoothstep` gives
  resolution-independent edges, and the derivative holds as long as neighbouring
  pixels took the same branch — keep it out of code following a data-dependent
  early return.
- **WGSL resolves in any order**, so helpers may sit below `background()`.

## 2.4 Material shader graphs

A shader graph defines how one style group's surfaces respond to light. It is a
node graph in the Blender idiom — nodes with typed sockets, connected by links —
compiled to WGSL and applied live.

From the Materials tab, click a group's graph name, **Browse all…**, then **Edit
graph** on any entry. The built-ins come as two sets plus a neutral base, and all
of them are reference implementations to fork:

- **AG** — *AG Body*, *AG Eye*, *AG Face*, *AG Hair*, *AG Metal*, *AG Rough
  Cloth*, *AG Smooth Cloth*, *AG Stockings*. Eight worked examples of specific
  surface types, each built around a lighting closure and a ramp.
- **WuWa** — *WuWa Body*, *WuWa Cloth*, *WuWa Hair*, *WuWa Face*, *WuWa Metal*,
  *WuWa Eye*. Thirteen nodes each, built around the light directly rather than a
  closure: a half-Lambert through a narrow soft threshold, a shadow that passes
  through a warm band on its way to lit, the model's own sphere-map highlight,
  and a rim. Start here for a hard-terminator anime look.
- ***Principled BSDF*** — the neutral base, and what an ungrouped material gets.

Neither set carries an image of its own. A preset reads the material's own
texture and sphere map, so it applies to any model — which is the property to
preserve if you publish one.

### The palette

| Category | What lives there |
| --- | --- |
| **Input** | The surface's own data: texture fetch, geometry (normal, view direction, world and rest position, UV, reflection), the material's diffuse colour, its sphere map, plain values and RGB constants |
| **Scene** | `light` — the key light as values: direction, colour, ambient, shadow. `head_basis` — the head bone's forward/right/up |
| **Colour** | Hue/saturation, brightness/contrast, invert, gamma, RGB curves, separate/combine in RGB, HSV and HSL, and colour ramps — linear, constant, cardinal, anti-aliased constant, triangular, and a three-stop linear |
| **Texture** | Procedural noise, gradients and voronoi, plus up to four image maps carried by the style group |
| **Vector** | Mapping, bump, normal map, separate/combine XYZ, vector rotate, vector transform, and 24 vector-math operations |
| **Math / Mix** | 39 arithmetic operations, 20 blend modes, map range |
| **Shader** | Principled BSDF, emission, add and mix shader, shader-to-RGB as colour or scalar, diffuse and transparent BSDFs, fresnel, layer weight |

The socket names you will meet most often are `color`, `alpha`, `normal`, `view`,
`uv`, `fac` (a 0–1 blend factor), `strength`, `roughness`, `metallic` and
`base_color`.

**Reaching the light directly.** `shader_to_rgb_diffuse` and `bsdf_diffuse` bake
a whole lighting closure and hand back a result, which is the AG idiom. The `light`
node instead exposes the sun as values, so a graph can build its own term —
`dot(normal, direction)` pushed through a ramp or a threshold — which is what
gives an anime shader a hard terminator, and what the WuWa set is built on.

### Building

- **Add a node** — right-click the canvas, or use the add-node menu, which is
  searchable by name.
- **Connect** — drag from an output socket to an input socket. Types must be
  compatible.
- **Unlinked inputs use their literal default**, editable on the node itself. A
  graph with no links at all is a valid graph.
- **Set the output** — right-click a node and choose *Set as output*. This is the
  value the material renders, every graph has exactly one, and it must resolve to
  a colour (`vec3f`) or a scalar (`float`).
- **Preview any socket** — *Preview output* routes a socket to the screen so you
  can see what a branch produces in isolation; *Stop preview* returns to the real
  output. This is the editor's most useful debugging tool: when a graph looks
  wrong, preview sockets backwards from the output, and the first one that looks
  wrong is where the problem is.
- **Generated WGSL** — the editor shows the code your graph compiles to, which is
  worth reading when a graph is not doing what you expect.

Node positions are layout. Moving nodes never changes the result, and a rearranged
graph still counts as identical to the library entry it came from.

### The graph as a document

Everything the editor builds is a plain JSON document — `ShaderGraph` in
reze-engine — and the document is a first-class way to author. This is the whole
shape:

```jsonc
{
  "version": 1,
  "name": "My Graph",
  "nodes": [
    // id: unique, /^[a-z0-9_]+$/ · type: one of the registry ids below
    // inputs: literal defaults for sockets you leave unlinked
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

That example is a complete, working cel shader: the texture times the material's
own diffuse tint, with diffuse lighting quantised to two bands multiplied over
it. `output` must resolve to a colour (`vec3f`) or scalar (`f32`); floats and
colours convert where sensible. An optional `params` array exposes chosen node
inputs as named sliders that adjust live without recompiling, and `tags` are
free-form hints for library search.

The node vocabulary, by registry id — sockets in parentheses:

| Type id | Inputs → outputs |
| --- | --- |
| `texture` | → `color`, `alpha` — the material's diffuse texture at this pixel |
| `geometry` | → `normal`, `view`, `world_pos`, `rest_pos`, `uv`, `reflection` |
| `material_diffuse` | → `color` — the PMX material's authored base tint |
| `value` / `rgb` | a literal float / colour → `value` / `color` |
| `hue_sat` | `hue`, `saturation`, `value`, `fac`, `color` → `color` |
| `bright_contrast` | `color`, `bright`, `contrast` → `color` |
| `invert` | `fac`, `color` → `color` |
| `ramp_constant`, `ramp_linear`, `ramp_cardinal` | `fac`, `pos0`, `color0`, `pos1`, `color1` → `color`, `alpha`, `fac_out` |
| `ramp_constant_aa` | `fac`, `edge`, `color0`, `color1` → `color` — the anti-aliased two-band ramp; the cel-shading workhorse |
| `ramp_tri` | `fac` → `value` — triangle wave |
| `math/*` | `a`, `b`, `c` → `value` — 39 operations, Blender's set: `add` `subtract` `multiply` `divide` `multiply_add` `power` `logarithm` `sqrt` `inversesqrt` `absolute` `exponent` `minimum` `maximum` `less_than` `greater_than` `sign` `compare` `smooth_min` `smooth_max` `round` `floor` `ceil` `truncate` `fraction` `modulo` `floored_modulo` `wrap` `snap` `pingpong` `sine` `cosine` `tangent` `arcsine` `arccosine` `arctangent` `arctan2` `radians` `degrees` `clamp01` |
| `vector_math/*` | `a`, `b`, `c`, `scale` → `vector` or `value` — 24 operations: `add` `subtract` `multiply` `divide` `multiply_add` `cross` `project` `reflect` `refract` `dot` `distance` `length` `scale` `normalize` `absolute` `minimum` `maximum` `floor` `ceil` `fraction` `modulo` `wrap` `snap` `faceforward` |
| `mix/*` | `fac`, `a`, `b` → `color` — 20 blend modes: `blend` `add` `subtract` `multiply` `divide` `screen` `overlay` `soft_light` `dodge` `burn` `darken` `lighten` `difference` `exclusion` `linear_light` `hue` `saturation` `color` `value` `add_emit` |
| `map_range`, `map_range/linear`, `map_range/smoothstep` | `value`, `from_min`, `from_max`, `to_min`, `to_max` → `value` — the plain id clamps |
| `principled` | `base_color`, `metallic`, `roughness`, `ior`, `specular_ior_level`, `sheen_weight`, `sheen_tint`, `emission_color`, `emission_strength`, `normal`, `spec_clamp` → `color` — the GGX core, Principled v2 sockets |
| `emission` | `color`, `strength` → `color` |
| `add_shader` | `a`, `b` → `color` |
| `mix_shader` | `fac`, `a`, `b` → `color` |
| `fresnel` | `ior` → `value` |
| `layer_weight/fresnel`, `layer_weight/facing` | `blend` → `value` |
| `shader_to_rgb_diffuse` | → `value` — the scene's diffuse lighting term (normal · light, sun, ambient, shadow), the input a toon ramp wants |
| `shader_to_rgb` | → `color` — the same closure as a colour, so a warm sun and cool ambient stay warm and cool |
| `light` | → `direction`, `color`, `ambient`, `shadow` — the key light as values, for a graph that builds its own diffuse term |
| `head_basis` | → `forward`, `right`, `up` — the head bone's world axes, for face shading that tracks the head |
| `sphere_map` | `base`, `strength` → `color` — the model's own sphere map; an exact no-op on a material without one |
| `bsdf_diffuse` | `color` → `color` · `bsdf_transparent` → `color` |
| `tex_image/0`…`tex_image/3` | `uv` → `color`, `alpha` — the style group's own image maps, mesh UV by default |
| `ramp_linear_3` | `fac`, `pos0`, `color0`, `pos1`, `color1`, `pos2`, `color2` → `color`, `alpha`, `fac_out` |
| `rgb_curve` | `color`, `fac`, `y0`…`y4` → `color` — one curve sampled five times |
| `separate_color`, `combine_color` (+ `/hsv`, `/hsl`) | `color` ↔ `r`, `g`, `b` |
| `separate_xyz` | `vector` → `x`, `y`, `z` · `combine_xyz` | `x`, `y`, `z` → `vector` |
| `normal_map` | `color`, `strength` → `normal` · `gamma` | `color`, `gamma` → `color` |
| `vector_rotate/axis_angle`, `vector_rotate/euler_xyz` | `vector`, `center`, `axis`, `angle`, `rotation` → `vector` |
| `vector_transform/*` | `vector` → `vector` — world↔camera |
| `uv_map` | → `uv` · `attribute`, `object_info`, `light_path` — answered with honest constants on a PMX |
| `vect_cross` | `a`, `b` → `vector` |
| `mapping` | `vector`, `loc`, `rot`, `scl` → `vector` |
| `bump` | `strength`, `height`, `normal` → `vector` |
| `tex_noise` | `vector`, `scale`, `detail`, `roughness`, `distortion` → `value` |
| `tex_gradient` | `vector` → `value` |
| `tex_voronoi/f1`, `tex_voronoi/color` | `vector`, `scale` → `value` / `color` |

The compiler reports diagnostics with node and socket names rather than failing
silently, and pass integration (the hair/eye stencil, hashed alpha) belongs to
the style group's role, never to the graph — a graph only ever computes colour.

### Writing a graph that compiles

The editor keeps you inside the schema as you drag: it offers only sockets that
exist, dims the ones a wire cannot legally reach, and replaces the old link when
a second one lands on an occupied input. A document written by hand or generated
by a tool has none of that, so it is checked on arrival — **Import graph JSON**
in the editor's header validates the file before it reaches the canvas and lists
what is wrong with it in the diagnostics panel. What follows is what you need to
write one that lands clean.

**There are two spines**, and starting from either gets a surface most of the way
there. The first takes the engine's lighting closure and quantises it — the AG
idiom:

1. **Base colour** — `texture` multiplied by `material_diffuse`, as a
   `mix/multiply` with `fac: 1`. Leave the multiply out and untextured materials
   render white.
2. **A lighting term** — `shader_to_rgb_diffuse` into a ramp: `ramp_constant_aa`
   for cel bands, `ramp_linear` for a soft falloff. Use `principled` in its place
   when the surface should read as lit PBR rather than toon.
3. **Combine the two** — another `mix/multiply` at `fac: 1`, the ramp over the
   base. That alone is a working cel shader.
4. **Then add** — `fresnel` or `layer_weight/facing` into `emission`, joined with
   `add_shader`, for rim light; `mix/add_emit` for a glowing region; `bump` or
   `tex_noise` into `principled.normal` for surface detail.

The second builds its own diffuse term from the light, which is how most game NPR
presets work and what the WuWa set does. It costs a few more nodes and gives a
much harder terminator:

1. **The term** — `light.direction` and `geometry.normal` into `vector_math/dot`,
   then `math/multiply_add` with `b: 0.5, c: 0.5`. That is a half-Lambert: −1…1
   remapped to 0…1, keeping some shape in the unlit half instead of clipping it.
2. **The terminator** — `map_range` (the clamping one) over a NARROW window, say
   0.46 to 0.54. Width is the whole character of the look: wide is a soft
   falloff, narrow is the hard step anime shading wants.
3. **The colour** — `ramp_linear_3` on that, shadow → warm → lit. The middle stop
   is what stops a shadow reading grey.
4. **Over the texture** — `mix/multiply` of `texture.color` by the ramp, at a
   factor below 1 so the tint sits over the texture rather than replacing it.
5. **Then add** — `sphere_map` for the model's own highlight, and
   `layer_weight/facing` into `mix/add_emit` for a rim.

Expose the two or three numbers you will want to retune later as `params`, and
they become sliders that adjust live without a recompile.

These are the rules the result is checked against.

**Structure.** `version` is `1`. Node ids are unique and match
`/^[a-z0-9_]+$/` — lowercase, digits, underscore, nothing else — and `type` is
an exact registry id from the table above: `math/power`, never `Math` or
`power`. Each input socket takes at most one link, the graph is acyclic, and
`output` must resolve to a colour or a float, a `vec4` output being rejected and
a float splatting to colour. A graph is capped at 64 nodes and 16 exposed params.

**Literals and links.** `inputs` carries literal values for the sockets you leave
unlinked, and the shape has to fit the socket: a 3-vector on a `float` socket is
an error, while a scalar splats onto colour, vector and `vec4` sockets. The
sockets that carry the value a node processes — `invert.color`,
`separate_xyz.vector`, `principled.base_color`, the ramps' `fac` — need either a link
or an explicit literal; leaving one at its registry default is the error, and it
is only reported for nodes that actually feed the output. Ramp stop colours
(`color0`, `color1`) are `vec4` and can only be literals; nothing links into them.

**Params** target unlinked inputs, one param per socket, and a param's `kind`
must match the socket's type. Since `kind` is `float` or `color`, a ramp stop
cannot be exposed at all — to make a toon shadow tint adjustable, drive it
through a `mix/*` node and expose that node's colour input instead. A param
aimed at a node that gets pruned still compiles, with a warning that the slider
does nothing.

**Types convert implicitly** where they differ, so conversion nodes are never
needed: colour → float takes BT.601 luminance, float → colour or vector splats,
and colour and vector pass through each other unchanged. Vector → float is
rejected, exactly as in Blender — use `separate_xyz`.

**Coordinates are the engine's** — left-handed and Y-up, the PMX convention,
where Blender is right-handed and Z-up. The vertical component of a normal is
`separate_xyz` socket `y`, not `z`, and a direction vector written for Blender as
`(x, y, z)` is `(x, z, y)` here, sign checked. UVs are unchanged. Get this wrong
and the shading looks plausible but lit from the wrong axis, which is the most
common mistake in a hand-written graph.

**What the vocabulary has**, since it is wider than a Blender user tends to
expect and knowing the shape saves rebuilding something that already exists:

- **39 math operations** and **24 vector-math operations** — the full Blender
  sets, safeguards included: divide by zero is 0 rather than infinity, modulo is
  truncated, and the per-channel blend modes clamp the way Blender's do.
- **20 mix modes** — every Blender blend type, including screen, dodge, burn,
  soft light, difference, hue, saturation, colour and value, plus `mix/add_emit`.
- **Ramps** with two stops in four interpolations, a **three-stop linear ramp**
  (`ramp_linear_3`), and `ramp_tri` for the black→white→black case. Three stops
  is what lets a shadow pass through a colour on its way to lit, which is most of
  what makes a toon shadow read as warm rather than grey.
- **RGB curves**, as five samples of one curve applied to all channels.
- **Group image maps** — `tex_image/0` to `tex_image/3`, four extra images
  carried by the style group and sampled at the mesh UV by default, or at any
  vector you feed them.

**What it does not have**, still worth knowing before you write against it:

- **A node graph does not carry an image.** The built-ins ship none, and a preset
  that does is a preset for one character rather than a look. Prefer the
  material's own texture and sphere map.
- **Sockets belong to the node, not the operation.** Every math node offers three
  value inputs and every vector-math node three vectors and a scale, whichever
  operation is selected — the unused ones are inert, exactly as in Blender, so a
  transcription maps socket for socket without knowing which the op reads.
- **Shading is colour.** `add_shader` compiles to `a + b` and `mix_shader` to
  `mix(a, b, fac)`, both on `vec3f` — evaluate each branch to a colour, then
  combine. There is no BSDF object to mix beforehand.
- **A ramp stop cannot be a slider.** Stop colours are `vec4` literals and a
  param is `float` or `colour`, so to make a shadow tint adjustable, drive it
  through a `mix/*` node and expose that node's colour input instead.
- **No EEVEE Next lighting.** No screen-traced GI, no virtual shadow maps, no
  irradiance probes. Coat, transmission, subsurface, anisotropy and thin film are
  absent from Principled rather than approximated.
- **A graph is capped at 64 nodes** and 16 exposed params.

**Checking a graph outside the editor.** reze-engine exports
`validateGraph(graph)`, which returns the diagnostics above, and
`compileGraph(graph)`, which returns `{ ok, wgsl, diagnostics }`; both report
problems rather than throwing. Sockets that need a link, cycles and pruned nodes
are reported by the compile rather than by validation, so compile before handing
a graph over.

### Coming from Blender

Node semantics track **Blender 5.2**, so most of a material transfers socket for
socket — Principled carries its v2 names (`base_color`, `specular_ior_level`,
`sheen_weight`), and the math, vector and mix operation sets are Blender's own,
transcribed from its GLSL with the safeguards intact. reze reads no `.blend`
file: the conversion is an authoring-time translation you do once.

Two things still differ, and both change values rather than structure.
**EEVEE Next lighting does not exist here** — no screen-traced GI, no virtual
shadow maps, no probes — so a preset tuned against probe bounce reads flatter and
wants re-tuning by eye. And **the view transform is yours to set**: the Tone
controls in the Post row carry Standard and Filmic, and a `.blend` rendering under
Standard will not match until you match it. Anime and NPR work is normally
Standard; the colours the graph computes are the colours that land.

**Two idioms transfer.** A material built on a diffuse closure — Shader to RGB
into a ramp — maps onto `shader_to_rgb`/`shader_to_rgb_diffuse` directly. A
material that builds its own term from a light vector, which is how most game NPR
presets work, maps onto the `light` node: where the original reads a light empty's
direction through a driver or an attribute, read `light.direction` and the rest of
the chain transfers unchanged.

**What will not transfer** is anything the graph reads from an image the model
does not carry: highlight maps, ID masks, face SDFs. Those belong to one
character. Where the original uses an ID mask to tell one shader which region it
is shading, use style groups — that is the same information, and it is what the
built-ins do.

**Node for node:**

| Blender node | reze type |
| --- | --- |
| Principled BSDF | `principled` — eight inputs, see below |
| Emission | `emission` |
| Mix Shader, Add Shader | `mix_shader`, `add_shader` — RGB, see below |
| Shader to RGB | `shader_to_rgb_diffuse` |
| Image Texture | `texture` — the material's own diffuse map at the mesh UV |
| Texture Coordinate, Geometry | `geometry` |
| Value, RGB | `value`, `rgb` |
| Hue/Saturation, Bright/Contrast, Invert | `hue_sat`, `bright_contrast`, `invert` |
| Color Ramp | `ramp_constant`, `ramp_linear`, `ramp_cardinal`, by interpolation |
| Math | `math/add`, `math/multiply`, `math/power`, `math/greater_than` |
| Mix Color | `mix/blend`, `mix/overlay`, `mix/multiply`, `mix/lighten`, `mix/linear_light` |
| Fresnel, Layer Weight | `fresnel`, `layer_weight/fresnel`, `layer_weight/facing` |
| Separate XYZ, Vector Math (cross), Mapping, Bump | `separate_xyz`, `vect_cross`, `mapping`, `bump` |
| Noise, Gradient, Voronoi Texture | `tex_noise`, `tex_gradient`, `tex_voronoi/f1`, `tex_voronoi/color` |

A node's mode is part of the type string, because it is topology rather than a
parameter: `Math` set to POWER is `math/power`, a Color Ramp's interpolation
picks between the three `ramp_*` types, and Layer Weight's chosen output picks
`layer_weight/fresnel` or `layer_weight/facing`. A few types have no Blender
source and are worth reaching for — `material_diffuse` (the PMX material's own
tint; multiply the diffuse texture by it, or untextured materials render white),
`ramp_constant_aa`, `ramp_tri`, `mix/add_emit` and `math/clamp01`.

**Principled BSDF carries v2 sockets**, so a 4.x or 5.x material maps by name.

| reze socket | Blender 5.2 | Notes |
| --- | --- | --- |
| `base_color` | Base Color | direct |
| `metallic` | Metallic | direct; v2's F82 tint is lost |
| `roughness` | Roughness | direct |
| `ior` | IOR | with `specular_ior_level`, gives f0 |
| `specular_ior_level` | Specular IOR Level | 0–1, 0.5 default |
| `sheen_weight` | Sheen Weight | direct |
| `sheen_tint` | Sheen Tint (colour) | take the luminance |
| `emission_color`, `emission_strength` | Emission | folded into Principled, as in 4.x+ |
| `normal` | Normal | flipped as above; unlinked means the shading normal |
| `spec_clamp` | — | reze-only, EEVEE's Light Clamp; leave it off unless a noisy bump throws specular fireflies |

At `ior` 1.5 the v2 chain is an identity onto the old convention, so a 3.6
material's Specular value transfers unchanged. Everything else bakes into
`base_color` at authoring time or is dropped: coat, subsurface, transmission,
alpha, anisotropy, tangent, thin film, diffuse roughness.

**Mixed BSDFs are a rewrite rather than a transcription.** A tree that mixes
closures and evaluates the result afterwards has to be restructured in the
Shader-to-RGB style — evaluate each branch to a colour, then combine — and what
comes out wants checking against a reference render. *Hair* is the built-in to
read for the idiom.

**A large tree will not fit.** Sixty-four nodes is the ceiling, so a material of
eighty-seven has to lose twenty-three. Most of the excess is reroutes, frames and
constant plumbing carrying no runtime meaning: fold constant subtrees, collapse
chains of literal math into single values, and drop the branches feeding
Principled inputs that do not exist here. Node groups flatten before porting,
Float and RGB Curves resample into ramps or a math chain, and Menu Switch
resolves to the one branch you want. Normal Map, Displacement, Attribute, Object
Info, Light Path and AOV Output have no equivalent at all.

**Say what did not survive.** A silently degraded material reads as a renderer
bug to whoever inherits it. Name the Blender node or socket you dropped and
whether it was baked into another value, approximated or omitted; and where the
source leans on multi-stop ramps, transformed texture lookups or real closure
mixing, say up front that the result is a rewrite rather than a port.

**Say what did not survive the port.** A silently degraded material reads as a
renderer bug to whoever inherits it. Name the Blender node or socket you dropped
and whether it was baked into another value, approximated or omitted; and if the
source leans on multi-stop ramps, transformed texture lookups or real closure
mixing, say up front that it is a rewrite rather than a port.

### The MMD idiom

Models from this ecosystem carry conventions worth exploiting:

- **Toon ramps.** MMD models ship with toon textures that quantise lighting into
  bands. The characteristic cel look comes from a **constant** or **anti-aliased
  constant** colour ramp driven by the dot product of normal and light — two or
  three bands, not a gradient. Prefer the anti-aliased variant, which holds up in
  motion.
- **Rim light via fresnel.** A fresnel node into an emission, added to the main
  shader, gives the edge separation that reads as anime lighting. Keep the
  strength low; rim light is a hint.
- **Eyes want their own graph.** They are flatter, more saturated and less
  responsive to scene light than skin, which is why *Eye* exists as a separate
  built-in and why the eye style group is created automatically.
- **Hair wants anisotropy.** A gradient along the hair's rest position, driven into
  a highlight, produces the banded sheen the style expects. Uniform specular on
  hair reads as plastic.
- **Stockings and other layered semi-transparent materials** need alpha hashing to
  sort correctly through layers. The built-in *Stockings* graph and its group role
  handle this; start from it when you build your own.

Work one change at a time, checking the viewport after each — an unexpected result
usually traces back to a link made three edits ago. Check a close-up and a wide
shot, since a graph tuned tight can turn to noise at distance. And remember that
cost multiplies: a graph runs for every pixel of every material in its group,
every frame, so the same graph costs far more on a costume filling the frame than
on the eyes.

## 2.5 Drafts, publishing and versions

All three surfaces share one lifecycle, and one rule: **what you keep lives in
Local, what you don't is gone.**

**Your own drafts save as you work.** Every change goes to local storage as you
make it, so closing a draft is simply closing it — nothing to confirm, and a
stray reload costs nothing.

**Everything else is a scratchpad.** A built-in, someone else's published item,
or a look you build directly on a style group: it is live on screen while you
work, but nothing is written anywhere until you close. Then you are asked whether
to keep it. Keep it and it lands in **Local**, free to rename, re-edit, apply to
other scenes and publish. Decline and it is discarded — including from the scene
you were previewing it in, which returns to what it was.

That is why there is no "saved in this scene but not in your library" state to
reason about: a look you want exists in Local, or it does not exist.

**Applying a draft embeds it in your scene by value**,
so the scene carries the actual grade, shader or graph, which is what lets a
published scene reproduce exactly on someone else's machine.

**Publishing mints a library item** under your name, visible to everyone. Two
properties follow:

- **Versions are immutable.** Publishing over your own item writes version *n+1*
  rather than replacing version *n*. Every scene using the old version keeps using
  it, byte for byte.
- **Scenes pin an exact version.** A scene records `{ id, version }`. Retuning your
  grade next month leaves untouched the look of a scene somebody published with it
  last month.

So publishing is a commitment. Improve an item freely — that is what versions are
for — and expect the versions already out there to keep serving the people using
them.

Unmodified built-ins travel differently: a scene records them as a bare reference,
resolved from the application itself. This is why a scene using only built-in
presets renders correctly with no network and no database at all.

---

# Appendix A. Control reference

**Assets**

| Control | Accepts | Notes |
| --- | --- | --- |
| Model | `.pmx` folder or `.zip` | Multiple models, one per slot |
| Animation | `.vmd` body motion | Per model |
| Camera | `.vmd` camera motion | Scene-wide; owns the camera while active |
| Music | `.mp3` / `.wav` / `.ogg` | Bound to the timeline |
| Backdrop | image | Flat, behind the scene |
| Skybox | equirectangular 2:1 image | 360° dome, display-only |

**Scene**

| Section | Control | Range |
| --- | --- | --- |
| Grade | preset, intensity | 0 – 1, remembered per preset |
| Background | colour, effect | — |
| Sun | colour, strength / azimuth / elevation | 0 – 6 / 0 – 360° / −90 – 90° |
| World | colour, strength | 0 – 2 |
| Bloom | colour, threshold / intensity | 0 – 2 / 0 – 1 (0 = off) |
| Ground | colour, opacity, shadow, grid lines | 0 – 1 opacity |
| Camera | distance, target X / Y / Z | 1 – 100 / ±50, −10 – 50, ±50 |

**Render**

| Control | Options |
| --- | --- |
| Aspect | 16:9, 9:16, 2.39:1, 1:1, 4:3 |
| Quality | 720p, 1080p, 1440p, 4K |
| Range | `m:ss` – `m:ss`, blank = whole clip |
| Audio | Music, None |
| Green screen | on / off (turns the watermark off) |
| Watermark | on / off |
| Outputs | 60 fps H.264 MP4; PNG still |

**Limits**

| Limit | Value |
| --- | --- |
| Scene name | 60 characters |
| Description | 500 characters |
| Tags | 5, of 16 characters each |
| Credits | 4,000 characters |
| Published bundle | 200 MB |
| Thumbnail | 20 MB |

---

# Appendix B. Finding models, motions and music

- **BOOTH** (`booth.pm`) — pixiv's marketplace, and the centre of gravity for
  currently-maintained models. Search in Japanese (`MMD モデル`) for the widest
  results.
- **Niconi Solid** (`3d.nicovideo.jp`) — Niconico's model host, including official
  Crypton models.
- **BowlRoll** (`bowlroll.net`) — a file host. Most motion, and much else, is
  distributed through it, linked from a Niconico video or a Twitter post and
  sometimes behind a password given in that post.
- **Aplaybox** (`aplaybox.com`) — a large Chinese-language model site, widely used
  by the bilibili MMD and VTuber communities.
- **DeviantArt** — long the Western hub, and still full of links. Much of it is
  redistribution of someone else's model, so prefer the original author's page.

Body and camera motion usually arrive together, per song, from the choreographer;
search the song title plus `モーション配布`. Motion targets a standard skeleton, so
it drives any model — where proportions differ you will see foot sliding, and a
model closer in build to the one it was authored for resolves it.

For music, most dance motion is choreographed to a specific commercial track.
VOCALOID producers often permit non-commercial derivative use, royalty-free
libraries such as DOVA-SYNDROME (`dova-s.jp`) are explicit about it, and anything
you made yourself is yours. Since publishing uploads the audio, treat music as the
most rights-sensitive asset in the scene.

---

# Appendix C. Glossary

**ASC CDL** — American Society of Cinematographers Color Decision List. The
slope/offset/power colour transform behind Reze Design's grades.

**借物表 (karimono-hyō)** — "borrowed items list". The credit list naming every
model, motion, effect and track used in a work, with authors. Required when
publishing.

**Bone** — a joint in a model's skeleton. Motion files address bones by name,
which is what makes files interchangeable.

**Cel shading / toon shading** — quantising lighting into flat bands rather than a
smooth gradient. The characteristic MMD look.

**Equirectangular** — a 2:1 panoramic projection, used for skyboxes.

**Grade** — a colour transform applied to the whole finished image.

**MME (MikuMikuEffect)** — the DirectX 9 HLSL effect plugin for desktop MMD. Its
counterparts here are background effects and shader graphs, in WGSL.

**Morph** — a named blend shape, most often a facial expression, driven by motion
files alongside bones.

**PMX / PMD** — MMD model formats. PMX is current.

**Physics** — simulated hair, cloth and accessory motion, defined in the model and
simulated at runtime.

**Shader graph** — a node graph defining how a surface responds to light,
compiled to WGSL.

**Style group** — a set of materials sharing one shader graph.

**利用規約 (riyō kiyaku)** — a model's terms of use. Read it before publishing.

**VMD** — Vocaloid Motion Data. Carries either body motion or camera motion.

**WebGPU** — the browser GPU API this application is built on.

**WGSL** — WebGPU Shading Language. Background effects are written in it, and
shader graphs compile to it.
