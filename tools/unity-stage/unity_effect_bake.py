# The game's effect shader (ZTong/Effect_Common), evaluated once into a texture.
#
# X309's night sky is effect layers on cylinders round the scene: a nebula, a
# field of twinkling stars, a purple band where they meet the sea, columns of
# falling light. Each layer composes several textures — a main one raised to a
# power, a second one mixed in, a mask — with its own rotation and tiling, and
# a PMX material holds one texture. So each layer is baked: the shader's own
# arithmetic at time 0, over the mesh's UV square, written as one RGBA picture.
#
# THE FORMULA, read from Effect_Common.shader's fragment variants (MAIN always,
# the plus block with MAIN_PLUS, the mask block with MASK):
#
#   main  = lerp(P.x·t, P.y·t^P.z, P.w) · _Color            P = _MainPow
#   alpha = t.a, or main's red when _IsRedAlpha_Main
#   plus  = lerp(Q.x·q, Q.y·q^Q.z, Q.w) · _ColorPlus        q = p.rgb · p.alpha
#   mixed by _PlusMode — 0 multiply, 1 add, 2 lerp — at _MainPlusStrength
#   alpha = saturate(alpha · (mask − _MaskStrength))
#   out   = (alpha · rgb, alpha · (_DstBlend − 1) / 9)       One, OneMinusSrcAlpha
#
# so _DstBlend 10 is an ordinary premultiplied layer and _DstBlend 1 is purely
# additive. A PMX blends over, so the bake finds the straight colour and alpha
# that come closest, stored at 1/GAIN for a look that emits at GAIN (below): an
# additive layer over a dark sky loses almost nothing, and only light past GAIN
# times white clips.
#
# THE UVs are the vertex shader's: rotated about 0.5 by the slot's angle, then
# scaled and offset by its _ST. Every texture here is sRGB, so it is decoded
# before it is filtered, as the GPU does. Unity's v runs up the image.
#
# Scrolling and twinkling are functions of time; the bake is time 0.

import math
import os
import re

import numpy as np
from PIL import Image

from unity_lights import gamma_to_linear


def _srgb_to_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


class _Texture:
    """A decoded texture, sampled bilinearly with its own wrap mode."""

    def __init__(self, png, repeat_u, repeat_v):
        im = np.asarray(Image.open(png).convert("RGBA"), dtype=np.float64) / 255.0
        self.rgb = _srgb_to_linear(im[..., :3])
        self.a = im[..., 3]
        self.h, self.w = self.a.shape
        self.repeat = (repeat_u, repeat_v)

    def _index(self, x, n, repeat):
        return np.mod(x, n) if repeat else np.clip(x, 0, n - 1)

    def sample(self, u, v):
        # Texel centres; the image's first row is the TOP, where Unity's v is 1.
        x = u * self.w - 0.5
        y = (1.0 - v) * self.h - 0.5
        if not self.repeat[0]:
            x = np.clip(x, 0.0, self.w - 1.0)
        if not self.repeat[1]:
            y = np.clip(y, 0.0, self.h - 1.0)
        x0 = np.floor(x).astype(np.int64)
        y0 = np.floor(y).astype(np.int64)
        fx = (x - x0)[..., None]
        fy = (y - y0)[..., None]
        xs = [self._index(x0 + d, self.w, self.repeat[0]) for d in (0, 1)]
        ys = [self._index(y0 + d, self.h, self.repeat[1]) for d in (0, 1)]
        rgba = np.concatenate([self.rgb, self.a[..., None]], axis=-1)
        top = rgba[ys[0], xs[0]] * (1 - fx) + rgba[ys[0], xs[1]] * fx
        bottom = rgba[ys[1], xs[0]] * (1 - fx) + rgba[ys[1], xs[1]] * fx
        return top * (1 - fy) + bottom * fy


def _wrap(asset_path):
    """(repeat u, repeat v) from the Texture2D asset; Unity's 0 is Repeat."""
    try:
        text = open(asset_path, encoding="utf-8", errors="replace").read()
    except OSError:
        return True, True
    u = re.search(r"m_WrapU:\s*(\d+)", text)
    v = re.search(r"m_WrapV:\s*(\d+)", text)
    return (u is None or u.group(1) == "0"), (v is None or v.group(1) == "0")


ROTATION_OF = {"_MainTex": "_MainRotation", "_MainPlusTex": "_MainPlusRotation", "_MaskTex": "_MaskRotation"}


def _slot_uv(material, slot, u, v):
    deg = material["floats"].get(ROTATION_OF[slot], 0.0)
    theta = 2 * math.pi * ((deg / 360.0) % 1.0)
    c, s = math.cos(theta), math.sin(theta)
    du, dv = u - 0.5, v - 0.5
    ru, rv = c * du + s * dv + 0.5, -s * du + c * dv + 0.5
    st = material["textures"][slot]
    return ru * st["scale"][0] + st["offset"][0], rv * st["scale"][1] + st["offset"][1]


def _used_slots(material):
    kw = set(material["keywords"])
    slots = ["_MainTex"]
    if "MAIN_PLUS" in kw:
        slots.append("_MainPlusTex")
    if "MASK" in kw:
        slots.append("_MaskTex")
    return [s for s in slots if s in material["textures"]]


