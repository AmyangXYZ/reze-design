# The game's colour grade, as the LUT its pipeline bakes every frame.
#
# WHERE IT COMES FROM. Not SceneSetting._colorGraddingLut: the live pipeline
# never reads it. Replica.ColorGradingLutPass bakes _ColorGraddingLut each frame
# from the VOLUME STACK — WhiteBalance, ColorAdjustments, SplitToning,
# ChannelMixer, ShadowsMidtonesHighlights, LiftGammaGain, ColorCurves — with
# Hidden/RenderPipeline/Lut, URP's LDR LUT builder, into a size² × size ARGB32
# sRGB strip (16, or 32 with PostProcessSetting.lutSize32). The Final pass then
# looks the tonemapped colour up in it. ag-rip's AGSimPostFX.cs does the same in
# Unity; this does it here, so the stage carries the grade rather than a guess.
#
# `bake` below is the decompiled fragment shader line for line, on every texel
# at once. Two of its habits are the game's own and are kept:
#
#   - _LutParams.w is an INTEGER division in the game, size/(size-1) = 1, so
#     texel i holds the grade of i/size rather than i/(size-1). Sampled the
#     usual way, white comes out at (size-1)/size of itself — the game's frame
#     is that much darker at the top, and so is this one.
#   - the curves are sampled half a texel in, off 128-texel bakes whose last
#     texel is 127/128, so nothing leaves the LUT above that.
#
# What leaves: the cube as the game stores it — 8-bit, sRGB-encoded — red
# fastest, then green, then blue, one byte per channel.

import base64
import re

import numpy as np

from unity_lights import gamma_to_linear
from unity_scene import shallow

LUMA = np.array([0.2126729, 0.7151522, 0.072175])


def _value(text):
    """A parameter's m_Value: a number, or an inline {x..} / {r..} block."""
    text = text.strip()
    if text.startswith("{"):
        got = dict(re.findall(r"([xyzwrgba]):\s*(-?[\d.eE+-]+)", text))
        keys = "xyzw" if "x" in got else "rgba"
        return tuple(float(got.get(k, 0.0)) for k in keys)
    try:
        return float(text)
    except ValueError:
        return None


def overrides(body):
    """Every parameter a volume component overrides, name -> value.

    A VolumeParameter is written as its name, then an indented m_OverrideState
    and m_Value; only the overridden ones say anything about the stage."""
    out = {}
    for m in re.finditer(r"^  (\w+):\s*\n    m_OverrideState: (\d)\s*\n    m_Value: (.*)$", body, re.M):
        if m.group(2) == "1":
            v = _value(m.group(3))
            if v is not None:
                out[m.group(1)] = v
    return out


def volume_stack(scene, proj, notes):
    """The volume components that apply everywhere in the stage, lowest priority
    first, as (weight, component name, overrides).

    Resolved the way AGVolumes.cs does: global volumes only — a local one
    applies where the camera stands, and a stage has no camera of its own —
    each profile's components in priority order."""
    layers = []
    for fid, (cls, body) in scene.docs.items():
        if cls != 114 or "sharedProfile:" not in body or "m_IsGlobal:" not in body:
            continue
        go = re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body)
        if shallow(body, "m_Enabled", "1") != "1" or (go and not scene.active_in_hierarchy(int(go.group(1)))):
            continue
        guid = re.search(r"sharedProfile:.*?guid:\s*([0-9a-f]{32})", body)
        profile = proj.path(guid.group(1)) if guid else None
        if not profile:
            continue
        name = scene.name_of(int(go.group(1))) if go else "?"
        if shallow(body, "m_IsGlobal", "1") != "1":
            notes.append(f"local volume on {name} left out of the grade: it applies where a camera stands")
            continue
        weight = float(shallow(body, "weight", "1") or 1)
        priority = float(shallow(body, "priority", "0") or 0)
        text = open(profile, encoding="utf-8", errors="replace").read()
        for comp_guid in re.findall(r"^  - \{fileID: \d+, guid: ([0-9a-f]{32})", text, re.M):
            path = proj.path(comp_guid)
            if not path:
                continue
            comp = open(path, encoding="utf-8", errors="replace").read()
            if shallow(comp, "active", "1") == "0":
                continue
            layers.append((priority, weight, shallow(comp, "m_Name", ""), overrides(comp)))
    layers.sort(key=lambda l: l[0])
    return [(w, n, o) for _p, w, n, o in layers]


def resolve(stack):
    """component -> parameter -> value, blended by weight as AGVolumes.Interp:
    a partial weight lerps from what the stack already said, and over nothing
    takes the override whole."""
    out = {}
    for weight, name, params in stack:
        if weight <= 0:
            continue
        comp = out.setdefault(name, {})
        for k, v in params.items():
            prev = comp.get(k)
            if weight >= 1 or prev is None or type(prev) is not type(v):
                comp[k] = v
            elif isinstance(v, tuple):
                comp[k] = tuple(a + (b - a) * weight for a, b in zip(prev, v))
            else:
                comp[k] = prev + (v - prev) * weight
    return out


# ── The builder's inputs, prepared on the CPU as the game prepares them ──


