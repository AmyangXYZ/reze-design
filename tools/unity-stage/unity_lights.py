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
# WHAT HAS TO BE FITTED is how bright, because the two falloffs differ in shape:
#
#   game    L · (1 - (d/r)⁴)² · min(1/d², 1/shapeRadius)     d in Unity units
#   engine  J · (1 - (d/r)²)²
#
# The game is inverse-square, capped by a per-light shape radius; the engine's
# intensity is the brightness AT the lamp and falls to zero at its reach. No
# single J makes the curves agree, so J is the one that lands the same total
# light, per channel, on the stage's own surfaces: every triangle the lamp can
# reach and the game lets it light, weighted by area and N·L and the cone. A
# cookie is sampled at each triangle, so a lamp that projects stained glass
# arrives carrying the glass's colour and the fraction of light it lets through.
#
# THE GAME'S COLOUR IS (colour × intensity).linear, not colour.linear ×
# intensity. It runs with GraphicsSettings.lightsUseLinearIntensity false (see
# AGTools/AGSimPipeline.cs in the rip), so the product is converted from gamma,
# and a lamp at intensity 17 is 17^2.2 in linear light, not 17.
#
# THE SUN takes one π that the lamps do not. The engine's direct diffuse is
# sun·N·L/π; URP's is colour·N·L. Its positional lamps divide by nothing, and
# neither does the game's, so a lamp carries the game's number as it stands.

import bisect
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


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _inverse3(m):
    """A 3x3 inverse — a lamp's world matrix can carry its fixture's scale."""
    a, b, c = m
    det = _dot(a, _cross(b, c))
    if abs(det) < 1e-12:
        return None
    cols = (_cross(b, c), _cross(c, a), _cross(a, b))
    return tuple(tuple(cols[j][i] / det for j in range(3)) for i in range(3))


class Surfaces:
    """The stage's triangles in Unity world space, for asking what a lamp lights.

    Kept as centroid, unit normal and area — the game shades per pixel, and at
    the density of a stage mesh a triangle's centre stands for its pixels well
    enough to weigh one falloff against another. Sorted on x so a lamp only
    walks the slab its reach covers.
    """

    def __init__(self):
        self.items = []
        self._xs = None

    def add(self, a, b, c, normal, layer, rendering_mask):
        e = _cross(_sub(b, a), _sub(c, a))
        area = 0.5 * math.sqrt(_dot(e, e))
        if area <= 0:
            return
        centroid = ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)
        self.items.append((centroid, normal, area, layer, rendering_mask))

    def near(self, p, reach):
        if self._xs is None:
            self.items.sort(key=lambda s: s[0][0])
            self._xs = [s[0][0] for s in self.items]
        lo = bisect.bisect_left(self._xs, p[0] - reach)
        hi = bisect.bisect_right(self._xs, p[0] + reach)
        return self.items[lo:hi]


class Cookie:
    """A spot's cookie as the shader samples it: linear rgb × alpha.

    The texture is sRGB (m_ColorSpace 1), so its colour is decoded before it is
    averaged; alpha is coverage and stays as it is.
    """

    def __init__(self, path, size=128):
        from PIL import Image  # noqa: PLC0415

        im = Image.open(path).convert("RGBA").resize((size, size), Image.BILINEAR)
        self.size = size
        lut = [gamma_to_linear(i / 255) for i in range(256)]
        self.px = [(lut[r] * a / 255, lut[g] * a / 255, lut[b] * a / 255) for r, g, b, a in im.getdata()]

    def at(self, u, v):
        # Unity's v runs up the image; a PIL row runs down it.
        u = min(1.0, max(0.0, u))
        v = min(1.0, max(0.0, v))
        x = min(self.size - 1, int(u * self.size))
        y = min(self.size - 1, int((1.0 - v) * self.size))
        return self.px[y * self.size + x]


