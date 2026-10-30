#particles @PARTICLES@
#blend cutout
#param float COUNT 4 1 16 — how many Pochitas
#param float SIZE 1.0 0.5 2.0 — how big they are
#param float ROAM 1.0 0.3 6.0 — how far from her they wander
#param float BEAT 1.0 0 2 — how high the resting ones bounce on the beat
#param float OUTLINE 1.0 0 3 — how wide their outline is

// Pochita — the real mesh: "Pochita" by ARKON-83, CC-BY-4.0,
// https://sketchfab.com/3d-models/pochita-91023b6e85b4463eacad786496c233a0,
// decimated and rigged by tools/pochita. Each picks a spot near her and walks
// or runs there; at rest it stands about or sits down, looks around, blinks and
// wags, the chain revving up and down, and the resting ones bounce on the beat.
//
// Every triangle is a particle: particleCorner reads the pool as a mesh.
//   0 .. VERTS-1    the vertices: pos, vel the normal, rot the two bones,
//                   stretch how much of the second. Never move.
//   .. ROM-1        the triangles: pos the three vertex slots. Never move.
//   then one block a pet: the pet, its BONES bones, its shadow, a hull slot and
//   a slot for each triangle. The bones are written here in pet space and read
//   by every corner, which reads the pet's place once, after the step.

const VERTS: u32 = @VERTS@u;
const TRIS: u32 = @TRIS@u;
const ROM: u32 = VERTS + TRIS;
const BONES: u32 = 13u;
const SHADOW: u32 = 1u + BONES;
const FIRST_HULL: u32 = SHADOW + 1u;
const FIRST_TRI: u32 = FIRST_HULL + TRIS;
const BLOCK: u32 = FIRST_TRI + TRIS;
const PET_MAX: u32 = 16u;
/** Where each part's triangles start: the white, the pupil, the dark parts,
 *  the blade's plate, its teeth. */
const TRI_WHITE: u32 = @TRI_WHITE@u;
const TRI_PUPIL: u32 = @TRI_PUPIL@u;
const TRI_DARK: u32 = @TRI_DARK@u;
const TRI_BLADE: u32 = @TRI_BLADE@u;
const TRI_TEETH: u32 = @TRI_TEETH@u;
const SUN_TURN: f32 = 40.0;
const SUN_HIGH: f32 = 0.55;
/** The app's music analysis runs at 60 frames a second (lib/audio-analysis.ts). */
const AUDIO_SPF: f32 = 1.0 / 60.0;
const TAU: f32 = 6.2831853;

const HIPS: i32 = 0;
const TORSO: i32 = 1;
const HEAD: i32 = 2;
const FL: i32 = 3;
const FR: i32 = 4;
const HL: i32 = 5;
const HR: i32 = 6;
const TAIL: i32 = 7;
const WIRE: i32 = 8;
const EYE_L: i32 = 9;
const EYE_R: i32 = 10;
const BLADE: i32 = 11;
const CHAIN: i32 = 12;

const JOINT = array<vec3f, 13>(
@JOINTS@
);
/** Where each foot rests along the pet, front and hind, in the sculpt. */
const FOOT_FRONT: f32 = @FOOT_FRONT@;
const FOOT_HIND: f32 = @FOOT_HIND@;
/** The floor under the pet, a hair above the ground it stands on. */
const FLOOR: f32 = 0.015;
/** The outline, by the rules of the engine's hull (shaders/passes/outline.ts).
 *  Its width at the rim and its minimum, in pixels at 1080p. */
const HULL_PX: f32 = 1.5;
const HULL_MIN_PX: f32 = 1.5;
/** Half the frame height, world units, past which the line thins as a line of
 *  world width: a full figure, as the engine's RZ_OUTLINE_FULL_FIGURE. */
const HULL_FULL_FIGURE: f32 = 12.5;

/** The saw's rim as (y, z), even steps, counter-clockwise. The base runs
 *  through the head, where the teeth pass out of sight. */
const CHAIN_COUNT: u32 = @CHAIN_COUNT@u;
const CHAIN_PATH = array<vec2f, @CHAIN_COUNT@>(
@CHAIN_DATA@
);

/** Two words a vertex: x y z in 11, 11 and 10 bits; the normal's octahedron in
 *  8 and 8, the two bones in 4 and 4, the second's weight in 8. */
