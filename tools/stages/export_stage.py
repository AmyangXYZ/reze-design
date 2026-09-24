# Export a Blender scene as a stage the app loads.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b "Stage.blend" \
#     --python tools/stages/export_stage.py -- "stages/Stage/Stage.glb"
#
# Blender's own glTF exporter writes the file; this script sets it up so the
# stage arrives as the .blend renders it, which the stock export does not:
#
#   - modifiers applied — a ring built from a Bezier circle and geometry nodes
#     exports as nothing otherwise, and a mirrored wing as half of one
#   - only what is visible and renders; the author's hidden alternatives and
#     the rigid-body boxes of a test character stay behind
#   - lights, area lights included: glTF has no area light, so each becomes a
#     point light of the same power and colour standing where the panel stood
#   - the WORLD under `extras.reze.world`: its background colour and strength,
#     or its environment image when it has one
#   - the VIEW under `extras.reze.view`: the transform, look and exposure the
#     scene was authored under — a neon stage tuned under AgX at −0.5 stops is
#     a different picture under Filmic at +0.6
#   - emission colours that come from nodes: the exporter writes white for a
#     colour it cannot fold. An RGB node or a ColorRamp on a constant is
#     evaluated and written as the constant it produces; anything else — a
#     ramp along the object, a texture, a mix — is BAKED at the current frame
#     into an image the material then emits, per object, so a neon bar keeps
#     its gradient
#   - fog left out: an object whose material is volume only exports as a
#     solid box the size of the fog, which is a grey room around the stage
#
# Every change is made in memory; the .blend is not saved.

import base64
import math
import os
import sys

import bpy

out_path = sys.argv[sys.argv.index("--") + 1]
scene = bpy.context.scene
notes = []


def linked_from(socket):
    """The node feeding a socket, reroutes followed, or None."""
    while socket.links:
        node = socket.links[0].from_node
        if node.type != "REROUTE":
            return node, socket.links[0].from_socket
        socket = node.inputs[0]
    return None, None


def constant_colour(node, from_socket):
    """A node's colour output as a constant, or None when it cannot be folded."""
    if node.type == "RGB":
        return tuple(node.outputs[0].default_value)[:3]
    if node.type == "VALTORGB":
        fac = node.inputs["Fac"]
        # A ramp on a constant is a constant; one driven by position or time
        # is a gradient, and a gradient is baked.
        if not fac.links:
            return tuple(node.color_ramp.evaluate(fac.default_value))[:3]
        return None
    if node.type == "MIX" and node.data_type == "RGBA":
        a = node.inputs[6]
        b = node.inputs[7]
        ca = constant_colour(*linked_from(a)) if a.links else tuple(a.default_value)[:3]
        cb = constant_colour(*linked_from(b)) if b.links else tuple(b.default_value)[:3]
        if ca and cb:
            f = node.inputs["Factor"].default_value if not node.inputs["Factor"].links else 0.5
            return tuple(ca[c] * (1 - f) + cb[c] * f for c in range(3))
    return None


