# A Unity scene as a stage the app loads: geometry and its textures.
#
#   python3 tools/unity-stage/unity_to_pmx.py \
#     --project "stages/x305/ExportedProject" \
#     --scene   "Assets/ComScene/ABResources/Levels/X305.unity" \
#     --out     stages/x305-stage --name X305
#
# It writes:
#
#   X305.pmx           geometry, one material per Unity material, names kept
#   tex/               the albedo each material samples
#   maps/              the relief map each material samples, named for that
#                      material's albedo: tex/T_D.png pairs with maps/T_N.png
#
# THE LIGHTING RIG IS NOT IMPORTED. A game scene's sun, ambient, exposure and
# lamps were authored for its own renderer and its own subject — X305's four
# lamps stand inside a piano and reach 0.7 m — and carried across they fight the
# app's defaults, which are calibrated for a character standing in frame. The
# probe is written out because it is a picture, and installing it stays a
# decision. Nor are the PBR maps imported: a look per material sampling normal,
# metal, roughness and AO plus an environment reflection cost this stage its
# frame rate, and the albedo alone reads as the same garden. Water's ripple map
# is the one exception, and it earns it — those ripples ARE that texture, and
# procedural noise in its place reads as moving grain.
#
# What a stage DOES state travels in the PMX, where MMD already has words for
# it: two-sided from _Cull, the shadow bits, ambient 1 on the sky dome and the
# painted glass so they arrive unlit, a plant's own vertical tint folded into
# its material colour, and each material's SOURCE SHADER in the memo — the free
# text field MMD shows and nothing reads, which is how the app gives a pane of
# glass named Terrain_X333_005 the glass look without a sidecar.
#
# NO BLENDER AND NO FBX. The exported project already holds meshes, materials
# and a scene, and every hop through another format is a hop that renames a
# material or loses a map. The material name is what a person assigns a look to
# in the app, so it is the one thing that must survive, and here nothing touches
# it.
#
# WHAT IT ASSUMES, and checks: uncompressed meshes with their data inline, one
# submesh per material slot, and triangles. Anything else raises rather than
# writing a stage that is quietly missing a building.

import argparse
import json
import math
import os
import re
import shutil
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from unity_mesh import Mesh  # noqa: E402
from unity_scene import Project, Scene, read_material  # noqa: E402

# Unity units to PMX units, and the turn between the two coordinate systems.
#
# The axes differ by a half turn about Y (x and z both negate), which is a
# ROTATION rather than a mirror: the determinant stays +1, so triangle winding
# and normals carry over untouched.
#
# THE SCALE IS NOT 12.5, and the reasoning matters because 12.5 is the number
# everyone reaches for. MMD's own convention is 1 unit = 8 cm — a 158 cm figure
# stands about 20 units — so metres convert at 12.5. That is right if a Unity
# unit is a metre, and in Aether Gazer it is not: measured off X305, a piano
# bench is 0.75 Unity units tall where a real bench is 0.48, and the grand piano
# and the pergola agree at the same factor. The game's props run about 1.5x life
# size, so 12.5 puts an MMD character in a giant's furniture.
#
# 8 is 12.5 divided by that 1.55, and it lands the bench at 6 units — a seat an
# MMD model can sit on. A game whose unit IS a metre wants --scale 12.5.
SCALE = 8.0


def to_pmx(v, scale=None):
    s = SCALE if scale is None else scale
    return (-v[0] * s, v[1] * s, -v[2] * s)


def transform(matrix, translation, v):
    m, t = matrix, translation
    return tuple(t[r] + sum(m[r][c] * v[c] for c in range(3)) for r in range(3))


def rotate(matrix, v):
    return tuple(sum(matrix[r][c] * v[c] for c in range(3)) for r in range(3))


def normalise(v):
    n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) ** 0.5
    return (v[0] / n, v[1] / n, v[2] / n) if n > 1e-9 else (0.0, 1.0, 0.0)


# ── The PMX file ────────────────────────────────────────────────────────────


def pmx_text(s):
    b = s.encode("utf-8")
    return struct.pack("<i", len(b)) + b


