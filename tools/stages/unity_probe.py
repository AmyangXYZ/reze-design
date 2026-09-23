"""A Unity reflection probe, at the level the game baked it.

THE PROBE IS HDR AND THE EXPORT KEPT IT. A baked probe is a BC6H cube — half
floats, values far above white, which is where a room's windows and lamps live.
The PNG beside it in an AssetRipper export is that cube flattened to 8 bits: the
structure survives and the range does not, and a room lit only by what survived
reads as muddy rather than dark, because what makes a dark room look lit is its
highlights.

The blocks themselves are in the .asset, as `_typelessdata`. Blender decodes
BC6H and hands back floats, so the decoder is one the pipeline already has —
wrap the blocks in a DDS header and load the file. Checked against an
independent decoder (texture2ddecoder) over every texel of a face: the two agree
to within 8-bit quantisation, linear, same orientation.

WHAT THE IMAGE IS. Unity lights a scene with two separate things: a trilight
AMBIENT, one colour overhead, one at the horizon and one below, for diffuse, and
the PROBE for what speculars mirror. This engine has one world doing both jobs,
so the image is the probe plus, per direction, whatever the ambient asks for
above what the probe already gives:

    world(d) = probe(d) + max(0, gradient(d) - smooth(d))

where smooth is the probe's own low-frequency content, its spherical harmonics
through l=2 reconstructed. Diffuse then lands on the ambient the scene declares,
warm ground and all; a highlight brighter than the gradient is left exactly as
the game baked it, because there the lift is zero. Additive, so the room's
contrast survives — scaling the probe to a target level is what flattens it.

DIRECTION. Geometry goes Unity -> glTF by mirroring X and glTF -> engine by
mirroring Z, so a Unity direction (x, y, z) is (-x, y, -z) by the time the
engine reflects it. The bake looks the cube up at the Unity direction for the
engine direction it is filling, or the room would be reflected yawed half a turn
against itself.
"""

from __future__ import annotations

import math
import os
import re
import struct
import subprocess
import tempfile

import numpy as np

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"

# Unity's TextureFormat for BC6H, the format a baked HDR probe is stored in.
BC6H = 24
# DXGI_FORMAT_BC6H_UF16, the unsigned half-float variant Unity bakes.
DXGI_BC6H_UF16 = 95


def _dds(blocks: bytes, size: int) -> bytes:
    """One square BC6H mip as a DX10 .dds, the container Blender will open."""
    hdr = b"DDS " + struct.pack("<I", 124)
    flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000  # caps|height|width|pixelformat|linearsize
    hdr += struct.pack("<IIIII", flags, size, size, len(blocks), 0)
    hdr += struct.pack("<I", 1) + b"\0" * 44  # one mip, then reserved[11]
    hdr += struct.pack("<II", 32, 0x4) + b"DX10" + struct.pack("<IIIII", 0, 0, 0, 0, 0)
    hdr += struct.pack("<IIIII", 0x1000, 0, 0, 0, 0)
    hdr += struct.pack("<IIIII", DXGI_BC6H_UF16, 3, 0, 1, 0)
    return hdr + blocks


