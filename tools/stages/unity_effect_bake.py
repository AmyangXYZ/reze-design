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
# that come closest, stored at 1/gain for a look that emits at that gain
# (below): an additive layer over a dark sky loses almost nothing, and only
# light past sixteen times white clips.
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
TILING_OF = {"_MainTex": "_IsTillingUV_Main", "_MainPlusTex": "_IsTillingUV_MainPlus", "_MaskTex": "_IsTillingUV_Mask"}


def _slot_uv(material, slot, u, v):
    deg = material["floats"].get(ROTATION_OF[slot], 0.0)
    theta = 2 * math.pi * ((deg / 360.0) % 1.0)
    c, s = math.cos(theta), math.sin(theta)
    du, dv = u - 0.5, v - 0.5
    ru, rv = c * du + s * dv + 0.5, -s * du + c * dv + 0.5
    st = material["textures"][slot]
    su, sv = ru * st["scale"][0] + st["offset"][0], rv * st["scale"][1] + st["offset"][1]
    # 平铺 OFF CLAMPS. The fragment ends every slot's UV with
    #   uv = lerp(saturate(uv), uv, _IsTillingUV_<slot>)
    # so with the switch off a picture shows once and holds its edge beyond —
    # X323's additive stain glows through ONE spot of a glow tiled 10x, not a
    # grid of them across the puddle.
    if material["floats"].get(TILING_OF[slot], 1.0) < 0.5:
        su, sv = np.clip(su, 0.0, 1.0), np.clip(sv, 0.0, 1.0)
    return su, sv


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
# its bloom turns into shine. A PNG stops at white, so the bake divides by a
# gain and the look that draws it emits at that gain. The file name carries it,
# `_x4`: the least of 1, 2, 4, 8 and 16 that holds the picture, never below
# `least`. A sky layer takes at least 4 — its coverage is its light over its
# gain, so the higher the gain the less an additive layer darkens what is
# behind it.
GAINS = (1, 2, 4, 8, 16)


def gain_for(peak, least=1):
    return next((g for g in GAINS if g >= least and g >= peak), GAINS[-1])


# BRIGHTER THAN WHITE CARRIES THE GAME'S BLOOM. The game adds its bloom at full
# energy; the app's, at its default intensity 0.05 over a five-level pyramid
# that sums its levels, adds a quarter of it. So what a picture holds above
# white is carried four times over, and a lamp shade at 2.2 throws the halo it
# throws in the game. At white and below nothing changes: the colour a surface
# shows is the game's, and only what blooms is louder.
BLOOM = 4.0


def for_bloom(linear):
    """Linear RGB with the part of each texel above white carried BLOOM times,
    scaled on its brightest channel so the hue holds."""
    peak = linear.max(axis=-1, keepdims=True)
    lifted = np.where(peak > 1.0, 1.0 + BLOOM * (peak - 1.0), peak)
    return linear * (lifted / np.maximum(peak, 1e-6))


def bake(material, proj, png_for_guid, out_base, max_width=4096, max_height=1024):
    """Write the layer's time-0 picture over its UV square to `<out_base>_x<gain>.png`
    and return that path, or None when a texture is missing."""
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
    premultiplied = for_bloom(rgb * a[..., None])
    gain = gain_for(float(premultiplied.max()), least=4)
    own_alpha = a * (f.get("_DstBlend", 10.0) - 1.0) / 9.0
    alpha = np.clip(np.maximum(own_alpha, premultiplied.max(axis=-1) / gain), 0.0, 1.0)
    straight = premultiplied / (gain * np.maximum(alpha, 1e-6))[..., None]
    out = np.concatenate([_linear_to_srgb(straight), alpha[..., None]], axis=-1)
    out_path = f"{out_base}_x{gain}.png"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(np.round(out * 255.0).astype(np.uint8), "RGBA").save(out_path, optimize=True)
    return out_path