def write_pmx(path, name, vertices, faces, materials, textures):
    """A PMX 2.0 with one bone and no physics — a stage is scenery, not a rig.

    Index sizes are declared from the counts rather than fixed, which is what
    keeps a 200k-vertex stage inside a format whose smaller files use one byte.
    """
    vertex_index_size = 1 if len(vertices) < 256 else 2 if len(vertices) < 65536 else 4
    texture_index_size = 1 if len(textures) < 128 else 2
    material_index_size = 1 if len(materials) < 128 else 2
    out = bytearray()
    out += b"PMX "
    out += struct.pack("<f", 2.0)
    out += bytes([8, 1, 0, vertex_index_size, texture_index_size, material_index_size, 1, 1, 1])
    for s in (name, name, f"Converted from a Unity scene by tools/unity-stage.", ""):
        out += pmx_text(s)

    out += struct.pack("<i", len(vertices))
    for p, n, uv in vertices:
        out += struct.pack("<8f", p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1])
        out += bytes([0])  # BDEF1
        out += struct.pack("<B", 0)  # the one bone
        out += struct.pack("<f", 1.0)  # edge scale

    # WOUND THE OTHER WAY. The half turn about Y preserves handedness, so this
    # is not about the axes: Unity and PMX disagree about which winding faces
    # the viewer, and a stage written in Unity's order renders inside out —
    # every wall visible only from behind it. Measured rather than assumed: a
    # PMX the app already draws correctly has the cross product of every
    # triangle pointing AWAY from its own shading normals under the right-hand
    # rule, and this is what puts ours there too.
    code = {1: "<B", 2: "<H", 4: "<i"}[vertex_index_size]
    out += struct.pack("<i", len(faces) * 3)
    for a, b, c in faces:
        out += struct.pack(code, a) + struct.pack(code, c) + struct.pack(code, b)

    out += struct.pack("<i", len(textures))
    for t in textures:
        out += pmx_text(t)

    tcode = {1: "<b", 2: "<h"}[texture_index_size]
    out += struct.pack("<i", len(materials))
    for m in materials:
        out += pmx_text(m["name"]) + pmx_text(m["name"])
        out += struct.pack("<4f", *m["diffuse"])
        out += struct.pack("<3f", *m.get("specular", (0.0, 0.5, 1.0)))
        out += struct.pack("<f", m.get("shininess", 5.0))
        # AMBIENT IS WHERE A PMX SAYS "DRAW THIS AS PAINTED". MMD's convention
        # is ambient 1: whatever the light adds, the sum saturates, so the
        # texture arrives at its own brightness. The app reads it back off the
        # loaded material table and puts those materials in an Unlit group.
        #
        # A wall carries the neutral half every exporter writes and is lit by
        # the scene. A sky dome and a painted light shaft carry 1 — a sky shaded
        # like a wall is a dim grey dome, which is what it looks like: the sun
        # rakes across a sphere, so most of the horizon faces away from it.
        amb = 1.0 if m["unlit"] else 0.5
        out += struct.pack("<3f", amb, amb, amb)
        out += bytes([m["flag"]])
        out += struct.pack("<4f", 0.0, 0.0, 0.0, 1.0)  # edge colour
        out += struct.pack("<f", 1.0)  # edge size
        out += struct.pack(tcode, m["texture"])
        out += struct.pack(tcode, -1)  # sphere
        out += bytes([0])  # sphere mode: none
        out += bytes([1])  # shared toon
        out += bytes([0])  # toon 0
        out += pmx_text(m.get("memo", ""))
        out += struct.pack("<i", m["faces"] * 3)

    out += struct.pack("<i", 1)
    out += pmx_text("全ての親") + pmx_text("Root")
    out += struct.pack("<3f", 0.0, 0.0, 0.0)
    out += struct.pack("<b", -1)  # parent
    out += struct.pack("<i", 0)  # layer
    out += struct.pack("<H", 0x0002 | 0x0004 | 0x0008)  # rotatable, movable, visible
    out += struct.pack("<3f", 0.0, 0.0, 0.0)  # tail offset

    out += struct.pack("<i", 0)  # morphs
    out += struct.pack("<i", 1)  # one display frame, holding the root bone
    out += pmx_text("Root") + pmx_text("Root") + bytes([1]) + struct.pack("<i", 1) + bytes([0]) + struct.pack("<B", 0)
    out += struct.pack("<i", 0)  # rigid bodies
    out += struct.pack("<i", 0)  # joints
    open(path, "wb").write(bytes(out))


# ── Materials ───────────────────────────────────────────────────────────────

# Which texture slot a shader keeps its colour in. `_MainTex` is the old
# built-in name and the effect shaders still use it.
ALBEDO_SLOTS = ("_AlbedoTex", "_MainTex", "_Tex", "_Texture")
PROPERTY_SLOTS = ("_PropertyTex",)
# The one map that travels, and only for water.
#
# The PBR maps were dropped on purpose: a look per material sampling normal,
# metal, roughness and AO cost a stage its frame rate for a difference the
# albedo already carried. Water is the exception, because its ripples ARE this
# texture — a tiling normal map the shader scrolls twice at different speeds.
# Reproduced with procedural noise it reads as moving grain: noise has no
# ripple shapes in it, and a bump taken from its screen-space derivative aliases
# into scan lines wherever a pixel outgrows the pattern. A sampled map has the
# right shapes and mipmaps, which answers both at once.
RIPPLE_SLOTS = ("_RippleTex",)
NORMAL_SLOTS = ("_NormalTex", "_BumpMap", "_NormalMap")


def slot(material, names):
    for n in names:
        if n in material["textures"]:
            return material["textures"][n]
    return None


