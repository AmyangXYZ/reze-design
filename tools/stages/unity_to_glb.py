# A Unity scene as a stage the app loads, by way of Blender.
#
#   python3 tools/stages/unity_to_glb.py \
#     --project "stages/x323-unity/ExportedProject" \
#     --scene   "Assets/ComScene/ABResources/Levels/X323.unity" \
#     --out     stages/x323-glb --name X323
#
# Two steps, one command. This script reads the export with the same readers
# unity_to_pmx.py uses and writes a BUILD folder: world-space geometry per
# material, the maps each material samples with the game's own remaps packed
# in, and one scene.json naming materials, lamps, sun, world and cast fill.
# Then it starts Blender headless on unity_blender_build.py, which builds the
# scene from that folder, saves <Name>.blend for a person to open, and exports
# <Name>.glb with Blender's own glTF exporter — the same exporter a stage
# built by hand in Blender goes through, so the app has ONE loader.
#
# UNITS ARE METRES, glTF's own. Aether Gazer's unit is not a metre: its props
# run 1.55x life size read as metres, and a PMX unit is 8 cm, so 1 Unity unit
# = 8 PMX units = 0.64 m. A lamp's brightness one metre away follows from the
# inverse square: the app's per-PMX-unit intensity is this x 12.5².
#
# The build folder's contract, read by unity_blender_build.py:
#
#   scene.json      materials[], lamps[], sun, fill, world, grading, notes[]
#   geo/<i>.npz     positions, normals (glTF axes, metres), uvs (Blender's V, up), indices
#   tex/            the images scene.json names, PNG, copied or packed here

import argparse
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from unity_grading import grading as stage_grading  # noqa: E402
from unity_effect_bake import BASIC_EFFECT_SHADERS, _linear_to_srgb, _srgb_to_linear, bake as bake_effect, bake_basic, bake_detailed, repeats_across  # noqa: E402
from unity_lights import gamma_to_linear  # noqa: E402
from unity_probe import probe_to_equirect  # noqa: E402
from unity_scene import Project, Scene, read_material  # noqa: E402
from unity_materials import (  # noqa: E402
    ALBEDO_SLOTS,
    BACKDROP_EFFECTS,
    PROPERTY_SLOTS,
    albedo_slot,
    decal_has_coverage,
    face_origin,
    is_effect_decal,
    is_sky,
    is_sky_layer,
    material_tint,
    normal_slot,
    png_for,
    RIPPLE_SLOTS,
    rotate,
    slot,
    surface_alpha,
    transform,
)
from unity_mesh import BuiltinMesh, Mesh  # noqa: E402

def _find_blender():
    """$BLENDER, else the usual install on macOS or Windows (the newest)."""
    if os.environ.get("BLENDER"):
        return os.environ["BLENDER"]
    mac = "/Applications/Blender.app/Contents/MacOS/Blender"
    if os.path.exists(mac):
        return mac
    import glob

    found = sorted(glob.glob(r"C:/Program Files/Blender Foundation/Blender */blender.exe"))
    return found[-1] if found else mac


BLENDER = _find_blender()
METRES = 0.64
# PMX units per metre: the app's intensities are per PMX unit.
PMX_PER_METRE = 12.5


def to_gltf(v):
    """Unity (left-handed, Y up) to glTF (right-handed, Y up): mirror X. The
    mirror flips every triangle's winding, which the geometry loop undoes."""
    return (-v[0] * METRES, v[1] * METRES, v[2] * METRES)


def to_gltf_dir(v):
    return (-v[0], v[1], v[2])