def repeats_across(material):
    """How many times the whole layer repeats across its u, so the bake can
    hold ONE repeat at full detail and the mesh's u carries the rest.

    X309's stars tile ten times round their cylinder; baked across all ten at
    a size a browser takes, each star shrinks below a texel and goes out.
    Whole repeats only: every slot's u-scale a whole number and no slot turned
    by a quarter, whose u would then be the texture's v."""
    counts = []
    for slot in _used_slots(material):
        deg = material["floats"].get(ROTATION_OF[slot], 0.0) % 180.0
        su = material["textures"][slot]["scale"][0]
        if deg != 0.0 or su != round(su) or round(su) < 1:
            return 1
        counts.append(int(round(su)))
    return math.gcd(*counts) if counts else 1


def _pow_mix(rgb, vec, w):
    x, y, z = vec
    return (1 - w) * (x * rgb) + w * (y * np.power(np.maximum(rgb, 0.0), max(z, 0.01)))


def _linear_colour(material, name, default=(1.0, 1.0, 1.0)):
    c = material["colors"].get(name, default)
    return np.array([gamma_to_linear(v) for v in c]), material["alpha"].get(name, 1.0)


# THE PICTURE IS STORED AT 1/GAIN. The game's sky is brighter than white — the
# nebula's wisps reach twice it, its stars fifty times — and that excess is what
# its bloom turns into shine. A PNG stops at white, so the bake divides by GAIN
# and the look that draws it emits at GAIN: everything up to four times white
# survives and blooms here too. The file name carries it, `_x4`.
GAIN = 4


def bake(material, proj, png_for_guid, out_path, max_width=4096, max_height=1024, gain=GAIN):
    """Write the layer's time-0 picture over its UV square, at 1/gain; returns
    the number of repeats across u the mesh must carry, or None when a texture
    is missing."""
    slots = _used_slots(material)
    textures = {}
    for slot in slots:
        guid = material["textures"][slot]["guid"]
        png = png_for_guid(guid)
        if not png or not os.path.exists(png):
            return None
        textures[slot] = _Texture(png, *_wrap(proj.path(guid) or ""))
    if "_MainTex" not in textures:
        return None

    k = repeats_across(material)
    width = max(256, min(max_width, max(int(t.w * abs(material["textures"][s]["scale"][0]) / k) for s, t in textures.items())))
    height = max(128, min(max_height, max(int(t.h * abs(material["textures"][s]["scale"][1])) for s, t in textures.items())))
    u = (np.arange(width) + 0.5) / width / k
    v = 1.0 - (np.arange(height) + 0.5) / height
    U, V = np.meshgrid(u, v)
    f = material["floats"]

    t = textures["_MainTex"].sample(*_slot_uv(material, "_MainTex", U, V))
    pw = material["colors"].get("_MainPow", (1.0, 1.0, 1.0))
    rgb = _pow_mix(t[..., :3], pw, material["alpha"].get("_MainPow", 0.0))
    a = np.where(f.get("_IsRedAlpha_Main", 0.0) > 0.5, rgb[..., 0], t[..., 3])
    colour, colour_a = _linear_colour(material, "_Color")
    rgb = rgb * colour
    a = a * colour_a

    if "_MainPlusTex" in textures:
        p = textures["_MainPlusTex"].sample(*_slot_uv(material, "_MainPlusTex", U, V))
        pa = np.where(f.get("_IsRedAlpha_MainPlus", 0.0) > 0.5, p[..., 0], p[..., 3])
        q = p[..., :3] * pa[..., None]
        pw = material["colors"].get("_MainPlusPow", (1.0, 1.0, 1.0))
        plus_colour, plus_a = _linear_colour(material, "_ColorPlus")
        plus_rgb = _pow_mix(q, pw, material["alpha"].get("_MainPlusPow", 0.0)) * plus_colour
        plus_alpha = pa * plus_a
        strength = f.get("_MainPlusStrength", 1.0)
        kc = f.get("_IsPlusColor", 0.0) * strength
        ka = f.get("_IsPlusAlpha", 0.0) * strength
        mode = int(f.get("_PlusMode", 0.0))
        if mode == 2:
            rgb = (1 - kc) * rgb + kc * plus_rgb
            a = (1 - ka) * a + ka * plus_alpha
        elif mode == 1:
            rgb = rgb + kc * plus_rgb
            a = a + ka * plus_alpha
        else:
            rgb = rgb * ((1 - kc) + kc * plus_rgb)
            a = a * ((1 - ka) + ka * plus_alpha)
    rgb = np.maximum(rgb, 0.0)

    if "_MaskTex" in textures:
        m = textures["_MaskTex"].sample(*_slot_uv(material, "_MaskTex", U, V))
        mv = np.where(f.get("_IsRedAlpha_Mask", 0.0) > 0.5, m[..., 0], m[..., 3]) - f.get("_MaskStrength", 0.0)
        a = a * mv
    a = np.clip(a, 0.0, 1.0)

    # Drawn as gain × colour over, with coverage alpha: the light it adds is
    # gain × colour × alpha, which must be the layer's premultiplied light. A
    # blended layer keeps its own alpha; an additive one takes the least alpha
    # that still carries its light, so it darkens what is behind as little as
    # the blend allows.
    premultiplied = rgb * a[..., None]
    own_alpha = a * (f.get("_DstBlend", 10.0) - 1.0) / 9.0
    alpha = np.clip(np.maximum(own_alpha, premultiplied.max(axis=-1) / gain), 0.0, 1.0)
    straight = premultiplied / (gain * np.maximum(alpha, 1e-6))[..., None]
    out = np.concatenate([_linear_to_srgb(straight), alpha[..., None]], axis=-1)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(np.round(out * 255.0).astype(np.uint8), "RGBA").save(out_path, optimize=True)
    return k