const MESH_VERTS = array<u32, @VERT_WORDS@>(
@VERT_DATA@
);
/** One word a triangle: three vertices, 10 bits each. */
const MESH_TRIS = array<u32, @TRIS@>(
@TRI_DATA@
);

fn petCount() -> u32 {
  return u32(clamp(round(params.COUNT), 1.0, f32(PET_MAX)));
}

/** World units to one pet unit. Pochita sits about 1.7 pet units tall. */
fn petScale() -> f32 {
  return 1.8 * params.SIZE;
}

fn particleCount() -> u32 {
  return ROM + petCount() * BLOCK;
}

fn petSlot(k: u32) -> u32 {
  return ROM + k * BLOCK;
}

fn petSubject(k: i32) -> i32 {
  return k % max(rzSubjectCount(), 1);
}

fn qax(axis: vec3f, ang: f32) -> vec4f {
  return vec4f(axis * sin(ang * 0.5), cos(ang * 0.5));
}

fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

struct PetGoal {
  spot: vec2f,
  run: f32,
  sit: f32,
}

/** Where pet k is headed, how, and whether it sits on arrival. */
fn petGoal(k: i32) -> PetGoal {
  let sub = rzSubject(petSubject(k));
  let fk = f32(k);
  let period = 7.0 + fract(fk * 0.618) * 6.0;
  let slot = floor((rzTime() + fk * 3.7) / period);
  let h = rzHash13(slot * 1.31 + fk * 17.7);
  let ang = h.x * TAU;
  let rad = (3.0 + h.y * 7.0) * params.ROAM * mix(1.0, params.SIZE, 0.5);
  let w = rzHash13(slot * 2.17 + fk * 5.3);
  var g: PetGoal;
  g.spot = sub.root.xz + vec2f(cos(ang), sin(ang)) * rad;
  g.run = select(0.0, 1.0, w.x > 0.6);
  g.sit = select(0.0, 1.0, w.y > 0.45);
  return g;
}

/** The hop on the beat: 0..1, highest a tenth of a second after each kick. */
fn petBeat() -> f32 {
  if (rzAudioFrames() <= 0) { return 0.0; }
  let lead = fract(rzAudioTime() / AUDIO_SPF) * AUDIO_SPF;
  var b = 0.0;
  for (var i = 0; i < 18; i++) {
    let o = -f32(i) * AUDIO_SPF;
    if (rzAudioOnsetAt(o) > 0.45 && rzAudioOnsetAt(o - AUDIO_SPF) <= 0.45) {
      let age = f32(i) * AUDIO_SPF + lead;
      b = max(b, sin(3.14159265 * clamp(age / 0.3, 0.0, 1.0)));
    }
  }
  return b;
}

// ── The simulation ──
//
// The pet's slot: pos its feet, vel the ground heading times its speed and y the
// stride clock, rot how far it has sat, size how far it has broken into a run,
// stretch the clock of its last step, negative while it stands. The sign is the
// moving flag and the size is the stamp petStride reads.

fn particleInit(i: u32, seed: f32) -> Particle {
  var p: Particle;
  p.seed = f32(i);
  if (i < VERTS) {
    let a = MESH_VERTS[i * 2u];
    let b = MESH_VERTS[i * 2u + 1u];
    p.pos = vec3f(
      mix(-0.8, 0.8, f32(a & 2047u) / 2047.0),
      mix(0.0, 2.2, f32((a >> 11u) & 2047u) / 2047.0),
      mix(-1.35, 1.5, f32(a >> 22u) / 1023.0),
    );
    let o = vec2f(f32(b & 255u), f32((b >> 8u) & 255u)) / 255.0 * 2.0 - 1.0;
    var n = vec3f(o.x, 1.0 - abs(o.x) - abs(o.y), o.y);
    if (n.y < 0.0) {
      n = vec3f((1.0 - abs(n.z)) * select(-1.0, 1.0, n.x >= 0.0), n.y, (1.0 - abs(n.x)) * select(-1.0, 1.0, n.z >= 0.0));
    }
    p.vel = normalize(n);
    p.rot = f32((b >> 16u) & 255u);
    p.stretch = f32(b >> 24u) / 255.0;
    p.life = 1.0e9;
    return p;
  }
  if (i < ROM) {
    let t = MESH_TRIS[i - VERTS];
    p.pos = vec3f(f32(t & 1023u), f32((t >> 10u) & 1023u), f32((t >> 20u) & 1023u));
    p.life = 1.0e9;
    return p;
  }
  let k = (i - ROM) / BLOCK;
  if (rzSubjectCount() == 0 || k >= petCount()) {
    p.life = 0.0;
    return p;
  }
  p.life = 1.0e9;
  if ((i - ROM) % BLOCK == 0u) {
    let g = petGoal(i32(k));
    let a = f32(k) * 2.4;
    p.pos = vec3f(g.spot.x, rzSubject(petSubject(i32(k))).root.y, g.spot.y);
    p.vel = vec3f(cos(a) * 0.001, fract(f32(k) * 0.37), sin(a) * 0.001);
    p.rot = g.sit;
  }
  return p;
}