def material_tint(material, shader):
    """The colour a material multiplies its albedo by.

    THE SHADER DECIDES WHICH FIELD IS LIVE, not whether a texture happens to be
    bound. `SimPipeline/PBR/*` reads `_AlbedoColor` always — with a texture it
    tints it, without one it IS the surface — while `_Color` sits at the white
    it was constructed with. Every other family states its colour in `_Color`.
    
    Reading it the other way costs a whole building: X305's glass canopy binds
    no texture and carries _AlbedoColor (0.45, 0.53, 0.60) at alpha 0.46, so
    falling back to _Color exported it as an opaque white sheet — which from
    above is a white slab over the plaza, and the plaza is then "missing".
    """
    colors, alpha = material["colors"], material["alpha"]
    # A PLANT IS TINTED BY ITS OWN NORMAL, and the mean of that is a constant.
    #
    # SimPipeline/Scene/Plant ends with, from the game's own shader source:
    #
    #   t      = worldNormal.y * 0.5 + 0.5
    #   colour = lit * lerp(_BottomColor, _TopColor, t) * 2
    #
    # Sky-facing leaves take the bright HDR canopy colour, downward ones the
    # dark. Averaged over the normals of a leaf cluster t is 0.5, so the mean
    # tint is simply top + bottom — which is what a PMX material colour can
    # hold, and it is the difference between a yellow-green tree and a grey one.
    # The atlases are dark (linear mean 0.04-0.15, measured), which is why the
    # tint is allowed over 1 and why the product still lands under 0.3.
    #
    # `_AlbedoColor` is NOT read here: it appears nowhere in that shader, so
    # applying it tinted plants by a number Unity never used.
    #
    # Keyed off the SHADER, not the VEGETATION keyword — that keyword gates the
    # wind branch, and four of the eight materials on this shader do without it
    # while still carrying the gradient. Measured across all eight, the product
    # lands between 0.01 and 0.35, brightest texel 1.4.
    if shader == "SimPipeline/Scene/Plant" and "_TopColor" in colors and "_BottomColor" in colors:
        top, bottom = colors["_TopColor"], colors["_BottomColor"]
        return tuple(top[i] + bottom[i] for i in range(3)), alpha.get("_Color", 1.0)
    pbr = bool(shader) and shader.startswith("SimPipeline/PBR/")
    if (pbr or slot(material, ("_AlbedoTex",))) and "_AlbedoColor" in colors:
        return colors["_AlbedoColor"], alpha.get("_AlbedoColor", 1.0)
    if "_Color" in colors:
        return colors["_Color"], alpha.get("_Color", 1.0)
    return (1.0, 1.0, 1.0), 1.0


# The effect-decal family: a wet patch, a scorch, a light pool. Painted rather
# than lit, premultiplied, ZWrite off, and its coverage comes from its own
# textures — see EFFECT_DECAL_NOTE at the call below.
EFFECT_SHADERS = ("Effect_Common",)


def is_effect_decal(shader):
    return bool(shader) and shader.rsplit("/", 1)[-1] in EFFECT_SHADERS


_DECAL_COVER = {}


def decal_has_coverage(material, png_root, proj):
    """Whether this decal's own albedo alpha says where it is.

    Its shader builds coverage from four maps through dissolve and mask
    keywords, and no single exported texture can carry that. But some of these
    albedos DO hold the shape — X323's spill is 66% clear with droplets in
    between, which is the fine granularity the original has — while others are
    solid to the edge and have their coverage entirely in maps we do not ship.
    Measured rather than assumed, because the same shader gives both: the solid
    one drew as an amber slab across the floor, and its neighbour is a puddle.
    """
    bound = slot(material, ALBEDO_SLOTS)
    src = png_for(png_root, proj.path(bound["guid"]) or "") if bound else None
    if not (src and os.path.exists(src)):
        return False
    if src not in _DECAL_COVER:
        from PIL import Image  # noqa: PLC0415

        with Image.open(src) as im:
            if im.mode != "RGBA":
                _DECAL_COVER[src] = False
            else:
                px = im.convert("RGBA").resize((64, 64)).load()
                v = [px[x, y][3] for x in range(64) for y in range(64)]
                # A fifth of it has to be genuinely clear for the alpha to be a
                # shape rather than a rectangle with soft corners.
                _DECAL_COVER[src] = sum(1 for a in v if a < 8) / len(v) > 0.05
    return _DECAL_COVER[src]


def surface_alpha(material, tint_alpha, shader=None, decal_coverage=False):
    """How opaque the material is.

    An alpha means opacity only where the material is actually blended: Unity's
    Standard blend state src One / dst Zero is an opaque pass that never reads
    the channel, and believing it exports invisible glass. Mode 10,
    OneMinusSrcAlpha, is the blend that gives the number meaning.
    """
    floats = material["floats"]
    # THE DECAL FAMILY STATES ITS MODE, and its shader source says what the
    # number means: `_DstBlend ("混合模式(1:Add 10:Blend)")`, applied as
    #
    #   o.sv_target.xyz = coverage * colour          // premultiplied
    #   o.sv_target.w   = coverage * (_DstBlend - 1) / 9
    #
    # so 1 writes alpha 0 — pure add under its One/OneMinusSrcAlpha pass — and
    # 10 writes the coverage. Neither number is `_Color`'s alpha, which the
    # fragment only ever uses as a colour.
    #
    # NEITHER MODE IS REPRODUCIBLE HERE, so the family is left out rather than
    # approximated. Add needs a blend this renderer has no material path for,
    # and Blend needs the coverage — which that shader builds from FOUR textures
    # (`_MainTex`, `_MainPlusTex`, `_MaskTex`, `_NoiseTex`) through dissolve and
    # mask keywords, with a soft-particle depth fade on top. One exported
    # texture cannot carry it, and the textures disagree about what a single
    # constant should be: X323's six decals range from an alpha channel that is
    # 255 everywhere to one whose maximum is 45. Pick 1.0 and the first becomes
    # an opaque slab z-fighting the floor; pick the colour's alpha and the rest
    # are a haze that is not what the shader draws either.
    #
    # With a usable one the material gets out of the way at 1.0 and the texture
    # draws the puddle. Without, alpha 0 — discarded per fragment, costing
    # nothing, and leaving the material in the table for anyone who wants to
    # give it a look by hand.
    if is_effect_decal(shader):
        return 1.0 if decal_coverage else 0.0
    blended = int(floats.get("_DstBlend", floats.get("_BlendDst", 0.0))) == 10
    keywords = material["keywords"]
    if "CUTOFF" in keywords:
        return 1.0
    # `OPAQUE` IN THE KEYWORDS IS NOT OPACITY. It tracks the shader's
    # `RenderType` tag, which categorises a material for replacement shaders and
    # says nothing about how it blends. X333's pool carries it while its pass
    # reads `QUEUE = Transparent-1` and `Blend SrcAlpha OneMinusSrcAlpha`, and
    # its water is 7% opaque over the pool floor. Reading the keyword as opacity
    # exported that pool as a solid teal slab.
    if not blended and "TRANSPARENT_PREMULT" not in keywords:
        return 1.0
    if tint_alpha > 0.01:
        return tint_alpha
    # ZERO IS A STATEMENT WHEN NOTHING ELSE CAN CARRY ONE.
    #
    # A premultiplied pane usually keeps its transparency in its albedo TEXTURE
    # and blends on that per texel, so the material colour's alpha is a spare
    # field sitting at whatever it was left — reading it as opacity would erase
    # a window. Hence the guard: alpha 0 with a texture means "opaque, ask the
    # texture".
    #
    # With no albedo texture there is nothing to ask. X333's pool cover is the
    # case: SimPipeline/PBR/Glass, one reflection normal map and no albedo,
    # `_AlbedoColor` alpha 0 — and the guard exported it as a pale blue slab
    # lying across the water. That shader computes its alpha per pixel,
    # `(1 - NdotV) * _Fresnel`, so `_Fresnel` is the most it ever reaches and
    # the honest constant to stand in for a curve we cannot draw yet.
    if not slot(material, ALBEDO_SLOTS):
        fresnel = material["floats"].get("_Fresnel")
        return round(float(fresnel), 4) if fresnel else 0.25
    return 1.0


