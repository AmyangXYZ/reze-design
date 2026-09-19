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
#   X305.hdr           the scene's reflection probe as an equirect, for the
#                      World (HDRI) slot — written, never installed
#   X305.maps.json     water only: the ripple normal map its shader scrolls,
#                      plus maps/ — omitted when the scene has no water
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
        out += struct.pack("<3f", 0.0, 0.0, 0.0)  # specular
        out += struct.pack("<f", 5.0)  # shininess
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


def surface_alpha(material, tint_alpha):
    """How opaque the material is.

    An alpha means opacity only where the material is actually blended: Unity's
    Standard blend state src One / dst Zero is an opaque pass that never reads
    the channel, and believing it exports invisible glass. Mode 10,
    OneMinusSrcAlpha, is the blend that gives the number meaning.
    """
    floats = material["floats"]
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


def copy_image(src, dst, cap):
    """Copy an image, shrinking it to `cap` on its longest edge.

    A game ships 2048² albedos because a phone streams them in and out; a stage
    the app has to UPLOAD carries all of them at once, and X305's full set is
    390 MB against 30 at 1024. The engine samples group maps without a mip
    chain, so a larger map buys shimmer as much as detail.
    """
    if not cap:
        shutil.copyfile(src, dst)
        return
    from PIL import Image  # noqa: PLC0415 — only needed when capping

    with Image.open(src) as im:
        if max(im.size) <= cap:
            shutil.copyfile(src, dst)
            return
        k = cap / max(im.size)
        im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS).save(dst)


# ── The scene's own sky, as something to light and reflect with ─────────────


def cube_strip_to_equirect(strip_path, out_path, width=1024, target=None):
    """A Unity reflection probe (six faces stacked in one image) as a Radiance
    equirect, which is what the World (HDRI) slot takes.

    THE FLOOR'S POLISH LIVES HERE. A game stage's glossy surfaces reflect the
    scene's baked probe, not a sky gradient — marble mirroring the planters is
    what separates the reference frame from ours — and the probe is exactly the
    picture to reflect. It lights better than a three-colour gradient too,
    because it is the room rather than a guess about the room.

    The strip is +X, -X, +Y, -Y, +Z, -Z top to bottom, Unity's own order. LDR,
    because the export decoded a BC6H cube to 8 bits: the range is gone and the
    direction is not, which is the half that matters for a reflection.
    """
    from PIL import Image  # noqa: PLC0415

    with Image.open(strip_path) as im:
        rgb = im.convert("RGB")
        face = rgb.width
        if rgb.height != face * 6:
            raise ValueError(f"{strip_path}: {rgb.size} is not six square faces")
        faces = [rgb.crop((0, i * face, face, (i + 1) * face)).load() for i in range(6)]

    # NORMALISED TO THE SCENE'S OWN AMBIENT, per channel.
    #
    # The probe arrives as an 8-bit decode of an HDR cube: its direction is
    # intact and its LEVEL is not — a mean luma of 0.06, and blue, because most
    # of a garden probe is sky. Installed as a world at that level it owns the
    # ambient and the whole scene goes dark and blue, which is neither the
    # probe's fault nor the ambient's: one carries structure, the other level.
    #
    # So the pixels are scaled until the probe's average IS the ambient the
    # scene declares. Reflections keep the room; the fill keeps the artist's
    # colour. The ambient is taken at face value — see write_pmx's note on the
    # single pi, which belongs to the sun and to nothing else.
    gain = [1.0, 1.0, 1.0]
    if target:
        total = [0.0, 0.0, 0.0]
        n = 0
        for fp in faces:
            for fy in range(0, face, 4):
                for fx in range(0, face, 4):
                    c = fp[fx, fy]
                    for i in range(3):
                        v = c[i] / 255.0
                        total[i] += v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
                    n += 1
        for i in range(3):
            mean = total[i] / max(n, 1)
            gain[i] = (target[i] / mean) if mean > 1e-5 else 1.0

    height = width // 2
    out = bytearray()
    out += b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n"
    out += f"-Y {height} +X {width}\n".encode()
    for y in range(height):
        theta = math.pi * (y + 0.5) / height
        sy = math.cos(theta)
        r = math.sin(theta)
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
            # sRGB to linear, then RGBE. A probe is radiance once it is light.
            lin = [
                ((c[i] / 255.0) / 12.92 if c[i] / 255.0 <= 0.04045 else (((c[i] / 255.0) + 0.055) / 1.055) ** 2.4) * gain[i]
                for i in range(3)
            ]
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


