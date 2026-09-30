# The game's particle systems, as data the app turns into effects.
#
# A water splash in X348 is a ParticleSystem drawing billboards through the
# game's effect shader (ZTong/Effect_Common). Drawn by a hand-written effect it
# was a guess at every step — its size, its shape, its brightness — and each
# guess was wrong in its own way. So nothing is guessed here: every module that
# shapes the picture is read from the scene, the material's effect settings and
# its own textures go with it, and the app builds one effect per kind of system
# (lib/gltf-stage.ts, particleEffectWgsl) that runs Unity's particle rules and
# the decompiled fragment on the game's pictures.
#
# What is read, per system:
#   main      lifetime, speed, size (per axis), rotation, colour, gravity, the cap
#   emission  rate over time and bursts
#   shape     cone / box / sphere / circle: radius, angle, arc, scale, rotation
#   over life size, rotation, colour (gradients), the flipbook (UV module)
#   clamp     the velocity limit and its dampen
#   custom    the custom-data vectors the material reads (dissolve, offsets)
#   renderer  billboard or stretched, pivot, length scale, colour space
# Curves are sampled through Unity's own Hermite tangents, not averaged.

import math
import os
import re

import yaml

LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
SAMPLES = 16                 # a curve or gradient becomes this many samples across life


def _doc(body, key):
    try:
        return (yaml.load(body, Loader=LOADER) or {}).get(key) or {}
    except yaml.YAMLError:
        return {}


def _hermite(keys, t):
    """Unity's AnimationCurve at t, through each key's tangents."""
    if not keys:
        return 0.0
    if t <= keys[0]["time"]:
        return float(keys[0]["value"])
    if t >= keys[-1]["time"]:
        return float(keys[-1]["value"])
    for a, b in zip(keys, keys[1:]):
        if a["time"] <= t <= b["time"]:
            dt = max(b["time"] - a["time"], 1e-9)
            s = (t - a["time"]) / dt
            m0 = float(a.get("outSlope", 0.0)) * dt
            m1 = float(b.get("inSlope", 0.0)) * dt
            if not (math.isfinite(m0) and math.isfinite(m1)):    # a stepped key
                return float(a["value"])
            s2, s3 = s * s, s * s * s
            return (2 * s3 - 3 * s2 + 1) * a["value"] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b["value"] + (s3 - s2) * m1
    return float(keys[-1]["value"])


def minmax(c, default=0.0):
    """A MinMaxCurve as {lo, hi} plus sampled curves when it has them.

    Unity's modes: 0 a constant, 1 a curve times scalar, 2 random between two
    curves, 3 random between two constants. A particle draws its random
    fraction once (the app does) and blends lo..hi with it."""
    if not isinstance(c, dict):
        return {"lo": default, "hi": default}
    mode = int(c.get("minMaxState", 0))
    k = float(c.get("scalar", default))
    lo = float(c.get("minScalar", k))
    out = {"mode": mode}
    if mode == 0:
        out.update(lo=k, hi=k)
    elif mode == 3:
        out.update(lo=min(lo, k), hi=max(lo, k))
    else:
        hi_keys = (c.get("maxCurve") or {}).get("m_Curve") or []
        lo_keys = (c.get("minCurve") or {}).get("m_Curve") or []
        ts = [i / (SAMPLES - 1) for i in range(SAMPLES)]
        out["curve"] = [k * _hermite(hi_keys, t) for t in ts]
        out["curveLo"] = [k * _hermite(lo_keys if mode == 2 else hi_keys, t) for t in ts]
        out.update(lo=min(out["curveLo"] + out["curve"]), hi=max(out["curveLo"] + out["curve"]))
    return out


