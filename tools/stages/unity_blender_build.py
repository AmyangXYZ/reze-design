# Builds a stage in Blender from a build folder and exports it. Run by
# unity_to_glb.py:
#
#   Blender -b --python unity_blender_build.py -- <build> <out.glb> <Name>
#
# Writes <build>/<Name>.blend, for a person to open and fix, and <out.glb>
# through Blender's own glTF exporter — the same exporter a stage built by
# hand goes through.
#
# MATERIALS ARE WIRED THE WAY THE EXPORTER READS THEM. The glTF exporter does
# not bake; it recognises node patterns. Base Color from an Image Texture,
# Metallic and Roughness from a Separate Color on a Non-Color image (with the
# channels already in glTF's order, it exports that image as the
# metallicRoughness map), occlusion through the "glTF Material Output" group,
# a Normal Map node for the normal, an Emission colour with a strength. What
# glTF cannot say — additive blending, the app's look, a sky that casts nothing
# — goes on the material as custom properties, which the exporter writes to
# `extras`. The scene's lamps, sun, fill and world go to the scene's extras
# the same way, in the app's own terms.

import base64
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

build, out_glb, name = sys.argv[sys.argv.index("--") + 1 :][:3]
scene_json = json.load(open(os.path.join(build, "scene.json"), encoding="utf-8"))
PMX_PER_METRE = scene_json["pmxPerMetre"]


def blender_xyz(p):
    """glTF (Y up) to Blender (Z up); the exporter turns it back."""
    return (p[0], -p[2], p[1])


def load_image(rel, colorspace):
    path = os.path.join(build, rel)
    key = (rel, colorspace)
    if key in load_image.cache:
        return load_image.cache[key]
    img = bpy.data.images.load(path, check_existing=False)
    img.name = f"{os.path.splitext(os.path.basename(rel))[0]}{'' if colorspace == 'sRGB' else '_data'}"
    img.colorspace_settings.name = colorspace
    load_image.cache[key] = img
    return img


load_image.cache = {}