def normalised(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


# ── Candle flames ────────────────────────────────────────────────────────────

FLAME_WORDS = ("huomiao", "huoyan", "flame", "candle")
# Where the visible flame sits along the game's card — see flame_points.
FLAME_START = 67 / 256
FLAME_LENGTH = (186 - 67) / 256


def flame_points(scene, materials_by_guid):
    """Every candle flame the game draws, as (name, base, tip) in glTF metres.

    The game's flame is ONE particle that never moves: a stretched billboard
    `startSize` wide and `lengthScale` times that long, sized by the transform
    its scaling mode names. It emits DOWNWARD at almost no speed, and a
    stretched card trails behind its velocity — so the card runs UP from the
    particle. Measured on X340: every candle's wax top sits 0.30–0.43 of the
    card above its particle, which a centred card would bury the flame under.

    The point is the VISIBLE flame, base to tip, not the card. The flipbook
    (sc_x331_huoyan) draws its flame in the middle of each tile — rows 67–186
    of 256 — so the flame starts FLAME_START of the way up the card and is
    FLAME_LENGTH of it long. The stage carries each as an empty named
    flame.NN with its +Y running base to tip, which the app reads as a bone
    and stands the Candle Flames effect on. Ordered nearest the origin first.
    """
    found = []
    for ps in scene.particle_systems():
        names = [(materials_by_guid.get(g) or {}).get("name", "").lower() for g in ps["materials"]]
        if not ps["on"] or not any(w in n for n in names for w in FLAME_WORDS):
            continue
        if ps["scalingMode"] == 0:  # Hierarchy: the whole chain's scale
            s = max(math.sqrt(sum(ps["matrix"][r][c] ** 2 for r in range(3))) for c in range(3))
        elif ps["scalingMode"] == 1:  # Local: the system's own transform
            s = max(abs(v) for v in ps["localScale"])
        else:  # Shape: none
            s = 1.0
        width = ps["startSize"] * s
        height = width * (ps["lengthScale"] if ps["renderMode"] == 1 else 1.0)
        if height <= 0:
            continue
        x, y, z = ps["position"]
        base = (x, y + height * FLAME_START, z)
        found.append((to_gltf(base), to_gltf((x, y + height * (FLAME_START + FLAME_LENGTH), z))))
    found.sort(key=lambda f: sum(v * v for v in f[0]))
    return [{"name": f"flame.{i + 1:02d}", "from": list(a), "to": list(b)} for i, (a, b) in enumerate(found)]


# ── Maps, packed the way glTF reads them ─────────────────────────────────────

_PACKED = {}


def pack_orm(material, png_root, proj, out_tex):
    """glTF's occlusion-roughness-metallic map from the game's property map.

    The game stores metal in R, roughness in G and occlusion in B, each remapped
    per material by _PropertyMin/_PropertyMax; glTF wants occlusion R, roughness
    G, metal B and no remap. So the remap is baked and the channels swapped,
    once per (map, remap), and the material carries factors of 1.
    """
    bound = slot(material, PROPERTY_SLOTS)
    lo = material["colors"].get("_PropertyMin")
    hi = material["colors"].get("_PropertyMax")
    if not (bound and lo and hi):
        return None
    src = png_for(png_root, proj.path(bound["guid"]) or "")
    if not (src and os.path.exists(src)):
        return None
    key = ("orm", src, tuple(lo), tuple(hi))
    if key not in _PACKED:
        with Image.open(src) as im:
            p = np.asarray(im.convert("RGB"), np.float32) / 255.0
        remapped = np.stack([lo[i] + (hi[i] - lo[i]) * p[..., i] for i in range(3)], axis=-1)
        orm = np.clip(np.stack([remapped[..., 2], remapped[..., 1], remapped[..., 0]], axis=-1), 0.0, 1.0)
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.splitext(os.path.basename(src))[0])
        rel = f"{name}_{len(_PACKED):02d}_ORM.png"
        Image.fromarray((orm * 255.0 + 0.5).astype(np.uint8)).save(os.path.join(out_tex, rel))
        _PACKED[key] = rel
    return _PACKED[key]


def pack_emissive(material, shader, png_root, proj, out_tex):
    """(image, strength) for a Standard material that glows, or None.

    PBR/Standard keeps its emission in the property map's alpha, remapped by
    _PropertyMin.a/_PropertyMax.a; where it passes 1 the pixel is the albedo
    times it and lighting has no say. glTF says the same thing as an emissive
    map with KHR_materials_emissive_strength: the picture holds albedo x e over
    the strength, and the strength is the most e reaches.
    """
    if not (shader or "").endswith("PBR/Standard") or "TRANSPARENT_PREMULT" in material["keywords"]:
        return None
    bound = slot(material, PROPERTY_SLOTS)
    albedo = albedo_slot(material, png_root, proj)
    if not (bound and albedo and "_PropertyMax" in material["alpha"]):
        return None
    src = png_for(png_root, proj.path(bound["guid"]) or "")
    asrc = png_for(png_root, proj.path(albedo["guid"]) or "")
    if not (src and asrc and os.path.exists(src) and os.path.exists(asrc)):
        return None
    lo, hi = material["alpha"].get("_PropertyMin", 0.0), material["alpha"]["_PropertyMax"]
    key = ("emissive", src, asrc, lo, hi)
    if key not in _PACKED:
        with Image.open(src) as im:
            a = np.asarray(im.convert("RGBA"), np.float32)[..., 3] / 255.0
        e = np.maximum((a - lo) / max(hi - lo, 1e-4), 0.0)
        if e.max() < 0.5:
            _PACKED[key] = None
        else:
            with Image.open(asrc) as im:
                rgb = np.asarray(im.convert("RGB"), np.float32) / 255.0
            h, w = rgb.shape[:2]
            e = np.asarray(Image.fromarray(e.astype(np.float32)).resize((w, h), Image.BILINEAR))
            strength = float(max(1.0, math.ceil(e.max())))
            lin = _srgb_to_linear(rgb) * e[..., None] / strength
            name = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.splitext(os.path.basename(asrc))[0])
            rel = f"{name}_{len(_PACKED):02d}_E.png"
            Image.fromarray((_linear_to_srgb(lin) * 255.0 + 0.5).astype(np.uint8)).save(os.path.join(out_tex, rel))
            _PACKED[key] = (rel, strength)
    return _PACKED[key]