def _gradient(g):
    """A Gradient sampled across life, rgba (gamma, as Unity stores it)."""
    nc, na = int(g.get("m_NumColorKeys", 0)), int(g.get("m_NumAlphaKeys", 0))
    ck = [(g[f"ctime{i}"] / 65535.0, g[f"key{i}"]) for i in range(nc)]
    ak = [(g[f"atime{i}"] / 65535.0, g[f"key{i}"]["a"]) for i in range(na)]
    fixed = int(g.get("m_Mode", 0)) == 1

    def at(keys, t, pick):
        if not keys:
            return 1.0
        if t <= keys[0][0]:
            return pick(keys[0][1])
        for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
            if t0 <= t <= t1:
                if fixed:
                    return pick(v1)
                s = (t - t0) / max(t1 - t0, 1e-9)
                return pick(v0) * (1 - s) + pick(v1) * s
        return pick(keys[-1][1])

    out = []
    for i in range(SAMPLES):
        t = i / (SAMPLES - 1)
        out.append([at(ck, t, lambda v: v["r"]), at(ck, t, lambda v: v["g"]), at(ck, t, lambda v: v["b"]), at(ak, t, lambda v: v)])
    return out


def colour(c):
    """A MinMaxGradient: {mode, lo, hi} rgba, or sampled gradients."""
    mode = int(c.get("minMaxState", 0))
    rgba = lambda v: [float(v["r"]), float(v["g"]), float(v["b"]), float(v["a"])]   # noqa: E731
    if mode == 0:
        return {"mode": 0, "lo": rgba(c["maxColor"]), "hi": rgba(c["maxColor"])}
    if mode == 2:
        return {"mode": 2, "lo": rgba(c["minColor"]), "hi": rgba(c["maxColor"])}
    grad = _gradient(c.get("maxGradient") or {})
    lo = _gradient(c.get("minGradient") or {}) if mode == 3 else grad
    return {"mode": mode, "gradient": grad, "gradientLo": lo}


