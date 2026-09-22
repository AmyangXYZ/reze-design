# A game light's colour, the way the app and Blender take it.
#
# COLOUR IS (colour x intensity).linear: the game runs with
# lightsUseLinearIntensity off, so intensity 17 is 17^2.2 in linear light
# (AGTools/AGSimPipeline.cs in the rip). The radiance carries as it is — the
# engine lights as Blender does, strength·albedo·N·L/π for the sun and
# intensity/d² over π for a lamp — so no π is taken or given back here.

import math

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