def copy_texture(src, out_tex, copied):
    rel = os.path.basename(src)
    if rel not in copied:
        shutil.copyfile(src, os.path.join(out_tex, rel))
        copied.add(rel)
    return rel


def opaque_texture(rel, out_tex):
    """The picture an OPAQUE material wears, with no alpha channel.

    glTF's OPAQUE says alpha is ignored; a PMX renderer reads it anyway, and
    decides from the texture whether a material blends. X323's floor keeps
    something else in its albedo's alpha (a fifth of its texels under 250), so
    the app drew it as a blended surface, in material order, after the water
    stains lying on it — and their depth cut the floor away under every stain.
    A picture with no alpha below 255 is used as it is; one with any is copied
    without it, beside the original, which a blended material may still share.
    """
    path = os.path.join(out_tex, rel)
    try:
        im = Image.open(path)
        im.load()
    except OSError:
        return rel
    if "A" not in im.getbands() or im.getchannel("A").getextrema()[0] == 255:
        return rel
    stem = os.path.splitext(rel)[0] + "_rgb.png"
    if not os.path.exists(os.path.join(out_tex, stem)):
        im.convert("RGB").save(os.path.join(out_tex, stem))
    return stem


# ── The scene ────────────────────────────────────────────────────────────────


def game_ambient(project_root, scene_path, notes):
    """The ambient the game lights surfaces with, as nine RGB coefficients in glTF
    axes, or None.

    Not the reflection probe: SimPipeline's diffuse ambient is _Replica_SH*,
    Unity's own ambient probe of the scene's trilight (EnvironmentSetting when
    the volume says so), packed raw — SHA = (c3, c1, c2, c0 − c6), SHB = (c4,
    c5, 3·c6, c7), SHC = c8 — and evaluated as c0 + c1·y + c2·z + c3·x + c4·xy +
    c5·yz + c6·(3z² − 1) + c7·xz + c8·(x² − y²). The probe feeds reflections
    alone. The Unity project's render manifest records the coefficients as the
    sim set them; glTF mirrors x, which turns c3, c4 and c7 over."""
    path = os.path.join(project_root, "ag_render_manifest.json")
    if not os.path.isfile(path):
        notes.append("no ag_render_manifest.json: the ambient is fitted to the world picture")
        return None
    manifest = json.load(open(path, encoding="utf-8-sig"))
    want = scene_path.replace("\\", "/")
    scene = next((s for s in manifest.get("scenes", []) if s.get("scene", "").replace("\\", "/").endswith(want)), None)
    g = (scene or {}).get("shaderGlobals", {})
    if not all(k in g for k in ("_Replica_SHAr", "_Replica_SHAg", "_Replica_SHAb", "_Replica_SHBr", "_Replica_SHBg", "_Replica_SHBb", "_Replica_SHC")):
        notes.append("the manifest has no _Replica_SH*: the ambient is fitted to the world picture")
        return None
    sh = [0.0] * 27
    for ch, c in enumerate("rgb"):
        a, b = g["_Replica_SHA" + c], g["_Replica_SHB" + c]
        c6 = b[2] / 3.0
        coeffs = [a[3] + c6, a[1], a[2], a[0], b[0], b[1], c6, b[3], g["_Replica_SHC"][ch]]
        for i, s in ((3, -1.0), (4, -1.0), (7, -1.0)):
            coeffs[i] *= s
        for i in range(9):
            sh[i * 3 + ch] = coeffs[i]
    return sh


def game_fog(project_root, scene_path, notes):
    """The game's distance fog, in glTF metres, or None.

    SimPipeline fogs every surface twice, per vertex: a haze (sim_FogColor,
    sim_FogParams) and a second layer (sim_DynFog*) that X340 uses to darken
    toward black. Each is t = saturate(f − (1 − f)·h), f = saturate(depth·x + y)
    on the view depth, h = clamp((z − height)/w, −1, 1), the colour pulled to
    the layer's by (1 − t)·colour.a. Read from the render manifest as the sim
    set it — linear fog only (sim_FOG_LINEAR / sim_DYN_FOG_LINEAR)."""
    path = os.path.join(project_root, "ag_render_manifest.json")
    if not os.path.isfile(path):
        return None
    manifest = json.load(open(path, encoding="utf-8-sig"))
    want = scene_path.replace("\\", "/")
    scene = next((s for s in manifest.get("scenes", []) if s.get("scene", "").replace("\\", "/").endswith(want)), None)
    if not scene:
        return None
    g, kw = scene.get("shaderGlobals", {}), scene.get("shaderKeywords", {})

    def layer(colour, params, keyword):
        c, p = g.get(colour), g.get(params)
        if not (c and p and kw.get(keyword)) or c[3] <= 0:
            return None
        return {
            "color": [c[0], c[1], c[2]],
            "amount": c[3],
            # Unity units to metres: a depth of d metres is d / 0.64 units.
            "distance": [p[0] / METRES, p[1]],
            "height": [p[2] * METRES, p[3] * METRES],
        }

    haze = layer("sim_FogColor", "sim_FogParams", "sim_FOG_LINEAR")
    dyn = layer("sim_DynFogColor", "sim_DynFogParams", "sim_DYN_FOG_LINEAR")
    for k in ("sim_DYN_FOG_EXP", "sim_DYN_FOG_EXP_SQ"):
        if kw.get(k):
            notes.append(f"fog: {k} is not reproduced")
    if (g.get("sim_FogColor2") or [0, 0, 0, 0])[3] > 0 or (g.get("sim_FogDirectionalColor") or [0, 0, 0, 0])[3] > 0:
        notes.append("fog: its second colour and directional tint are not reproduced")
    if not haze and not dyn:
        return None
    base = haze or {"color": [0, 0, 0], "amount": 0.0, "distance": [0.0, 1.0], "height": [0.0, 1.0]}
    return {**base, **({"dyn": dyn} if dyn else {})}


