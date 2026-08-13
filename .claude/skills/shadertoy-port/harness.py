"""Run a GLSL multipass demo in numpy so you can LOOK at it.

There is no headless WebGPU available, but a fragment shader is just arithmetic
over a grid, and numpy does that fine at 512x288. Copy this next to your work,
port each Buffer as one function over whole arrays, and render PNGs.

Everything here is float32 on purpose: GPUs are, and several shader idioms
(large-argument sine hashes especially) only misbehave the way the original
misbehaves when the precision matches.

    from harness import F, bilinear, shift, save_png, glsl_hash11, value_noise_3d

See SKILL.md for the workflow this belongs to.
"""
import numpy as np
from PIL import Image

F = np.float32


# ── sampling ─────────────────────────────────────────────────────────────────

def bilinear(tex, x, y):
    """`texture()` with clamp-to-edge and linear filtering.

    tex is (H, W, C); x/y are in TEXEL coordinates (fragCoord space, so texel
    centres sit at +0.5). Returns (..., C).
    """
    H, W = tex.shape[0], tex.shape[1]
    xf, yf = x - 0.5, y - 0.5
    x0, y0 = np.floor(xf), np.floor(yf)
    tx = (xf - x0).astype(F)[..., None]
    ty = (yf - y0).astype(F)[..., None]
    x0i = np.clip(x0.astype(np.int32), 0, W - 1)
    x1i = np.clip(x0.astype(np.int32) + 1, 0, W - 1)
    y0i = np.clip(y0.astype(np.int32), 0, H - 1)
    y1i = np.clip(y0.astype(np.int32) + 1, 0, H - 1)
    c00, c10 = tex[y0i, x0i], tex[y0i, x1i]
    c01, c11 = tex[y1i, x0i], tex[y1i, x1i]
    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty


def sample_uv(tex, u, v):
    """Same, but u/v are 0..1 across the field — the engine's `rzSim` convention."""
    H, W = tex.shape[0], tex.shape[1]
    return bilinear(tex, np.clip(u, 0, 1) * W, np.clip(v, 0, 1) * H)


def shift(a, dx, dy):
    """`texelFetch(ch, coord + ivec2(dx, dy))` with clamp-to-edge.

    Use this for stencils (divergence, Jacobi, gradients) — NOT np.roll, which
    wraps, and a wrapped fluid quietly advects off one edge and onto the other.
    """
    out = np.roll(a, (-dy, -dx), axis=(0, 1))
    if dx > 0:
        out[:, -dx:] = out[:, -dx - 1:-dx]
    elif dx < 0:
        out[:, :-dx] = out[:, -dx:-dx + 1]
    if dy > 0:
        out[-dy:, :] = out[-dy - 1:-dy, :]
    elif dy < 0:
        out[:-dy, :] = out[-dy:-dy + 1, :]
    return out


# ── the usual shader hashes, ported exactly ──────────────────────────────────

def glsl_hash11(x):
    """`fract(sin(x) * 43758.5453)`. Keep it in float32: its precision collapse
    at large arguments is part of what the original looks like."""
    return np.mod(np.sin(x.astype(F)) * F(43758.5453), 1.0).astype(F)


def hash13_sine_free(px, py, pz):
    """Dave Hoskins' hash13 — what to use in the WGSL port. No sine, so it stays
    random out in world coordinates where a sine hash turns into moiré rings."""
    qx = np.mod(px * F(0.1031), 1.0)
    qy = np.mod(py * F(0.1031), 1.0)
    qz = np.mod(pz * F(0.1031), 1.0)
    d = qx * (qy + F(33.33)) + qy * (qz + F(33.33)) + qz * (qx + F(33.33))
    qx, qy, qz = qx + d, qy + d, qz + d
    return np.mod((qx + qy) * qz, 1.0).astype(F)


def value_noise_3d(px, py, pz, hash3=hash13_sine_free):
    """Trilinear value noise with smoothstep interpolation — the `noise(vec3)`
    almost every demo defines. Swap `hash3` to match the original's."""
    ix, iy, iz = np.floor(px), np.floor(py), np.floor(pz)
    fx, fy, fz = px - ix, py - iy, pz - iz
    ux = fx * fx * (F(3.0) - F(2.0) * fx)
    uy = fy * fy * (F(3.0) - F(2.0) * fy)
    uz = fz * fz * (F(3.0) - F(2.0) * fz)

    def h(dx, dy, dz):
        return hash3(ix + dx, iy + dy, iz + dz)

    def lerp(a, b, t):
        return a + (b - a) * t

    z0 = lerp(lerp(h(0, 0, 0), h(1, 0, 0), ux), lerp(h(0, 1, 0), h(1, 1, 0), ux), uy)
    z1 = lerp(lerp(h(0, 0, 1), h(1, 0, 1), ux), lerp(h(0, 1, 1), h(1, 1, 1), ux), uy)
    return lerp(z0, z1, uz)


def fbm(px, py, pz, octaves, noise=value_noise_3d, scale_time=True):
    """Sum of octaves, CENTRED ON ITS OWN MEAN.

    An fbm of k octaves averages 0.5*(1 - 2**-k), not 0.5. Subtracting a flat 0.5
    (which is what the demos do) biases every sample low by the same amount, and
    a constant added to a velocity field each frame is a wind that the pressure
    solve cannot remove — a uniform flow has no divergence. Returns roughly
    [-0.5, 0.5].

    scale_time mirrors `p = p*2.0 + shift` applying to all three components, so
    each octave drifts at the same rate measured in its own cells. Capped at 8x
    so the argument stays inside float32's useful range over a long take.
    """
    acc = np.zeros_like(px)
    amp, total = F(0.5), F(0.0)
    qx, qy, qz = px.copy(), py.copy(), pz.copy()
    for i in range(octaves):
        acc += noise(qx, qy, qz) * amp
        total += amp
        qx = qx * F(2.0) + F(100.0)
        qy = qy * F(2.0) + F(100.0)
        qz = (qz * F(2.0) if (scale_time and i < 3) else qz) + F(100.0)
        amp *= F(0.5)
    return acc - F(0.5) * total


# ── output ───────────────────────────────────────────────────────────────────

def save_png(arr, path, gamma=None):
    """arr is (H, W) or (H, W, 3) in 0..1. Flipped, because shader y is up.

    gamma=2.0 applies the `sqrt(col)` most demos end on. If the original has it,
    the port needs it too: the effect mounts return display-space sRGB.
    """
    a = np.clip(arr, 0, 1)
    if gamma:
        a = a ** (1.0 / gamma)
    Image.fromarray((a * 255).astype(np.uint8)[::-1]).save(path)


def uv_grid(W, H):
    """fragCoord, and the demos' `uv = (2*fragCoord - res)/res.y` — which spans
    [-aspect, aspect] x [-1, 1]. The `/res.y` is why a demo's look depends on its
    resolution, and why the port has to pin that resolution. See SKILL.md §2."""
    ys, xs = np.mgrid[0:H, 0:W]
    fx = (xs + 0.5).astype(F)
    fy = (ys + 0.5).astype(F)
    return fx, fy, ((2.0 * fx - W) / H).astype(F), ((2.0 * fy - H) / H).astype(F)


def report(name, frame, elapsed, **fields):
    """Print field statistics every N frames. These numbers — not the pictures —
    are what the port gets held to; matching within ~10% is the bar."""
    parts = " ".join(
        f"{k}={v.mean():.3f}/{v.max():.3f}" if v.ndim else f"{k}={v:.3f}"
        for k, v in fields.items()
    )
    print(f"  {name} f{frame} {parts} ({elapsed:.0f}s)", flush=True)
