# What a Unity material IS, read off the exported project: which texture a
# shader samples for its colour and its relief, the tint it multiplies in, how
# opaque it is, whether it is a sky or an effect sheet; and the scene's own
# world, its reflection probe ridden on its ambient gradient as an equirect.
#
# Every rule here was settled against a game's decompiled shader source
# (tools/stages/README.md, "Read the game's shaders") rather than guessed from a
# property name, and each keeps the case that settled it beside it.
#
# The readers unity_to_glb.py builds a stage from. The PMX writer that once
# lived beside them is retired: a stage goes through Blender to glTF now.

import math
import os
import re
import sys
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


def transform(matrix, translation, v):
    m, t = matrix, translation
    return tuple(t[r] + sum(m[r][c] * v[c] for c in range(3)) for r in range(3))


def rotate(matrix, v):
    return tuple(sum(matrix[r][c] * v[c] for c in range(3)) for r in range(3))


def face_origin(matrix, translation):
    """The matrix turned about the vertical, through the pivot, so the card's
    face points at the stage centre. The card is the XY plane of its mesh, so
    its face is the matrix's third column."""
    nx, nz = matrix[0][2], matrix[2][2]
    tx, tz = -translation[0], -translation[2]
    if math.hypot(nx, nz) < 1e-9 or math.hypot(tx, tz) < 1e-9:
        return matrix
    turn = math.atan2(tx, tz) - math.atan2(nx, nz)
    c, s = math.cos(turn), math.sin(turn)
    ry = ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))
    return tuple(tuple(sum(ry[r][k] * matrix[k][col] for k in range(3)) for col in range(3)) for r in range(3))


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


# A TERRAIN blends numbered layers by a splat map: `_AlbedoTex_1`, `_AlbedoTex_2`
# and their normals, weighted by the R, G, B, A of `_V_T2M_Control`
# (SimPipeline/PBR/Standard_PBR_2). A PMX material holds one texture, so a
# terrain wears the layer carrying the most weight — X309's beach is 97% its
# sand, tiled 80 x 80. Read as an ordinary material it had no albedo at all and
# came out a flat dark teal.
_SPLAT_LAYER = {}


def terrain_layer(material, png_root, proj):
    """The dominant splat layer's number (1-4), or None for an ordinary material."""
    control = material["textures"].get("_V_T2M_Control")
    if not control:
        return None
    guid = control["guid"]
    if guid not in _SPLAT_LAYER:
        layer = 1
        src = png_for(png_root, proj.path(guid) or "")
        if src and os.path.exists(src):
            from PIL import Image  # noqa: PLC0415

            im = Image.open(src).convert("RGBA").resize((64, 64))
            px = list(im.getdata())
            weights = [sum(p[c] for p in px) for c in range(4)]
            layer = 1 + max(range(4), key=lambda c: weights[c])
        _SPLAT_LAYER[guid] = layer
    layer = _SPLAT_LAYER[guid]
    return layer if f"_AlbedoTex_{layer}" in material["textures"] else None


def albedo_slot(material, png_root, proj):
    layer = terrain_layer(material, png_root, proj)
    return material["textures"][f"_AlbedoTex_{layer}"] if layer else slot(material, ALBEDO_SLOTS)


def normal_slot(material, png_root, proj):
    layer = terrain_layer(material, png_root, proj)
    if layer and f"_NormalTex_{layer}" in material["textures"]:
        return material["textures"][f"_NormalTex_{layer}"]
    return slot(material, NORMAL_SLOTS)


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


# A sky's own properties, which is how one is recognised when its shader
# reference cannot be trusted. AssetRipper remaps a material whose shader was
# not exported onto whatever it can find — X305's sky dome comes through
# claiming to be SimPipeline/PBR/Standard while carrying _SkyColorBackground,
# _CloudColor and _Star_RChannel — so the PROPERTY SET identifies the family and
# the shader name is a hint.
# The sky shaders' own colours. X309's dome is a remapped sky material with
# cloud, night and daytime colours and nothing else a surface would carry; its
# moon hangs nearly as far out as the dome, so the size test cannot find it.
SKY_PROPERTIES = (
    "_SkyColorBackground",
    "_CloudColor",
    "_SunGlowColor",
    "_Star_RChannel",
    "_CloudColorOverAll",
    "_NightColor",
    "_DayTimeColor",
)


def is_sky(material):
    return sum(1 for k in SKY_PROPERTIES if k in material["colors"]) >= 2


# Effect materials drawn on a cylinder — filled by convert() before its
# renderers are read. See is_sky_layer.
BACKDROP_EFFECTS = set()


def is_sky_layer(material, shader):
    """An effect sheet or a billboard named for the sky IS the sky, and so is an
    effect sheet drawn on a cylinder, whatever it is called.

    X309's night is three effect layers on cylinders round the whole scene —
    a nebula, twinkling stars, a purple band where they meet the sea — plus a
    moon on a billboard. X203a's view from its windows is eleven more
    cylinders, named for nothing but their number. As effect sheets, they
    measure as a faint overlay and the decal rule drops them; as sky they are
    kept, drawn unlit and two-sided, and cast nothing.
    """
    if not material or not shader:
        return False
    name = material["name"].lower()
    if is_effect_decal(shader) and material["name"] in BACKDROP_EFFECTS:
        return True
    return ("sky" in name or "moon" in name) and (is_effect_decal(shader) or shader.endswith("SceneBillboard"))


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
        # LINEAR, as the game has them: its pipeline takes RenderSettings'
        # ambient colours through `.linear` before building the probe
        # (AGTools/AGSimPipeline.cs, SetupEnvironmentLighting). Baked as stored
        # they are gamma values read as light — X340's night sky came out two to
        # six times too bright and washed out of its blue.
        def srgb(c):
            return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

        ambient = {**ambient, "sky": srgb(ambient["sky"]), "equator": srgb(ambient["equator"]), "ground": srgb(ambient["ground"])}
        # The gradient's own average over the sphere: the sky half averages
        # (sky + equator) / 2 and the ground half (ground + equator) / 2. The
        # probe's structure is divided to a mean of 1, so this is the level the
        # bake already has, and the gain below only takes back what the
        # structure's correlation with the sky moved. Targeting the sky half
        # alone lifted a scene with a black ground by a third.
        target = [(ambient["sky"][i] + 2.0 * ambient["equator"][i] + ambient["ground"][i]) * 0.25 * ambient["intensity"] for i in range(3)]

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