def surface_bsdf(mat):
    """The Principled node feeding the material's active output, or None."""
    if not mat.use_nodes or not mat.node_tree:
        return None
    out = next((n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
    if not out or not out.inputs["Surface"].links:
        return None
    node = out.inputs["Surface"].links[0].from_node
    return node if node.type == "BSDF_PRINCIPLED" else None


def volume_only(mat):
    if not mat.use_nodes or not mat.node_tree:
        return False
    out = next((n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
    return bool(out and out.inputs["Volume"].links and not out.inputs["Surface"].links)


# ── Fog and other volume-only objects ──
for ob in scene.objects:
    if ob.type == "MESH" and ob.material_slots and all(s.material and volume_only(s.material) for s in ob.material_slots):
        ob.hide_render = True
        notes.append(f"{ob.name}: a volume, left out")


# ── Emission colours the exporter cannot fold ──
BAKE_SIZE = 1024
to_bake = []
for mat in bpy.data.materials:
    node = surface_bsdf(mat)
    if not node:
        continue
    colour = node.inputs["Emission Color"]
    if not colour.links:
        continue
    src, sock = linked_from(colour)
    value = constant_colour(src, sock) if src else None
    if value is None:
        to_bake.append(mat)
        continue
    for link in list(colour.links):
        mat.node_tree.links.remove(link)
    colour.default_value = (value[0], value[1], value[2], 1.0)


def bake_emission(ob, mat):
    """Bake this object's emission colour at the current frame into an image
    and make a copy of the material that emits it, on this object alone."""
    copy = mat.copy()
    copy.name = f"{mat.name}~{ob.name}"
    for slot in ob.material_slots:
        if slot.material == mat:
            slot.material = copy
    nt = copy.node_tree
    bsdf = surface_bsdf(copy)
    strength = bsdf.inputs["Emission Strength"]
    kept = strength.default_value
    for link in list(strength.links):
        nt.links.remove(link)
    strength.default_value = 1.0
    # The operators want the object selected and active in the real context;
    # an override leaves edit mode without an edit object.
    for other in scene.objects:
        other.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if not ob.data.uv_layers:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new(f"{copy.name}_E", BAKE_SIZE, BAKE_SIZE, alpha=False)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    bpy.ops.object.bake(type="EMIT", margin=4, use_clear=True)
    for link in list(bsdf.inputs["Emission Color"].links):
        nt.links.remove(link)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    strength.default_value = kept


if to_bake:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    for mat in to_bake:
        users = [
            ob
            for ob in scene.objects
            if ob.type == "MESH" and ob.visible_get() and not ob.hide_render and len(ob.data.polygons) > 0 and any(s.material == mat for s in ob.material_slots)
        ]
        for ob in users:
            bake_emission(ob, mat)
        notes.append(f"{mat.name}: emission colour from nodes, baked at frame {scene.frame_current} for {len(users)} object(s)")

# ── Area lights as points ──
for ob in scene.objects:
    if ob.type == "LIGHT" and ob.data.type == "AREA":
        light = ob.data
        light.type = "POINT"
        notes.append(f"{ob.name}: an area light, exported as a point light of the same power")

# ── The world ──
world = None
if scene.world and scene.world.use_nodes and scene.world.node_tree:
    bg = next((n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        strength = bg.inputs["Strength"].default_value
        src, _ = linked_from(bg.inputs["Color"])
        if src and src.type == "TEX_ENVIRONMENT" and src.image:
            image = src.image
            path = bpy.path.abspath(image.filepath) if image.filepath else ""
            ext = os.path.splitext(path)[1].lower()
            # Packed into the .blend, or beside it on disk — a stage handed
            # around as one file carries its sky inside.
            data = bytes(image.packed_file.data) if image.packed_file else (open(path, "rb").read() if path and os.path.exists(path) else None)
            if data and ext in (".hdr", ".exr"):
                world = {"format": ext[1:], "base64": base64.b64encode(data).decode("ascii"), "strength": strength}
            elif data:
                notes.append(f"world image {os.path.basename(path)} is a {ext or 'packed'} image; the app reads .hdr — the world is its colour")
            else:
                notes.append(f"world image {os.path.basename(path)} is neither packed nor on disk; the world is its colour")
        if world is None:
            c = tuple(bg.inputs["Color"].default_value)[:3]
            world = {"color": [c[0], c[1], c[2]], "strength": strength}

# ── The view ──
vs = scene.view_settings
view = {"transform": vs.view_transform, "look": vs.look, "exposure": vs.exposure, "gamma": vs.gamma}

# A grade the Unity build baked into this .blend stays with it: Blender has no
# place of its own for the game's LUT, so it rides on the scene property.
previous = scene.get("reze")
grading = previous.get("grading") if hasattr(previous, "get") else None
if hasattr(grading, "to_dict"):
    grading = grading.to_dict()
ambient = previous.get("ambient") if hasattr(previous, "get") else None
if hasattr(ambient, "to_dict"):
    ambient = ambient.to_dict()
fog = previous.get("fog") if hasattr(previous, "get") else None
if hasattr(fog, "to_dict"):
    fog = fog.to_dict()
ground_shadow = previous.get("groundShadow") if hasattr(previous, "get") else None
if hasattr(ground_shadow, "to_dict"):
    ground_shadow = ground_shadow.to_dict()

scene["reze"] = {"version": 1, "world": world, "view": view, "notes": notes, **({"grading": grading} if grading else {}), **({"ambient": ambient} if ambient else {}), **({"fog": fog} if fog else {}), **({"groundShadow": ground_shadow} if ground_shadow else {})}

os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_apply=True,
    export_lights=True,
    export_extras=True,
    use_visible=True,
    use_renderable=True,
    export_animations=False,
    export_yup=True,
    export_image_format="AUTO",
    export_normals=True,
    export_texcoords=True,
    export_materials="EXPORT",
)
lights = sum(1 for ob in scene.objects if ob.type == "LIGHT" and ob.visible_get())
print(f"[blender] wrote {out_path} ({os.path.getsize(out_path) / 1e6:.1f} MB): {lights} lights, world {'image' if world and 'base64' in world else world['color'] if world else 'none'}, view {view['transform']} {view['look']} at {view['exposure']:+.2f}")
for n in notes:
    print(f"[blender]   {n}")
