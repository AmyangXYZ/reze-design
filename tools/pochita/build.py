# Packs the decimated mesh and the rig into the effect:
#   python3 tools/pochita/build.py tools/pochita/mesh.json design/pochita/pochita.wgsl
import sys
import numpy as np
sys.path.insert(0, "tools/pochita")
from rig import *

src, out = sys.argv[1:3]
v, n, t, kinds, names, chain = load(src)
J = joints(v, names)
a, b, w = weights(v, names)
assert len(v) < 1024

def bits(x, lo, hi, n):
    return np.clip(np.round((x - lo) / (hi - lo) * n), 0, n).astype(np.uint64)

def octa(n):
    u = n / np.abs(n).sum(1, keepdims=True)
    o = np.stack((u[:, 0], u[:, 2]), 1)
    low = u[:, 1] < 0
    s = np.where(o >= 0, 1.0, -1.0)
    o[low] = ((1 - np.abs(o[:, ::-1])) * s)[low]
    return o

A = bits(v[:, 0], -0.8, 0.8, 2047) | bits(v[:, 1], 0, 2.2, 2047) << np.uint64(11) | bits(v[:, 2], -1.35, 1.5, 1023) << np.uint64(22)
o = octa(n)
B = (
    bits(o[:, 0], -1, 1, 255)
    | bits(o[:, 1], -1, 1, 255) << np.uint64(8)
    | (a.astype(np.uint64) | b.astype(np.uint64) << np.uint64(4)) << np.uint64(16)
    | bits(w, 0, 1, 255) << np.uint64(24)
)
T = t[:, 0].astype(np.uint64) | t[:, 1].astype(np.uint64) << np.uint64(10) | t[:, 2].astype(np.uint64) << np.uint64(20)

def words(xs):
    xs = [f"0x{int(x):x}u" for x in xs]
    return "\n".join("  " + ", ".join(xs[i : i + 10]) + "," for i in range(0, len(xs), 10))

first = [int(np.argmax(kinds == k)) for k in range(6)]
verts = len(v)
tris = len(t)
block = 2 + BONE_COUNT + 2 * tris
sub = {
    "VERTS": verts,
    "TRIS": tris,
    "PARTICLES": verts + tris + 16 * block,
    "TRI_WHITE": first[1],
    "TRI_PUPIL": first[2],
    "TRI_DARK": first[3],
    "TRI_BLADE": first[4],
    "TRI_TEETH": first[5],
    "CHAIN_COUNT": len(chain),
    "CHAIN_DATA": "\n".join(f"  vec2f({y:.4f}, {z:.4f})," for y, z in chain),
    "JOINTS": "\n".join(f"  vec3f({x:.4f}, {y:.4f}, {z:.4f})," for x, y, z in J),
    "FOOT_FRONT": FOOT_Z[FL],
    "FOOT_HIND": FOOT_Z[HL],
    "VERT_WORDS": verts * 2,
    "VERT_DATA": words(np.stack((A, B), 1).ravel()),
    "TRI_DATA": words(T),
}
s = open("tools/pochita/pochita.template.wgsl").read()
for k, val in sub.items():
    s = s.replace(f"@{k}@", str(val))
assert "@" not in s.replace("@bloom", "")
open(out, "w").write(s)
print(out, len(s), "bytes", sub["PARTICLES"], "particles", "tri starts", first)
