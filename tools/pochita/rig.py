# The skeleton, the weights and the pose, shared by the preview and the build.
import json
import numpy as np

HIPS, TORSO, HEAD, FL, FR, HL, HR, TAIL, WIRE, EYE_L, EYE_R, BLADE, CHAIN = range(13)
PARENT = [-1, HIPS, TORSO, TORSO, TORSO, HIPS, HIPS, HIPS, TAIL, HEAD, HEAD, HEAD, BLADE]
BONE_COUNT = 13
# Where each foot rests in the sculpt, (z), under its joint.
FOOT_Z = {FL: 0.5, FR: 0.5, HL: -0.02, HR: -0.02}
TOOTH_SPACING = 0.12
TOOTH_HEIGHT = 0.07
BLADE_HALF = 0.025


def blade_rim(raw, cells=320, tooth=0.075, count=48):
    from scipy import ndimage
    from PIL import Image, ImageDraw

    v = np.array(raw["v"])
    lo = v[:, [1, 2]].min(0) - 0.05
    step = (v[:, [1, 2]].max(0) + 0.05 - lo).max() / cells
    img = Image.new("1", (cells + 1, cells + 1))
    d = ImageDraw.Draw(img)
    for t in raw["t"]:
        d.polygon([tuple((v[i, [1, 2]] - lo) / step) for i in t], fill=1)
    mask = np.array(img)
    r = int(np.ceil(tooth / step))
    yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
    disc = xx * xx + yy * yy <= r * r
    opened = ndimage.binary_opening(mask, structure=disc)
    # The boundary, walked by angle about the middle (the shape is star-like).
    my, mx = np.argwhere(opened).mean(0)
    pts = []
    for a in np.linspace(0, 2 * np.pi, 720, endpoint=False):
        rad = 0.0
        while True:
            x, y = int(mx + rad * np.cos(a)), int(my + rad * np.sin(a))
            if not (0 <= x <= cells and 0 <= y <= cells) or not opened[y, x]:
                break
            rad += 0.5
        pts.append((mx + rad * np.cos(a), my + rad * np.sin(a)))
    pts = np.array(pts) * step + lo  # (y, z), image x is y
    # Even steps along the rim.
    closed = np.vstack((pts, pts[:1]))
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    arc = np.concatenate(((0,), np.cumsum(seg)))
    at = np.linspace(0, arc[-1], count, endpoint=False)
    path = np.stack((np.interp(at, arc, closed[:, 0]), np.interp(at, arc, closed[:, 1])), 1)
    area = 0.5 * np.sum(path[:, 0] * np.roll(path[:, 1], -1) - np.roll(path[:, 0], -1) * path[:, 1])
    if area < 0:
        path = path[::-1]
    return path, float(arc[-1])


def chain_point(path, u, h):
    """Where the chain is at u (0..1), h out from the rim, in (y, z)."""
    m = len(path)
    f = (u % 1.0) * m
    i = np.floor(f).astype(int) % m
    a, b = path[i], path[(i + 1) % m]
    t = b - a
    t = t / np.linalg.norm(t, axis=-1, keepdims=True)
    return a + (b - a) * (f - np.floor(f))[..., None] + np.stack((t[..., 1], -t[..., 0]), -1) * h[..., None]


def make_blade(raw):
    """The plate from the rim, both faces and the edge, and the loose teeth."""
    path, length = blade_rim(raw)
    rim = path[::2]
    n = len(rim)
    mid = rim.mean(0)
    vs, ns, ts = [], [], []
    for side in (1, -1):
        for y, z in rim:
            vs.append([side * BLADE_HALF, y, z])
            o = np.array((y, z)) - mid
            o = o / np.linalg.norm(o)
            d = np.array((side * 0.5, o[0], o[1]))
            ns.append(list(d / np.linalg.norm(d)))
        vs.append([side * BLADE_HALF, mid[0], mid[1]])
        ns.append([float(side), 0.0, 0.0])
    for i in range(n):
        j = (i + 1) % n
        ts.append([i, j, n])
        ts.append([n + 1 + i, n + 1 + j, n + 1 + n])
        ts.append([i, j, n + 1 + j])
        ts.append([i, n + 1 + j, n + 1 + i])
    count = int(round(length / TOOTH_SPACING))
    tv, tt = [], []
    du = 1.0 / count
    for k in range(count):
        u = k * du
        base = len(tv)
        tv += [[0.0, u, 0.0], [0.0, u + du * 0.85, 0.0], [0.0, u + du * 0.8, TOOTH_HEIGHT]]
        tt.append([base, base + 1, base + 2])
    return (
        {"v": vs, "n": ns, "t": ts},
        {"v": tv, "n": [[1.0, 0.0, 0.0]] * len(tv), "t": tt},
        path,
    )


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def load(path):
    """The parts in draw order: body, white, pupil, dark, plate, teeth."""
    raw = json.load(open(path))
    raw["plate"], raw["tooth"], chain = make_blade(raw["blade"])
    order = [("body", 0), ("white", 1), ("pupil", 2), ("handle", 3), ("wire", 3), ("loop", 3), ("plate", 4), ("tooth", 5)]
    vs, ns, ts, kinds, names, base = [], [], [], [], [], 0
    for name, kind in order:
        p = raw[name]
        vs += p["v"]
        ns += p["n"]
        names += [name] * len(p["v"])
        ts += [[i + base for i in t] for t in p["t"]]
        kinds += [kind] * len(p["t"])
        base += len(p["v"])
    return np.array(vs), np.array(ns), np.array(ts), np.array(kinds), np.array(names), chain