fn petStep(pIn: Particle, k: i32, dtIn: f32) -> Particle {
  var p = pIn;
  let s = petScale();
  let dt = min(dtIn, 0.05);
  let sub = rzSubject(petSubject(k));
  let g = petGoal(k);
  var to = g.spot - p.pos.xz;
  var dist = length(to);
  if (dist > 60.0 * s) {
    p.pos = vec3f(g.spot.x, p.pos.y, g.spot.y);
    to = vec2f(0.0);
    dist = 0.0;
  }
  // Off once it is well away from the spot; stopped once it is there.
  var moving = p.stretch > 0.0;
  if (!moving && dist > 1.6 * s) { moving = true; }
  if (moving && dist < 0.4 * s) { moving = false; }
  let ease = 1.0 - exp(-dt * 4.0);
  let run = p.size + (select(0.0, g.run, moving) - p.size) * ease;
  let sat = p.rot + (select(g.sit, 0.0, moving) - p.rot) * ease;
  let want = select(0.0, mix(1.1, 3.2, run) * s, moving);
  var head = p.vel.xz;
  var speed = max(length(head), 1e-4);
  head = head / speed;
  // Turn toward the spot, at most four radians a second.
  if (moving && dist > 1e-3) {
    let goal = to / dist;
    let turn = clamp(atan2(head.x * goal.y - head.y * goal.x, dot(head, goal)), -4.0 * dt, 4.0 * dt);
    head = vec2f(head.x * cos(turn) - head.y * sin(turn), head.x * sin(turn) + head.y * cos(turn));
  }
  speed = max(speed + (want - speed) * (1.0 - exp(-dt * 3.0)), 0.001);
  // Round her feet, and round each other, softly.
  var push = vec2f(0.0);
  let toHer = p.pos.xz - sub.root.xz;
  let herR = 2.0 + 0.8 * s;
  let lh = length(toHer);
  if (lh < herR && lh > 1e-4) { push = push + toHer / lh * (herR - lh); }
  for (var j = 0u; j < petCount(); j++) {
    if (i32(j) == k) { continue; }
    let o = particles[petSlot(j)];
    if (o.life <= 0.0) { continue; }
    let d = p.pos.xz - o.pos.xz;
    let l = length(d);
    let r = 1.7 * s;
    if (l < r && l > 1e-4) { push = push + d / l * (r - l) * 0.5; }
  }
  p.pos = vec3f(p.pos.x + head.x * speed * dt + push.x * dt * 4.0, sub.root.y, p.pos.z + head.y * speed * dt + push.y * dt * 4.0);
  // The stride clock: one cycle in the distance a planted foot sweeps.
  let stride = fract(p.vel.y + speed * dt / (petCycle(run) * s));
  p.vel = vec3f(head.x * speed, stride, head.y * speed);
  p.rot = sat;
  p.size = run;
  p.stretch = select(-1.0, 1.0, moving) * max(abs(rzTime()), 1e-3);
  return p;
}

/** Pet units travelled in one stride: two sweeps of a foot over its duty. */
fn petCycle(run: f32) -> f32 {
  return mix(0.64, 1.4, run);
}

/** The stride as it stood before this step, whether the pet's own slot has been
 *  stepped yet or not: the bones run beside it, and legs read from two different
 *  frames would shake. */
fn petStride(pet: Particle) -> f32 {
  if (abs(pet.stretch) != max(abs(rzTime()), 1e-3)) { return pet.vel.y; }
  let last = length(pet.vel.xz) * min(rzDt(), 0.05) / (petCycle(pet.size) * petScale());
  return fract(pet.vel.y - last + 1.0);
}

struct Bone {
  q: vec4f,
  at: vec3f,
  reach: f32,
}