def gltf_settings_group():
    """The exporter's occlusion hook: a node group by this name with an
    Occlusion input."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupInput")
    return g


def make_material(spec):
    mat = bpy.data.materials.new(spec["name"])
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (250, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    f = spec["baseColor"]["factor"]

    def image_node(rel, colorspace, x, y):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = load_image(rel, colorspace)
        n.location = (x, y)
        return n

    if spec["baseColor"]["image"]:
        tex = image_node(spec["baseColor"]["image"], "sRGB", -600, 300)
        if any(abs(c - 1.0) > 1e-3 for c in f[:3]):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.location = (-200, 300)
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = (f[0], f[1], f[2], 1.0)
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if spec["alphaMode"] != "OPAQUE":
            if abs(f[3] - 1.0) > 1e-3:
                m = nt.nodes.new("ShaderNodeMath")
                m.operation = "MULTIPLY"
                m.inputs[1].default_value = f[3]
                m.location = (-200, 50)
                nt.links.new(tex.outputs["Alpha"], m.inputs[0])
                nt.links.new(m.outputs[0], bsdf.inputs["Alpha"])
            else:
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    else:
        bsdf.inputs["Base Color"].default_value = (f[0], f[1], f[2], 1.0)
        if spec["alphaMode"] != "OPAQUE":
            bsdf.inputs["Alpha"].default_value = f[3]

    if spec["orm"]:
        orm = image_node(spec["orm"], "Non-Color", -600, -100)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-300, -100)
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = gltf_settings_group()
        grp.location = (250, -400)
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.5
        bsdf.inputs["Metallic"].default_value = 0.0

    if spec["normal"]:
        nimg = image_node(spec["normal"]["image"], "Non-Color", -600, -500)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = spec["normal"]["scale"]
        nm.location = (-300, -500)
        nt.links.new(nimg.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if spec["emissive"]:
        eimg = image_node(spec["emissive"]["image"], "sRGB", -600, 600)
        nt.links.new(eimg.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = spec["emissive"]["strength"]
    elif spec["unlit"] and spec["baseColor"]["image"]:
        # A painted sheet: its picture is what it gives off, and it takes no
        # light. Emission of the base colour at strength 1 with the base colour
        # itself black; the app reads `unlit` and draws it as painted.
        src = nt.nodes["Image Texture"] if "Image Texture" in nt.nodes else None
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "sRGB":
                src = n
                break
        if src:
            for l in list(bsdf.inputs["Base Color"].links):
                nt.links.remove(l)
            bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            nt.links.new(src.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0

    if spec["alphaMode"] == "BLEND":
        mat.surface_render_method = "BLENDED"
    elif spec["alphaMode"] == "MASK":
        mat.surface_render_method = "DITHERED"
        # The exporter reads a cutoff off a Math node on the alpha path.
        clip = nt.nodes.new("ShaderNodeMath")
        clip.operation = "GREATER_THAN"
        clip.inputs[1].default_value = spec["alphaCutoff"] or 0.5
        clip.location = (0, 50)
        links = list(bsdf.inputs["Alpha"].links)
        if links:
            src_socket = links[0].from_socket
            nt.links.remove(links[0])
            nt.links.new(src_socket, clip.inputs[0])
            nt.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    mat.use_backface_culling = not spec["doubleSided"]

    mat["reze"] = {
            "shader": spec["shader"],
            "alphaMode": spec["alphaMode"],
            "unlit": spec["unlit"],
            "additive": spec["additive"],
            "sky": spec["sky"],
            "castShadow": spec["castShadow"],
            "look": spec["look"],
    }
    return mat


# ── The scene ──
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = name
stage = bpy.data.collections.new(name)
scene.collection.children.link(stage)

for i, spec in enumerate(scene_json["materials"]):
    g = np.load(os.path.join(build, spec["geometry"]))
    pos = g["positions"]
    idx = g["indices"]
    me = bpy.data.meshes.new(spec["name"])
    verts = [blender_xyz(p) for p in pos.tolist()]
    me.from_pydata(verts, [], idx.tolist())
    # UVs per loop, from the per-vertex UVs the build carries.
    uv = g["uvs"]
    layer = me.uv_layers.new(name="UVMap")
    loop_uv = np.empty((len(me.loops), 2), np.float32)
    loop_vi = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", loop_vi)
    loop_uv[:] = uv[loop_vi]
    layer.data.foreach_set("uv", loop_uv.ravel())
    # Normals as the game authored them, rather than recomputed.
    nrm = np.asarray([blender_xyz(n) for n in g["normals"].tolist()], np.float32)
    me.normals_split_custom_set_from_vertices(nrm.tolist())
    me.validate(clean_customdata=False)
    me.update()
    mat = make_material(spec)
    me.materials.append(mat)
    ob = bpy.data.objects.new(spec["name"], me)
    stage.objects.link(ob)
    if not spec["castShadow"]:
        ob.visible_shadow = False

# Candle flames: an empty per wick, named flame.NN, its local Z from base to tip
# and as long as the flame. Blender's Z becomes glTF's +Y on export, which is
# the axis the app reads the bone along — so an unrotated empty scaled to the
# flame's length is the hand-built form of the same thing.
for pt in scene_json.get("points") or []:
    ob = bpy.data.objects.new(pt["name"], None)
    ob.empty_display_type = "SINGLE_ARROW"
    a = Vector(blender_xyz(pt["from"]))
    b = Vector(blender_xyz(pt["to"]))
    up = b - a
    length = up.length or 0.1
    ob.matrix_world = Matrix.Translation(a) @ up.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4() @ Matrix.Scale(length, 4)
    stage.objects.link(ob)

# Lamps: Blender lights for the .blend, and the app's own numbers as extras.
for l in scene_json["lamps"]:
    data = bpy.data.lights.new(l["name"], "SPOT" if l["type"] == "spot" else "POINT")
    c = l["color"]
    peak = max(c) or 1.0
    data.color = (c[0] / peak, c[1] / peak, c[2] / peak)
    # Radiant intensity (brightness one metre away) to Blender's watts, and
    # Unity's convention to Blender's: Unity's lit term has no π (albedo ·
    # radiance · N·L), Blender's has 1/π, so the same lamp needs π more —
    # 4π² in all. Measured against the Unity sim, 4π lit X340 at a third.
    data.energy = peak * l["intensity"] * 4.0 * math.pi * math.pi
    data.shadow_soft_size = 0.05
    # The game's lamps cast no shadow (every one is shadows: None), and reach
    # no further than their range — Blender's cutoff is hard where Unity's
    # window fades, which is as close as EEVEE goes.
    data.use_shadow = False
    try:
        data.use_custom_distance = True
        data.cutoff_distance = l["range"]
    except AttributeError:
        pass
    if l["type"] == "spot":
        data.spot_size = math.radians(l["angle"])
        data.spot_blend = 1.0 - (l["innerAngle"] / l["angle"] if l["angle"] else 0.0)
    ob = bpy.data.objects.new(l["name"], data)
    ob.location = blender_xyz(l["position"])
    d = Vector(blender_xyz(l["direction"]))
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    ob["reze"] = {"range": l["range"], "intensity": l["intensity"], "color": c, "innerAngle": l["innerAngle"], "angle": l["angle"]}
    stage.objects.link(ob)

if scene_json["sun"]:
    s = scene_json["sun"]
    data = bpy.data.lights.new("Sun", "SUN")
    peak = max(s["color"]) or 1.0
    data.color = tuple(v / peak for v in s["color"])
    # W/m², with Unity's missing π restored as for the lamps.
    data.energy = peak * math.pi
    data.use_shadow = s["shadow"]
    ob = bpy.data.objects.new("Sun", data)
    d = Vector(blender_xyz(s["direction"]))
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    ob["reze"] = {"color": s["color"], "shadow": s["shadow"]}
    stage.objects.link(ob)

world_b64 = None
if scene_json["world"]:
    hdr_path = os.path.join(build, scene_json["world"]["hdr"])
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdr_path)
    bg = world.node_tree.nodes["Background"]
    world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
    scene.world = world
    world_b64 = base64.b64encode(open(hdr_path, "rb").read()).decode("ascii")

scene["reze"] = {
        "version": 1,
        "name": name,
        "pmxPerMetre": PMX_PER_METRE,
        "fill": scene_json["fill"],
        "world": {"format": "hdr", "base64": world_b64} if world_b64 else None,
        # The view the .blend below is set to, stated so the stage arrives
        # looking as the .blend renders it rather than under whatever the scene
        # was already on — the same field export_stage.py writes for a .blend
        # built by hand.
        "view": {"transform": "Filmic", "look": "None", "exposure": 0.6},
        # The game's colour grade, as the LUT its pipeline bakes from the
        # volume stack (see unity_grading.py). Applied after the view.
        "notes": scene_json["notes"],
        **({"grading": scene_json["grading"]} if scene_json.get("grading") else {}),
        # The ambient the game lights its surfaces with (glTF axes; see
        # unity_to_glb.game_ambient) — apart from the world, which is its
        # reflection probe.
        **({"ambient": {"sh": scene_json["ambient"]}} if scene_json.get("ambient") else {}),
        # The game's distance fog, in metres (unity_to_glb.game_fog).
        **({"fog": scene_json["fog"]} if scene_json.get("fog") else {}),
        # The game's character shadow on its ground (unity_to_glb).
        **({"groundShadow": scene_json["groundShadow"]} if scene_json.get("groundShadow") else {}),
}

# Viewed as the app views it — Filmic at +0.6 stops — so the .blend and the
# stage agree on the picture. The game's own curve, exposure 2.4 and contrast
# 1.35, is neither Blender's nor the app's.
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.6
scene.display_settings.display_device = "sRGB"

os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
# The images are referenced from the build folder; pack them so the .blend
# stands alone.
for img in bpy.data.images:
    if img.source == "FILE" and not img.packed_file:
        img.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(build, f"{name}.blend"))
glb = out_glb
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    export_extras=True,
    export_lights=True,
    export_apply=True,
    export_yup=True,
    export_image_format="AUTO",
    export_animations=False,
    export_normals=True,
    export_texcoords=True,
    export_materials="EXPORT",
    use_selection=False,
)
print(f"[blender] wrote {glb} ({os.path.getsize(glb) / 1e6:.1f} MB) and {name}.blend")
