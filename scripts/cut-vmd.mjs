// Cut the first N frames off a VMD, through the engine's own loader and writer.
//
//   node --import ./scripts/register.mjs scripts/cut-vmd.mjs \
//        <in.vmd> <out.vmd> <frames> [all|motion|morphs]
//
// WHY THE ENGINE'S CODE rather than a byte-level splice: a VMD's bone and morph
// blocks are positional, its counts are four separate section headers, and the
// interpolation bytes are transposed per channel in a layout that has bitten
// this project twice. Reading and rewriting through VMDLoader/VMDWriter means
// the file that comes out is the file the engine believes it wrote, and the
// round trip is checked below rather than assumed.
//
// THE POSE AT THE CUT IS KEPT. Every track that was mid-motion at frame N gets a
// key at 0 holding where it was, interpolated between the keys either side —
// otherwise a clip that started three seconds in would open on whatever pose the
// last key BEFORE the cut happened to hold, which is a different dance.
//
// Bezier easing is ignored for that one inserted key: the curve shapes WHEN a
// channel crosses between two poses, not which poses, so a straight
// interpolation is off only by the easing across a single frame boundary.
import { readFileSync, writeFileSync } from "node:fs"
// The package root, not its files: reze-engine's exports map allows one entry
// point, and every name below is on it.
import { VMDLoader, VMDWriter, Quat, Vec3, rawInterpolationToBoneInterpolation } from "reze-engine"

const [inPath, outPath, cutArg, tracksArg] = process.argv.slice(2)
if (!inPath || !outPath || !cutArg) {
  console.error("usage: cut-vmd.mjs <in.vmd> <out.vmd> <frames> [all|motion|morphs]")
  process.exit(1)
}
const CUT = Number(cutArg)
const TRACKS = tracksArg ?? "all"

const buf = readFileSync(inPath)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

/** VMD keyframes -> AnimationClip, exactly as Model.buildClipFromVmdKeyFrames does. */
function buildClip(frames) {
  const boneBy = new Map()
  const morphBy = new Map()
  for (const kf of frames) {
    for (const bf of kf.boneFrames) {
      const list = boneBy.get(bf.boneName) ?? []
      list.push({
        boneName: bf.boneName,
        frame: bf.frame,
        rotation: bf.rotation,
        translation: bf.translation,
        interpolation: rawInterpolationToBoneInterpolation(bf.interpolation),
      })
      boneBy.set(bf.boneName, list)
    }
    for (const mf of kf.morphFrames) {
      const list = morphBy.get(mf.morphName) ?? []
      list.push({ morphName: mf.morphName, frame: mf.frame, weight: mf.weight })
      morphBy.set(mf.morphName, list)
    }
  }
  const boneTracks = new Map()
  for (const [name, list] of boneBy) boneTracks.set(name, list.sort((a, b) => a.frame - b.frame))
  const morphTracks = new Map()
  for (const [name, list] of morphBy) morphTracks.set(name, list.sort((a, b) => a.frame - b.frame))
  let frameCount = 0
  for (const t of boneTracks.values()) frameCount = Math.max(frameCount, t[t.length - 1].frame)
  for (const t of morphTracks.values()) frameCount = Math.max(frameCount, t[t.length - 1].frame)
  return { boneTracks, morphTracks, frameCount }
}

/** Where a track stands at `at`, as a key stamped at frame 0. Null when the
 *  track has nothing to say before the cut — those simply start later. */
function poseAt(keys, at, kind) {
  let before = null
  let after = null
  for (const k of keys) {
    if (k.frame <= at) before = k
    else {
      after = k
      break
    }
  }
  if (!before) return null
  if (before.frame === at) return { ...before, frame: 0 }
  if (!after) return { ...before, frame: 0 }
  const t = (at - before.frame) / (after.frame - before.frame)
  if (kind === "morph") {
    return { morphName: before.morphName, frame: 0, weight: before.weight + (after.weight - before.weight) * t }
  }
  const tr = new Vec3(
    before.translation.x + (after.translation.x - before.translation.x) * t,
    before.translation.y + (after.translation.y - before.translation.y) * t,
    before.translation.z + (after.translation.z - before.translation.z) * t,
  )
  return {
    boneName: before.boneName,
    frame: 0,
    rotation: Quat.slerp(before.rotation, after.rotation, t),
    translation: tr,
    // The interpolation of the key being LEFT is what governs the segment that
    // now starts at 0, so the shape of the move out of this pose is kept.
    interpolation: after.interpolation,
  }
}

function cutTrack(keys, kind) {
  const kept = keys.filter((k) => k.frame >= CUT).map((k) => ({ ...k, frame: k.frame - CUT }))
  if (kept.length > 0 && kept[0].frame === 0) return kept
  const seed = poseAt(keys, CUT, kind)
  return seed ? [seed, ...kept] : kept
}

const clip = buildClip(VMDLoader.loadFromBuffer(ab))
const before = { bones: clip.boneTracks.size, morphs: clip.morphTracks.size, frames: clip.frameCount }

const cut = { boneTracks: new Map(), morphTracks: new Map(), frameCount: Math.max(0, clip.frameCount - CUT) }
for (const [name, keys] of clip.boneTracks) {
  const t = cutTrack(keys, "bone")
  if (t.length) cut.boneTracks.set(name, t)
}
for (const [name, keys] of clip.morphTracks) {
  const t = cutTrack(keys, "morph")
  if (t.length) cut.morphTracks.set(name, t)
}

const out = new VMDWriter().write(cut, { tracks: TRACKS })
writeFileSync(outPath, Buffer.from(out))

// Read the file we just wrote back through the loader — the only check that
// says the bytes are a VMD rather than merely bytes.
const back = buildClip(VMDLoader.loadFromBuffer(out))
const keyCount = (c) =>
  [...c.boneTracks.values()].reduce((n, t) => n + t.length, 0) + [...c.morphTracks.values()].reduce((n, t) => n + t.length, 0)
console.log(`${inPath}  ->  ${outPath}   (tracks: ${TRACKS}, cut ${CUT} frames = ${(CUT / 30).toFixed(2)}s)`)
console.log(`  in : ${before.bones} bones, ${before.morphs} morphs, ${before.frames} frames, ${keyCount(clip)} keys`)
console.log(`  out: ${cut.boneTracks.size} bones, ${cut.morphTracks.size} morphs, ${cut.frameCount} frames, ${keyCount(cut)} keys`)
console.log(`  round-trip: ${back.boneTracks.size} bones, ${back.morphTracks.size} morphs, ${back.frameCount} frames, ${keyCount(back)} keys`)
if (back.frameCount !== cut.frameCount || keyCount(back) !== keyCount(cut)) {
  console.error("  MISMATCH — what was written is not what reads back")
  process.exit(1)
}