fn boneChild(par: Bone, b: i32, parent: i32, local: vec4f) -> Bone {
  var c: Bone;
  c.q = qmul(par.q, local);
  c.at = par.at + qrot(par.q, JOINT[b] - JOINT[parent]);
  c.reach = 1.0;
  return c;
}

/** A leg: a foot planted through its stance and carried forward through its
 *  swing, the leg reaching from its joint to wherever the foot is. */
fn boneLeg(par: Bone, b: i32, parent: i32, rest: f32, u: f32, sweep: f32, rise: f32, hop: f32) -> Bone {
  var c = boneChild(par, b, parent, vec4f(0.0, 0.0, 0.0, 1.0));
  let duty = 0.5 - 0.1 * clamp((sweep - 0.16) / 0.12, 0.0, 1.0);
  var dz = sweep * (1.0 - 2.0 * u / duty);
  var fy = 0.0;
  if (u >= duty) {
    let k = (u - duty) / (1.0 - duty);
    dz = sweep * (2.0 * smoothstep(0.0, 1.0, k) - 1.0);
    fy = rise * sin(3.14159265 * k);
  }
  let hgt = JOINT[b].y;
  let off = rest - JOINT[b].z;
  let dy = c.at.y - fy - hop;
  let dw = rest + dz - c.at.z;
  c.reach = min(sqrt(max(dy * dy + dw * dw - off * off, 0.16 * hgt * hgt)) / hgt, 2.6);
  c.q = qax(vec3f(1.0, 0.0, 0.0), atan2(off, hgt * c.reach) - atan2(dw, dy));
  return c;
}

/** The skeleton in pet space, from the pet's state and the clock. */
fn petBones(pet: Particle, k: i32) -> array<Bone, 13> {
  let X = vec3f(1.0, 0.0, 0.0);
  let Y = vec3f(0.0, 1.0, 0.0);
  let Z = vec3f(0.0, 0.0, 1.0);
  let fk = f32(k);
  let t = rzTime();
  let speed = length(pet.vel.xz) / petScale();
  let gait = smoothstep(0.1, 0.7, speed);
  let run = pet.size * gait;
  let walk = (1.0 - pet.size) * gait;
  let sit = pet.rot;
  let stand = 1.0 - sit;
  let still = 1.0 - gait;
  let ph = petStride(pet);
  let ang = TAU * ph;

  // At rest, an act every five seconds, easing in and out.
  let slot = floor((t + fk * 1.9) / 5.0);
  let at = t + fk * 1.9 - slot * 5.0;
  let env = smoothstep(0.0, 0.6, at) * (1.0 - smoothstep(4.3, 5.0, at)) * still;
  let act = rzHash21(vec2f(slot, fk + 7.0));
  let look = select(0.0, env * sin(at * 1.4 + fk) * 0.7, act < 0.55);
  let nod = select(0.0, env * sin(t * 7.0 + fk) * 0.1, act >= 0.55 && act < 0.8);
  let beat = petBeat() * params.BEAT * still * 0.16;
  let bl = fract(t * 0.29 + fk * 0.37);
  let blink = 1.0 - smoothstep(0.0, 0.015, abs(bl - 0.5) - 0.012);

  // Rising from the sculpted sit: the rump lifts and the body tips forward.
  let pitch = stand * 0.42 + run * (0.1 + 0.16 * sin(ang + 0.6)) + 0.02 * sin(t * 2.2 + fk) * still;
  let lift = stand * 0.2 + beat + walk * 0.025 * abs(sin(ang)) + run * 0.08 * max(sin(ang + 0.6), 0.0);
  let roll = walk * 0.03 * sin(ang);

  var b: array<Bone, 13>;
  b[HIPS].q = qmul(qax(X, pitch), qax(Z, roll));
  b[HIPS].at = JOINT[HIPS] + vec3f(0.0, lift, 0.0);
  b[HIPS].reach = 1.0;
  b[TORSO] = boneChild(b[HIPS], TORSO, HIPS, qax(X, -pitch * 0.35));
  b[HEAD] = boneChild(b[TORSO], HEAD, TORSO, qmul(qmul(qax(Y, look), qax(X, -pitch * 0.5 + nod)), qax(Z, -roll * 0.6)));

  // Walking the diagonals together; running the front pair, then the hind.
  let sweep = walk * 0.16 + run * 0.28;
  let rise = walk * 0.09 + run * 0.17;
  b[FL] = boneLeg(b[TORSO], FL, TORSO, FOOT_FRONT, ph, sweep, rise, beat);
  b[FR] = boneLeg(b[TORSO], FR, TORSO, FOOT_FRONT, fract(ph + mix(0.5, 0.08, run)), sweep, rise, beat);
  b[HL] = boneLeg(b[HIPS], HL, HIPS, FOOT_HIND, fract(ph + 0.5), sweep, rise, beat);
  b[HR] = boneLeg(b[HIPS], HR, HIPS, FOOT_HIND, fract(ph + mix(0.0, 0.58, run)), sweep, rise, beat);

  // The tail wags at rest and streams behind at a run.
  let wag = (1.0 - run) * sin(t * 8.0 + fk) * (0.25 + 0.15 * sit);
  let up = stand * 0.1 + run * 0.1;
  b[TAIL] = boneChild(b[HIPS], TAIL, HIPS, qmul(qax(Y, wag), qax(X, up)));
  b[WIRE] = boneChild(b[TAIL], WIRE, TAIL, qmul(qax(Y, wag * 1.4), qax(X, 0.2 * run)));
  b[EYE_L] = boneChild(b[HEAD], EYE_L, HEAD, vec4f(0.0, 0.0, 0.0, 1.0));
  b[EYE_R] = boneChild(b[HEAD], EYE_R, HEAD, vec4f(0.0, 0.0, 0.0, 1.0));
  b[EYE_L].reach = 1.0 - 0.88 * blink;
  b[EYE_R].reach = b[EYE_L].reach;
  b[BLADE] = boneChild(b[HEAD], BLADE, HEAD, qax(Z, run * 0.03 * sin(t * 60.0)));
  b[CHAIN] = boneChild(b[BLADE], CHAIN, BLADE, vec4f(0.0, 0.0, 0.0, 1.0));
  return b;
}