# ── ZTong/Tong_jichu_AB: the plain alpha-blended effect sheet ──
#
# A soft blob under a candle, a shadow projection on a floor ("touying"): one
# texture, an optional mask, a colour, and no light. The fragment, as
# decompiled:
#
#   tex  = _Tex, or (1,1,1,tex.a) with _Tex_IsSingleChannel 1, or tex.rrrr with 2
#   mask = the same switches over _Tex_Mask (_Tex_Mask_IsSingleChannel)
#   a    = luma(mask.rgb) · mask.a · tex.a · vertex.a        luma = .3/.59/.11
#   rgb  = lerp(tex.rgb, luma(tex.rgb), _Desaturate) · _Color.rgb · vertex.rgb
#   Blend SrcAlpha OneMinusSrcAlpha
#
# and the vertex stage folds _Color.a into vertex.a (times uv1.x through
# _Color_Alpha_X, off on every sheet so far): X340's projection draws at 0.53
# times the texture's alpha squared. Baked over the mesh's UV square at time 0
# with each slot's _ST; its scroll and rotation dials are time's.

BASIC_EFFECT_SHADERS = ("Tong_jichu_AB",)


def _single(t, mode):
    if mode > 1.5:
        return np.repeat(t[..., :1], 4, axis=-1)
    if mode > 0.5:
        return np.concatenate([np.ones_like(t[..., :3]), t[..., 3:]], axis=-1)
    return t


def bake_basic(material, proj, png_for_guid, out_base, notes):
    """Write the sheet's colour and coverage to `<out_base>.png`, sRGB RGBA,
    and return that path, or None when its texture is missing."""
    f = material["floats"]
    tex_slot = material["textures"].get("_Tex")
    if not tex_slot:
        return None
    loaded = {}
    for name in ("_Tex", "_Tex_Mask"):
        slot = material["textures"].get(name)
        if not slot:
            continue
        png = png_for_guid(slot["guid"])
        if not png or not os.path.exists(png):
            return None
        loaded[name] = (_Texture(png, *_wrap(proj.path(slot["guid"]) or "")), slot)
    for dial in ("_Tex_Ang", "_Tex_Mask_Ang"):
        if f.get(dial, 0.0):
            notes.append(f"{material.get('name', '?')}: {dial} {f[dial]:g} left out of the bake")
    main, _ = loaded["_Tex"]
    width, height = max(64, main.w), max(64, main.h)
    U, V = np.meshgrid((np.arange(width) + 0.5) / width, 1.0 - (np.arange(height) + 0.5) / height)

    def sample(name):
        tex, slot = loaded[name]
        return tex.sample(U * slot["scale"][0] + slot["offset"][0], V * slot["scale"][1] + slot["offset"][1])

    luma = np.array([0.3, 0.59, 0.11])
    t = _single(sample("_Tex"), f.get("_Tex_IsSingleChannel", 0.0))
    a = t[..., 3]
    if "_Tex_Mask" in loaded:
        m = _single(sample("_Tex_Mask"), f.get("_Tex_Mask_IsSingleChannel", 0.0))
        a = a * (m[..., :3] @ luma) * m[..., 3]
    colour, colour_a = _linear_colour(material, "_Color")
    if f.get("_Color_Alpha_X", 0.0):
        notes.append(f"{material.get('name', '?')}: _Color_Alpha_X fades by uv1.x, left out of the bake")
    a = a * colour_a
    rgb = t[..., :3]
    rgb = rgb + f.get("_Desaturate", 0.0) * ((rgb @ luma)[..., None] - rgb)
    rgb = rgb * colour
    if rgb.max() > 1.0:
        notes.append(f"{material.get('name', '?')}: colour past white clipped in the bake ({rgb.max():.2f})")
    out = np.concatenate([_linear_to_srgb(np.clip(rgb, 0.0, 1.0)), np.clip(a, 0.0, 1.0)[..., None]], axis=-1)
    path = f"{out_base}.png"
    Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA").save(path)
    return path