# ── What a surface is made of, as three numbers ──────────────────────────────

_PROPERTY_MEAN = {}


def property_triple(material, png_root, proj):
    """(metal, roughness, occlusion) for this material, averaged over its own map.

    Their `_PropertyTex` carries the three in R, G and B, remapped per material
    by `_PropertyMin`/`_PropertyMax` — X323's kitchen counter reads metal 1.00,
    its floor roughness 0.21, where this app draws every stage material at a
    flat 0.5 and no metal at all. A counter comes out plastic and a polished
    floor comes out matte.

    Averaged rather than sampled, because the map itself is not exported: one
    triple per material rides in the PMX and one shared look reads it, so a
    whole stage keeps ONE pipeline. The variation this cannot carry is the
    within-material kind — that floor ranges 0 to 0.72 across its texture — and
    the mean is still the difference between polished and matte.
    """
    lo = material["colors"].get("_PropertyMin")
    hi = material["colors"].get("_PropertyMax")
    bound = slot(material, PROPERTY_SLOTS)
    if not (lo and hi and bound):
        return None
    src = png_for(png_root, proj.path(bound["guid"]) or "")
    if not (src and os.path.exists(src)):
        return None
    if src not in _PROPERTY_MEAN:
        from PIL import Image  # noqa: PLC0415

        with Image.open(src) as im:
            px = im.convert("RGB").resize((64, 64), Image.LANCZOS).load()
            n = 64 * 64
            _PROPERTY_MEAN[src] = [sum(px[x, y][i] for x in range(64) for y in range(64)) / (n * 255.0) for i in range(3)]
    mean = _PROPERTY_MEAN[src]
    return tuple(min(1.0, max(0.0, lo[i] + (hi[i] - lo[i]) * mean[i])) for i in range(3))


# A sky's own properties, which is how one is recognised when its shader
# reference cannot be trusted. AssetRipper remaps a material whose shader was
# not exported onto whatever it can find — X305's sky dome comes through
# claiming to be SimPipeline/PBR/Standard while carrying _SkyColorBackground,
# _CloudColor and _Star_RChannel — so the PROPERTY SET identifies the family and
# the shader name is a hint.
SKY_PROPERTIES = ("_SkyColorBackground", "_CloudColor", "_SunGlowColor", "_Star_RChannel")


def is_sky(material):
    return sum(1 for k in SKY_PROPERTIES if k in material["colors"]) >= 2


# Where the decoded images live.
#
# A project's Texture2D is a serialised asset, not an image — copying it gives a
# file no browser can open — and the export writes the decoded PNGs beside the
# project under `_png_textures`, mirroring the asset tree. So a texture is
# resolved by PATH rather than by guid: the same relative path under that root,
# with a .png extension.
def png_for(png_root, asset_path):
    if not png_root or not asset_path:
        return None
    marker = os.sep + "Assets" + os.sep
    i = asset_path.find(marker)
    if i < 0:
        return None
    rel = asset_path[i + len(marker) :]
    candidate = os.path.join(png_root, os.path.splitext(rel)[0] + ".png")
    return candidate if os.path.exists(candidate) else None


def copy_image(src, dst, cap, drop_alpha=False):
    """Copy an image, shrinking it to `cap` on its longest edge.

    A game ships 2048² albedos because a phone streams them in and out; a stage
    the app has to UPLOAD carries all of them at once, and X305's full set is
    390 MB against 30 at 1024. The engine samples group maps without a mip
    chain, so a larger map buys shimmer as much as detail.

    `drop_alpha` FLATTENS THE CHANNEL, and an opaque material needs it flattened.
    An albedo's alpha is only transparency when the shader reads it as such;
    under an OPAQUE render mode it is spare storage, and these stages use it —
    X323's floor is 47% mid-alpha and its bar's books are 100%. Carried through,
    MMD semantics multiply it into the surface: the floor lands in the alpha
    bucket, its grout lines go see-through, and being blended it draws in author
    order and fights everything it overlaps. One channel, three symptoms.
    """
    from PIL import Image  # noqa: PLC0415

    if not cap and not drop_alpha:
        shutil.copyfile(src, dst)
        return
    with Image.open(src) as im:
        if cap and max(im.size) > cap:
            k = cap / max(im.size)
            im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
        if drop_alpha and im.mode in ("RGBA", "LA", "PA"):
            im = im.convert("RGB")
        elif not cap:
            shutil.copyfile(src, dst)
            return
        im.save(dst)