fn particleStep(pIn: Particle, dt: f32) -> Particle {
  var p = pIn;
  let i = u32(p.seed);
  if (i < ROM) { return p; }
  let k = (i - ROM) / BLOCK;
  if (rzSubjectCount() == 0 || k >= petCount()) {
    p.life = 0.0;
    return p;
  }
  let j = (i - ROM) % BLOCK;
  if (j == 0u) { return petStep(p, i32(k), dt); }
  if (j >= FIRST_TRI) { return p; }
  let pet = particles[petSlot(k)];
  let s = petScale();
  if (j == SHADOW) {
    p.pos = pet.pos + vec3f(0.0, 0.03, 0.0);
    p.vel = pet.vel;
    p.size = 1.05 * s;
    return p;
  }
  // A bone, in pet space: rotation in vel and rot, the joint in pos, the scale
  // in size, the leg's reach in stretch; the chain's stretch is how far it has
  // run, idling at rest and racing at a run.
  let bone = j - 1u;
  let posed = petBones(pet, i32(k));
  let b = posed[bone];
  p.pos = b.at;
  p.vel = b.q.xyz;
  p.rot = b.q.w;
  p.size = s;
  if (bone == u32(CHAIN)) {
    // The throttle opens and closes every few seconds, each pet in its own
    // time; a run holds it open. A clock of its own, so the speed never jumps.
    let rev = 0.5 + 0.3 * sin(rzTime() * 0.9 + f32(k) * 2.1) + 0.2 * sin(rzTime() * 2.3 + f32(k) * 4.7);
    let throttle = max(smoothstep(0.3, 0.7, rev), pet.size);
    p.stretch = fract(p.stretch + min(dt, 0.05) * mix(0.2, 0.7, throttle));
  } else {
    p.stretch = b.reach;
  }
  return p;
}

// ── The mesh ──

struct Skinned {
  pos: vec3f,
  n: vec3f,
}

fn boneMove(bone: Particle, b: u32, v: vec3f) -> vec3f {
  let o = (v - JOINT[b]) * vec3f(1.0, bone.stretch, 1.0);
  return bone.pos + qrot(vec4f(bone.vel, bone.rot), o);
}

/** A tooth's corner on the rim: pos.y is how far round, pos.z how far out. */
fn chainMove(bone: Particle, v: vec3f) -> vec3f {
  let f = fract(v.y + bone.stretch) * f32(CHAIN_COUNT);
  let i = u32(f) % CHAIN_COUNT;
  let a = CHAIN_PATH[i];
  let b = CHAIN_PATH[(i + 1u) % CHAIN_COUNT];
  let d = normalize(b - a);
  let on = mix(a, b, fract(f)) + vec2f(d.y, -d.x) * v.z;
  return bone.pos + qrot(vec4f(bone.vel, bone.rot), vec3f(v.x, on.x, on.y) - JOINT[CHAIN]);
}