def probe_cube(asset_path: str, blender: str = BLENDER) -> np.ndarray:
    """The probe's six faces as linear float radiance, (6, n, n, 3).

    Unity's own face order, +X -X +Y -Y +Z -Z, each row top-down, which is what
    the cube lookup below expects.
    """
    text = open(asset_path, encoding="utf-8", errors="replace").read()
    blob = re.search(r"_typelessdata: ([0-9a-f]+)", text)
    if not blob:
        raise ValueError(f"{os.path.basename(asset_path)}: no image data (streamed?)")
    fmt = int(re.search(r"m_TextureFormat: (\d+)", text).group(1))
    if fmt != BC6H:
        raise ValueError(f"{os.path.basename(asset_path)}: texture format {fmt}, not BC6H")
    size = int(re.search(r"m_Width: (\d+)", text).group(1))
    data = bytes.fromhex(blob.group(1))
    if len(data) % 6:
        raise ValueError(f"{os.path.basename(asset_path)}: {len(data)} bytes is not six faces")
    per_face = len(data) // 6  # the face's whole mip chain
    mip0 = (max(1, size // 4)) ** 2 * 16

    with tempfile.TemporaryDirectory() as tmp:
        faces = []
        for i in range(6):
            p = os.path.join(tmp, f"f{i}.dds")
            with open(p, "wb") as fh:
                fh.write(_dds(data[i * per_face : i * per_face + mip0], size))
            faces.append(p)
        out = os.path.join(tmp, "faces.npy")
        script = os.path.join(tmp, "read.py")
        with open(script, "w") as fh:
            fh.write("import bpy, numpy as np\nf=[]\n")
            for p in faces:
                # Blender hands pixels back bottom-up; the cube lookup is top-down.
                fh.write(f"f.append(np.array(bpy.data.images.load({p!r}).pixels[:],np.float32).reshape({size},{size},4)[::-1,:,:3])\n")
            fh.write(f"np.save({out!r}, np.stack(f))\n")
        run = subprocess.run([blender, "-b", "--python", script], capture_output=True, text=True)
        if not os.path.exists(out):
            raise RuntimeError(f"Blender could not decode the probe: {run.stdout[-400:]}{run.stderr[-400:]}")
        return np.load(out)


def _cube_sample(faces: np.ndarray, dx: np.ndarray, dy: np.ndarray, dz: np.ndarray) -> np.ndarray:
    """Bilinear cube lookup, D3D's face convention — the one Unity bakes in."""
    n = faces.shape[1]
    ax, ay, az = np.abs(dx), np.abs(dy), np.abs(dz)
    idx = np.where(
        (ax >= ay) & (ax >= az),
        np.where(dx > 0, 0, 1),
        np.where(ay >= az, np.where(dy > 0, 2, 3), np.where(dz > 0, 4, 5)),
    )
    ma = np.where((ax >= ay) & (ax >= az), ax, np.where(ay >= az, ay, az))
    ma = np.maximum(ma, 1e-12)
    uc = np.select(
        [idx == 0, idx == 1, idx == 2, idx == 3, idx == 4, idx == 5],
        [-dz, dz, dx, dx, dx, -dx],
    )
    vc = np.select(
        [idx == 0, idx == 1, idx == 2, idx == 3, idx == 4, idx == 5],
        [-dy, -dy, dz, -dz, -dy, -dy],
    )
    # Texel coordinates, clamped inside the face: a seam is a texel wide at this
    # size and the probe is blurry to begin with.
    fx = np.clip((uc / ma * 0.5 + 0.5) * n - 0.5, 0.0, n - 1.0)
    fy = np.clip((vc / ma * 0.5 + 0.5) * n - 0.5, 0.0, n - 1.0)
    x0, y0 = np.floor(fx).astype(np.int32), np.floor(fy).astype(np.int32)
    x1, y1 = np.minimum(x0 + 1, n - 1), np.minimum(y0 + 1, n - 1)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
    top = faces[idx, y0, x0] * (1 - tx) + faces[idx, y0, x1] * tx
    bot = faces[idx, y1, x0] * (1 - tx) + faces[idx, y1, x1] * tx
    return top * (1 - ty) + bot * ty


def _srgb_to_linear(v: float) -> float:
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _sh_basis(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Real orthonormal spherical harmonics through l=2, stacked last."""
    return np.stack(
        [
            np.full_like(x, 0.282095),
            0.488603 * y,
            0.488603 * z,
            0.488603 * x,
            1.092548 * x * y,
            1.092548 * y * z,
            0.315392 * (3.0 * z * z - 1.0),
            1.092548 * x * z,
            0.546274 * (x * x - y * y),
        ],
        axis=-1,
    )


def write_hdr(path: str, img: np.ndarray) -> None:
    """Radiance RGBE, the format the app's world loader reads."""
    h, w, _ = img.shape
    peak = img.max(axis=2)
    e = np.zeros_like(peak, np.int32)
    lit = peak >= 1e-8
    e[lit] = np.floor(np.log2(peak[lit])).astype(np.int32) + 1
    scale = np.where(lit, 256.0 / np.exp2(e.astype(np.float32)), 0.0)
    mant = np.clip(img * scale[..., None], 0, 255).astype(np.uint8)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = mant
    out[..., 3] = np.where(lit, e + 128, 0).astype(np.uint8)
    with open(path, "wb") as fh:
        fh.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
        fh.write(f"-Y {h} +X {w}\n".encode())
        fh.write(out.tobytes())


def probe_to_equirect(asset_path: str, out_path: str, width: int = 256, ambient: dict | None = None, blender: str = BLENDER) -> tuple[int, int]:
    """Bake the probe, and the scene's ambient with it, to the world .hdr.

    `ambient` is Scene.ambient() as stored. Mode 1 is Unity's trilight, mode 3
    one flat colour; a scene on a skybox gets the probe alone.

    The width is 256 because the source is 32 texels a face: a cube that size
    carries detail down to about three degrees, and 256 across the full turn is
    already twice that. The engine's mip chain is the reflection's prefilter.
    """
    faces = probe_cube(asset_path, blender)
    height = width // 2

    theta = math.pi * (np.arange(height) + 0.5) / height
    phi = ((np.arange(width) + 0.5) / width - 0.5) * 2.0 * math.pi
    sy = np.cos(theta)[:, None] * np.ones((1, width))
    r = np.sin(theta)[:, None] * np.ones((1, width))
    sx = r * np.sin(phi)[None, :]
    sz = r * np.cos(phi)[None, :]

    # The engine's direction, looked up at Unity's: X and Z both mirrored by the
    # trip through glTF.
    probe = _cube_sample(faces, -sx, sy, -sz).astype(np.float32)

    # Solid angle per texel, for anything measured over the sphere.
    solid = (r * (math.pi / height) * (2.0 * math.pi / width)).astype(np.float32)

    world = probe
    mode = (ambient or {}).get("mode")
    if ambient and mode in (1, 3):
        # LINEAR, as the game has them: its pipeline takes RenderSettings'
        # ambient colours through `.linear` before it lights with them
        # (AGTools/AGSimPipeline.cs, SetupEnvironmentLighting). Baked as stored
        # they are gamma values read as light — X340's night sky came out two to
        # six times too bright and washed out of its blue.
        lin = {k: np.array([_srgb_to_linear(c) for c in ambient[k]], np.float32) for k in ("sky", "equator", "ground")}
        if mode == 1:
            t = np.abs(sy)[..., None]
            far = np.where(sy[..., None] >= 0.0, lin["sky"], lin["ground"])
            gradient = (lin["equator"] + (far - lin["equator"]) * t) * ambient["intensity"]
        else:
            gradient = np.broadcast_to(lin["sky"] * ambient["intensity"], probe.shape).copy()
        basis = _sh_basis(-sx, sy, -sz)
        coeff = np.einsum("hwk,hwc,hw->kc", basis, probe, solid)
        smooth = np.einsum("hwk,kc->hwc", basis, coeff)
        world = probe + np.clip(gradient - smooth, 0.0, None)

    write_hdr(out_path, np.ascontiguousarray(world.astype(np.float32)))
    return width, height