def system_spec(ps, renderer):
    """Everything about one system that is the same for every emitter of its kind."""
    init = ps.get("InitialModule") or {}
    shape = ps.get("ShapeModule") or {}
    emission = ps.get("EmissionModule") or {}
    size = ps.get("SizeModule") or {}
    rot = ps.get("RotationModule") or {}
    col = ps.get("ColorModule") or {}
    uv = ps.get("UVModule") or {}
    clamp = ps.get("ClampVelocityModule") or {}
    custom = ps.get("CustomDataModule") or {}
    on = lambda m: int(m.get("enabled", 0)) == 1   # noqa: E731
    bursts = [
        {"time": float(b.get("time", 0.0)), "count": minmax(b.get("countCurve"), 0.0)["hi"], "cycles": int(b.get("cycleCount", 1)), "interval": float(b.get("repeatInterval", 0.01))}
        for b in (emission.get("m_Bursts") or [])
    ]
    spec = {
        "duration": float(ps.get("lengthInSec", 5.0)),
        "looping": int(ps.get("looping", 1)) == 1,
        "prewarm": int(ps.get("prewarm", 0)) == 1,
        "scalingMode": int(ps.get("scalingMode", 1)),
        "simulationSpace": int((init or {}).get("simulationSpace", ps.get("moveWithTransform", 0)) or 0),
        "max": int(init.get("maxNumParticles", 1000)),
        "lifetime": minmax(init.get("startLifetime"), 5.0),
        "speed": minmax(init.get("startSpeed"), 5.0),
        "size3D": int(init.get("size3D", 0)) == 1,
        "size": [minmax(init.get("startSize"), 1.0), minmax(init.get("startSizeY"), 1.0), minmax(init.get("startSizeZ"), 1.0)],
        "rotation3D": int(init.get("rotation3D", 0)) == 1,
        "rotation": minmax(init.get("startRotation"), 0.0),         # radians
        "color": colour(init.get("startColor") or {}),
        "gravity": minmax(init.get("gravityModifier"), 0.0),
        "emission": {"on": on(emission), "rate": minmax(emission.get("rateOverTime"), 0.0), "bursts": bursts},
        "shape": {
            "on": on(shape),
            "type": int(shape.get("type", 4)),
            "radius": float((shape.get("radius") or {}).get("value", 1.0)),
            "radiusThickness": float(shape.get("radiusThickness", 1.0)),
            "angle": float(shape.get("angle", 25.0)),
            "arc": float((shape.get("arc") or {}).get("value", 360.0)),
            "length": float(shape.get("length", 5.0)),
            "position": [float(shape.get("m_Position", {}).get(k, 0.0)) for k in "xyz"],
            "rotation": [float(shape.get("m_Rotation", {}).get(k, 0.0)) for k in "xyz"],
            "scale": [float(shape.get("m_Scale", {}).get(k, 1.0)) for k in "xyz"],
            "randomDirection": float(shape.get("randomDirectionAmount", 0.0)),
        },
        "sizeOverLife": {"on": on(size), "separate": int(size.get("separateAxes", 0)) == 1, "x": minmax(size.get("curve"), 1.0), "y": minmax(size.get("y"), 1.0)} if on(size) else None,
        "rotationOverLife": {"on": True, "z": minmax(rot.get("curve"), 0.0)} if on(rot) else None,     # radians/second
        "colorOverLife": colour((col.get("gradient") or {})) if on(col) else None,
        "uv": {
            "tiles": [int(uv.get("tilesX", 1)), int(uv.get("tilesY", 1))],
            "mode": int(uv.get("animationType", 0)),           # 0 whole sheet, 1 single row
            "row": int(uv.get("rowIndex", 0)),
            "frame": minmax(uv.get("frameOverTime"), 0.0),
            "start": minmax(uv.get("startFrame"), 0.0),
            "cycles": float(uv.get("cycles", 1.0)),
        } if on(uv) and int(uv.get("mode", 0)) == 0 else None,
        "clamp": {"limit": minmax(clamp.get("magnitude"), 1.0), "dampen": float(clamp.get("dampen", 0.0))} if on(clamp) and int(clamp.get("separateAxis", 0)) == 0 else None,
        "custom": {
            f"{s}_{i}": minmax(custom.get(f"vector{s}_{i}"), 0.0)
            for s in (0, 1) for i in range(4) if on(custom) and int(custom.get(f"mode{s}", 0)) == 1
        } if on(custom) else None,
        "renderer": {
            "mode": int(renderer.get("m_RenderMode", 0)),       # 0 billboard, 1 stretched, 2 horizontal, 3 vertical
            "pivot": [float(renderer.get("m_Pivot", {}).get(k, 0.0)) for k in "xyz"],
            "lengthScale": float(renderer.get("m_LengthScale", 2.0)),
            "velocityScale": float(renderer.get("m_VelocityScale", 0.0)),
            "linear": int(renderer.get("m_ApplyActiveColorSpace", 1)) == 1,
        },
    }
    return spec


def systems(scene):
    """Every active billboard / stretched ParticleSystem: (spec, renderer material guids,
    GameObject, transform id, name)."""
    bodies = {}
    for fid, (cls, body) in scene.docs.items():
        if cls == 198:
            go = re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body)
            if go:
                bodies[int(go.group(1))] = body
    out = []
    for fid, (cls, body) in scene.docs.items():
        if cls != 199:
            continue
        r = _doc(body, "ParticleSystemRenderer")
        if int(r.get("m_Enabled", 1)) != 1 or int(r.get("m_RenderMode", 0)) not in (0, 1):
            continue
        go = int(r["m_GameObject"]["fileID"])
        if go not in bodies or not scene.active_in_hierarchy(go):
            continue
        ps = _doc(bodies[go], "ParticleSystem")
        mats = [m.get("guid") for m in (r.get("m_Materials") or []) if isinstance(m, dict) and m.get("guid")]
        out.append((system_spec(ps, r), mats, go, scene.transform_of(go), scene.name_of(go)))
    return out