fn petSkin(vi: u32, k: u32) -> Skinned {
  let v = particles[vi];
  let pack = u32(v.rot);
  let a = pack & 15u;
  let b = pack >> 4u;
  let first = petSlot(k) + 1u;
  let ba = particles[first + a];
  let bb = particles[first + b];
  var out: Skinned;
  // Its bones are written on the frame after the slot is born.
  if (ba.size <= 0.0 || bb.size <= 0.0) { return out; }
  let pet = particles[petSlot(k)];
  let h = normalize(pet.vel.xz + vec2f(1e-5, 0.0));
  let turn = qax(vec3f(0.0, 1.0, 0.0), atan2(h.x, h.y));
  var at: vec3f;
  if (a == u32(CHAIN)) {
    at = chainMove(ba, v.pos);
  } else {
    at = mix(boneMove(ba, a, v.pos), boneMove(bb, b, v.pos), v.stretch);
  }
  // A toe tipped below the floor flattens on it, as a foot does.
  at.y = max(at.y, FLOOR);
  out.pos = pet.pos + qrot(turn, at) * ba.size;
  out.n = qrot(turn, normalize(mix(qrot(vec4f(ba.vel, ba.rot), v.vel), qrot(vec4f(bb.vel, bb.rot), v.vel), v.stretch)));
  return out;
}

/** The eyes have no outline: a model leaves them out by material, and here the
 *  body inside the sockets, which are concave, goes with them. */
fn hullSkips(vi: u32) -> bool {
  let v = particles[vi];
  return min(distance(v.pos, JOINT[EYE_L]), distance(v.pos, JOINT[EYE_R])) < 0.2;
}

/** World units per the frame's height, here: uv per unit along the camera's up. */
fn hullPerUnit(at: vec3f) -> f32 {
  return max(abs(rzProject(at + rzCameraUp()).y - rzProject(at).y), 1e-5);
}

/** The line's width here before its minimum, in pixels at 1080p: the view
 *  normal's length across the screen, not renormalized, so full at the rim and
 *  finer on what faces the camera; thinning past a full figure. */
fn hullPx(s: Skinned) -> f32 {
  let across = length(vec2f(dot(s.n, rzCameraRight()), dot(s.n, rzCameraUp())));
  return HULL_PX * params.OUTLINE * across * min(1.0, 2.0 * HULL_FULL_FIGURE * hullPerUnit(s.pos));
}

/** A skinned vertex on the hull: pushed across the screen by the view normal,
 *  at its own depth, a hair behind (the engine's depth bias). */
fn hullPoint(s: Skinned) -> vec3f {
  let right = rzCameraRight();
  let up = rzCameraUp();
  let dir = right * dot(s.n, right) + up * dot(s.n, up);
  let px = max(hullPx(s), HULL_MIN_PX * min(params.OUTLINE, 1.0));
  let world = px / (1080.0 * hullPerUnit(s.pos));
  return s.pos + dir / max(length(dir), 1e-4) * world + normalize(s.pos - rzCameraPos()) * 0.002 * petScale();
}

fn hullHasTri(t: u32) -> bool {
  return params.OUTLINE > 0.0 && t < TRI_TEETH && (t < TRI_WHITE || t >= TRI_DARK);
}

fn particleCorner(p: Particle, id: u32, corner: u32) -> vec3f {
  if (id < ROM) { return vec3f(0.0); }
  let j = (id - ROM) % BLOCK;
  if (j == SHADOW) {
    // Flat on the floor, long along the pet.
    let h = normalize(p.vel.xz + vec2f(1e-5, 0.0));
    let cx = f32(corner & 1u) * 2.0 - 1.0;
    let cy = f32(corner >> 1u) * 2.0 - 1.0;
    return p.pos + (vec3f(h.y, 0.0, -h.x) * cx * 0.85 + vec3f(h.x, 0.0, h.y) * cy * 1.15) * p.size;
  }
  if (j < FIRST_HULL) { return vec3f(0.0); }
  let k = (id - ROM) / BLOCK;
  if (j < FIRST_TRI) {
    // The hull: drawn first, so an effect card, which has no depth, paints the
    // pet over it.
    let t = j - FIRST_HULL;
    if (!hullHasTri(t)) { return vec3f(0.0); }
    let tri = particles[VERTS + t];
    if (t < TRI_WHITE && (hullSkips(u32(tri.pos.x)) || hullSkips(u32(tri.pos.y)) || hullSkips(u32(tri.pos.z)))) { return vec3f(0.0); }
    return hullPoint(petSkin(u32(tri.pos[min(corner, 2u)]), k));
  }
  let tri = particles[VERTS + j - FIRST_TRI];
  return petSkin(u32(tri.pos[min(corner, 2u)]), k).pos;
}

