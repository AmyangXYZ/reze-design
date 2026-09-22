# A Unity scene's lighting rig, as the lamps and the sun of a reze scene.
#
# Written beside the PMX as <Name>.lights.json. The app reads it once, when the
# stage is uploaded, into the scene document: the lamps join the Lamps tab and
# the sun takes the game's. From then on they are the scene's, edited like any
# other lamp.
#
# WHAT CARRIES OVER UNCHANGED: position and aim (through to_pmx), reach
# (range × scale), and the cone. The game's cone term is
# saturate(dot(-L, aim)·z + w)² with z, w from the whole-cone outer and inner
# angles, which is exactly the engine's, so both angles pass through as they are.
#
# BRIGHTNESS CARRIES OVER TOO, because the two falloffs are the same curve:
#
#   game    L · (1 - (d/r)⁴)² · min(1/d², 1/shapeRadius)     d in Unity units
#   engine  J · (1 - (d/R)⁴)² / max(d², 2.5²)                d in PMX units
#
# The engine's document lamps fall off as the inverse square, windowed to zero
# at their reach and held flat inside a 2.5-unit bulb — Aether Gazer's usual
# 0.1 shape radius at MMD scale. d in PMX units is d × scale in Unity's, so
# J = L × scale². A cookie is folded in as its mean colour × coverage: a spot
# projecting stained glass arrives carrying the glass's colour and the share of
# light it lets through.
#
# THE GAME'S COLOUR IS (colour × intensity).linear, not colour.linear ×
# intensity. It runs with GraphicsSettings.lightsUseLinearIntensity false (see
# AGTools/AGSimPipeline.cs in the rip), so the product is converted from gamma,
# and a lamp at intensity 17 is 17^2.2 in linear light, not 17.
#
# THE SUN takes one π that the lamps do not. The engine's direct diffuse is
# sun·N·L/π; URP's is colour·N·L. Its positional lamps divide by nothing, and
# neither does the game's, so a lamp carries the game's number as it stands.

import json
import math
import os


def gamma_to_linear(v):
    """Unity's Mathf.GammaToLinearSpace, which extends past 1 as a 2.2 power."""
    if v <= 0.04045:
        return v / 12.92
    if v < 1.0:
        return ((v + 0.055) / 1.055) ** 2.4
    return v**2.2


def linear_to_srgb(v):
    v = min(1.0, max(0.0, v))
    return v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def hex_of(linear):
    return "#" + "".join(f"{round(linear_to_srgb(c) * 255):02x}" for c in linear)


def game_radiance(light):
    """What the game's shader receives as this light's colour, in linear."""
    return tuple(gamma_to_linear(c * light["intensity"]) for c in light["color"])


def as_colour_and_strength(linear):
    """A linear RGB as the document's hex colour and a scalar that scales it."""
    peak = max(linear)
    if peak <= 0:
        return "#000000", 0.0
    return hex_of(tuple(c / peak for c in linear)), peak


class Cookie:
    """A spot's cookie as the shader samples it, averaged: linear rgb × alpha.

    The texture is sRGB (m_ColorSpace 1), so its colour is decoded before it is
    averaged; alpha is coverage and stays as it is.
    """

    def __init__(self, path, size=128):
        from PIL import Image  # noqa: PLC0415

        im = Image.open(path).convert("RGBA").resize((size, size), Image.BILINEAR)
        lut = [gamma_to_linear(i / 255) for i in range(256)]
        px = [(lut[r] * a / 255, lut[g] * a / 255, lut[b] * a / 255) for r, g, b, a in im.getdata()]
        self.mean = tuple(sum(p[i] for p in px) / len(px) for i in range(3))


def sun_of(light):
    """The game's directional light as the scene's sun settings.

    The engine's sun is the direction light TRAVELS, built from azimuth and
    elevation as (-cos e·sin a, -sin e, -cos e·cos a); a Unity light travels
    down its +Z, which to_pmx turns into (-x, y, -z).
    """
    fx, fy, fz = light["direction"]
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, -fy))))
    azimuth = math.degrees(math.atan2(fx, fz)) % 360.0
    colour, peak = as_colour_and_strength(game_radiance(light))
    return {
        "color": colour,
        "strength": round(peak * math.pi, 3),
        "azimuth": round(azimuth, 1),
        "elevation": round(elevation, 1),
        "shadow": bool(light["shadows"]),
    }


def moon_sun(game_sun_light, moon):
    """The key light from the stage's moon: travelling from it to the stage
    centre, in the moon's colour, as bright as the game's own key.

    Brightness is matched as luminance, so a cool light lands where the warm
    one did rather than wherever a hue change would leave it."""
    px, py, pz = moon["position"]
    n = math.sqrt(px * px + py * py + pz * pz) or 1.0
    light = dict(game_sun_light, direction=(-px / n, -py / n, -pz / n))
    sun = sun_of(light)
    game = game_radiance(game_sun_light)
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]  # noqa: E731
    colour = tuple(gamma_to_linear(c) for c in moon["color"])
    peak = max(colour) or 1.0
    sun["color"] = hex_of(tuple(c / peak for c in colour))
    sun["strength"] = round(lum(game) / max(lum(tuple(c / peak for c in colour)), 1e-6) * math.pi, 3)
    return sun


def stage_lights(scene, cookie_path, to_pmx, scale, name, moon=None):
    """The rig as the document holds it, plus what was left out and why.

    `cookie_path(guid)` finds a cookie's decoded PNG. Lamps are ordered nearest
    the origin first: that is where the camera opens, and the engine takes the
    first 128 when a scene holds more.
    """
    lamps, notes, sun = [], [], None
    cookies = {}
    for light in scene.lights():
        if not light["on"]:
            notes.append(f"{light['name']}: switched off in the game")
            continue
        if light["type"] == "directional":
            if sun is None:
                sun = moon_sun(light, moon) if moon else sun_of(light)
            else:
                notes.append(f"{light['name']}: a second directional light")
            continue
        if light["type"] not in ("point", "spot") or light["extensionType"] or light["dummy"]:
            notes.append(f"{light['name']}: a {light['type']} light the engine has no lamp for")
            continue
        tint = (1.0, 1.0, 1.0)
        if light["type"] == "spot" and light["cookie"]:
            path = cookie_path(light["cookie"])
            if path not in cookies:
                cookies[path] = Cookie(path) if path and os.path.exists(path) else None
            if cookies[path] is None:
                notes.append(f"{light['name']}: its cookie has no decoded image, so it lights the whole cone")
            else:
                tint = cookies[path].mean
        radiance = game_radiance(light)
        colour, intensity = as_colour_and_strength(tuple(radiance[i] * tint[i] * scale * scale for i in range(3)))
        if intensity <= 0:
            notes.append(f"{light['name']}: gives no light")
            continue
        entry = {
            "position": [round(v, 3) for v in to_pmx(light["position"], scale)],
            "color": colour,
            "intensity": round(intensity, 3),
            "radius": round(light["range"] * scale, 3),
        }
        if light["type"] == "spot":
            entry["aim"] = [round(v, 4) for v in to_pmx(light["direction"], 1.0)]
            entry["angle"] = round(light["angle"], 2)
            entry["innerAngle"] = round(min(light["innerAngle"], light["angle"]), 2)
        lamps.append(entry)
    lamps.sort(key=lambda l: sum(v * v for v in l["position"]))
    for i, lamp in enumerate(lamps):
        lamp["name"] = f"{name} {i + 1:02d}"
    out = {"lamps": [{"name": l.pop("name"), **l} for l in lamps]}
    if sun:
        out["sun"] = sun
    return out, notes