def joints(v, names):
    J = np.zeros((13, 3))
    J[HIPS] = (0, 0.42, -0.2)
    J[TORSO] = (0, 0.72, -0.05)
    J[HEAD] = (0, 1.02, 0.12)
    J[FL] = (0.3, 0.42, 0.38)
    J[FR] = (-0.3, 0.42, 0.38)
    J[HL] = (0.5, 0.33, -0.15)
    J[HR] = (-0.5, 0.33, -0.15)
    J[TAIL] = (0, 0.12, -0.55)
    J[WIRE] = (0, 0.05, -0.92)
    w = v[names == "pupil"]
    J[EYE_L] = w[w[:, 0] > 0].mean(0)
    J[EYE_R] = w[w[:, 0] < 0].mean(0)
    J[BLADE] = (0, 1.0, 0.45)
    J[CHAIN] = J[BLADE]
    return J


def weights(v, names):
    """Two bones a vertex: (a, b, how much of b)."""
    n = len(v)
    a, b, w = np.zeros(n, int), np.zeros(n, int), np.zeros(n)
    x, y, z = v.T
    # The spine up the blob: hips, torso, head.
    s1 = smooth(0.6, 0.86, y)
    s2 = smooth(0.92, 1.14, y)
    a[:] = np.where(s2 > 0, TORSO, HIPS)
    b[:] = np.where(s2 > 0, HEAD, TORSO)
    w[:] = np.where(s2 > 0, s2, s1)
    # Legs, each a soft capsule from the joint to the foot, over the spine.
    for bone, ax, ay, az, fx, fz, r in (
        (FL, 0.3, 0.42, 0.38, 0.3, 0.5, 0.2),
        (FR, -0.3, 0.42, 0.38, -0.3, 0.5, 0.2),
        (HL, 0.5, 0.33, -0.15, 0.5, -0.02, 0.3),
        (HR, -0.5, 0.33, -0.15, -0.5, -0.02, 0.3),
    ):
        A, B = np.array((ax, ay, az)), np.array((fx, 0.0, fz))
        d = B - A
        t = np.clip(((v - A) @ d) / (d @ d), 0, 1)
        dist = np.linalg.norm(v - (A + t[:, None] * d), axis=1)
        leg = (1 - smooth(r * 0.7, r * 1.25, dist)) * (1 - smooth(0.36, 0.5, y))
        m = leg > 0
        a[m], b[m], w[m] = HIPS, bone, leg[m]
    # The tail cone grows out of the hips.
    tl = smooth(-0.5, -0.66, z) * (1 - smooth(0.25, 0.45, y))
    m = tl > 0
    a[m], b[m], w[m] = HIPS, TAIL, tl[m]
    # The rigid parts.
    head = np.isin(names, ("handle",))
    a[head], b[head], w[head] = HEAD, HEAD, 0
    tail = np.isin(names, ("wire", "loop"))
    a[tail], b[tail], w[tail] = WIRE, WIRE, 0
    plate = names == "plate"
    a[plate], b[plate], w[plate] = BLADE, BLADE, 0
    tooth = names == "tooth"
    a[tooth], b[tooth], w[tooth] = CHAIN, CHAIN, 0
    a[names == "white"], b[names == "white"], w[names == "white"] = HEAD, HEAD, 0
    eye = names == "pupil"
    a[eye] = b[eye] = np.where(x[eye] > 0, EYE_L, EYE_R)
    w[eye] = 0
    return a, b, w


# ── The pose: the same arithmetic as petBones in the effect ──


def qax(axis, ang):
    h = ang * 0.5
    return np.array((*(np.array(axis, float) * np.sin(h)), np.cos(h)))