fn petColour(t: u32) -> vec3f {
  if (t >= TRI_TEETH) { return vec3f(0.3); }
  if (t >= TRI_BLADE) { return vec3f(0.087); }
  if (t >= TRI_DARK) { return vec3f(0.012); }
  if (t >= TRI_PUPIL) { return vec3f(0.0); }
  if (t >= TRI_WHITE) { return vec3f(0.8); }
  return vec3f(0.8, 0.158, 0.033);
}

fn particleShade(p: Particle, uv: vec2f) -> vec4f {
  let i = u32(p.seed);
  let j = (i - ROM) % BLOCK;
  if (j == SHADOW) {
    let r = length(uv * 2.0 - 1.0);
    return vec4f(0.0, 0.0, 0.0, 0.42 * (1.0 - smoothstep(0.45, 1.0, r)));
  }
  let k = (i - ROM) / BLOCK;
  let hull = j < FIRST_TRI;
  let t = select(j - FIRST_TRI, j - FIRST_HULL, hull);
  let tri = particles[VERTS + t];
  let a = petSkin(u32(tri.pos.x), k);
  let b = petSkin(u32(tri.pos.y), k);
  let c = petSkin(u32(tri.pos.z), k);
  let w = vec3f(1.0 - uv.x - uv.y, uv.x, uv.y);
  let pos = a.pos * w.x + b.pos * w.y + c.pos * w.z;
  let view = normalize(rzCameraPos() - pos);
  if (hull) {
    // Only the back faces of the pushed hull show. The engine culls them; this
    // mesh's winding cannot be trusted, so the smooth normals say which way is out.
    let pa = hullPoint(a);
    let face = cross(hullPoint(b) - pa, hullPoint(c) - pa);
    if (dot(face, view) * dot(face, a.n + b.n + c.n) > 0.0) { return vec4f(0.0); }
    // Thinner than the minimum, it is held there and faded by the shortfall.
    var mid: Skinned;
    mid.pos = pos;
    mid.n = a.n * w.x + b.n * w.y + c.n * w.z;
    let cover = min(hullPx(mid) / (HULL_MIN_PX * min(params.OUTLINE, 1.0)), 1.0);
    return vec4f(0.012, 0.006, 0.005, cover);
  }
  var n: vec3f;
  if (t >= TRI_DARK) {
    n = normalize(cross(b.pos - a.pos, c.pos - a.pos));
  } else {
    n = normalize(a.n * w.x + b.n * w.y + c.n * w.z);
  }
  // The mesh is double-sided: every face is lit from the side it is seen on.
  n = n * select(-1.0, 1.0, dot(n, view) >= 0.0);
  let base = petColour(t);
  // The sun as the Chicks have it, dimmed by the scene's shadow and tinted by
  // its ambient; the eyes and the metal catch a highlight.
  let sa = radians(SUN_TURN);
  let sr = sqrt(max(0.0, 1.0 - SUN_HIGH * SUN_HIGH));
  let sun = normalize(vec3f(cos(sa) * sr, SUN_HIGH, sin(sa) * sr));
  let sunlit = rzShadow(pos + n * 0.05);
  let amb = rzWorldAmbient(n);
  let lam = clamp(dot(n, sun), 0.0, 1.0);
  let shade = 0.62 + 0.42 * lam * mix(0.4, 1.0, sunlit) + 0.08 * clamp(n.y, 0.0, 1.0);
  var col = base * shade + base * amb * 0.25;
  if (t >= TRI_WHITE) {
    let h = normalize(sun + view);
    col = col + vec3f(0.5 * pow(max(dot(n, h), 0.0), 48.0) * mix(0.4, 1.0, sunlit));
  }
  return vec4f(col, 1.0);
}