def _color_balance(temperature, tint):
    """SRP ColorUtils.ColorBalanceToLMSCoeffs."""
    t1, t2 = temperature / 65.0, tint / 65.0
    x = 0.31271 - t1 * (0.1 if t1 < 0 else 0.05)
    y = 2.87 * x - 3 * x * x - 0.27509507 + t2 * 0.05
    X, Z = x / y, (1 - x - y) / y
    lms = (0.7328 * X + 0.4296 - 0.1624 * Z, -0.7036 * X + 1.6975 + 0.0061 * Z, 0.0030 * X + 0.0136 + 0.9834 * Z)
    return np.array([0.949237 / lms[0], 1.03542 / lms[1], 1.08728 / lms[2]])


def _lin(v):
    return np.array([gamma_to_linear(c) for c in v[:3]])


def _smh(v):
    """PrepareShadowsMidtonesHighlights: linear colour + w (x4 when w >= 0), floored at 0."""
    w = v[3] * (4.0 if v[3] >= 0 else 1.0)
    return np.maximum(_lin(v) + w, 0.0)


def _lgg(lift, gamma, gain):
    """PrepareLiftGammaGain: lift x0.15, gamma/gain x0.8, each less its luminance plus w."""
    l, g, k = _lin(lift) * 0.15, _lin(gamma) * 0.8, _lin(gain) * 0.8
    return (
        l - l @ LUMA + lift[3],
        1.0 / np.maximum(g - g @ LUMA + gamma[3] + 1.0, 0.001),
        k - k @ LUMA + gain[3] + 1.0,
    )


def params(grade):
    """The builder's uniforms from the resolved stack, defaults where it is silent."""
    get = lambda comp, key, d: grade.get(comp, {}).get(key, d)  # noqa: E731
    one = (1.0, 1.0, 1.0, 0.0)
    grey = (0.5, 0.5, 0.5, 1.0)
    cf = get("ColorAdjustments", "colorFilter", (1.0, 1.0, 1.0, 1.0))
    lift, gamma, gain = _lgg(get("LiftGammaGain", "lift", one), get("LiftGammaGain", "gamma", one), get("LiftGammaGain", "gain", one))
    mixer = lambda out, r, g, b: np.array(  # noqa: E731
        [get("ChannelMixer", f"{out}OutRedIn", r), get("ChannelMixer", f"{out}OutGreenIn", g), get("ChannelMixer", f"{out}OutBlueIn", b)]
    ) / 100.0
    split_s, split_h = get("SplitToning", "shadows", grey), get("SplitToning", "highlights", grey)
    return {
        "size": 32 if get("PostProcessSetting", "lutSize32", 0.0) > 0.5 else 16,
        "balance": _color_balance(get("WhiteBalance", "temperature", 0.0), get("WhiteBalance", "tint", 0.0)),
        "filter": _lin(cf),
        "hue": get("ColorAdjustments", "hueShift", 0.0) / 360.0,
        "sat": get("ColorAdjustments", "saturation", 0.0) / 100.0 + 1.0,
        "con": get("ColorAdjustments", "contrast", 0.0) / 100.0 + 1.0,
        "splitShadows": np.array(split_s[:3]),
        "splitHighlights": np.array(split_h[:3]),
        "splitBalance": get("SplitToning", "balance", 0.0) / 100.0,
        "mixer": np.stack([mixer("red", 100, 0, 0), mixer("green", 0, 100, 0), mixer("blue", 0, 0, 100)]),
        "shadows": _smh(get("ShadowsMidtonesHighlights", "shadows", one)),
        "midtones": _smh(get("ShadowsMidtonesHighlights", "midtones", one)),
        "highlights": _smh(get("ShadowsMidtonesHighlights", "highlights", one)),
        "limits": np.array(
            [
                get("ShadowsMidtonesHighlights", "shadowsStart", 0.0),
                get("ShadowsMidtonesHighlights", "shadowsEnd", 0.3),
                get("ShadowsMidtonesHighlights", "highlightsStart", 0.55),
                get("ShadowsMidtonesHighlights", "highlightsEnd", 1.0),
            ]
        ),
        "lift": lift,
        "gamma": gamma,
        "gain": gain,
    }


# ── Hidden/RenderPipeline/Lut, fragment, on every texel at once ──


def _soft_light(c, tone):
    """The split-toning blend, per channel: below 0.5 darkens, above lightens."""
    a = 2 * c * tone + c * c * (1 - 2 * tone)
    b = np.sqrt(np.maximum(c, 0)) * (2 * tone - 1) + 2 * c * (1 - tone)
    return np.where(tone >= 0.5, b, a)


def _curve(x):
    """A default TextureCurve, sampled as the shader samples it: 128 texels of
    texel i = i/128, read at x + half a texel, clamped. Identity up to 127/128."""
    return np.clip(np.clip(x, 0.0, 1.0), 0.0, 127.0 / 128.0)


