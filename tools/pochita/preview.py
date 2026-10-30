# A contact sheet of the poses: python3 tools/pochita/preview.py tools/pochita/mesh.json design/pochita/poses.png
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, "tools/pochita")
from rig import *

BASE = np.array([(0.8, 0.158, 0.033), (0.8, 0.8, 0.8), (0.0, 0.0, 0.0), (0.03, 0.03, 0.03), (0.087, 0.087, 0.087), (0.3, 0.3, 0.3), (0.012, 0.006, 0.005)])


FLOOR = 0.015
FLOORED = False


def draw(v, n, t, kinds, az, el, S=300, hull=None, ring=None):
    a, e = np.radians(az), np.radians(el)
    f = np.array((np.sin(a) * np.cos(e), np.sin(e), np.cos(a) * np.cos(e)))
    r = np.cross((0, 1, 0), f)
    r /= np.linalg.norm(r)
    u = np.cross(f, r)
    c = np.array((0, 0.95, 0))
    k = S / 3.6
    px = np.stack(((v - c) @ r * k + S / 2, S / 2 - (v - c) @ u * k), 1)
    dz = (v - c) @ f
    z = np.full((S, S), -1e9)
    im = np.full((S, S, 3), 0.86)
    sun = np.array((0.47, 0.75, 0.47))
    # The hull: the back of the mesh pushed out along its normals, 2px wide.
    jobs = [(tri, kind, False) for tri, kind in zip(t, kinds)]
    if hull:
        # The engine's rules: the view normal not renormalized, held at the
        # minimum, faded below it.
        side = n - np.outer(n @ f, f)
        wide = np.linalg.norm(side, axis=1) * hull
        hv = v + side * (np.maximum(wide, hull) / np.maximum(wide, 1e-4) * hull / k)[:, None]
        cover = np.minimum(wide / hull, 1.0)
        hpx = np.stack(((hv - c) @ r * k + S / 2, S / 2 - (hv - c) @ u * k), 1)
        hdz = (hv - c) @ f
        jobs += [(tri, kind, True) for tri, kind in zip(t, kinds) if kind not in (1, 2, 5) and not ring[tri].any()]
    for tri, kind, back in jobs:
        if back:
            fn = np.cross(hv[tri[1]] - hv[tri[0]], hv[tri[2]] - hv[tri[0]])
            if (fn @ f) * (fn @ n[tri].sum(0)) > 0:
                continue
        P = (hpx if back else px)[tri]
        depth = hdz if back else dz
        lo = np.floor(P.min(0)).astype(int).clip(0, S - 1)
        hi = np.ceil(P.max(0)).astype(int).clip(0, S - 1)
        d = (P[1, 0] - P[0, 0]) * (P[2, 1] - P[0, 1]) - (P[2, 0] - P[0, 0]) * (P[1, 1] - P[0, 1])
        if abs(d) < 1e-9:
            continue
        X_, Y_ = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1))
        w1 = ((X_ - P[0, 0]) * (P[2, 1] - P[0, 1]) - (P[2, 0] - P[0, 0]) * (Y_ - P[0, 1])) / d
        w2 = ((P[1, 0] - P[0, 0]) * (Y_ - P[0, 1]) - (X_ - P[0, 0]) * (P[1, 1] - P[0, 1])) / d
        w0 = 1 - w1 - w2
        m = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not m.any():
            continue
        zz = w0 * depth[tri[0]] + w1 * depth[tri[1]] + w2 * depth[tri[2]]
        if back:
            m = m & ((w0 * cover[tri[0]] + w1 * cover[tri[1]] + w2 * cover[tri[2]]) > 0.5)
            if not m.any():
                continue
            col = np.broadcast_to(BASE[6] ** (1 / 2.2), (*zz.shape, 3))
        elif kind <= 2:
            nn = w0[..., None] * n[tri[0]] + w1[..., None] * n[tri[1]] + w2[..., None] * n[tri[2]]
            nn /= np.maximum(np.linalg.norm(nn, axis=-1, keepdims=True), 1e-6)
        else:
            fn = np.cross(v[tri[1]] - v[tri[0]], v[tri[2]] - v[tri[0]])
            fn /= max(np.linalg.norm(fn), 1e-9)
            nn = np.broadcast_to(fn, (*zz.shape, 3))
        if not back:
            lam = np.clip(np.abs(nn @ sun) if kind > 2 else nn @ sun, 0, 1)
            col = BASE[kind] * (0.62 + 0.5 * lam)[..., None]
            col = col ** (1 / 2.2)
        ys, xs = np.nonzero(m)
        for yy, xx in zip(ys, xs):
            gx, gy = X_[yy, xx], Y_[yy, xx]
            if zz[yy, xx] > z[gy, gx]:
                z[gy, gx] = zz[yy, xx]
                im[gy, gx] = col[yy, xx]
    return im