# ── The scene's own sky, as something to light and reflect with ─────────────


def cube_strip_to_equirect(strip_path, out_path, width=1024, ambient=None):
    """A Unity reflection probe as the world this engine can light with.

    THE AMBIENT IS THE COLOUR; THE PROBE IS ONLY THE DETAIL.

    Unity runs two things at once: a trilight AMBIENT — one colour overhead, one
    at the horizon, one below — lighting every surface diffusely, and a
    reflection PROBE its speculars mirror. This engine has one world doing both
    jobs, so installing the probe alone does not add the room: it REPLACES the
    scene's ambient with a dark room average, and the set goes dark and blue.

    So the gradient is what this image IS, per direction, exactly Unity's own
    interpolation — and the probe rides on top as relative structure with its
    own level divided out. Diffuse then matches the ambient the scene declares,
    warm ground and all, while a mirror still sees the shape of the room.

    The strip is +X, -X, +Y, -Y, +Z, -Z top to bottom, Unity's own order. LDR,
    because the export decoded a BC6H cube to 8 bits: the range is gone and the
    direction is not, which is the half that matters here.
    """
    from PIL import Image  # noqa: PLC0415

    with Image.open(strip_path) as im:
        rgb = im.convert("RGB")
        face = rgb.width
        if rgb.height != face * 6:
            raise ValueError(f"{strip_path}: {rgb.size} is not six square faces")
        faces = [rgb.crop((0, i * face, face, (i + 1) * face)).load() for i in range(6)]

    height = width // 2
    target = None
    if ambient:
        target = [(ambient["sky"][i] + ambient["equator"][i]) * 0.5 * ambient["intensity"] for i in range(3)]

    # MEASURED OVER SOLID ANGLE, the only average that means anything here: a
    # texel's contribution to irradiance is its solid angle, and an equirect's
    # poles are stretched across pixels covering almost nothing. Measured flat,
    # X323's probe came out +13% BLUE against its own target, because the bright
    # parts of a room are its windows and they are the cool ones.
    rows = []
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for y in range(height):
        theta = math.pi * (y + 0.5) / height
        sy = math.cos(theta)
        r = math.sin(theta)
        row = []
        for x in range(width):
            # The composite's own convention: u = 0.5 + atan2(x, z)/2pi.
            phi = ((x + 0.5) / width - 0.5) * 2.0 * math.pi
            sx = r * math.sin(phi)
            sz = r * math.cos(phi)
            ax, ay, az = abs(sx), abs(sy), abs(sz)
            if ax >= ay and ax >= az:
                idx, u, v, m = (0, -sz, -sy, ax) if sx > 0 else (1, sz, -sy, ax)
            elif ay >= az:
                idx, u, v, m = (2, sx, sz, ay) if sy > 0 else (3, sx, -sz, ay)
            else:
                idx, u, v, m = (4, sx, -sy, az) if sz > 0 else (5, -sx, -sy, az)
            fx = min(face - 1, max(0, int((u / m * 0.5 + 0.5) * face)))
            fy = min(face - 1, max(0, int((v / m * 0.5 + 0.5) * face)))
            c = faces[idx][fx, fy]
            lin = [
                ((c[i] / 255.0) / 12.92 if c[i] / 255.0 <= 0.04045 else (((c[i] / 255.0) + 0.055) / 1.055) ** 2.4)
                for i in range(3)
            ]
            row.append(lin)
            for i in range(3):
                total[i] += lin[i] * r
            weight += r
        rows.append(row)

    # THE PROBE'S OWN LEVEL, DIVIDED OUT — this is what makes it structure
    # rather than colour. Multiplied in raw, a dark ceiling stays dark however
    # bright the gradient says the sky is, which is the whole failure this bake
    # exists to undo: measured that way, X323's sky band came out 0.17 where its
    # ambient asks for 1.00.
    #
    # STRUCTURE is then a ratio around 1, and only PART of it is taken: at full
    # weight a black patch of probe still zeroes the gradient under it, and an
    # 8-bit cube decode has plenty of those. Half keeps the room legible in a
    # mirror while the diffuse stays the colour the scene declared.
    probe_mean = [max(total[i] / max(weight, 1e-9), 1e-6) for i in range(3)]
    STRUCTURE = 0.5

    lit = []
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for y, row in enumerate(rows):
        theta = math.pi * (y + 0.5) / height
        sy = math.cos(theta)
        r = math.sin(theta)
        if ambient:
            t = abs(sy)
            far = ambient["sky"] if sy >= 0.0 else ambient["ground"]
            grad = [(ambient["equator"][i] + (far[i] - ambient["equator"][i]) * t) * ambient["intensity"] for i in range(3)]
        out_row = []
        for lin0 in row:
            if ambient:
                lin0 = [
                    grad[i] * max(0.0, 1.0 + STRUCTURE * (lin0[i] / probe_mean[i] - 1.0))
                    for i in range(3)
                ]
            out_row.append(lin0)
            for i in range(3):
                total[i] += lin0[i] * r
            weight += r
        lit.append(out_row)
    rows = lit

    gain = [1.0, 1.0, 1.0]
    if target and weight > 0.0:
        for i in range(3):
            mean = total[i] / weight
            gain[i] = (target[i] / mean) if mean > 1e-5 else 1.0

    out = bytearray()
    out += b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n"
    out += f"-Y {height} +X {width}\n".encode()
    for row in rows:
        for lin0 in row:
            lin = [lin0[i] * gain[i] for i in range(3)]
            peak = max(lin)
            if peak < 1e-8:
                out += bytes([0, 0, 0, 0])
                continue
            e = math.floor(math.log2(peak)) + 1
            scale = 256.0 / (2.0**e)
            out += bytes([min(255, int(lin[0] * scale)), min(255, int(lin[1] * scale)), min(255, int(lin[2] * scale)), e + 128])
    with open(out_path, "wb") as fh:
        fh.write(bytes(out))
    return width, height


