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


ROTATION_OF = {"_MainTex": "_MainRotation", "_MainPlusTex": "_MainPlusRotation", "_MaskTex": "_MaskRotation", "_DissovleTex": "_DissovleRotation"}
TILING_OF = {"_MainTex": "_IsTillingUV_Main", "_MainPlusTex": "_IsTillingUV_MainPlus", "_MaskTex": "_IsTillingUV_Mask", "_DissovleTex": "_IsTillingUV_Dissovle"}


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


def _dissolve(material, proj, png_for_guid, U, V):
    """DISSOLVE_SIMPLE's cover, 1 where it is off — from the fragment:

      d = the dissolve picture's red (or alpha), 1 − d under _IsOpposition_Dissovle
      W = soft + 1;  lo = W · strength − soft
      cover = smoothstep of saturate((d − lo) / soft)

    strength and soft are _DissovleStrength and _DissovleSoft, or the particle's
    Custom2 .z / .w under their _Z2 / _W2 switches — none on a still sheet, so 0.
    Left out, X203a's brightest window layer (sc11, a blue at 24x white eaten
    away to a sparse pattern at strength 0.59) drew whole and washed the rainy
    night city into a bright cyan day."""
    f = material["floats"]
    slot = material["textures"].get("_DissovleTex")
    if "DISSOLVE_SIMPLE" not in set(material["keywords"]) or f.get("_UseDissolve", 0.0) < 0.5 or not slot or not slot.get("guid"):
        return 1.0
    png = png_for_guid(slot["guid"])
    if not png or not os.path.exists(png):
        return 1.0
    tex = _Texture(png, *_wrap(proj.path(slot["guid"]) or ""))
    d = tex.sample(*_slot_uv(material, "_DissovleTex", U, V))
    d = d[..., 0] if f.get("_IsRedAlpha_Dissovle", 0.0) > 0.5 else d[..., 3]
    if f.get("_IsOpposition_Dissovle", 0.0) > 0.5:
        d = 1.0 - d
    strength = 0.0 if f.get("_DissovleStrength_Z2", 0.0) > 0.5 else f.get("_DissovleStrength", 0.0)
    soft = 0.0 if f.get("_DissovleSoft_W2", 0.0) > 0.5 else f.get("_DissovleSoft", 0.0)
    lo = (soft + 1.0) * strength - soft
    x = np.clip((np.clip(d, 0.0, 1.0) - lo) / max(soft, 1e-6), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


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


def bake(material, proj, png_for_guid, out_base, max_width=4096, max_height=1024, tint=(1.0, 1.0, 1.0, 1.0)):
    """Write the layer's time-0 picture over its UV square to `<out_base>_x<gain>.png`
    and return that path, or None when a texture is missing.

    `tint` is the colour the renderer gives it on top — a standing mesh
    particle's start colour, gamma, with its alpha — which the shader takes as
    the vertex colour: it multiplies the colour (made linear, as the particle
    renderer makes it) and the alpha. Left out, X316's purple, red and orange
    window glows (alpha 0.05-0.08) baked white at full cover and blew the car's
    windows out."""
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
    # the vertex colour, after the plus picture as the fragment has it
    rgb = rgb * np.array([gamma_to_linear(c) for c in tint[:3]])
    a = a * tint[3]

    if "_MaskTex" in textures:
        m = textures["_MaskTex"].sample(*_slot_uv(material, "_MaskTex", U, V))
        mv = np.where(f.get("_IsRedAlpha_Mask", 0.0) > 0.5, m[..., 0], m[..., 3]) - f.get("_MaskStrength", 0.0)
        a = a * mv
    a = a * _dissolve(material, proj, png_for_guid, U, V)
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
    Image.fromarray(np.round(out * 255.0).astype(np.uint8), "RGBA").save(out_path, compress_level=1)
    return out_path


# ── The same layer, live: what moves, for the app to draw each frame ──
#
# THE SCROLL, read from the vertex shader: every slot's UV is
#   uv' = rotate(u + time · _UVOffset_<slot>.y, v + time · _UVOffset_<slot>.x) · _ST.xy + _ST.zw
# — added before the rotation and crossed (x moves v, y moves u)
# unless its particle switch (_UVOffset_Main_XY, _UVOffset_MainPlus_XY,
# _UVOffset_Mask_ZW) hands the offset to the particle's custom data instead —
# a still decal has none, so its switched slot stands still, while a particle
# system's effect slides it by the Custom1 its CustomData module gives each
# particle (lib/unity-particles.ts). Time is
# the game clock in seconds. The noise that ripples a slot and the dissolve
# are not carried: the layers slide, they do not shimmer.
#
# A layer whose slots all stand still stays baked; one that moves carries its
# pictures and numbers in the material's extras.reze.effect, and the app draws
# the formula above (see gltf-stage.ts, effectSheetGraph) with the time in it.

SWITCH_OF = {"_MainTex": "_UVOffset_Main_XY", "_MainPlusTex": "_UVOffset_MainPlus_XY", "_MaskTex": "_UVOffset_Mask_ZW"}
SPEED_OF = {"_MainTex": "_UVOffset_Main", "_MainPlusTex": "_UVOffset_MainPlus", "_MaskTex": "_UVOffset_Mask"}
LAYER_OF = {"_MainTex": "main", "_MainPlusTex": "plus", "_MaskTex": "mask"}


def _speed(material, slot):
    if material["floats"].get(SWITCH_OF[slot], 0.0) > 0.5:
        return (0.0, 0.0)
    c = material["colors"].get(SPEED_OF[slot], (0.0, 0.0, 0.0))
    return (float(c[0]), float(c[1]))


def live_effect(material, png_for_guid, max_size=1024, always=False, asset_for_guid=None):
    """The layer's pictures and numbers when any of its slots scrolls, else None.

    `always` gives them whether or not anything scrolls — a particle system's
    material is drawn live by its effect however still its layers are — and
    `asset_for_guid`, when given, lets each picture say whether it is colour
    (sRGB) or data, as its Texture2D asset does."""
    import base64
    import io

    slots = _used_slots(material)
    if "_MainTex" not in slots or not (always or any(_speed(material, s) != (0.0, 0.0) for s in slots)):
        return None
    srgb_of = (lambda g: _is_srgb(asset_for_guid(g) or "")) if asset_for_guid else (lambda g: True)
    f = material["floats"]
    layers = {}
    for slot in slots:
        png = png_for_guid(material["textures"][slot]["guid"])
        if not png or not os.path.exists(png):
            return None
        im = Image.open(png).convert("RGBA")
        if max(im.size) > max_size:
            k = max_size / max(im.size)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        st = material["textures"][slot]
        layers[LAYER_OF[slot]] = {
            "png": base64.b64encode(buf.getvalue()).decode("ascii"),
            "scale": [float(st["scale"][0]), float(st["scale"][1])],
            "offset": [float(st["offset"][0]), float(st["offset"][1])],
            "rotation": float(f.get(ROTATION_OF[slot], 0.0)),
            "tiling": f.get(TILING_OF[slot], 1.0) >= 0.5,
            "speed": list(_speed(material, slot)),
            "srgb": srgb_of(material["textures"][slot]["guid"]),
            # switched to the particle's own Custom1 (TEXCOORD1): main and plus
            # slide by its xy, the mask by its zw — (u + x, v + y) either way
            **({"custom": "zw" if slot == "_MaskTex" else "xy"} if f.get(SWITCH_OF[slot], 0.0) > 0.5 else {}),
        }
    # THE NOISE (_UseNoise): the fragment pulls each flagged layer's UV toward
    # the noise picture's red, uv + _NoiseParam.xy · (n − uv), the noise's own
    # UV scrolling by _NoiseParam.zw a second. X348's mist domes tile their
    # ripple 17 times across and would draw it as hard dashes without it.
    noise = None
    nslot = material["textures"].get("_NoiseTex")
    npar = list(material["colors"].get("_NoiseParam", (0.0, 0.0, 0.0))[:3]) + [material["alpha"].get("_NoiseParam", 0.0)]
    if f.get("_UseNoise", 0.0) > 0.5 and nslot and nslot.get("guid") and (npar[0] or npar[1]):
        png = png_for_guid(nslot["guid"])
        if png and os.path.exists(png):
            im = Image.open(png).convert("RGBA")
            if max(im.size) > max_size:
                k = max_size / max(im.size)
                im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            noise = {
                "png": base64.b64encode(buf.getvalue()).decode("ascii"),
                "scale": [float(nslot["scale"][0]), float(nslot["scale"][1])],
                "offset": [float(nslot["offset"][0]), float(nslot["offset"][1])],
                "speed": [float(npar[2]), float(npar[3])],
                "strength": [float(npar[0]), float(npar[1])],
                "srgb": srgb_of(nslot["guid"]),
                "main": f.get("_IsDisturbUV_Main", 1.0) > 0.5,
                "plus": f.get("_IsDisturbUV_MainPlus", 1.0) > 0.5,
                "mask": f.get("_IsDisturbUV_Mask", 0.0) > 0.5,
            }
    colour, colour_a = _linear_colour(material, "_Color")
    plus_colour, plus_a = _linear_colour(material, "_ColorPlus")
    return {
        "layers": layers,
        **({"noise": noise} if noise else {}),
        "mainPow": list(material["colors"].get("_MainPow", (1.0, 1.0, 1.0))[:3]) + [material["alpha"].get("_MainPow", 0.0)],
        "color": [float(c) for c in colour] + [colour_a],
        "redAlphaMain": f.get("_IsRedAlpha_Main", 0.0) > 0.5,
        "plusPow": list(material["colors"].get("_MainPlusPow", (1.0, 1.0, 1.0))[:3]) + [material["alpha"].get("_MainPlusPow", 0.0)],
        "plusColor": [float(c) for c in plus_colour] + [plus_a],
        "redAlphaPlus": f.get("_IsRedAlpha_MainPlus", 0.0) > 0.5,
        "plusStrength": f.get("_MainPlusStrength", 1.0),
        "plusColorOn": f.get("_IsPlusColor", 0.0),
        "plusAlphaOn": f.get("_IsPlusAlpha", 0.0),
        "plusMode": int(f.get("_PlusMode", 0.0)),
        "redAlphaMask": f.get("_IsRedAlpha_Mask", 0.0) > 0.5,
        "maskStrength": f.get("_MaskStrength", 0.0),
        # _DstBlend 1 adds its light; 10 lays it over; between, the shader's own mix
        "dstBlend": f.get("_DstBlend", 10.0),
    }



def tong_add_effect(material, png_for_guid, max_size=1024, asset_for_guid=None):
    """ZTong/Tong_jichu_Add as a particle system's picture: the pictures and numbers
    lib/unity-particles.ts draws with (kind "tong_add"), or None without a _Tex.

    THE FORMULA, read from the shader's one fragment (Blend One One):
      tex  = _Tex, taken whole, as (1,1,1,a) at _Tex_IsSingleChannel 1, or red
             everywhere at 2; rgb = tex.rgb · _Color.rgb · tex.a · _Color.a
      mask = _Tex_Mask the same way; its weight luminance(rgb) · a
      out  = rgb · mask, and unless _Vertex_Color is on — the switch that IGNORES
             it — times the vertex colour and its alpha twice over (the second
             Custom1.x under _Color_Alpha_X)
    Each picture's UV slides by time · (_Tex_U, _Tex_V) — or by Custom1.xy
    (_Tex_Mask: .zw) per axis under the _X/_Y switches — turns about 0.5 by
    _Tex_Ang, or spins at _Tex_Rotate_speed rad/s under _Tex_Rotate, then _ST."""
    import base64
    import io

    f = material["floats"]
    srgb_of = (lambda g: _is_srgb(asset_for_guid(g) or "")) if asset_for_guid else (lambda g: True)

    def layer(slot, prefix, custom):
        st = material["textures"].get(slot)
        if not st or not st.get("guid"):
            return None
        png = png_for_guid(st["guid"])
        if not png or not os.path.exists(png):
            return None
        im = Image.open(png).convert("RGBA")
        if max(im.size) > max_size:
            k = max_size / max(im.size)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return {
            "png": base64.b64encode(buf.getvalue()).decode("ascii"),
            "scale": [float(st["scale"][0]), float(st["scale"][1])],
            "offset": [float(st["offset"][0]), float(st["offset"][1])],
            "speed": [f.get(f"{prefix}_U", 0.0), f.get(f"{prefix}_V", 0.0)],
            # which axes Custom1 drives instead of time: xy for the picture, zw for the mask
            "customAxes": [f.get(f"{prefix}_U_{custom[0]}", 0.0) > 0.5, f.get(f"{prefix}_V_{custom[1]}", 0.0) > 0.5],
            "angle": f.get(f"{prefix}_Ang", 0.0),
            "spin": f.get(f"{prefix}_Rotate_speed", 0.0) if f.get(f"{prefix}_Rotate", 0.0) > 0.5 else None,
            "single": int(round(f.get(f"{prefix}_IsSingleChannel", 0.0))),
            "srgb": srgb_of(st["guid"]),
        }

    main = layer("_Tex", "_Tex", "XY")
    if not main:
        return None
    mask = layer("_Tex_Mask", "_Tex_Mask", "ZW")
    colour, colour_a = _linear_colour(material, "_Color")
    return {
        "kind": "tong_add",
        "layers": {"main": main, **({"mask": mask} if mask else {})},
        "color": [float(c) for c in colour] + [colour_a],
        "alphaFromCustom": f.get("_Color_Alpha_X", 0.0) > 0.5,
        "ignoreVertexColor": f.get("_Vertex_Color", 0.0) > 0.5,
        # world/view-space masks (_World_Mask) are not carried: the particle has no such UV
        "worldMask": f.get("_World_Mask", 0.0) > 0.5,
        "dstBlend": 1.0,
    }

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

# Tong_jichu_Add is the same composition added whole (Blend One One) rather than
# laid over: its colour times its coverage is the light it adds, which is what
# the bake's picture holds — the converter draws it additive (X306's screen,
# sc_107601_x306_pingmu2_2, wore Standard and drew as a lit solid)
BASIC_EFFECT_SHADERS = ("Tong_jichu_AB", "Tong_jichu_Add")


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
    Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA").save(path, compress_level=1)
    return path


def bake_fresnel(material, proj, png_for_guid, out_base, notes):
    """ZTong/Tong_jichu_Fresnel_Add, split where it can be: `<out_base>.png` is its
    mask's weight — luminance · alpha, as the fragment takes it — in grey, and the
    returned spec is the rest, drawn live by the app (lib/gltf-stage.ts fresnelGraph):

      f      = 1 − max(N·V, 0), both faces; 1 − f again under _OneMinus
      colour = f ^ e^(1 − _Fresnel_Intensity) · _Fresnel_Color.rgb · _Fresnel_Color.a · mask
    added whole (Blend One One). Returns (path, spec), or (None, None) without a mask
    — its default is white, which bakes to nothing but the colour."""
    f = material["floats"]
    slot = material["textures"].get("_Tex_Mask")
    width = height = 64
    weight = None
    if slot and slot.get("guid"):
        png = png_for_guid(slot["guid"])
        if png and os.path.exists(png):
            tex = _Texture(png, *_wrap(proj.path(slot["guid"]) or ""))
            width, height = max(64, tex.w), max(64, tex.h)
            U, V = np.meshgrid((np.arange(width) + 0.5) / width, 1.0 - (np.arange(height) + 0.5) / height)
            m = _single(tex.sample(U * slot["scale"][0] + slot["offset"][0], V * slot["scale"][1] + slot["offset"][1]),
                        f.get("_Tex_Mask_IsSingleChannel", 0.0))
            weight = (m[..., :3] @ np.array([0.3, 0.59, 0.11])) * m[..., 3]
            for dial in ("_Tex_Mask_Ang", "_Tex_Mask_U", "_Tex_Mask_V"):
                if f.get(dial, 0.0):
                    notes.append(f"{material.get('name', '?')}: {dial} {f[dial]:g} left out of the bake")
    if weight is None:
        weight = np.ones((height, width))
    if material["textures"].get("_Tex_Mask_2", {}).get("guid"):
        notes.append(f"{material.get('name', '?')}: its second mask is left out")
    grey = _linear_to_srgb(np.clip(weight, 0.0, 1.0))
    out = np.stack([grey, grey, grey, np.ones_like(grey)], axis=-1)
    path = f"{out_base}_fresnel.png"
    Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA").save(path, compress_level=1)
    colour, colour_a = _linear_colour(material, "_Fresnel_Color")
    return path, {
        "color": [float(c) * colour_a for c in colour],
        "power": float(math.exp(1.0 - f.get("_Fresnel_Intensity", 0.0))),
        "oneMinus": f.get("_OneMinus", 0.0) > 0.5,
    }


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


def _is_srgb(asset_path):
    """Whether the Texture2D asset is sampled as colour (m_ColorSpace 1): the
    GPU decodes it before the shader sees it, mask or not."""
    try:
        text = open(asset_path, encoding="utf-8", errors="replace").read()
    except OSError:
        return False
    m = re.search(r"m_ColorSpace:\s*(\d+)", text)
    return bool(m and m.group(1) == "1")


def bake_detailed(material, proj, png_for_guid, out_base, notes, max_size=2048):
    """Write `<out_base>_D.png` (sRGB albedo), `<out_base>_ORM.png` (glTF
    order) and, when a layer has relief, `<out_base>_N.png` over the UV square;
    return (albedo path, orm path, normal path or None) or None."""
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
        # AN sRGB MASK IS DECODED before the blend reads it: X348's beach mask is
        # one, and read raw it weighted the grey cover and the dark worn colour
        # half again — the sand baked grey-brown where the game's is pale.
        if _is_srgb(proj.path(s["guid"]) or ""):
            m = np.concatenate([_srgb_to_linear(m[..., :3]), m[..., 3:]], axis=-1)
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
    Image.fromarray(np.round(_linear_to_srgb(np.clip(albedo, 0, 1)) * 255).astype(np.uint8), "RGB").save(a_path, compress_level=1)
    orm = np.stack([np.ones_like(rough), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], axis=-1)
    Image.fromarray(np.round(orm * 255).astype(np.uint8), "RGB").save(o_path, compress_level=1)
    # THE RELIEF: lerp(detail normal · _DetailNormalScale, cover normal ·
    # _CoverNormalScale, cover), tangent space, through the same tiling — X348's
    # sand ripples live only here, its albedo all but flat.
    n_path = None
    dn, cn = load("_DetailNormal", False), load("_CoverNormal", False)
    ks = (f.get("_DetailNormalScale", 1.0), f.get("_CoverNormalScale", 1.0))
    if (dn and ks[0]) or (cn and ks[1]):
        def relief(entry, k):
            if not entry or not k:
                return np.zeros((n, n, 2))
            raw, s = entry
            h, w = raw.shape[:2]
            x = np.clip(((U * s["scale"][0] + s["offset"][0]) % 1.0) * w, 0, w - 1).astype(int)
            y = np.clip((1.0 - ((V * s["scale"][1] + s["offset"][1]) % 1.0)) * h, 0, h - 1).astype(int)
            return (raw[y, x][..., :2] * 2.0 - 1.0) * k
        xy = relief(dn, ks[0]) * (1 - r) + relief(cn, ks[1]) * r
        z = np.sqrt(np.clip(1.0 - (xy ** 2).sum(-1, keepdims=True), 0.0, 1.0))
        nrm = np.concatenate([xy, z], axis=-1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-9
        n_path = f"{out_base}_N.png"
        Image.fromarray(np.round((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(n_path, compress_level=1)
    return a_path, o_path, n_path