# ── SimPipeline/PBR/Detailed: a layered surface, baked to albedo and ORM ──
#
# No albedo or property map of its own: constants blended by a mask, over a
# tiling detail picture. From the fragment, every texture on UV0 through its
# own _ST:
#
#   cover   = mask.r        (its up-facing term needs _CoverMaskSoft > 0)
#   albedo  = lerp(detail · _BaseColor, _BaseWornColor, mask.g)
#   albedo  = lerp(albedo, coverTex · _CoverColor, cover)
#   metal   = lerp(_BaseMetallic, _CoverMetallic, cover)
#   rough   = lerp(_BaseRoughness, _CoverRoughness, cover)      (perceptual)
#
# Exported as Standard it had none of this: glTF's defaults, roughness 1 and
# METAL 1, turned X340's stone steps into white metal that every spot lit.


def _raw(png):
    return np.asarray(Image.open(png).convert("RGBA"), dtype=np.float64) / 255.0


def bake_detailed(material, proj, png_for_guid, out_base, notes, max_size=2048):
    """Write `<out_base>_D.png` (sRGB albedo) and `<out_base>_ORM.png` (glTF
    order) over the UV square; return (albedo path, orm path) or None."""
    t, f = material["textures"], material["floats"]

    def load(slot, colour):
        s = t.get(slot)
        png = png_for_guid(s["guid"]) if s else None
        if not png or not os.path.exists(png):
            return None
        return (_Texture(png, *_wrap(proj.path(s["guid"]) or "")) if colour else _raw(png)), s

    mask, detail, cover = load("_MaskTex", False), load("_DetailTex", True), load("_CoverTex", True)
    sizes = [m[0].shape[1] * abs(m[1]["scale"][0]) for m in (mask,) if m] + [d[0].w * abs(d[1]["scale"][0]) for d in (detail, cover) if d]
    n = int(min(max_size, max([256] + sizes)))
    U, V = np.meshgrid((np.arange(n) + 0.5) / n, 1.0 - (np.arange(n) + 0.5) / n)

    def at(entry):
        tex, s = entry
        return tex.sample(U * s["scale"][0] + s["offset"][0], V * s["scale"][1] + s["offset"][1])

    if mask:
        raw, s = mask
        h, w = raw.shape[:2]
        x = np.clip(((U * s["scale"][0] + s["offset"][0]) % 1.0) * w, 0, w - 1).astype(int)
        y = np.clip((1.0 - ((V * s["scale"][1] + s["offset"][1]) % 1.0)) * h, 0, h - 1).astype(int)
        m = raw[y, x]
    else:
        m = np.zeros((n, n, 4))  # "black", the shader's default
    if f.get("_CoverMaskSoft", 0.0) > 0:
        notes.append(f"{material.get('name', '?')}: its up-facing cover is left out of the bake")
    base = _linear_colour(material, "_BaseColor")[0]
    worn = _linear_colour(material, "_BaseWornColor")[0]
    cov = _linear_colour(material, "_CoverColor")[0]
    d = at(detail)[..., :3] if detail else np.ones((n, n, 3))
    c = at(cover)[..., :3] if cover else np.ones((n, n, 3))
    g, r = m[..., 1:2], m[..., 0:1]
    albedo = d * base * (1 - g) + worn * g
    albedo = albedo * (1 - r) + c * cov * r
    rough = f.get("_BaseRoughness", 1.0) * (1 - r[..., 0]) + f.get("_CoverRoughness", 1.0) * r[..., 0]
    metal = f.get("_BaseMetallic", 0.0) * (1 - r[..., 0]) + f.get("_CoverMetallic", 0.0) * r[..., 0]
    a_path, o_path = f"{out_base}_D.png", f"{out_base}_ORM.png"
    Image.fromarray(np.round(_linear_to_srgb(np.clip(albedo, 0, 1)) * 255).astype(np.uint8), "RGB").save(a_path)
    orm = np.stack([np.ones_like(rough), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], axis=-1)
    Image.fromarray(np.round(orm * 255).astype(np.uint8), "RGB").save(o_path)
    return a_path, o_path