def posed(v, n, J, a, b, w, chain, clock=0.0, **kw):
    bones = pose(J, **kw)
    out = skin(v, J, a, b, w, bones, chain, clock)
    out[:, 1] = np.maximum(out[:, 1], FLOOR) if FLOORED else out[:, 1]
    qs = np.array(bones[0])
    nb = n.copy()
    for i in range(BONE_COUNT):
        m = a == i
        if m.any():
            c = qs[i]
            nb[m] = n[m] + 2 * np.cross(c[:3], np.cross(c[:3], n[m]) + c[3] * n[m])
    return out, nb


if __name__ == "__main__":
    v, n, t, kinds, names, chain = load(sys.argv[1])
    J = joints(v, names)
    a, b, w = weights(v, names)
    print("verts", len(v), "tris", len(t))
    # Feet: the planted one must hold still on the floor as the body passes.
    for leg, name in ((FL, "FL"), (HL, "HL")):
        i = np.argmin(np.linalg.norm(v[:, [0, 2]] - np.array((J[leg][0], FOOT_Z[leg])), axis=1) + 10 * v[:, 1] * (names == "body") + 100 * (names != "body"))
        for label, kw, cycle in (("walk", dict(walk=1, run=0), 0.64), ("run", dict(walk=0, run=1), 1.4)):
            duty = 0.5 - 0.1 * kw["run"]
            ph = np.linspace(0, 1, 40, endpoint=False)
            poses = [posed(v, n, J, a, b, w, chain, sit=0, ph=x, **kw)[0] for x in ph]
            at = np.array([q[i] for q in poses])
            print(name, label, "lowest of the whole mesh", round(float(min(q[:, 1].min() for q in poses)), 3))
            world = at[:, 2] + ph * cycle
            off = {FL: 0.0, HL: 0.5}[leg]
            st = ((ph + off) % 1.0) < duty * 0.9
            print(name, label, "stance floor y", at[st, 1].min().round(3), at[st, 1].max().round(3), "world z drift", (world[st].max() - world[st].min()).round(3), "swing peak y", at[:, 1].max().round(3))
    FLOORED = True
    socket = np.minimum(np.linalg.norm(v - J[EYE_L], axis=1), np.linalg.norm(v - J[EYE_R], axis=1)) < 0.2
    ring = (names == "body") & socket

    S = 300
    rows = [
        [dict(sit=1, walk=0, run=0, ph=0), dict(sit=0, walk=0, run=0, ph=0, clock=0.12), dict(sit=0, walk=0, run=0, ph=0, look=0.6, nod=0.1), dict(sit=1, walk=0, run=0, ph=0, blink=1)],
        [dict(sit=0, walk=1, run=0, ph=p) for p in (0.0, 0.25, 0.5, 0.75)],
        [dict(sit=0, walk=0, run=1, ph=p) for p in (0.0, 0.25, 0.5, 0.75)],
    ]
    views = [(50, 12), (90, 6)]
    W = np.ones((S * len(rows) * len(views), S * 4, 3))
    for vi, (az, el) in enumerate(views):
        for r, row in enumerate(rows):
            for c, kw in enumerate(row):
                pv, pn = posed(v, n, J, a, b, w, chain, **kw)
                W[(vi * len(rows) + r) * S : (vi * len(rows) + r + 1) * S, c * S : (c + 1) * S] = draw(pv, pn, t, kinds, az, el, S, hull=1.0, ring=ring)
    Image.fromarray((W.clip(0, 1) * 255).astype("uint8")).save(sys.argv[2])
    if len(sys.argv) > 3:
        # The legs up close through a walk and a run, for the outline.
        S = 420
        kws = [dict(sit=0, walk=1, run=0, ph=p) for p in (0.0, 0.17, 0.33, 0.5, 0.67, 0.83)] + [dict(sit=0, walk=0, run=1, ph=p) for p in (0.0, 0.17, 0.33, 0.5, 0.67, 0.83)]
        W = np.ones((S, S * 6, 3))
        W = np.ones((S * 2, S * 6, 3))
        for i, kw in enumerate(kws):
            pv, pn = posed(v, n, J, a, b, w, chain, **kw)
            W[(i // 6) * S : (i // 6 + 1) * S, (i % 6) * S : (i % 6 + 1) * S] = draw(pv, pn, t, kinds, 60, 8, S, hull=1.0, ring=ring)
        Image.fromarray((W.clip(0, 1) * 255).astype("uint8")).save(sys.argv[3])