# ── The whole pass ──────────────────────────────────────────────────────────


def convert(project_root, scene_path, out_dir, name, png_root=None, albedo_cap=0, normal_cap=0, verbose=True):
    proj = Project(project_root)
    scene = Scene(os.path.join(project_root, scene_path))
    os.makedirs(os.path.join(out_dir, "tex"), exist_ok=True)

    materials_by_guid = {}
    for guid, path in proj.by_guid.items():
        if path.endswith(".mat") and os.path.exists(path):
            try:
                materials_by_guid[guid] = read_material(path)
            except Exception as e:  # noqa: BLE001 — a malformed .mat is data, not a crash
                print(f"[unity] unreadable material {path}: {e}")

    meshes = {}

    def mesh(guid):
        if guid not in meshes:
            path = proj.path(guid)
            meshes[guid] = Mesh(path) if path and os.path.exists(path) else None
        return meshes[guid]

    # Geometry, gathered per material so a PMX's face ranges fall out of it.
    per_material = {}
    used_order = []
    skipped = []
    # LOD1 and below: the same objects again at lower detail, which Unity shows
    # one of at a time and a converter would otherwise draw all of at once.
    fallbacks = scene.lod_fallback_renderers()
    dropped_lods = 0
    for r in scene.renderers():
        if not r["mesh"] or not r["enabled"]:
            continue
        if r["id"] in fallbacks:
            dropped_lods += 1
            continue
        m = mesh(r["mesh"])
        if m is None:
            skipped.append(r["name"])
            continue
        # A batched renderer's geometry is ALREADY in world space — that is what
        # batching did — so it takes the identity rather than its own transform.
        if r["batched"]:
            matrix, translation = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (0.0, 0.0, 0.0)
        else:
            matrix, translation = scene.world_matrix(r["transform"])
        # A scale can be negative or non-uniform, so normals take the same
        # matrix and are renormalised rather than assumed unit.
        for slot_index, guid in enumerate(r["materials"]):
            i = r["firstSubMesh"] + slot_index
            if i >= len(m.submeshes):
                break
            mat = materials_by_guid.get(guid)
            key = mat["name"] if mat else f"unnamed_{guid[:8]}"
            if key not in per_material:
                per_material[key] = {"vertices": [], "faces": [], "guid": guid}
                used_order.append(key)
            bucket = per_material[key]
            remap = {}
            for tri in m.triangles(i):
                out = []
                for v in tri:
                    if v not in remap:
                        p = to_pmx(transform(matrix, translation, m.positions[v]))
                        n = to_pmx(rotate(matrix, m.normals[v]))
                        uv = m.uvs[v]
                        remap[v] = len(bucket["vertices"])
                        # PMX's V runs the other way from Unity's.
                        bucket["vertices"].append((p, normalise(n), (uv[0], 1.0 - uv[1])))
                    out.append(remap[v])
                bucket["faces"].append(tuple(out))

    # One PMX vertex list, with each material's faces contiguous after it.
    vertices, faces, pmx_materials, textures, texture_index = [], [], [], [], {}
    relief_written = set()
    decals = []

    # A DOME IS KNOWN BY ITS SIZE, not by its name or its properties.
    #
    # is_sky reads the property set because AssetRipper remaps a material whose
    # shader was not exported, and X305's dome came through claiming to be
    # Standard while carrying _SkyColorBackground. X323's carries nothing: it is
    # a plain Standard material called X318_sky, and no property test will ever
    # catch it. What IS true of every sky is that it encloses the scene — this
    # one reaches 14,081 units where the whole rest of the stage fits inside
    # 305 — so that is what gets measured.
    #
    # Left lit and casting, such a dome puts its far wall between the sun and
    # the floor: the stage renders fully shadowed, and a character standing on
    # it throws a shadow nobody can see because there is no lit floor to darken.
    # WHICH ALBEDOS STILL NEED THEIR ALPHA. Decided per TEXTURE rather than per
    # material, because one sheet can dress a cutout leaf and an opaque plank:
    # a texture keeps its channel if ANY material asks transparency of it, and
    # loses it only when every user renders opaque.
    needs_alpha = set()
    for key, bucket in per_material.items():
        m = materials_by_guid.get(bucket["guid"])
        if not m:
            continue
        sh = proj.shader_name(m["shader_guid"])
        tint, ta = material_tint(m, sh)
        transparent = (
            surface_alpha(m, ta, sh, decal_has_coverage(m, png_root, proj)) < 1.0
            or "CUTOFF" in m["keywords"]
            or is_sky(m)
            or is_effect_decal(sh)
        )
        a = slot(m, ALBEDO_SLOTS)
        if transparent and a:
            needs_alpha.add(a["guid"])

    reach = {}
    for key, bucket in per_material.items():
        reach[key] = max((max(abs(c) for c in v[0]) for v in bucket["vertices"]), default=0.0)
    domes = set()
    for key, r in reach.items():
        others = max((v for k, v in reach.items() if k != key), default=0.0)
        if r > 3.0 * others and others > 0.0:
            domes.add(key)

    for key in used_order:
        bucket = per_material[key]
        base = len(vertices)
        vertices.extend(bucket["vertices"])
        faces.extend((a + base, b + base, c + base) for a, b, c in bucket["faces"])
        mat = materials_by_guid.get(bucket["guid"])

        shader = proj.shader_name(mat["shader_guid"]) if mat else None
        tint, tint_alpha = material_tint(mat, shader) if mat else ((1.0, 1.0, 1.0), 1.0)
        alpha = surface_alpha(mat, tint_alpha, shader, decal_has_coverage(mat, png_root, proj) if mat else False) if mat else 1.0
        if is_effect_decal(shader) and alpha == 0.0:
            decals.append(key)
        albedo = slot(mat, ALBEDO_SLOTS) if mat else None
        index = -1
        albedo_rel = None
        if albedo:
            src = png_for(png_root, proj.path(albedo["guid"]) or "")
            if src:
                rel = "tex/" + os.path.basename(src)
                albedo_rel = rel
                if rel not in texture_index:
                    copy_image(src, os.path.join(out_dir, rel), albedo_cap, albedo["guid"] not in needs_alpha)
                    texture_index[rel] = len(textures)
                    textures.append(rel)
                index = texture_index[rel]
        # SLOT 0 IS THE SURFACE'S OWN RELIEF. Water scrolls a ripple map there;
        # everything else puts its normal map in the same place, because both
        # are read by the same socket and a material has only one of them.
        #
        # Shipped per material and bound per draw call, so one look covers a
        # whole set and each prop still gets its own grain — the wood on the
        # panelling, the tread on the plate, the ribbing on a stool rim. Without
        # them every surface takes light as though it were polished flat, which
        # is most of what separates this from the frame it was ripped out of.
        relief = slot(mat, RIPPLE_SLOTS) if mat else None
        if not relief and mat:
            relief = slot(mat, NORMAL_SLOTS)
        # THE STRENGTH RIDES IN SHININESS, and zero is the important value.
        #
        # Unity states a `_NormalScale` per material and most of them are 1, but
        # not all — four here sit between 0.285 and 0.5, and applying every map
        # at full strength is not what the original does.
        #
        # Zero when no map was shipped, because an empty slot samples WHITE and
        # white read as a tangent normal is (1,1,1): a 45 degree tilt on every
        # surface that has no relief at all. Nine materials in this stage. At
        # strength 0 the look's mix returns the geometric normal exactly, which
        # is what "no map" has to mean.
        relief_scale = 0.0
        if relief and mat:
            relief_scale = float(mat["floats"].get("_NormalScale", mat["floats"].get("_BumpScale", 1.0)))
        if relief:
            src = png_for(png_root, proj.path(relief["guid"]) or "")
            if src:
                # NAMED SO THE FOLDER STATES THE PAIRING. The app finds a
                # material's relief map by rule — its albedo's file name with the
                # trailing `_D` swapped for `_N`, under maps/ — so no sidecar has
                # to be written, read or kept in step, and a person opening the
                # folder can see which map belongs to which surface.
                #
                # Written under THAT name rather than the source's own, because
                # the game does not always agree with itself: five of this set's
                # materials sample a normal named for a different texture than
                # their albedo. Naming is the converter's job precisely so the
                # rule can be a rule.
                #
                # A material with no albedo — water, whose colour its look
                # computes — is named for itself instead, sanitised the same way
                # on both sides.
                stem = (
                    re.sub(r"_D$", "", os.path.splitext(os.path.basename(albedo_rel))[0])
                    if albedo_rel
                    else re.sub(r"[^A-Za-z0-9_.-]", "_", key)
                )
                rel = f"maps/{stem}_N.png"
                target = os.path.join(out_dir, rel)
                if not os.path.exists(target):
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    copy_image(src, target, normal_cap)
                relief_written.add(rel)
        # THE FLAG BITS, and the shadow ones are not optional.
        #
        # 0x01 no cull — Unity's _Cull 0, a two-sided material.
        # 0x02 ground shadow, 0x04 cast into the shadow map, 0x08 receive it.
        #
        # A PMX with the shadow bits clear is a stage that casts nothing: the
        # engine reads bit 0x04 per material and skips the rest of the pass. In
        # a garden that is the whole picture — the reference frame of this scene
        # is dappled leaf shadow across a marble floor, and without these bits
        # the floor is a flat slab under a tree that is not there.
        #
        # A sheer material still casts: the shadow pass alpha-tests per texel,
        # so a leaf card throws leaf-shaped shadow rather than a rectangle.
        # A SKY IS TWO-SIDED WHATEVER ITS CULL MODE SAYS. It is a dome seen from
        # the inside, so single-sided drawing culls exactly the faces the camera
        # is looking at, and the background colour shows through the hole — a
        # polygon in the sky that follows the view, because which facets face
        # away follows the view. Unity gets away with `_Cull 2` because its
        # winding agrees with its normals there; ours is flipped globally to
        # match PMX, and a dome is where that assumption breaks.
        sky = key in domes or (mat and is_sky(mat))
        two_sided = mat and (int(mat["floats"].get("_Cull", 2.0)) == 0 or sky)
        # AND THE SKY CASTS NOTHING. It encloses the scene, so a shadow map
        # asked to cover it covers two thousand units instead of the garden —
        # every real shadow in the frame loses the resolution to a dome that
        # should not be in the pass at all.
        shadow_bits = 0x00 if sky else (0x02 | 0x04 | 0x08)
        # A PREMULTIPLIED SHEET IS PAINTED LIGHT, not a surface. Glass, a light
        # shaft, a decal: the shader writes its colour and lets the background
        # through, and lighting it adds sun and ambient on top of light that is
        # already in the texture — which turns a greenhouse roof into an opaque
        # slab. It says so the same way the sky does.
        # A LIT FAMILY IS NEVER PAINTED LIGHT, whatever its blend says. Glass
        # and water are premultiplied because they let the scene through, not
        # because their colour was finished in Photoshop — they have a BRDF, a
        # reflection and a fresnel, and the host has looks for both. Marked
        # unlit, X333's pool cover joined the Unlit group and no look could ever
        # claim it: a flat pale slab lying across the water.
        lit_family = bool(shader) and shader.rsplit("/", 1)[-1] in ("Glass", "Ripplet")
        unlit = bool(mat) and not lit_family and (
            sky or "TRANSPARENT_PREMULT" in mat["keywords"] or is_effect_decal(shader)
        )
        # (metal, roughness, occlusion) into the PMX's SPECULAR field. The
        # format carries one and MMD's own renderer barely uses it; the engine
        # already ships it to the GPU for "graph nodes that want them". Absent
        # on a material with no property map, where the neutral default stands.
        triple = property_triple(mat, png_root, proj) if mat else None
        pmx_materials.append(
            {
                "name": key,
                "diffuse": (tint[0], tint[1], tint[2], alpha),
                "specular": triple or (0.0, 0.5, 1.0),
                "shininess": round(relief_scale, 4),
                "flag": (0x01 if two_sided else 0x00) | shadow_bits,
                "unlit": unlit,
                "texture": index,
                "faces": len(bucket["faces"]),
                "memo": (proj.shader_name(mat["shader_guid"]) or "") if mat else "",
            }
        )


    write_pmx(os.path.join(out_dir, f"{name}.pmx"), name, vertices, faces, pmx_materials, textures)

    # AND THE WORLD, beside it — the scene's ambient gradient with its
    # reflection probe baked in as structure. A separate file because the
    # geometry is the stage and this is how the stage is lit; the app installs
    # it when nothing else is in the World slot, and leaves it alone when
    # something is.
    look = scene.scene_setting()
    probe = png_for(png_root, proj.path(look["reflectionGuid"]) or "") if look and look.get("reflectionGuid") else None
    sky_written = False
    if probe:
        ambient = scene.ambient()
        try:
            cube_strip_to_equirect(
                probe,
                os.path.join(out_dir, f"{name}.hdr"),
                ambient=ambient if ambient and ambient["mode"] == 1 else None,
            )
            sky_written = True
        except Exception as e:  # noqa: BLE001 — a probe in another layout is data, not a crash
            print(f"[unity] REFLECTION PROBE NOT CONVERTED: {e}")

    if verbose:
        print(
            f"[unity] {len(vertices):,} vertices, {len(faces):,} triangles, {len(pmx_materials)} materials, "
            f"{len(textures)} textures -> {out_dir}/{name}.pmx"
        )
        if domes:
            print(f"[unity] sky dome: {', '.join(sorted(domes))} — unlit, two-sided, casts nothing")
        if decals:
            print(f"[unity] {len(decals)} effect decals left out (coverage lives in maps we do not ship): {', '.join(sorted(decals))}")
        if sky_written:
            print(f"[unity] world -> {out_dir}/{name}.hdr (its ambient gradient, with the probe as structure)")
        if relief_written:
            print(f"[unity] {len(relief_written)} relief maps -> {out_dir}/maps/ (named <albedo>_N, no sidecar)")
        if dropped_lods:
            print(f"[unity] {dropped_lods} LOD fallback renderers dropped (level 0 kept)")
        if skipped:
            print(f"[unity] {len(skipped)} renderers had no readable mesh: {', '.join(skipped[:5])}")
    return {"vertices": len(vertices), "faces": len(faces), "materials": len(pmx_materials), "skipped": skipped}


def main():
    global SCALE
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True, help="the ExportedProject folder")
    p.add_argument("--scene", required=True, help="the .unity scene, relative to the project")
    p.add_argument("--out", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--png", default=None, help="the decoded PNG tree; defaults to _png_textures beside the project")
    p.add_argument("--scale", type=float, default=SCALE, help="PMX units per Unity unit (8 for AG, 12.5 if a unit is a metre)")
    p.add_argument("--albedo", type=int, default=0, help="longest edge for albedo maps, 0 keeps the source")
    p.add_argument("--normal", type=int, default=0, help="longest edge for normal maps, 0 keeps the source")
    a = p.parse_args()
    SCALE = a.scale
    png = a.png or os.path.join(os.path.dirname(os.path.abspath(a.project)), "_png_textures")
    convert(a.project, a.scene, a.out, a.name, png, a.albedo, a.normal)


if __name__ == "__main__":
    main()