def convert(project_root, scene_path, out_dir, name, png_root=None, albedo_cap=1024, verbose=True):
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
    maps_doc = {"version": 1, "materials": {}}

    for key in used_order:
        bucket = per_material[key]
        base = len(vertices)
        vertices.extend(bucket["vertices"])
        faces.extend((a + base, b + base, c + base) for a, b, c in bucket["faces"])
        mat = materials_by_guid.get(bucket["guid"])

        shader = proj.shader_name(mat["shader_guid"]) if mat else None
        tint, tint_alpha = material_tint(mat, shader) if mat else ((1.0, 1.0, 1.0), 1.0)
        alpha = surface_alpha(mat, tint_alpha) if mat else 1.0
        albedo = slot(mat, ALBEDO_SLOTS) if mat else None
        index = -1
        if albedo:
            src = png_for(png_root, proj.path(albedo["guid"]) or "")
            if src:
                rel = "tex/" + os.path.basename(src)
                if rel not in texture_index:
                    copy_image(src, os.path.join(out_dir, rel), albedo_cap)
                    texture_index[rel] = len(textures)
                    textures.append(rel)
                index = texture_index[rel]
        # The ripple normal map, into map slot 0, for the water look to scroll.
        ripple = slot(mat, RIPPLE_SLOTS) if mat else None
        if ripple:
            src = png_for(png_root, proj.path(ripple["guid"]) or "")
            if src:
                rel = "maps/" + os.path.basename(src)
                target = os.path.join(out_dir, rel)
                if not os.path.exists(target):
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    copy_image(src, target, 0)
                maps_doc["materials"][key] = [{"path": rel, "srgb": False}]
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
        two_sided = mat and (int(mat["floats"].get("_Cull", 2.0)) == 0 or is_sky(mat))
        # AND THE SKY CASTS NOTHING. It encloses the scene, so a shadow map
        # asked to cover it covers two thousand units instead of the garden —
        # every real shadow in the frame loses the resolution to a dome that
        # should not be in the pass at all.
        shadow_bits = 0x00 if (mat and is_sky(mat)) else (0x02 | 0x04 | 0x08)
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
        unlit = bool(mat) and not lit_family and (is_sky(mat) or "TRANSPARENT_PREMULT" in mat["keywords"])
        pmx_materials.append(
            {
                "name": key,
                "diffuse": (tint[0], tint[1], tint[2], alpha),
                "flag": (0x01 if two_sided else 0x00) | shadow_bits,
                "unlit": unlit,
                "texture": index,
                "faces": len(bucket["faces"]),
                "memo": (proj.shader_name(mat["shader_guid"]) or "") if mat else "",
            }
        )


    write_pmx(os.path.join(out_dir, f"{name}.pmx"), name, vertices, faces, pmx_materials, textures)
    if maps_doc["materials"]:
        with open(os.path.join(out_dir, f"{name}.maps.json"), "w", encoding="utf-8") as fh:
            json.dump(maps_doc, fh, indent=1, ensure_ascii=False)

    # AND THE PROBE, beside it. It is a separate file for a separate decision:
    # the geometry is the stage and this is how the stage is lit, and the World
    # (HDRI) slot already takes a dropped .hdr. Written rather than installed,
    # because a scene lit by a game's own probe is a look, not a fact about the
    # model — and the same folder may be wanted under a sunset.
    look = scene.scene_setting()
    probe = png_for(png_root, proj.path(look["reflectionGuid"]) or "") if look and look.get("reflectionGuid") else None
    sky_written = False
    if probe:
        ambient = scene.ambient()
        # Sky and horizon averaged: roughly what a probe sees over a sphere.
        target = (
            [(ambient["sky"][i] + ambient["equator"][i]) * 0.5 * ambient["intensity"] for i in range(3)]
            if ambient and ambient["mode"] == 1
            else None
        )
        try:
            cube_strip_to_equirect(probe, os.path.join(out_dir, f"{name}.hdr"), target=target)
            sky_written = True
        except Exception as e:  # noqa: BLE001 — a probe in another layout is data, not a crash
            print(f"[unity] REFLECTION PROBE NOT CONVERTED: {e}")

    if verbose:
        print(
            f"[unity] {len(vertices):,} vertices, {len(faces):,} triangles, {len(pmx_materials)} materials, "
            f"{len(textures)} textures -> {out_dir}/{name}.pmx"
        )
        if maps_doc["materials"]:
            print(f"[unity] ripple maps for {len(maps_doc['materials'])} water materials -> {out_dir}/{name}.maps.json")
        if sky_written:
            print(f"[unity] reflection probe -> {out_dir}/{name}.hdr (drop it on World (HDRI))")
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
    p.add_argument("--albedo", type=int, default=1024, help="longest edge for albedo maps, 0 to keep")
    a = p.parse_args()
    SCALE = a.scale
    png = a.png or os.path.join(os.path.dirname(os.path.abspath(a.project)), "_png_textures")
    convert(a.project, a.scene, a.out, a.name, png, a.albedo)


if __name__ == "__main__":
    main()