def bake(p):
    """The cube, linear, shape (size, size, size, 3) indexed [b, g, r]."""
    n = p["size"]
    i = np.arange(n) / n  # the idiv: i/size, not i/(size-1)
    b, g, r = np.meshgrid(i, i, i, indexing="ij")
    c = np.stack([r, g, b], axis=-1)

    # White balance in LMS.
    to_lms = np.array([[0.390405, 0.549941, 0.00892632], [0.0708416, 0.963172, 0.00135775], [0.0231082, 0.128021, 0.936245]])
    from_lms = np.array([[2.85847, -1.62879, -0.024891], [-0.210182, 1.1582, 0.000324281], [-0.041812, -0.118169, 1.06867]])
    c = (c @ to_lms.T) * p["balance"]
    c = c @ from_lms.T

    # Contrast, in the log encoding (LogC), about its own mid-grey.
    a = np.log2(np.maximum(c * 5.555556 + 0.047996, 0.0)) * 0.073499784 - 0.027552396
    a = a * p["con"] + 0.027552396
    c = (np.exp2(a * 13.605482) - 0.047996) * 0.17999999

    # Colour filter, then split toning in gamma space.
    c = np.maximum(c * p["filter"], 0.0)
    c = np.power(c, 0.45454547)
    balance = np.clip(np.minimum(c, 1.0) @ LUMA + p["splitBalance"], 0.0, 1.0)[..., None]
    c = _soft_light(c, (1 - balance) * (p["splitShadows"] - 0.5) + 0.5)
    c = _soft_light(c, balance * (p["splitHighlights"] - 0.5) + 0.5)
    c = np.power(np.abs(c), 2.2)

    # Channel mixer, then shadows / midtones / highlights.
    c = c @ p["mixer"].T
    lum = c @ LUMA
    lo, hi = p["limits"][[0, 2]], p["limits"][[1, 3]]
    t = np.clip((lum[..., None] - lo) / (hi - lo), 0.0, 1.0)
    shadow_w = 1 - t[..., 0] ** 2 * (3 - 2 * t[..., 0])
    high_w = t[..., 1] ** 2 * (3 - 2 * t[..., 1])
    mid_w = 1 - shadow_w - high_w
    c = c * p["shadows"] * shadow_w[..., None] + c * p["midtones"] * mid_w[..., None] + c * p["highlights"] * high_w[..., None]

    # Lift, gain, then gamma with the sign kept.
    c = c * p["gain"] + p["lift"]
    c = np.sign(c) * np.power(np.abs(c), p["gamma"])

    # Hue and saturation, through HSV (Unity's RgbToHsv / HsvToRgb). The hue and
    # saturation curves are all at their neutral 0.5 on every stage.
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    px, py, pz, pw = (np.where(G >= B, G, B), np.where(G >= B, B, G), np.where(G >= B, 0.0, -1.0), np.where(G >= B, -1 / 3, 2 / 3))
    qx, qy, qz, qw = (np.where(R >= px, R, px), py, np.where(R >= px, pz, pw), np.where(R >= px, px, R))
    d = qx - np.minimum(qw, qy)
    hue = np.abs(qz + (qw - qy) / (6 * d + 0.0001))
    sat = d / (qx + 0.0001)
    val = qx
    h = hue + p["hue"]
    h = np.where(h > 1, h - 1, np.where(h < 0, h + 1, h))
    k = np.stack([h + 1.0, h + 2 / 3, h + 1 / 3], axis=-1)
    rgb = np.clip(np.abs((k - np.floor(k)) * 6 - 3) - 1, 0.0, 1.0) - 1
    rgb = val[..., None] * (sat[..., None] * rgb + 1)
    luma = (rgb @ LUMA)[..., None]
    c = luma + p["sat"] * (rgb - luma)

    # Master curve, then each channel's.
    return _curve(_curve(c))


def encode(cube):
    """8-bit sRGB, as the game's ARGB32 sRGB strip stores it; red fastest."""
    x = np.clip(cube, 0.0, 1.0)
    s = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.round(s * 255).astype(np.uint8).tobytes()


GRADING_COMPONENTS = ("WhiteBalance", "ColorAdjustments", "SplitToning", "ChannelMixer", "ShadowsMidtonesHighlights", "LiftGammaGain")


def grading(scene, proj, look, notes):
    """The stage's grade for `extras.reze.grading`, or None when it has none.

    The Final pass mixes the graded colour in by SceneSetting._tonemapping, so a
    stage with tonemapping off shows no grade in the game and carries none."""
    if not (look or {}).get("tonemapping"):
        return None
    grade = resolve(volume_stack(scene, proj, notes))
    if "ColorCurves" in grade and grade["ColorCurves"]:
        notes.append("the volume overrides ColorCurves, which the grade leaves at their defaults")
    used = {c: grade[c] for c in GRADING_COMPONENTS if grade.get(c)}
    if not used:
        return None
    p = params(grade)
    return {
        "size": p["size"],
        "format": "rgb8-srgb",
        # The frame it applies to: the game looks up its tonemapped colour,
        # linear, in [0, 1] — the app's is the view transform's output, decoded.
        "input": "display-linear",
        "base64": base64.b64encode(encode(bake(p))).decode("ascii"),
        "from": used,
    }