def qmul(a, b):
    return np.array((
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ))


def qrot(q, v):
    u = q[:3]
    return v + 2 * np.cross(u, np.cross(u, v) + q[3] * v)


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def pose(J, sit, walk, run, ph, t=0.0, look=0.0, nod=0.0, blink=0.0, hop=0.0):
    """Bones in pet space: (quaternion, joint position, leg stretch)."""
    tau = 2 * np.pi
    move = max(walk, run)
    stand = 1 - sit
    ang = tau * ph
    # Rising from the sculpted sit: the rump lifts and the body tips forward.
    pitch = stand * 0.42 + run * (0.1 + 0.16 * np.sin(ang + 0.6)) + 0.02 * np.sin(t * 2.2) * (1 - move)
    lift = stand * 0.2 + hop + walk * 0.025 * abs(np.sin(ang)) + run * 0.08 * max(np.sin(ang + 0.6), 0)
    roll = walk * 0.03 * np.sin(ang)
    q = [None] * BONE_COUNT
    p = [None] * BONE_COUNT
    s = [1.0] * BONE_COUNT
    q[HIPS] = qmul(qax(X, pitch), qax(Z, roll))
    p[HIPS] = J[HIPS] + np.array((0, lift, 0))

    def child(b, local):
        par = PARENT[b]
        q[b] = qmul(q[par], local)
        p[b] = p[par] + qrot(q[par], J[b] - J[par])

    child(TORSO, qax(X, -pitch * 0.35))
    child(HEAD, qmul(qmul(qax(Y, look), qax(X, -pitch * 0.5 + nod)), qax(Z, -roll * 0.6)))

    # Four feet, each planted on the floor through its stance and carried
    # forward through its swing; the leg reaches from its joint to the foot.
    # Walking the diagonals together; running the front pair, then the hind.
    phases = {FL: 0.0, HR: 0.0, FR: 0.5, HL: 0.5}
    gallop = {FL: 0.0, FR: 0.08, HL: 0.5, HR: 0.58}
    reach = walk * 0.16 + run * 0.28
    rise = walk * 0.09 + run * 0.17
    duty = 0.5 - 0.1 * run
    for leg in (FL, FR, HL, HR):
        u = (ph + phases[leg] * (1 - run) + gallop[leg] * run) % 1.0
        if u < duty:
            dz, fy = reach * (1 - 2 * u / duty), 0.0
        else:
            k = (u - duty) / (1 - duty)
            dz, fy = reach * (2 * float(smooth(0, 1, k)) - 1), rise * np.sin(np.pi * k)
        child(leg, qax(Y, 0))
        hgt = J[leg][1]
        off = FOOT_Z[leg] - J[leg][2]
        dy = p[leg][1] - fy - hop
        dw = FOOT_Z[leg] + dz - p[leg][2]
        r = np.sqrt(max(dy * dy + dw * dw - off * off, (0.4 * hgt) ** 2)) / hgt
        s[leg] = float(min(r, 2.6))
        q[leg] = qax(X, -(np.arctan2(dw, dy) - np.arctan2(off, hgt * s[leg])))

    # The tail wags at rest and streams behind at a run.
    wag = (1 - run) * np.sin(t * 8.0) * (0.25 + 0.15 * sit)
    up = stand * 0.1 + run * 0.1
    child(TAIL, qmul(qax(Y, wag), qax(X, up)))
    child(WIRE, qmul(qax(Y, wag * 1.4), qax(X, 0.2 * run)))
    for e in (EYE_L, EYE_R):
        child(e, qax(Y, 0))
        s[e] = 1 - 0.88 * blink
    child(BLADE, qax(Z, run * 0.03 * np.sin(t * 60.0)))
    child(CHAIN, qax(Y, 0))
    return q, p, s


def skin(v, J, a, b, w, bones, chain=None, clock=0.0):
    q, p, s = bones
    if chain is not None:
        tooth = a == CHAIN
        v = v.copy()
        at = chain_point(chain, v[tooth, 1] + clock, v[tooth, 2])
        v[tooth, 1], v[tooth, 2] = at[:, 0], at[:, 1]

    def one(i, u):
        o = (u - J[i]) * np.array((1, s[i], 1))
        c = q[i]
        return p[i] + o + 2 * np.cross(c[:3], np.cross(c[:3], o) + c[3] * o)

    out = np.zeros_like(v)
    for i in range(BONE_COUNT):
        ma, mb = a == i, b == i
        if ma.any():
            out[ma] += one(i, v[ma]) * (1 - w[ma])[:, None]
        if mb.any():
            out[mb] += one(i, v[mb]) * w[mb][:, None]
    return out