def build_dir_for(out_glb, name):
    """The build folder for a stage written to `out_glb`: `build/<name>/`
    beside it. A stage is one .glb; what Blender was built from — geometry,
    the maps as packed, the .blend — is an input, kept out of the way."""
    return os.path.join(os.path.dirname(os.path.abspath(out_glb)), "build", name.lower())


def prepare(project_root, scene_path, out_glb, name, png_root=None):
    proj = Project(project_root)
    scene = Scene(os.path.join(project_root, scene_path))
    build = build_dir_for(out_glb, name)
    out_tex = os.path.join(build, "tex")
    out_geo = os.path.join(build, "geo")
    shutil.rmtree(build, ignore_errors=True)
    os.makedirs(out_tex)
    os.makedirs(out_geo)
    _PACKED.clear()

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
            if guid.startswith("builtin:"):
                try:
                    meshes[guid] = BuiltinMesh(int(guid.split(":", 1)[1]))
                except ValueError:
                    meshes[guid] = None
            else:
                path = proj.path(guid)
                meshes[guid] = Mesh(path) if path and os.path.exists(path) else None
        return meshes[guid]

    def shader_of(mat):
        return proj.shader_name(mat["shader_guid"]) if mat else None

    def wears_sky(r):
        return any(materials_by_guid.get(g) and (is_sky(materials_by_guid[g]) or is_sky_layer(materials_by_guid[g], shader_of(materials_by_guid[g]))) for g in r["materials"])

    BACKDROP_EFFECTS.clear()
    for r in scene.renderers():
        m = mesh(r["mesh"]) if r["mesh"] and r["enabled"] else None
        if m is None or "cylinder" not in m.name.lower():
            continue
        for guid in r["materials"]:
            mat = materials_by_guid.get(guid)
            if mat and is_effect_decal(shader_of(mat)):
                BACKDROP_EFFECTS.add(mat["name"])

    notes = []
    fallbacks = scene.lod_fallback_renderers()
    switched_off, dropped_lods, unreadable = [], 0, []
    per_material = {}
    order = []

    for r in scene.renderers():
        if not r["mesh"] or not r["enabled"]:
            continue
        if not scene.active_in_hierarchy(r["object"]) and not wears_sky(r):
            switched_off.append(r["name"])
            continue
        if r["id"] in fallbacks:
            dropped_lods += 1
            continue
        m = mesh(r["mesh"])
        if m is None:
            unreadable.append(r["name"])
            continue
        if r["batched"]:
            matrix, translation = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (0.0, 0.0, 0.0)
        else:
            matrix, translation = scene.world_matrix(r["transform"])
        if any((shader_of(materials_by_guid.get(g)) or "").endswith("SceneBillboard") for g in r["materials"]):
            matrix = face_origin(matrix, translation)
        for slot_index, guid in enumerate(r["materials"]):
            i = r["firstSubMesh"] + slot_index
            if i >= len(m.submeshes):
                break
            mat = materials_by_guid.get(guid)
            key = mat["name"] if mat else f"unnamed_{guid[:8]}"
            if key not in per_material:
                per_material[key] = {"guid": guid, "positions": [], "normals": [], "uvs": [], "indices": []}
                order.append(key)
            bucket = per_material[key]
            shader_name = shader_of(mat)
            # AN EFFECT SHEET IN THE SKY IS BAKED to one picture (unity_effect_bake),
            # and the mesh's u carries its repeats; every texture's own transform
            # is inside the bake, so the UVs go raw.
            layer_repeats = repeats_across(mat) if mat and is_effect_decal(shader_name) and is_sky_layer(mat, shader_name) else 0
            albedo_st = albedo_slot(mat, png_root, proj) if mat and not layer_repeats else None
            (su, sv), (ou, ov) = (albedo_st["scale"], albedo_st["offset"]) if albedo_st else ((float(layer_repeats or 1), 1.0), (0.0, 0.0))
            remap = {}
            for tri in m.triangles(i):
                out = []
                for v in tri:
                    if v not in remap:
                        remap[v] = len(bucket["positions"])
                        bucket["positions"].append(to_gltf(transform(matrix, translation, m.positions[v])))
                        bucket["normals"].append(normalised(to_gltf_dir(rotate(matrix, m.normals[v]))))
                        uv = m.uvs[v]
                        # Unity's V, bottom-up, which is Blender's too: the glTF
                        # exporter turns it over once. Flipped here as well, every
                        # island lands mirrored — the stool's seat took the atlas's
                        # ribbed strip and a net panel its emissive screen.
                        bucket["uvs"].append((uv[0] * su + ou, uv[1] * sv + ov))
                    out.append(remap[v])
                # The mirror above reversed the winding; put it back.
                bucket["indices"].append((out[0], out[2], out[1]))

    # ONE SURFACE, TWO LAYERS. X309's nebula and its purple band are the same
    # cylinder at the same radius, and two layers in one surface fight over its
    # depth: squares along the horizon that change with every camera move. A
    # layer sharing its radius with one seen before it is pulled in by a third
    # of a percent, so it stands in front of the layer it is drawn over.
    def sky_radius(bucket):
        rs = sorted(math.hypot(p[0], p[2]) for p in bucket["positions"])
        return rs[len(rs) // 2] if rs else 0.0

    def skyish(key):
        m = materials_by_guid.get(per_material[key]["guid"])
        return bool(m and (is_sky(m) or is_sky_layer(m, shader_of(m))))

    radii = []
    pulled_in = []
    for key in order:
        if not skyish(key):
            continue
        r = sky_radius(per_material[key])
        shared = sum(1 for q in radii if abs(q - r) <= r * 0.001)
        if shared:
            k = 1.0 - 0.003 * shared
            per_material[key]["positions"] = [(p[0] * k, p[1], p[2] * k) for p in per_material[key]["positions"]]
            pulled_in.append(key)
        radii.append(r)

    # A DOME IS KNOWN BY ITS SIZE — see unity_materials.
    reach = {k: max((max(abs(c) for c in p) for p in b["positions"]), default=0.0) for k, b in per_material.items()}
    domes = set()
    for key, r in reach.items():
        others = max((v for k, v in reach.items() if k != key), default=0.0)
        if r > 3.0 * others and others > 0.0:
            domes.add(key)

    copied = set()
    materials = []
    sky_layers = []
    decals_dropped = []
    baked_decals = []
    coats_dropped = []
    unknown = {}
    for index, key in enumerate(order):
        bucket = per_material[key]
        if not bucket["indices"]:
            continue
        mat = materials_by_guid.get(bucket["guid"])
        shader = shader_of(mat)
        family = (shader or "").rsplit("/", 1)[-1]
        tint, tint_alpha = material_tint(mat, shader) if mat else ((1.0, 1.0, 1.0), 1.0)
        coverage = decal_has_coverage(mat, png_root, proj) if mat else False
        alpha = surface_alpha(mat, tint_alpha, shader, coverage) if mat else 1.0
        sky_material = key in domes or bool(mat and (is_sky(mat) or is_sky_layer(mat, shader)))
        # AN EFFECT DECAL IS BAKED, as a sky layer is: the shader's own
        # composition at time 0 — its mask, its HDR second picture, its add or
        # blend — is what the game draws, and no single texture of it is. X323's
        # puddle is the floor's own picture as a wet sheen through a
        # puddle-shaped mask; left out, what stayed was the stains inside it,
        # and those drawn as their raw picture at a flat alpha were grey smudges
        # where the game's are bright and wet (_ColorPlus at ten times white,
        # the first of them purely additive). One that cannot be baked keeps the
        # old way: its picture and tint, or left out when that has no coverage.
        bake_decal = bool(mat) and is_effect_decal(shader) and not sky_material
        masked_decal = bake_decal and "MASK" in mat["keywords"]
        if mat and is_effect_decal(shader) and alpha == 0.0 and not sky_material and not masked_decal:
            decals_dropped.append(key)
            continue
        # A REFLECTIVE COAT: SimPipeline/Scene/Transparent with nothing of its own
        # to paint — its colour black or its shininess 1 — is a sheen, the room's
        # blurred reflection at an alpha of (1 − N·V)^_AlphaFresnel, and takes no
        # lamp. The app has no view-dependent alpha to draw that with, and drawn
        # as a surface it caught every lamp above X340's floor as one broad
        # glare. Left out, the frame loses what Unity measures as a 3% darkening
        # at grazing angles.
        if mat and family == "Transparent":
            paint = max(c * (1.0 - mat["floats"].get("_Shininess", 0.0)) for c in (mat["colors"].get("_Color") or (1.0, 1.0, 1.0))[:3])
            if paint < 0.02:
                coats_dropped.append(key)
                continue
        basic_effect = bool(mat) and family in BASIC_EFFECT_SHADERS
        if family not in ("Standard", "Plant", "Glass", "Ripplet", "Effect_Common", "SceneBillboard", "FresnelColor", "Standard_PBR_2", "Detailed", "", *BASIC_EFFECT_SHADERS):
            unknown.setdefault(shader, []).append(key)

        np.savez(
            os.path.join(out_geo, f"{index}.npz"),
            positions=np.asarray(bucket["positions"], np.float32),
            normals=np.asarray(bucket["normals"], np.float32),
            uvs=np.asarray(bucket["uvs"], np.float32),
            indices=np.asarray(bucket["indices"], np.uint32),
        )

        base = None
        baked = None
        if mat and is_effect_decal(shader) and (sky_material or bake_decal):
            # The layer at time 0 — its textures, colours, mask and rotations
            # composed — stored at 1/gain and named for it; the material emits
            # it at gain, over black, with the picture's own coverage.
            written = bake_effect(mat, proj, lambda g: png_for(png_root, proj.path(g) or ""), os.path.join(out_tex, re.sub(r"[^A-Za-z0-9_.-]", "_", key)))
            if written:
                baked = os.path.basename(written)
                gain = int(re.search(r"_x(\d+)\.png$", baked).group(1))
                (sky_layers if sky_material else baked_decals).append(key)
            elif masked_decal:
                decals_dropped.append(key)
                continue
        # A plain effect sheet — a shadow projection, a candle's glow — is its
        # texture, mask and colour composed once, and takes no light: drawn as
        # a surface, a lamp overhead lit the black quad's whole rectangle.
        sheet = None
        if basic_effect:
            written = bake_basic(mat, proj, lambda g: png_for(png_root, proj.path(g) or ""), os.path.join(out_tex, re.sub(r"[^A-Za-z0-9_.-]", "_", key)), notes)
            if written:
                sheet = os.path.basename(written)
            else:
                notes.append(f"{key}: its {shader} texture is missing; exported as Standard")
        albedo = albedo_slot(mat, png_root, proj) if mat and not baked and not sheet else None
        src = png_for(png_root, proj.path(albedo["guid"]) or "") if albedo else None
        if src:
            base = copy_texture(src, out_tex, copied)
        normal, normal_scale = None, 1.0
        # SLOT 0 IS THE SURFACE'S OWN RELIEF: water scrolls its ripple map there
        # (the Water look samples it twice, the way the game's Ripplet does),
        # everything else its normal map, and the same socket reads both.
        nslot = (slot(mat, RIPPLE_SLOTS) or normal_slot(mat, png_root, proj)) if mat else None
        nsrc = png_for(png_root, proj.path(nslot["guid"]) or "") if nslot else None
        if nsrc:
            normal = copy_texture(nsrc, out_tex, copied)
            normal_scale = float(mat["floats"].get("_NormalScale", mat["floats"].get("_BumpScale", 1.0)))
        orm = pack_orm(mat, png_root, proj, out_tex) if mat and not sky_material else None
        # A LAYERED SURFACE (PBR/Detailed): constants over a mask and a detail
        # picture, baked to the albedo and ORM a Standard material would carry.
        layered = None
        if mat and family == "Detailed" and not sky_material:
            layered = bake_detailed(mat, proj, lambda g: png_for(png_root, proj.path(g) or ""), os.path.join(out_tex, re.sub(r"[^A-Za-z0-9_.-]", "_", key)), notes)
            if layered:
                base, orm = os.path.basename(layered[0]), os.path.basename(layered[1])
                bslot = mat["textures"].get("_BaseNormal")
                bsrc = png_for(png_root, proj.path(bslot["guid"]) or "") if bslot else None
                if bsrc:
                    normal = copy_texture(bsrc, out_tex, copied)
                    normal_scale = float(mat["floats"].get("_BaseNormalScale", 1.0))
            else:
                notes.append(f"{key}: its Detailed layers could not be read; exported as Standard")
        emissive = pack_emissive(mat, shader, png_root, proj, out_tex) if mat and not sky_material else None
        if baked:
            base = baked
            emissive = (baked, float(gain))
            tint, alpha = (0.0, 0.0, 0.0), 1.0
        if sheet:
            base, normal, orm, emissive = sheet, None, None, None
            tint, alpha = (1.0, 1.0, 1.0), 1.0
        if layered:
            tint, alpha = (1.0, 1.0, 1.0), 1.0

        premult = bool(mat) and "TRANSPARENT_PREMULT" in mat["keywords"]
        # SceneBillboard clips at _Cutoff with no keyword asking it to: a
        # moon or a tree card read as opaque is its whole square.
        cutoff = bool(mat) and ("CUTOFF" in mat["keywords"] or shader == "SimPipeline/Scene/SceneBillboard")
        lit_family = family in ("Glass", "Ripplet")
        # UNLIT IS THE SHADER'S TO SAY, never a blend keyword's. A sky and an
        # effect sheet take no light; TRANSPARENT_PREMULT is how a surface is
        # COMPOSITED and says nothing about whether it is lit. Reading it as
        # unlit turned X340's floor circle — premultiplied, and carrying the
        # game's own _DEFAULT_REFLECTION and _REAL_REFLECTION — into a flat
        # picture that no lamp reached and no camera move changed, over a floor
        # that was lit correctly underneath it.
        unlit = bool(mat) and not lit_family and (sky_material or is_effect_decal(shader) or bool(sheet))
        additive = bool(mat) and float(mat["floats"].get("_DstBlend", 10.0)) == 1.0 and is_effect_decal(shader)
        alpha_mode = "MASK" if cutoff else ("BLEND" if (alpha < 1.0 or premult or is_effect_decal(shader) or baked or sheet) else "OPAQUE")
        if alpha_mode == "OPAQUE" and base:
            base = opaque_texture(base, out_tex)
        materials.append(
            {
                "name": key,
                "geometry": f"geo/{index}.npz",
                "shader": shader or "",
                "baseColor": {"image": f"tex/{base}" if base else None, "factor": [min(1.0, tint[0]), min(1.0, tint[1]), min(1.0, tint[2]), alpha if alpha_mode != "OPAQUE" else 1.0]},
                "orm": f"tex/{orm}" if orm else None,
                "normal": {"image": f"tex/{normal}", "scale": normal_scale} if normal else None,
                "emissive": {"image": f"tex/{emissive[0]}", "strength": emissive[1]} if emissive else None,
                "alphaMode": alpha_mode,
                "alphaCutoff": float(mat["floats"].get("_Cutoff", 0.5)) if cutoff else None,
                "doubleSided": bool(mat) and (int(mat["floats"].get("_Cull", 2.0)) == 0 or sky_material),
                "unlit": unlit,
                "additive": additive,
                "sky": sky_material,
                # The effect sheets have no shadow pass in the game.
                "castShadow": not sky_material and not sheet,
                # WHEN IT DRAWS among the transparent: Unity sorts them by render
                # queue, and a stage's water stains (3001-3002) lie on the glass
                # beneath them (3000). Drawn in material order the glass came
                # last and greyed them out. Without a queue of its own, the
                # blend mode's default.
                "queue": (mat["queue"] if mat and mat.get("queue", -1) >= 0 else {"OPAQUE": 2000, "MASK": 2450}.get(alpha_mode, 3000)),
                # What glTF cannot say: which of the app's looks this is.
                "look": {"Glass": "glass", "Ripplet": "water", "Plant": "foliage"}.get(family),
            }
        )

    # ── Lamps and the sun, in metres ──
    lamps, sun = [], None
    for l in scene.lights():
        if not l["on"]:
            notes.append(f"left out {l['name']}: switched off in the game")
            continue
        if l["baked"] == "2":
            notes.append(f"left out {l['name']}: baked only")
            continue
        colour = [gamma_to_linear(l["color"][i] * l["intensity"]) for i in range(3)]
        if l["type"] == "directional":
            if sun is None:
                sun = {"color": colour, "direction": list(to_gltf_dir(l["direction"])), "shadow": bool(l["shadows"])}
            else:
                notes.append(f"left out {l['name']}: a second directional light")
            continue
        if l["type"] not in ("point", "spot"):
            notes.append(f"left out {l['name']}: {l['type']} light")
            continue
        lamps.append(
            {
                "name": l["name"],
                "type": l["type"],
                "position": list(to_gltf(l["position"])),
                "color": colour,
                # `color` carries the game's radiance, (colour x intensity)
                # in linear light; this factor makes the pair a brightness one
                # METRE away. The app's per-PMX-unit intensity is it x 12.5².
                "intensity": METRES * METRES,
                "range": l["range"] * METRES,
                "direction": list(to_gltf_dir(l["direction"])),
                "angle": l["angle"],
                "innerAngle": l["innerAngle"],
            }
        )

    look = scene.scene_setting() or {}
    fill = None
    if look.get("probeLightingBase"):
        fill = {"color": [gamma_to_linear(c) for c in look["probeLightingBase"]], "strength": 1.0}

    # The game's own diffuse ambient, when the project records it. With it the
    # world picture is the reflection probe ALONE: the gradient the bake would
    # add is there so a fitted ambient comes out right, and with the ambient
    # stated it would only brighten every reflection — X340's dark marble
    # mirrored five times the room it does in the game.
    ambient = game_ambient(project_root, scene_path, notes)
    fog = game_fog(project_root, scene_path, notes)
    # The character shadow the game lays on its ground, from its own angles —
    # RenderSettings.groundShadowDir, decompiled: (cos az·sin incl, cos incl,
    # sin az·sin incl), the way to the light with inclination from straight up.
    # Kept whether the stage switches it on or not; the app decides.
    gs = look.get("groundShadow")
    ground_shadow = None
    if gs:
        incl, az = math.radians(gs["inclination"]), math.radians(gs["azimuth"])
        to_light = (math.cos(az) * math.sin(incl), math.cos(incl), math.sin(az) * math.sin(incl))
        ground_shadow = {
            "enabled": gs["enable"],
            "direction": list(to_gltf_dir(to_light)),
            "color": [gamma_to_linear(c) for c in gs["color"]],
            "amount": gs["alpha"],
            "fade": gs["fade"],
        }
    world = None
    probe = proj.path(look["reflectionGuid"]) if look.get("reflectionGuid") else None
    if probe:
        hdr = os.path.join(build, f"{name}.hdr")
        try:
            probe_to_equirect(probe, hdr, ambient=None if ambient else scene.ambient(), blender=BLENDER)
            world = {"hdr": f"{name}.hdr"}
        except Exception as e:  # noqa: BLE001
            notes.append(f"reflection probe not converted: {e}")

    grade = stage_grading(scene, proj, look, notes)

    if switched_off:
        notes.append(f"{len(switched_off)} renderers the game switches off, left out: {', '.join(sorted(set(switched_off)))}")
    if dropped_lods:
        notes.append(f"{dropped_lods} LOD fallback renderers dropped (level 0 kept)")
    if unreadable:
        notes.append(f"{len(unreadable)} renderers had no readable mesh: {', '.join(unreadable[:5])}")
    if coats_dropped:
        notes.append(f"{len(coats_dropped)} reflective coats left out (a view-dependent sheen the app cannot draw): {', '.join(sorted(coats_dropped))}")
    if baked_decals:
        notes.append(f"{len(baked_decals)} effect decals baked from the effect shader: {', '.join(sorted(baked_decals))}")
    if decals_dropped:
        notes.append(f"{len(decals_dropped)} effect decals left out (coverage lives in maps we do not ship): {', '.join(sorted(decals_dropped))}")
    if sky_layers:
        notes.append(f"{len(sky_layers)} sky layers baked from the effect shader: {', '.join(sorted(sky_layers))}")
    if pulled_in:
        notes.append(f"sky layers sharing a surface, pulled in front of the one beneath: {', '.join(pulled_in)}")
    for shader, names in unknown.items():
        notes.append(f"UNKNOWN SHADER FAMILY {shader}: {', '.join(names)} — exported as Standard")

    points = flame_points(scene, materials_by_guid)
    if points:
        notes.append(f"{len(points)} candle flames -> empties flame.01..{len(points):02d} (Candle Flames (wick bones) stands a flame on each)")

    scene_json = {
        "name": name,
        "points": points,
        "metresPerUnityUnit": METRES,
        "pmxPerMetre": PMX_PER_METRE,
        "materials": materials,
        "lamps": lamps,
        "sun": sun,
        "fill": fill,
        "world": world,
        "grading": grade,
        "ambient": ambient,
        "fog": fog,
        "groundShadow": ground_shadow,
        "notes": notes,
    }
    with open(os.path.join(build, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(scene_json, f, indent=1)
    return build, scene_json


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--scene", required=True)
    ap.add_argument("--out", required=True, help="the stage file, e.g. stages/X323.glb; the build goes to stages/build/x323/")
    ap.add_argument("--name", required=True)
    ap.add_argument("--png-root", default=None, help="decoded textures; default <project>/../_png_textures")
    ap.add_argument("--prepare-only", action="store_true")
    ap.add_argument("--png", action="store_true", help="keep Blender's PNG textures (default: WebP q90, see glb_webp.py)")
    args = ap.parse_args()
    if not args.out.lower().endswith(".glb"):
        raise SystemExit("--out is the stage file itself, e.g. stages/X323.glb")
    png_root = args.png_root or os.path.join(os.path.dirname(os.path.abspath(args.project)), "_png_textures")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    build, scene_json = prepare(args.project, args.scene, args.out, args.name, png_root)
    grade = f"{scene_json['grading']['size']}^3" if scene_json["grading"] else "none"
    print(f"[unity] {len(scene_json['materials'])} materials, {len(scene_json['lamps'])} lamps, sun {'yes' if scene_json['sun'] else 'no'}, world {'yes' if scene_json['world'] else 'no'}, grade {grade} -> {build}")
    for n in scene_json["notes"]:
        print(f"[unity]   {n}")
    if args.prepare_only:
        return
    builder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "unity_blender_build.py")
    cmd = [BLENDER, "-b", "--python", builder, "--", build, os.path.abspath(args.out), args.name]
    print("[blender]", " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc == 0 and not args.png:
        from glb_webp import convert

        n, before, after = convert(args.out, args.out + ".tmp", 90)
        os.replace(args.out + ".tmp", args.out)
        print(f"[webp] {n} textures to WebP q90: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB; {args.out} is {os.path.getsize(args.out) / 1e6:.1f} MB")
    sys.exit(rc)


if __name__ == "__main__":
    main()
