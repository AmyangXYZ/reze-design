/// <reference types="@webgpu/types" />
"use client"

// LIVE effect previews: each card/inspector canvas runs the effect's REAL WGSL
//
// The engine mounts an effect by which entry points its code defines, and so does
// this — a foreground-only effect has no `background` to call, and wrapping every
// effect as though it did is a shader that will not compile and a card that stays
// blank. It also has to hand a foreground the things the engine does: a depth, a
// camera, and a world position built from them. So the preview carries a stand-in
// scene — a ground plane under a horizon — which is the least that makes fog and
// rain legible, since both are defined by what they sit in front of.

import { memo, useEffect, useRef } from "react"
import { EFFECT_MATH_API, PARTICLE_STRUCT_WGSL } from "reze-engine"
import { cn } from "@/lib/utils"

/** Same detection the engine does at install time — `fn` and the name. */
const definesBackground = (wgsl: string) => /\bfn\s+background\s*\(/.test(wgsl)
const definesForeground = (wgsl: string) => /\bfn\s+foreground\s*\(/.test(wgsl)
/** All three or none, the same rule the engine enforces at install. */
const definesParticles = (wgsl: string) =>
  /\bfn\s+particleInit\s*\(/.test(wgsl) &&
  /\bfn\s+particleStep\s*\(/.test(wgsl) &&
  /\bfn\s+particleShade\s*\(/.test(wgsl)
/** `#particles N`, read the way the engine reads it. */
const particleCount = (wgsl: string) => {
  const m = wgsl.match(/^[ \t]*#particles[ \t]+(\d+)/m)
  // A card is two centimetres across: a tenth of the scene's pool reads the
  // same and costs a tenth as much, with a floor so a sparse effect still shows.
  return Math.max(192, Math.min(Math.round(Number(m?.[1] ?? 1024) / 4), 1500))
}
/** `#blend additive` — fire adds light, rain covers. */
const additive = (wgsl: string) => /^[ \t]*#blend[ \t]+additive/m.test(wgsl)
/** `#bloom` — the pool reaches the bloom pyramid in the scene. */
const blooms = (wgsl: string) => /^[ \t]*#bloom\b/m.test(wgsl)
/** Both halves or neither, as the engine requires of a ribbon. */
const definesTrails = (wgsl: string) =>
  /\bfn\s+trailWidth\s*\(/.test(wgsl) && /\bfn\s+trailShade\s*\(/.test(wgsl)
/** How many anchors asked for a path. One ribbon each, in declaration order. */
const trailSlots = (wgsl: string) => (wgsl.match(/^[ \t]*#anchor\b.*\btrail\b/gm) ?? []).length

// Same contract the engine's composite gives user code, over a stand-in scene.
//
// SPLIT IN TWO on purpose. Everything down to USER_CODE is the world an effect
// is compiled against, and the particle modules below host the same source with
// a different tail — so a card and the scene disagree about nothing except how
// many drops there are.
const PREVIEW_WORLD =
  /* wgsl */ `
struct U { time: f32, dt: f32, res: vec2f, count: u32, frame: u32, _pad0: f32, _pad1: f32 }
@group(0) @binding(0) var<uniform> u: U;
` +
  // The hashes, the noise and the falloff an effect is written against. The
  // preview defined NONE of them, so every effect calling rzHash13 or
  // rzCurlNoise — which is most particle effects and half the fields — failed
  // to compile and showed the fallback gradient with nothing said anywhere.
  // Imported from the engine rather than copied: two spellings of rzHash11 is
  // two different previews of the same shader.
  EFFECT_MATH_API +
  PARTICLE_STRUCT_WGSL +
  /* wgsl */ `
/** The frame an effect is authored against, in pixels. Particle sizes are world
 *  units and read at their on-screen size, so a card has to say what it is
 *  standing in for. */
const PV_REF_HEIGHT: f32 = 1080.0;
/**
 * How much smaller this card is than the frame effects are authored for.
 *
 * ONE RULE, applied wherever a size is measured against the frame: exaggerate
 * it by exactly how much has been taken away. A particle's size is world units
 * and shrinks with resolution; an outline's width is a fraction of the picture
 * and shrinks with it too — Sticker Outline asks for twelve pixels of a
 * 1440-line frame, which is one pixel on a card and reads as nothing. Both get
 * the same factor back, so a card shows the effect's CHARACTER at a size a
 * thumbnail can carry rather than a faithful miniature of it that is invisible.
 */
fn pvCardScale() -> f32 { return max(1.0, PV_REF_HEIGHT / max(u.res.y, 1.0)); }
/** Particles need more help than a band does. A drop is about ONE PIXEL in a
 *  full frame, so the card factor alone leaves it under a pixel and the pool
 *  reads as an empty card. A band already covers many pixels and needs none of
 *  this, which is why the boost is here and not in pvCardScale. */
const PV_PARTICLE_BOOST: f32 = 3.5;
fn rzTime() -> f32 { return u.time; }
fn rzDt() -> f32 { return u.dt; }
fn bgResolution() -> vec2f { return u.res; }

// The stand-in camera: about where a character is framed, at roughly the scale
// scenes use (a cast member is ~20 units tall and sits ~25 out), so distances
// written against a real scene read the same here.
const PV_CAM = vec3f(0.0, 8.0, -26.0);
fn bgCameraPos() -> vec3f { return PV_CAM; }
/**
 * FIXED. It used to yaw slowly, on the argument that a drifting view shows an
 * effect is anchored in the WORLD rather than painted on the frame.
 *
 * What it actually did, once the cards had a stand-in body to draw against, was
 * slide that body across the card — and a card is two centimetres across, so a
 * figure crossing it reads as the SUBJECT walking rather than as the camera
 * turning. The thing a card has to show is the effect; a moving stage says
 * something the effect never said.
 */
fn pvForward() -> vec3f { return vec3f(0.0, 0.0, 1.0); }
fn bgWorldPos(ray: vec3f, depth: f32) -> vec3f {
  let axis = max(dot(normalize(ray), pvForward()), 1e-4);
  return bgCameraPos() + normalize(ray) * (depth / axis);
}
fn rzResolution() -> vec2f { return u.res; }
fn rzCameraPos() -> vec3f { return PV_CAM; }
fn rzCamPos() -> vec3f { return PV_CAM; }
fn rzWorldPos(ray: vec3f, depth: f32) -> vec3f { return bgWorldPos(ray, depth); }
fn rzCameraForward() -> vec3f { return pvForward(); }
fn rzCameraRight() -> vec3f { let f = pvForward(); return vec3f(f.z, 0.0, -f.x); }
fn rzCameraUp() -> vec3f { return vec3f(0.0, 1.0, 0.0); }

// The exact inverse of the ray this preview builds per pixel, the same way the
// engine's rzProject inverts its own — so an effect that projects a world point
// and measures against it in 2D lands where it does in a real scene.
fn rzProject(p: vec3f) -> vec3f {
  let fwd = pvForward();
  let d = p - PV_CAM;
  let z = dot(d, fwd);
  let inv = 1.0 / select(z, 1e-4, z < 1e-4);
  let right = vec3f(fwd.z, 0.0, -fwd.x);
  let ndc = vec2f(dot(d, right) * inv / 0.9, d.y * inv / 0.55);
  return vec3f(ndc * 0.5 + 0.5, z);
}

// ── A stand-in CAST ──
//
// Effects that read the cast are the majority now, and every one of them failed
// to compile here — a missing rzSubject is a shader error, and a shader error is
// a blank card with nothing to say why. A stand-in scene needs a stand-in cast
// for the same reason it needs a floor: fog is invisible without something to
// sit in front of, and an aura is invisible without somebody to sit around.
//
// One figure, roughly the size and place a real cast member is framed at.
struct RzSubject {
  root: vec3f,
  center: vec3f,
  bounds: vec4f,
  /** How much of this character is still there. Cycled on the card rather than
   *  held at 1: an effect that draws what LEAVES a dissolving body has nothing
   *  to draw against a subject who never goes. */
  dissolve: f32,
  valid: bool,
}
struct RzAnchor {
  pos: vec3f,
  vel: vec3f,
  fwd: vec3f,
  valid: bool,
}
const PV_HIP = 10.0;
fn rzSubjectCount() -> i32 { return 1; }
fn bgSubjectCount() -> i32 { return 1; }
fn rzSubject(i: i32) -> RzSubject {
  var s: RzSubject;
  s.valid = i == 0;
  if (!s.valid) { return s; }
  s.root = vec3f(0.0, 0.0, 0.0);
  s.center = vec3f(0.0, PV_HIP, 0.0);
  s.bounds = vec4f(0.0, PV_HIP, 0.0, 14.0);
  // One teleport every eight seconds — the cycle the built-in Teleportation
  // declares, and the same four moments the engine samples from it.
  // The built-in Teleportation's own cycle: 3.0 whole, 0.5 apart, 0.65 gone,
  // 0.35 back. The same four durations the @dissolve directive takes, so a
  // change there is a change of the same four numbers here.
  let c = fract(u.time / 4.5) * 4.5;
  var d = 1.0;
  if (c >= 3.0 && c < 3.5) { d = 1.0 - (c - 3.0) / 0.5; }
  else if (c >= 3.5 && c < 4.15) { d = 0.0; }
  else if (c >= 4.15) { d = (c - 4.15) / 0.35; }
  s.dissolve = clamp(d, 0.0, 1.0);
  return s;
}
fn rzSubjectHip(i: i32) -> vec3f { return rzSubject(i).center; }
fn bgSubjectPos(i: i32) -> vec3f { return rzSubject(i).center; }

// ── A stand-in FIGURE, and the anchors that are its joints ──
//
// One skeleton, read two ways. The anchors an effect rings limbs with and the
// silhouette a rim effect inks are the SAME points, so a card cannot show
// sparks off one body and an outline around another.
//
// It used to be eight anchors spiralling up a column and, separately, a capsule
// for the body. An effect that rings a wrist ringed a point on a spiral, and a
// rim effect inked a pill — which is why every outline and rim card read as a
// lozenge rather than a character.

/** A slow turn, so anchors move and trails have something to record. */
fn pvPhase() -> f32 { return u.time * 0.9; }

/** The subject's centre and radius, in world units. Body-sized, standing on the
 *  floor the field mounts see. */
const PV_R: f32 = 5.2;
/** RESTING ON THE FLOOR, so the lowest anchor is AT y=0.
 *
 *  Floating it put every anchor between 4 and 15 units up, and an effect that
 *  marks where a foot met the ground had nothing that ever met it — Footprints
 *  drew nothing at all, correctly, against a subject with no feet. */
fn pvCentre() -> vec3f { return vec3f(0.0, PV_R, 0.0); }

/**
 * ONE SPHERE, not a figure.
 *
 * A stick figure was tried and read as a stick figure: at 118 pixels the limbs
 * are two pixels wide, the silhouette is mostly gaps, and every rim and outline
 * effect inked a scribble. A sphere is what a material preview has always been,
 * for the reason it still is — one closed curve, unambiguous at any size, and an
 * outline around it is obviously an outline.
 *
 * The anchors are points ON it. An effect that rings a wrist rings a point on
 * the thing the card is drawing, which is the most a preview can honestly
 * promise about a bone it has no model for.
 */
fn pvJoint(i: i32) -> vec3f {
  return pvJointAt(i, pvPhase());
}

/** The same point at any moment, so velocity and history are the real thing
 *  rather than three curves that resemble each other. */
fn pvJointAt(i: i32, ph: f32) -> vec3f {
  // SLOT 0 RIDES THE EQUATOR. It is the widest circle on the subject, so the
  // ribbon drawn along its history is the largest arc a card can show — one big
  // sweep rather than several short ones tangled around a ball.
  if (i == 0) { return pvCentre() + vec3f(cos(ph), 0.0, sin(ph)) * PV_R * 1.18; }
  // The rest spread over the sphere on a Fibonacci spiral, turning slowly. The
  // lowest of them reaches the floor, which is what a footfall effect needs.
  let f = (f32(i) + 0.5) / 8.0;
  let y = 1.0 - f * 2.0;
  let rad = sqrt(max(0.0, 1.0 - y * y));
  let a = f32(i) * 2.399963 + ph;
  return pvCentre() + vec3f(cos(a) * rad, y, sin(a) * rad) * PV_R;
}

fn rzAnchor(subject: i32, slot: i32) -> RzAnchor {
  var a: RzAnchor;
  a.valid = subject == 0 && slot >= 0 && slot < 8;
  if (!a.valid) { return a; }
  a.pos = pvJoint(slot);
  // From where the same point was a moment ago, so a spark thrown along an
  // anchor's travel is thrown the way it is actually going.
  let dt = 0.03;
  a.vel = (a.pos - pvJointAt(slot, pvPhase() - dt * 0.9)) / dt;
  a.fwd = normalize(a.pos - pvCentre());
  return a;
}

// And a stand-in PATH for each: where that joint WAS, sampled back in time, so
// an effect looking for the moment a foot stopped descending finds real
// touchdowns and a ribbon has the hand's own curve to run along.
fn rzTrailCount(subject: i32, slot: i32) -> i32 {
  if (subject != 0 || slot < 0 || slot >= 8) { return 0; }
  return 48;
}
fn rzTrail(subject: i32, slot: i32, i: i32) -> vec4f {
  let n = rzTrailCount(subject, slot);
  if (i < 0 || i >= n) { return vec4f(0.0); }
  let age = f32(i) * (1.0 / 24.0);
  // The same point at an earlier moment — a real history, not a curve that
  // resembles one.
  return vec4f(pvJointAt(slot, pvPhase() - age * 0.9), age);
}

// ── A stand-in BODY, and the ids that name it ──
//
// ONE SIGNED DISTANCE, and everything about the silhouette reads it: the mask,
// the id attachment, the distance an effect measures, and the pixels the card
// actually draws.
//
// It was a hard binary before — inside or out, decided per pixel — and on a
// card 118 pixels wide that is a stair-stepped edge. Every rim, outline and
// silhouette effect then inked along the stairs, which is what made them look
// wrong: not the shape, the EDGE. A distance is smooth everywhere, so the mask
// can be antialiased across one pixel and a rim can sit at a true offset from
// the outline rather than at whichever pixel the step landed on.
const PV_ID: u32 = 7u;

/** A joint in the same space, so the anchors and the silhouette cannot
 *  disagree about where the subject is. */
fn pvAt(i: i32, asp: f32) -> vec2f {
  let q = rzProject(pvJoint(i));
  return vec2f(q.x * asp, q.y);
}

/** The subject as a signed distance in screen space. Negative inside. */
fn pvFigure(uv: vec2f) -> f32 {
  let asp = u.res.x / max(u.res.y, 1.0);
  let p = vec2f(uv.x * asp, uv.y);
  let c = rzProject(pvCentre());
  let centre = vec2f(c.x * asp, c.y);
  // Radius measured where it is drawn, so it tracks the projection.
  let edge = rzProject(pvCentre() + vec3f(PV_R, 0.0, 0.0));
  let r = abs(edge.x * asp - centre.x);
  return length(p - centre) - max(r, 1e-4);
}

/** Coverage, antialiased across ONE PIXEL — which is what makes the edge clean
 *  at a card's resolution instead of a staircase for a rim to follow. */
fn pvBodyMask(uv: vec2f) -> f32 {
  let px = 1.0 / max(u.res.y, 1.0);
  return 1.0 - smoothstep(-px, px, pvFigure(uv));
}
/** Which model this is — what rzObjectAt is compared against. */
fn rzSubjectId(i: i32) -> u32 { return select(0u, PV_ID, i == 0); }
/** TOP-LEFT uv, exactly as the engine's takes it: it indexes the attachment
 *  with textureLoad, whose origin is the top-left texel, while every uv the
 *  effect API hands out has its origin bottom-left. An effect turns y over for
 *  the real one, so it must turn it over here — otherwise the card would show a
 *  mask the scene does not. */
fn rzObjectAt(uvTop: vec2f) -> u32 {
  return select(0u, PV_ID, pvBodyMask(vec2f(uvTop.x, 1.0 - uvTop.y)) > 0.5);
}
/** One material on that body — enough for an effect that masks by material to
 *  compile and to see a shape, which is what a card is for. */
fn rzMaterialAt(uvTop: vec2f) -> u32 { return select(0u, 1u, rzObjectAt(uvTop) != 0u); }

// ── The CONSTANTS an effect is compiled with ──
//
// The engine splices these into every module that hosts an author's source, and
// the preview declared none of them. Same class of gap as the missing
// accessors, found the same way and missed the first time because a constant is
// not a function: Hand Ribbon's sparks pick a hand by indexing RZ_TRAIL_SLOTS,
// and a card that has never heard of it fails to compile and shows a gradient.
//
// The counts are this preview's own — eight anchors, forty-eight samples, one
// subject — so an effect that loops over them walks exactly what the stand-in
// world actually has.
const RZ_SUBJECTS: i32 = 1;
const RZ_MAX_ANCHORS: i32 = 8;
const RZ_SLOTS: i32 = 8;
const RZ_TRAIL_SLOTS: i32 = 8;
const RZ_SAMPLES: i32 = 48;
const RZ_TRAIL_SAMPLES: i32 = 48;
const RZ_ID_SAMPLES: i32 = 1;
const RZ_GRID_SIZE: f32 = 256.0;
const RZ_MAX_LIGHTS: u32 = 16u;
/** The dissolve grammar, verbatim from the engine — an effect that draws what
 *  leaves a dissolving body has to use the same grain to match it. */
const RZ_REF_SPAN: f32 = 0.37;
const RZ_DISSOLVE_GRAIN: f32 = 0.42;
const RZ_DISSOLVE_CLUMP: f32 = 0.6;
const RZ_DISSOLVE_GRIT: f32 = 0.06;
const RZ_DISSOLVE_EDGE: f32 = 0.11;
const RZ_BURN_COLOR: vec3f = vec3f(0.45, 0.62, 2.40);

// ── Stand-in AUDIO ──
//
// A plain pulse with a bass-heavy spectrum. The real analysis is a whole song
// precomputed; a card two centimetres across only has to show that the effect
// moves with one.
fn rzAudioFrames() -> i32 { return 3600; }
fn rzAudioBandCount() -> i32 { return 32; }
fn rzAudioPlaying() -> f32 { return 1.0; }
fn rzAudioTime() -> f32 { return u.time; }
/** Two bars of four, so a card shows a beat and the bar it sits in. */
const PV_BPM: f32 = 120.0;
fn pvBeat(o: f32) -> f32 { return (u.time + o) * (PV_BPM / 60.0); }
/** How long since the last beat, 0 at the hit and 1 just before the next. */
fn pvSinceBeat(o: f32) -> f32 { return fract(pvBeat(o)); }
fn rzAudioLevelAt(o: f32) -> f32 {
  // A kick that decays, over a bed — what a level meter on real music does,
  // where a sine only ever showed an effect breathing.
  let hit = pow(1.0 - pvSinceBeat(o), 3.0);
  let bar = 0.82 + 0.18 * sin(pvBeat(o) * 0.7853982);
  return clamp((0.24 + 0.62 * hit) * bar, 0.0, 1.0);
}
fn rzAudioLevel() -> f32 { return rzAudioLevelAt(0.0); }
/** A spike ON the beat, gone almost at once — what an onset detector reports. */
fn rzAudioOnsetAt(o: f32) -> f32 { return pow(1.0 - pvSinceBeat(o), 12.0); }
fn rzAudioOnset() -> f32 { return rzAudioOnsetAt(0.0); }
fn rzAudioBandAt(i: i32, o: f32) -> f32 {
  let f = f32(i) / max(f32(rzAudioBandCount()), 1.0);
  // A real spectrum is a tilted floor with structure on it: bass carries most of
  // the energy, the mids move with the melody, and the top is air. A smooth sine
  // across the bands drew a wave, which is the one shape a spectrum never is.
  let tilt = exp(-f * 2.3);
  let kick = pow(1.0 - pvSinceBeat(o), 4.0) * exp(-f * 7.0);
  let melody = 0.35 * exp(-pow((f - 0.32) * 4.5, 2.0)) * (0.5 + 0.5 * sin(pvBeat(o) * 1.57 + f * 12.0));
  let air = 0.10 * rzHash21(vec2f(f32(i), floor(pvBeat(o) * 2.0)));
  return clamp(tilt * 0.55 + kick * 0.75 + melody + air, 0.0, 1.0);
}
fn rzAudioBand(i: i32) -> f32 { return rzAudioBandAt(i, 0.0); }

// The light struct, declared exactly as the engine declares it in every module
// it splices user code into.
//
// The preview never CALLS lightEmit — a card has no scene to light — but an
// effect that defines one still has to compile, and a missing struct is a
// shader error, which renders as a blank card with nothing said anywhere. That
// is precisely how Summoning Circle and Stage Lights came to preview as
// nothing: both draw a perfectly good foreground, and both were rejected for a
// type the wrapper had never heard of.
struct RzLight {
  pos: vec3f,
  color: vec3f,
  intensity: f32,
  radius: f32,
}

// The MIDI interface, over a stand-in score.
//
// Stubbed for the same reason the cast is: an effect that reads notes cannot
// COMPILE without these, and a shader error is a blank card rather than a
// visible failure — which is exactly how Note Fall came to preview as nothing
// at all. The notes are synthetic and deliberately regular: a scale walking up
// the keyboard, one per beat, so a falling-note effect has something moving to
// draw without a file behind it.
const PV_NOTES: i32 = 48;
const PV_BEAT: f32 = 0.5;
fn rzNoteCount() -> i32 { return PV_NOTES; }
fn rzMidiTime() -> f32 { return u.time; }
fn rzMidiPlaying() -> f32 { return 1.0; }
fn rzMidiDuration() -> f32 { return f32(PV_NOTES) * PV_BEAT; }
fn rzPitchLow() -> f32 { return 48.0; }
fn rzPitchHigh() -> f32 { return 84.0; }
fn rzNoteStart(i: i32) -> f32 { return f32(i) * PV_BEAT; }
fn rzNoteLength(i: i32) -> f32 { return PV_BEAT * 0.8; }
fn rzNotePitch(i: i32) -> f32 { return 48.0 + f32(i % 36); }
fn rzNoteVelocity(i: i32) -> f32 { return 0.55 + 0.35 * abs(sin(f32(i) * 1.7)); }
fn rzNoteAge(i: i32) -> f32 { return u.time - rzNoteStart(i); }
fn rzNoteHeld(i: i32) -> f32 {
  let age = rzNoteAge(i);
  return select(0.0, 1.0, age >= 0.0 && age < rzNoteLength(i));
}
fn rzKeyEnergy(pitch: f32) -> f32 {
  // Whichever note is sounding now, decaying after it — the same shape the
  // engine's per-pitch map has, without needing the map.
  let i = i32(floor(u.time / PV_BEAT));
  let hit = abs(pitch - rzNotePitch(i));
  return select(0.0, max(0.0, 1.0 - fract(u.time / PV_BEAT)), hit < 0.5);
}
fn rzPitchX(pitch: f32) -> f32 {
  return clamp((pitch - rzPitchLow()) / max(1.0, rzPitchHigh() - rzPitchLow()), 0.0, 1.0);
}

// The lyric interface, over one stand-in line.
//
// The words themselves live in a texture the host rasterises, which a preview
// card has no host for — so rzLyricText draws a legible BLOCK per character
// instead. An effect's layout, sweep and fades are what a card is showing off;
// the glyphs are the one part it can honestly fake.
const PV_LINE: f32 = 3.0;
/** EIGHT lines in four PAIRS, each pair sharing a stamp.
 *
 *  A bilingual .lrc is two lines at one timestamp, and that is the case the
 *  subtitle effect exists to lay out — one stack, one type size, one sweep on
 *  the stack's clock. Eight evenly spaced lines never exercised it, so the card
 *  showed a caption effect doing the one thing it was written not to do. */
fn rzLyricCount() -> i32 { return 8; }
fn pvLyricPair(i: i32) -> i32 { return i / 2; }
fn rzLyricStart(i: i32) -> f32 { return f32(pvLyricPair(i)) * PV_LINE; }
fn rzLyricEnd(i: i32) -> f32 { return f32(pvLyricPair(i) + 1) * PV_LINE; }
/** Lines of different lengths — a lead and its shorter translation. A fixed
 *  twelve made every line the same width, which is the one thing that hides
 *  whether a layout centres, wraps or fits to the widest. */
fn rzLyricChars(i: i32) -> f32 {
  let lead = (i % 2) == 0;
  let n = array<f32, 4>(14.0, 9.0, 18.0, 11.0)[pvLyricPair(i) % 4];
  return select(n * 0.62, n, lead);
}
fn rzLyricIndex(t: f32) -> i32 { return (i32(floor(t / PV_LINE)) % 4) * 2; }
fn rzLyricProgress(i: i32, t: f32) -> f32 { return clamp(fract(t / PV_LINE), 0.0, 1.0); }
fn rzLyricRect(i: i32) -> vec4f { return vec4f(0.0, 0.0, 1.0, 1.0); }
fn rzLyricHasText(i: i32) -> bool { return true; }
fn rzLyricAspect(i: i32) -> f32 { return rzLyricChars(i) * 0.62; }
fn rzLyricPixels(i: i32) -> vec2f { return vec2f(rzLyricChars(i) * 48.0, 96.0); }
fn rzLyricText(i: i32, uv: vec2f) -> f32 {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
  let n = rzLyricChars(i);
  let cell = fract(uv.x * n);
  // A bar per character, with gaps between them and margins top and bottom —
  // enough for an outline, a wipe and a fade to read as they will on real text.
  let ink = step(0.18, cell) * step(cell, 0.82);
  return ink * step(0.22, uv.y) * step(uv.y, 0.78);
}

// ── THE REST OF THE CONTRACT ──
//
// An effect is compiled against ~98 accessors and this defined 64, so anything
// reaching for one of the other 34 failed to compile and the card showed its
// fallback with nothing said anywhere. A screen filter asking rzSceneDisplay
// what the frame looks like is the ordinary case, not an exotic one, and it was
// among the missing.
//
// Every one answers now, and answers with something a card can SHOW: stand-ins
// where a real value needs a scene (the taps read this preview's own floor and
// body), honest nothing where it needs a host pass the card does not run (no
// lights emitted, no grid stepped), and the real arithmetic where it is only
// arithmetic (the splines).

// What the fs composed before the mounts ran. Private module state, because
// these are read from inside the author's own functions, which cannot be
// handed it. (No backticks in here — this is inside a template literal, and one
// terminates it.)
var<private> pvCol: vec3f = vec3f(0.0);
var<private> pvDepth: f32 = 100000.0;
var<private> pvHit: f32 = 0.0;

fn rzSceneFar() -> f32 { return 100000.0; }
fn rzSceneAlpha(uv: vec2f) -> f32 { return pvHit; }
fn rzSceneHit(uv: vec2f) -> bool { return pvHit > 0.5; }
fn rzSceneDepth(uv: vec2f) -> f32 { return pvDepth; }
fn rzScene(uv: vec2f) -> vec3f { return pvCol; }
fn bgScene(uv: vec2f) -> vec3f { return pvCol; }
fn rzSceneDisplay(uv: vec2f) -> vec3f { return pvCol; }
fn rzSceneFrame(uv: vec2f) -> vec3f { return pvCol; }
/** Opaque, and the near-black the floor fades into — so a filter rebuilding the
 *  picture over the background gets the picture back. */
fn rzBackground() -> vec4f { return vec4f(0.075, 0.06, 0.1, 1.0); }

/**
 * Distance to the silhouette — in SCREEN PIXELS, and negative inside.
 *
 * The engine's is pixels whatever the field's own resolution is, so an author
 * writes the width they mean. This returned aspect-corrected uv, where 1.0 is
 * the whole frame — so an outline asking for three units got three SCREEN
 * HEIGHTS and every pixel came back inside it. That is what made Sticker
 * Outline read as a wash of glow instead of an edge.
 *
 * Inside runs to -0.5 and no further, as the engine's flood does: an effect
 * that guards on d >= 0 has to see the same negative here.
 */
fn rzCastDistance(uv: vec2f) -> f32 {
  return max(-0.5, pvFigure(uv) * u.res.y / pvCardScale());
}

/** Straight alpha OVER, the merge the composite performs between layers. */
fn rzFieldMerge(top: vec4f, bot: vec4f) -> vec4f {
  let a = clamp(top.a, 0.0, 1.0);
  return vec4f(top.rgb * a + bot.rgb * (1.0 - a), a + bot.a * (1.0 - a));
}

fn rzViewportHeight() -> f32 { return u.res.y; }
/** Flat and dim. A card has no HDRI, and faking one would show lighting the
 *  scene will not reproduce. */
fn rzWorldAmbient(n: vec3f) -> vec3f { return vec3f(0.06, 0.06, 0.075); }

// NO LIGHTS EMITTED. The #lights directive allocates slots the effect fills
// through lightEmit, a pass the card does not run — so the honest answer is
// none, and an effect reading them shades as it would before its first emit.
fn rzLightCount() -> u32 { return 0u; }
fn rzLightPos(i: u32) -> vec3f { return vec3f(0.0); }
fn rzLightRadius(i: u32) -> f32 { return 0.0; }
fn rzLightColor(i: u32) -> vec3f { return vec3f(0.0); }
fn rzLightsDiffuse(p: vec3f, n: vec3f) -> vec3f { return vec3f(0.0); }

// NO GRID STEPPED, for the same reason: a kernel reading its own previous state
// on a card would read a texture nobody wrote.
fn rzGridSize() -> f32 { return 256.0; }
fn rzGridTexel() -> f32 { return 1.0 / 256.0; }
fn rzGridFrame() -> i32 { return 0; }
fn rzGrid(uv: vec2f) -> vec4f { return vec4f(0.0); }
fn rzGridPrev(uv: vec2f) -> vec4f { return vec4f(0.0); }

/** The widest line as a fraction of the frame. The stand-in line is 12 blocks
 *  at aspect 8, a little over half. */
fn rzLyricWidest() -> f32 { return 18.0 * 0.62 * 0.048; }

// Real arithmetic, not a stand-in: a spline is a spline wherever it runs.
fn rzSpline(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}
fn rzSplineTangent(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  return 0.5 * ((-p0 + p2) + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * 2.0 * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * 3.0 * t2);
}
/** Resampled along the stand-in path, so a ribbon reads its own smooth curve. */
fn rzTrailAt(subject: i32, slot: i32, i: i32, n: i32) -> vec4f {
  let src = rzTrailCount(subject, slot);
  if (src <= 0 || n <= 0) { return vec4f(0.0); }
  let f = f32(i) / f32(max(n - 1, 1)) * f32(src - 1);
  let lo = i32(floor(f));
  let a = rzTrail(subject, slot, lo);
  let b = rzTrail(subject, slot, min(lo + 1, src - 1));
  return mix(a, b, fract(f));
}
fn rzTangentAt(subject: i32, slot: i32, i: i32, n: i32) -> vec3f {
  let a = rzTrailAt(subject, slot, max(i - 1, 0), n).xyz;
  let b = rzTrailAt(subject, slot, min(i + 1, n - 1), n).xyz;
  let d = b - a;
  return select(vec3f(0.0, 1.0, 0.0), normalize(d), length(d) > 1e-5);
}
/** Menger curvature: the radius of the circle through three points. */
fn rzTurnRadius(a: vec3f, b: vec3f, c: vec3f) -> f32 {
  let ab = length(b - a);
  let bc = length(c - b);
  let ca = length(a - c);
  let area = length(cross(b - a, c - a)) * 0.5;
  return select(1.0e9, (ab * bc * ca) / (4.0 * max(area, 1e-6)), area > 1e-6);
}

USER_CODE
`

/**
 * The field tail: one fullscreen triangle over the stand-in scene.
 *
 * Separated from the world above so the particle modules can host the same
 * source without it — a particle effect has no fullscreen pass, and compiling
 * one that calls `background` it never defined is how the card went blank.
 */
const FIELD_TAIL = /* wgsl */ `

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi & 1u) << 2u) - 1.0;
  let y = f32((vi & 2u) << 1u) - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = vec2f(fragCoord.x / u.res.x, 1.0 - fragCoord.y / u.res.y);
  let ndc = uv * 2.0 - 1.0;
  let fwd = pvForward();
  let right = vec3f(fwd.z, 0.0, -fwd.x);
  let dir = normalize(fwd + ndc.x * right * 0.9 + vec3f(0.0, ndc.y * 0.55, 0.0));

  // The stand-in scene: a floor at y=0, and nothing above the horizon. Depth is
  // measured along the VIEW AXIS, exactly as the engine hands it over, so an
  // effect's distances mean the same thing in both places.
  var hit = 100000.0;
  if (dir.y < -1e-4) {
    hit = -PV_CAM.y / dir.y;
  }
  var depth = clamp(hit * max(dot(dir, fwd), 1e-4), 0.05, 100000.0);

  // A dark base, then a hint of floor receding — a foreground needs something to
  // be in front of, or its whole point is invisible.
  var col = vec3f(0.075, 0.06, 0.1);
  if (hit < 100000.0) {
    col = mix(vec3f(0.16, 0.15, 0.19), col, clamp(hit / 140.0, 0.0, 1.0));
  }

  // The body the ids name, DRAWN as well as masked. An effect that dissolves a
  // character needs a character on the card to dissolve; without one it eats a
  // silhouette nobody can see and the card shows its sparks floating in a room.
  // Flat, and deliberately: this is a stand-in, and shading it would invite
  // reading the card as a render.
  // Blended by coverage rather than switched on a threshold: a hard cut here
  // would put the staircase back into the very pixels a rim is measured against.
  let body = pvBodyMask(uv);
  col = mix(col, vec3f(0.20, 0.19, 0.24), body);
  depth = mix(depth, max(rzProject(vec3f(0.0, 9.4, 0.0)).z, 0.05), step(0.5, body));

  // Hand the composed scene to the taps before the mounts run, so a filter that
  // rebuilds the picture from rzSceneDisplay gets THIS card's picture.
  pvCol = col;
  pvDepth = depth;
  pvHit = max(select(0.0, 1.0, hit < 100000.0), body);

  BACKGROUND_CALL
  FOREGROUND_CALL
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

// Both mounts composite the same way the engine's do: straight alpha OVER.
const BACKGROUND_CALL = /* wgsl */ `
  {
    let c = background(dir, uv, u.time);
    let a = clamp(c.a, 0.0, 1.0);
    col = clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a + col * (1.0 - a);
  }`
const FOREGROUND_CALL = /* wgsl */ `
  {
    let c = foreground(dir, uv, u.time, depth);
    let a = clamp(c.a, 0.0, 1.0);
    col = clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * a + col * (1.0 - a);
  }`

/**
 * DIRECTIVES ARE NOT WGSL, and the engine strips them before it compiles.
 *
 * This did not, so every effect declaring one — `#layer`, `#anchor`, `#lights`,
 * `#grid`, `#halfres`, `#particles` — spliced a `#` line straight into the
 * shader source and failed to compile. Twelve of the thirty built-ins declare
 * one, so twelve cards sat on their fallback gradient with nothing to say why.
 * A blank card looks like a slow card, which is why this went unnoticed.
 *
 * Line-based, exactly as the engine reads them: a directive owns its whole line.
 */
const stripDirectives = (wgsl: string) => wgsl.replace(/^[ \t]*#[^\n]*$/gm, "")

/**
 * The effect's declared dials, as constants at their defaults.
 *
 * The engine turns `#param` lines into a uniform the host writes; a card has no
 * host and no one to drag a slider, so the same lines become a private struct
 * initialised to what the author wrote. Without it a converted effect referred
 * to `params.FALL` while nothing declared `params`, and the card went blank —
 * which is exactly what happened to Rain the moment it grew dials.
 *
 * Read from the SAME directive lines the engine reads, so a card shows the
 * shader at its defaults and never at some second set of numbers.
 */
function paramsBlock(wgsl: string): string {
  const fields: string[] = []
  const values: string[] = []
  for (const line of wgsl.split("\n")) {
    const m = /^[ \t]*#param[ \t]+(\w+)[ \t]+(\w+)[ \t]+(.*)$/.exec(line)
    if (!m) continue
    const [, kind, name, rest] = m
    // A trailing note is the author's, exactly as the engine's parser treats it.
    const args = rest.split(/(?:^|\s)(?:—|--|\/\/|#)\s/)[0].trim().split(/\s+/)
    if (kind === "color") {
      const hex = args[0] ?? "#ffffff"
      const n = parseInt(hex.slice(1), 16)
      if (!/^#[0-9a-fA-F]{6}$/.test(hex) || Number.isNaN(n)) continue
      fields.push(`  ${name}: vec3f,`)
      values.push(`vec3f(${((n >> 16) & 255) / 255}, ${((n >> 8) & 255) / 255}, ${(n & 255) / 255})`)
    } else if (kind === "vec3") {
      const v = args.slice(0, 3).map(Number)
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) continue
      fields.push(`  ${name}: vec3f,`)
      values.push(`vec3f(${v.map((x) => x.toFixed(6)).join(", ")})`)
    } else if (kind === "float") {
      const v = Number(args[0])
      if (!Number.isFinite(v)) continue
      fields.push(`  ${name}: f32,`)
      values.push(v.toFixed(6))
    }
  }
  if (fields.length === 0) return ""
  return `struct EffectParams {\n${fields.join("\n")}\n}\nvar<private> params: EffectParams = EffectParams(${values.join(", ")});\n`
}

/** The author's source as a card compiles it: dials declared, directives gone. */
const hosted = (wgsl: string) => paramsBlock(wgsl) + stripDirectives(wgsl)

/**
 * The PARTICLE stages, over the same stand-in world.
 *
 * Ten of the thirty built-ins declare only the particle trio — rain, snow, both
 * ribbons, both teleports, the sparks — and the preview knew how to draw a
 * fullscreen pass and nothing else, so every one of them showed an empty card.
 * The world above already gives them everywhere to run: a subject with a hip and
 * a dissolve cycle, eight anchors swaying on a body-sized column, a recorded
 * path per anchor. What was missing was the pass that runs them.
 *
 * The engine's own shape, at a card's scale: the pool is storage, `main`
 * respawns a dead particle from particleInit and steps a live one, and the draw
 * is six vertices per instance with the billboard basis taken from the view.
 */
const PARTICLE_COMPUTE = (wgsl: string) =>
  PREVIEW_WORLD.replace("USER_CODE", hosted(wgsl)) +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  var p = particles[i];
  // Frame 0 seeds the whole pool; after that only what has died comes back —
  // the same rule the engine follows, so a card is not perpetually respawning.
  if (u.frame == 0u || p.life <= 0.0 || p.age >= p.life) {
    let generation = floor(u.time * 0.37) + f32(i) * 0.618;
    p = particleInit(i, rzHash11(generation));
  } else {
    p = particleStep(p, u.dt);
    p.age = p.age + u.dt;
  }
  particles[i] = p;
}
`

const PARTICLE_RENDER = (wgsl: string) =>
  PREVIEW_WORLD.replace("USER_CODE", hosted(wgsl)) +
  // Whether this pool would reach the bloom pyramid in the scene. The card has
  // no bloom pass, so an effect authored around one — HDR cores meant to grow a
  // halo — drew as small dim dots and looked worse than an effect that never
  // wanted bloom at all. Floating Stars beside Ember Drift was exactly that.
  `\nconst PV_BLOOM: f32 = ${blooms(wgsl) ? "1.0" : "0.0"};\n` +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct PVOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) id: u32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PVOut {
  var out: PVOut;
  let p = particles[ii];
  // Dead ones collapse to a degenerate quad rather than being culled on the
  // CPU: the draw is a fixed instance count and this costs one compare.
  if (p.life <= 0.0 || p.age >= p.life) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2f(0.0);
    out.id = ii;
    return out;
  }
  // Two triangles from the vertex index, corners in [-1, 1].
  let cx = f32(((vi + 1u) / 3u) % 2u) * 2.0 - 1.0;
  let cy = f32((vi / 2u) % 2u) * 2.0 - 1.0;
  let corner = vec2f(cx, cy);

  let fwd = pvForward();
  let right = vec3f(fwd.z, 0.0, -fwd.x);
  let up = vec3f(0.0, 1.0, 0.0);
  // Stretch runs along the SCREEN velocity, which is what makes a raindrop a
  // streak rather than a square that happens to be moving.
  let sv = vec2f(dot(p.vel, right), dot(p.vel, up));
  let dir = select(vec2f(0.0, 1.0), normalize(sv), length(sv) > 1e-4);
  // SIZED FOR THE CARD, not for the frame.
  //
  // A particle's size is in WORLD units, so its size on screen falls with the
  // resolution. Rain's drop is about a pixel wide in a 1080-tall frame and a
  // seventh of one on a 150-pixel card — which is why the pool drew and the card
  // still looked empty. Scaling by how much smaller the card is restores the
  // apparent size, so a drop reads as a drop and a spark as a spark.
  //
  // A floor of 1, so a card larger than the reference is left alone rather than
  // having its particles shrunk.
  let size = p.size * pvCardScale() * PV_PARTICLE_BOOST;
  let along = dir * corner.y * size * max(p.stretch, 1.0);
  let across = vec2f(dir.y, -dir.x) * corner.x * size;
  let world = p.pos + right * (along.x + across.x) + up * (along.y + across.y);

  let proj = rzProject(world);
  out.pos = vec4f(proj.xy * 2.0 - 1.0, 0.5, 1.0);
  out.uv = corner * 0.5 + 0.5;
  out.id = ii;
  return out;
}

@fragment fn fs(in: PVOut) -> @location(0) vec4f {
  let c = particleShade(particles[in.id], in.uv);
  // A STAND-IN FOR BLOOM, not bloom: the part of the colour above white is what
  // the pyramid would have spread, so it is added back here as a soft core
  // falling off across the quad. It cannot reach past the particle the way a
  // real pyramid does — but the halo is what a glowing mote READS as, and
  // without it an HDR core is just a small bright dot.
  let r = length(in.uv * 2.0 - vec2f(1.0));
  let halo = exp(-r * r * 2.2);
  let over = max(c.rgb - vec3f(1.0), vec3f(0.0));
  let lit = c.rgb + over * halo * PV_BLOOM;
  // Tone mapped, because the pool draws in HDR exactly as it does in the scene:
  // an INTENSITY of 2.4 is white with headroom, not white clipped flat.
  let mapped = lit / (lit + vec3f(1.0));
  let a = clamp(c.a, 0.0, 1.0);
  return vec4f(mapped * a, a);
}
`

/**
 * The RIBBON pass, over the same stand-in world.
 *
 * One quad per segment of each trailed anchor's recorded path, extruded across
 * the path in screen space — the engine's own approach, because a 2D
 * perpendicular cannot twist the way a camera-facing 3D side vector does at a
 * tight turn.
 *
 * No buffer: rzTrail is procedural here, so a ribbon needs nothing but the
 * clock. The engine reads a recorded history from the cast buffer instead, which
 * is the one place a card and the scene genuinely differ — the SHAPE of the path
 * is this preview's, the ribbon drawn along it is the author's.
 */
const TRAIL_RENDER = (wgsl: string) =>
  PREVIEW_WORLD.replace("USER_CODE", hosted(wgsl)) +
  // ONE ribbon, whatever the effect declares. Two hands' worth of short arcs
  // read as tangle at 118 pixels; slot 0 rides the equator, so a single ribbon
  // is one big legible sweep — which is what a card is for.
  `\nconst PV_RIBBONS: i32 = 1;\n` +
  /* wgsl */ `
struct TVOut {
  @builtin(position) pos: vec4f,
  @location(0) u: f32,
  @location(1) v: f32,
  @location(2) age: f32,
  @location(3) @interpolate(flat) slot: i32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TVOut {
  var out: TVOut;
  let n = rzTrailCount(0, 0);
  let segs = u32(max(n - 1, 1));
  let slot = i32(ii / segs);
  let seg = i32(ii % segs);
  if (slot >= PV_RIBBONS || seg + 1 >= n) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return out;
  }

  let quad = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = quad[vi];
  let atEnd = c.x > 0.5;

  let a = rzTrail(0, slot, seg);
  let b = rzTrail(0, slot, seg + 1);
  let p = select(a.xyz, b.xyz, atEnd);
  let age = select(a.w, b.w, atEnd);
  let uAlong = (f32(seg) + select(0.0, 1.0, atEnd)) / f32(max(1, n - 1));

  // World width to a screen offset, measured where it is drawn.
  let half = max(0.0, trailWidth(uAlong, age));
  let centre = rzProject(p);
  let side = rzProject(p + vec3f(half, 0.0, 0.0));
  let w = abs(side.x - centre.x);

  // Perpendicular to the PROJECTED path, so the strip cannot twist.
  let pa = rzProject(a.xyz).xy;
  let pb = rzProject(b.xyz).xy;
  let dir = normalize(select(vec2f(1.0, 0.0), pb - pa, length(pb - pa) > 1e-6));
  let perp = vec2f(-dir.y, dir.x);
  let uv = centre.xy + perp * c.y * w;

  out.pos = vec4f(uv * 2.0 - 1.0, 0.4, 1.0);
  out.u = uAlong;
  out.v = c.y;
  out.age = age;
  out.slot = slot;
  return out;
}

@fragment fn fs(in: TVOut) -> @location(0) vec4f {
  // Weight is the engine's line integral over the segment — how much path this
  // pixel actually covers. The stand-in path never pauses, so a full
  // contribution is the honest answer here rather than a second simulation.
  let c = trailShade(in.u, in.v, in.age, 1.0, in.slot);
  let a = clamp(c.a, 0.0, 1.0);
  let mapped = c.rgb / (c.rgb + vec3f(1.0));
  return vec4f(mapped * a, a);
}
`

function previewShader(wgsl: string): string {
  return (PREVIEW_WORLD.replace("USER_CODE", hosted(wgsl)) + FIELD_TAIL)
    .replace("BACKGROUND_CALL", definesBackground(wgsl) ? BACKGROUND_CALL : "")
    .replace("FOREGROUND_CALL", definesForeground(wgsl) ? FOREGROUND_CALL : "")
}

/** A particle effect's own state on ONE card. The pool has to be per canvas —
 *  a particle remembers where it is — while the pipelines are shared by shader
 *  text like every other preview's. */
type ParticleState = {
  pool: GPUBuffer
  compute: GPUBindGroup
  render: GPUBindGroup
  count: number
  frame: number
  additive: boolean
}

type Entry = {
  canvas: HTMLCanvasElement
  ctx: GPUCanvasContext
  wgsl: string
  particles?: ParticleState
}

// Module-level singleton: device, per-code pipeline cache, registered canvases, one shared
const previews = new Map<HTMLCanvasElement, Entry>()
let device: GPUDevice | null = null
let deviceLost = false
let devicePromise: Promise<GPUDevice | null> | null = null
let format: GPUTextureFormat = "bgra8unorm"
let uniformBuffer: GPUBuffer | null = null
let bindGroupLayout: GPUBindGroupLayout | null = null
let bindGroup: GPUBindGroup | null = null
/** The particle stages need the pool alongside the clock, so they take their own
 *  layout: binding 0 the uniform, binding 1 the pool. Storage visibility differs
 *  between the two stages — a read_write buffer is not visible to a vertex
 *  shader at all — so there are two, exactly as the engine has. */
let particleComputeLayout: GPUBindGroupLayout | null = null
let particleRenderLayout: GPUBindGroupLayout | null = null
// Keyed by the shader text, so every edit that ever gets previewed mints a new
// entry — and a render pipeline is GPU memory that nothing else will reclaim
// while this Map holds it. Editing a draft would grow it a pipeline per save, for
// the life of the tab. Capped and evicted oldest-first: Map preserves insertion
// order, so the first key is the least recently added.
// Sized to hold a WHOLE library page, not a handful of it. At 24 a grid showing
// more shaders than that evicted pipelines while they were still on screen, and
// closing the library meant recompiling everything on the way back in — the
// compile is the expensive part, and a retained pipeline costs far less than
// making it twice. The cap still exists so a long session of editing WGSL (a
// new key per keystroke-settled edit) cannot grow without bound.
const PIPELINE_CACHE_MAX = 96
const pipelineCache = new Map<string, GPURenderPipeline | "failed" | "pending">()
/** The particle pair, by shader text — its own map so a field pipeline and a
 *  particle one cannot collide on the same key, and its own eviction for the
 *  reason the cache above has one: editing a draft mints a key per save, and a
 *  pipeline is GPU memory nothing else reclaims while a Map holds it. */
type ParticlePair = { compute: GPUComputePipeline; render: GPURenderPipeline }
const particlePipelines = new Map<string, ParticlePair | "failed" | "pending">()

const trailPipelines = new Map<string, GPURenderPipeline | "failed" | "pending">()

function trailPipelineFor(d: GPUDevice, wgsl: string): GPURenderPipeline | null {
  const cached = trailPipelines.get(wgsl)
  if (cached === "failed" || cached === "pending") return null
  if (cached) {
    trailPipelines.delete(wgsl)
    trailPipelines.set(wgsl, cached)
    return cached
  }
  trailPipelines.set(wgsl, "pending")
  while (trailPipelines.size > PIPELINE_CACHE_MAX) {
    const old = [...trailPipelines.keys()].find((k) => k !== wgsl && trailPipelines.get(k) !== "pending")
    if (old === undefined) break
    trailPipelines.delete(old)
  }
  d.pushErrorScope("validation")
  const shader = d.createShaderModule({ code: TRAIL_RENDER(wgsl) })
  void report(shader, wgsl, "ribbon")
  void d
    .createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout!] }),
      vertex: { module: shader, entryPoint: "vs" },
      fragment: {
        module: shader,
        entryPoint: "fs",
        // Additive: overlapping strands of light sum, which is the rule the
        // engine's ribbons follow inside the scene pass.
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one" },
              alpha: { srcFactor: "one", dstFactor: "one" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    })
    .then(
      (pipeline) => trailPipelines.set(wgsl, pipeline),
      () => trailPipelines.set(wgsl, "failed"),
    )
  void d.popErrorScope().catch(() => {})
  return null
}

function rememberParticlePair(wgsl: string, value: ParticlePair | "failed" | "pending") {
  particlePipelines.set(wgsl, value)
  while (particlePipelines.size > PIPELINE_CACHE_MAX) {
    const evictable = [...particlePipelines.keys()].find(
      (k) => k !== wgsl && particlePipelines.get(k) !== "pending",
    )
    if (evictable === undefined) break
    particlePipelines.delete(evictable)
  }
}

function rememberPipeline(wgsl: string, value: GPURenderPipeline | "failed" | "pending") {
  pipelineCache.set(wgsl, value)
  while (pipelineCache.size > PIPELINE_CACHE_MAX) {
    // Skip past anything still compiling as well as the entry just written:
    // evicting a "pending" marker only means compiling that shader a second
    // time, with the card showing its fallback until the duplicate lands.
    const evictable = [...pipelineCache.keys()].find((k) => k !== wgsl && pipelineCache.get(k) !== "pending")
    if (evictable === undefined) break
    pipelineCache.delete(evictable)
  }
}
/**
 * SAY WHY A CARD IS BLANK.
 *
 * Every failure here was silent: a pipeline that would not compile became a
 * fallback gradient, and a gradient looks exactly like a card that has not
 * finished loading. Three separate causes hid behind that for as long as this
 * component has existed — directives fed to the compiler as source, a third of
 * the accessor surface missing, and a params struct nothing declared. Each was
 * found by reading, which is the slowest way to find any of them.
 *
 * Once per shader per stage, because the frame loop would otherwise say it sixty
 * times a second.
 */
const reported = new Set<string>()
async function report(shader: GPUShaderModule, wgsl: string, stage: string) {
  const key = `${stage}:${wgsl}`
  if (reported.has(key)) return
  const info = await shader.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === "error")
  if (errors.length === 0) return
  reported.add(key)
  // The first line of the author's own source is the only name a card has.
  const title = wgsl.split("\n").find((l) => l.trim().startsWith("//"))?.trim() ?? "effect"
  console.error(
    `[preview] ${stage} shader failed — ${title}`,
    errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`),
  )
}

let rafId = 0
// time, dt, res.x, res.y, count, frame — the widened U the world now declares.
const uniforms = new ArrayBuffer(32)
const uniformFloats = new Float32Array(uniforms)
const uniformUints = new Uint32Array(uniforms)
/** Bytes per particle, as PARTICLE_STRUCT_WGSL lays them out. */
const PARTICLE_STRIDE = 48

async function getDevice(): Promise<GPUDevice | null> {
  if (device) return device
  if (deviceLost) return null
  devicePromise ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) return null
      const d = await adapter.requestDevice()
      format = navigator.gpu.getPreferredCanvasFormat()
      uniformBuffer = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      bindGroupLayout = d.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
      })
      bindGroup = d.createBindGroup({ layout: bindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] })
      particleComputeLayout = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
      })
      particleRenderLayout = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        ],
      })
      void d.lost.then(() => {
        device = null
        deviceLost = true
      })
      device = d
      return d
    } catch {
      return null
    }
  })()
  return devicePromise
}

function pipelineFor(d: GPUDevice, wgsl: string): GPURenderPipeline | null {
  const cached = pipelineCache.get(wgsl)
  if (cached === "failed" || cached === "pending") return null
  if (cached) {
    // Touch it, so what is on screen is never what gets evicted.
    pipelineCache.delete(wgsl)
    pipelineCache.set(wgsl, cached)
    return cached
  }
  rememberPipeline(wgsl, "pending")
  d.pushErrorScope("validation")
  const shader = d.createShaderModule({ code: previewShader(wgsl) })
  void report(shader, wgsl, "field")
  void d
    .createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout!] }),
      vertex: { module: shader, entryPoint: "vs" },
      fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    })
    .then(
      (p) => rememberPipeline(wgsl, p),
      () => rememberPipeline(wgsl, "failed"),
    )
  void d.popErrorScope().catch(() => {})
  return null
}

/**
 * The particle pair for this shader, compiled once and shared by every card
 * showing it. Null while it compiles, and forever if it fails — the same
 * contract pipelineFor has, and the same reason: a card that cannot draw shows
 * the fallback rather than an error nobody asked to read.
 */
function particlePipelinesFor(d: GPUDevice, wgsl: string): ParticlePair | null {
  const cached = particlePipelines.get(wgsl)
  if (cached === "failed" || cached === "pending") return null
  if (cached) {
    particlePipelines.delete(wgsl)
    particlePipelines.set(wgsl, cached)
    return cached
  }
  rememberParticlePair(wgsl, "pending")
  d.pushErrorScope("validation")
  const computeModule = d.createShaderModule({ code: PARTICLE_COMPUTE(wgsl) })
  const renderModule = d.createShaderModule({ code: PARTICLE_RENDER(wgsl) })
  void report(computeModule, wgsl, "particle compute")
  void report(renderModule, wgsl, "particle render")
  const blend: GPUBlendState = additive(wgsl)
    ? { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } }
    : {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      }
  void Promise.all([
    d.createComputePipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [particleComputeLayout!] }),
      compute: { module: computeModule, entryPoint: "main" },
    }),
    d.createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [particleRenderLayout!] }),
      vertex: { module: renderModule, entryPoint: "vs" },
      fragment: { module: renderModule, entryPoint: "fs", targets: [{ format, blend }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
    }),
  ]).then(
    ([compute, render]) => rememberParticlePair(wgsl, { compute, render }),
    () => rememberParticlePair(wgsl, "failed"),
  )
  void d.popErrorScope().catch(() => {})
  return null
}

/** This card's own pool. Per canvas, because a particle remembers where it is. */
function makeParticles(d: GPUDevice, wgsl: string): ParticleState {
  const count = particleCount(wgsl)
  const pool = d.createBuffer({ size: count * PARTICLE_STRIDE, usage: GPUBufferUsage.STORAGE })
  const entries = [
    { binding: 0, resource: { buffer: uniformBuffer! } },
    { binding: 1, resource: { buffer: pool } },
  ]
  return {
    pool,
    compute: d.createBindGroup({ layout: particleComputeLayout!, entries }),
    render: d.createBindGroup({ layout: particleRenderLayout!, entries }),
    count,
    frame: 0,
    additive: additive(wgsl),
  }
}

function frame(now: number) {
  rafId = previews.size > 0 ? requestAnimationFrame(frame) : 0
  const d = device
  if (!d || previews.size === 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  // EVERY canvas gets its own try. One shared loop draws all of them, and an
  // exception anywhere in it — a lost context, a canvas whose configure was
  // refused, a shader module that throws on malformed source — used to abandon
  // the rest of the pass. Map iteration order is stable, so the SAME previews
  // after the bad one were skipped on every subsequent frame too: a grid where
  // some cards are permanently black and nothing says why. That is the bug this
  // catch exists for, and it got worse when the libraries stopped splitting
  // cards across three shelves and started showing thirty at once.
  //
  // A canvas that throws is dropped rather than retried in place. The observer
  // re-registers it when it next scrolls into view, so it gets another chance
  // without holding the others hostage in the meantime.
  const broken: HTMLCanvasElement[] = []
  for (const e of previews.values()) {
    if (!e.canvas.isConnected) continue
    try {
      const r = e.canvas.getBoundingClientRect()
      if (r.width < 1) continue
      const w = Math.max(1, Math.round(r.width * dpr))
      const h = Math.max(1, Math.round(r.height * dpr))
      if (e.canvas.width !== w || e.canvas.height !== h) {
        e.canvas.width = w
        e.canvas.height = h
      }
      const field = definesBackground(e.wgsl) || definesForeground(e.wgsl) ? pipelineFor(d, e.wgsl) : null
      const pair = definesParticles(e.wgsl) ? particlePipelinesFor(d, e.wgsl) : null
      const ribbons = definesTrails(e.wgsl) ? trailPipelineFor(d, e.wgsl) : null
      // Nothing compiled yet, or nothing to draw: leave the fallback gradient
      // rather than clearing the card to black and back every frame.
      if (!field && !pair && !ribbons) continue
      if (pair && !e.particles) e.particles = makeParticles(d, e.wgsl)

      // One uniform buffer shared across canvases: write per pass.
      uniformFloats[0] = now / 1000
      // Fixed, not measured: a card that lost a frame must not advance the
      // simulation by the gap, or a scrolled-past effect returns having
      // teleported. The scene's own clock is the one that matters.
      uniformFloats[1] = 1 / 60
      uniformFloats[2] = w
      uniformFloats[3] = h
      uniformUints[4] = e.particles?.count ?? 0
      uniformUints[5] = e.particles?.frame ?? 0
      d.queue.writeBuffer(uniformBuffer!, 0, uniforms)

      const pass = d.createCommandEncoder()
      if (pair && e.particles) {
        const cp = pass.beginComputePass()
        cp.setPipeline(pair.compute)
        cp.setBindGroup(0, e.particles.compute)
        cp.dispatchWorkgroups(Math.ceil(e.particles.count / 64))
        cp.end()
        e.particles.frame++
      }
      const rp = pass.beginRenderPass({
        colorAttachments: [{ view: e.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      // The field first, then the pool over it — the order the engine draws
      // them, so an effect that is both reads the same way on the card.
      if (field) {
        rp.setPipeline(field)
        rp.setBindGroup(0, bindGroup!)
        rp.draw(3)
      }
      if (ribbons) {
        rp.setPipeline(ribbons)
        rp.setBindGroup(0, bindGroup!)
        // 47 segments per ribbon, one ribbon per trailed anchor.
        rp.draw(6, 47 * Math.max(1, trailSlots(e.wgsl)))
      }
      if (pair && e.particles) {
        rp.setPipeline(pair.render)
        rp.setBindGroup(0, e.particles.render)
        rp.draw(6, e.particles.count)
      }
      rp.end()
      d.queue.submit([pass.finish()])
    } catch {
      broken.push(e.canvas)
    }
  }
  for (const c of broken) unregister(c)
}

function register(canvas: HTMLCanvasElement, wgsl: string) {
  void getDevice().then((d) => {
    if (!d || !canvas.isConnected) return
    try {
      const ctx = canvas.getContext("webgpu")
      if (!ctx) return
      ctx.configure({ device: d, format, alphaMode: "opaque" })
      // Re-registering a card that already held one — the observer fires again
      // on every scroll back into view — must not strand the pool it had.
      unregister(canvas)
      previews.set(canvas, { canvas, ctx, wgsl })
      if (!rafId) rafId = requestAnimationFrame(frame)
    } catch {
      // canvas already configured or context refused — leave the CSS fallback
    }
  })
}

function unregister(canvas: HTMLCanvasElement) {
  // The POOL goes with the entry. It is a GPU buffer per card, and the observer
  // unregisters every card that scrolls out — so leaving it behind leaked one
  // pool per card per scroll, for the life of the tab, with nothing holding a
  // reference that could ever free it.
  previews.get(canvas)?.particles?.pool.destroy()
  previews.delete(canvas)
}

export const EffectPreview = memo(function EffectPreview({ wgsl, className }: { wgsl: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    // ON SCREEN ONLY. Every card here runs its own fragment shader every frame,
    // so a library page draws all of them at once — including the ones scrolled
    // past, which cost exactly as much as the ones being looked at and show
    // nobody anything. Registering on entry also defers the pipeline compile
    // until a card is actually about to be seen, which is what makes opening
    // the library land quickly instead of after every shader in the list.
    //
    // The margin is deliberate: a card starts a frame before its edge appears,
    // so scrolling reveals moving effects rather than black squares filling in.
    if (typeof IntersectionObserver === "undefined") {
      register(canvas, wgsl)
      return () => unregister(canvas)
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) register(canvas, wgsl)
        else unregister(canvas)
      },
      { rootMargin: "200px" },
    )
    io.observe(canvas)
    return () => {
      io.disconnect()
      unregister(canvas)
    }
  }, [wgsl])
  // Fallback gradient shows until (unless) the pipeline lands.
  return <canvas ref={ref} className={cn("h-full w-full bg-gradient-to-br from-zinc-900 to-zinc-800", className)} />
})