def fit_lamp(light, surfaces, cookie=None):
    """The linear colour × intensity the engine's lamp needs, or None.

    None when the lamp lights nothing the game lets it light — no surface of
    the stage inside its reach, facing it, inside its cone.
    """
    p, r = light["position"], light["range"]
    spot = light["type"] == "spot"
    aim = light["direction"]
    cos_outer = math.cos(math.radians(light["angle"] * 0.5))
    cos_inner = math.cos(math.radians(light["innerAngle"] * 0.5))
    cone_scale = 1.0 / max(cos_inner - cos_outer, 0.001)
    cap = 1.0 / light["shapeRadius"] if light["shapeRadius"] > 0 else float("inf")
    tan_half = math.tan(math.radians(light["angle"] * 0.5))
    to_local = _inverse3(light["matrix"]) if cookie else None

    game = [0.0, 0.0, 0.0]
    ours = 0.0
    r2 = r * r
    for c, n, area, layer, rmask in surfaces.near(p, r):
        if not (light["cullingMask"] >> layer) & 1 or not (rmask & light["renderingLayerMask"]):
            continue
        d = _sub(p, c)
        dist2 = _dot(d, d)
        if dist2 >= r2:
            continue
        dist = math.sqrt(max(dist2, 6.1035156e-05))
        to_light = (d[0] / dist, d[1] / dist, d[2] / dist)
        ndl = _dot(n, to_light)
        if ndl <= 0:
            continue
        cone = 1.0
        if spot:
            cone = min(1.0, max(0.0, (-_dot(to_light, aim) - cos_outer) * cone_scale)) ** 2
            if cone <= 0:
                continue
        w = area * ndl * cone
        t2 = dist2 / r2
        g = w * max(1.0 - t2 * t2, 0.0) ** 2 * min(1.0 / max(dist2, 6.1035156e-05), cap)
        k = (1.0, 1.0, 1.0)
        if cookie:
            # The game projects the cookie through a perspective of the whole
            # spot angle, square, looking down the lamp's +Z.
            local = tuple(sum(to_local[i][j] * -d[j] for j in range(3)) for i in range(3))
            if local[2] <= 0:
                continue
            k = cookie.at(local[0] / (local[2] * tan_half) * 0.5 + 0.5, local[1] / (local[2] * tan_half) * 0.5 + 0.5)
        ours += w * (1.0 - t2) ** 2
        for i in range(3):
            game[i] += g * k[i]
    if ours <= 0:
        return None
    radiance = game_radiance(light)
    return tuple(radiance[i] * game[i] / ours for i in range(3))


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


def stage_lights(scene, surfaces, cookie_path, to_pmx, scale, name):
    """The rig as the document holds it, plus what was left out and why.

    `cookie_path(guid)` finds a cookie's decoded PNG. Lamps are ordered
    nearest the origin first: that is where the camera opens, and the engine
    takes the first 48 when a scene holds more.
    """
    lamps, notes, sun = [], [], None
    cookies = {}
    for light in scene.lights():
        if not light["on"]:
            notes.append(f"{light['name']}: switched off in the game")
            continue
        if light["type"] == "directional":
            if sun is None:
                sun = sun_of(light)
            else:
                notes.append(f"{light['name']}: a second directional light")
            continue
        if light["type"] not in ("point", "spot") or light["extensionType"] or light["dummy"]:
            notes.append(f"{light['name']}: a {light['type']} light the engine has no lamp for")
            continue
        cookie = None
        if light["type"] == "spot" and light["cookie"]:
            path = cookie_path(light["cookie"])
            if path not in cookies:
                cookies[path] = Cookie(path) if path and os.path.exists(path) else None
            cookie = cookies[path]
            if cookie is None:
                notes.append(f"{light['name']}: its cookie has no decoded image, so it lights the whole cone")
        linear = fit_lamp(light, surfaces, cookie)
        if linear is None:
            notes.append(f"{light['name']}: lights no surface of the stage")
            continue
        colour, intensity = as_colour_and_strength(linear)
        entry = {
            "position": [round(v, 3) for v in to_pmx(light["position"], scale)],
            "color": colour,
            "intensity": round(intensity, 4),
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
