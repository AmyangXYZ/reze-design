# reze Stage Export — a Blender add-on that writes a scene as a stage reze-design loads.
#
# INSTALL (one file, nothing else needed):
#   Blender 4.2+ → Edit → Preferences → Add-ons → ▾ (top right) → Install from Disk…
#   → pick this reze_stage_export.py → tick "reze Stage Export".
#   Then: File → Export → reze Stage (.glb).
#
# OR WITHOUT INSTALLING, from a terminal:
#   blender -b "Stage.blend" --python reze_stage_export.py -- "Stage.glb" [--quality 90] [--png]
#
# Your .blend is never changed. From the menu, the add-on saves a temporary copy
# and exports that in a background Blender; from the terminal, nothing is saved.
#
# What it does beyond Blender's plain glTF export — so the stage arrives as the
# .blend renders it:
#   - modifiers applied (a ring from a Bezier circle and geometry nodes exports
#     as nothing otherwise); only what is visible and renders
#   - lights exported; an area light becomes a point light of the same power
#     (glTF has no area light)
#   - the WORLD under extras.reze.world: its background colour and strength, or
#     its environment image (.hdr/.exr, packed or beside the .blend)
#   - the VIEW under extras.reze.view: view transform, look and exposure, so the
#     app shows it as you tuned it
#   - emission colours that come from nodes: an RGB node or a ColorRamp on a
#     constant is folded to the colour it makes; anything else (a gradient along
#     the object, a texture, a mix) is baked at the current frame into an image
#   - fog left out: a volume-only object would export as a solid box
#   - textures as WebP (about five times smaller); --png / the option keeps PNG
#   - a grade, ambient, fog or ground shadow a Unity stage build stored on the
#     scene (scene["reze"]) is carried through
#
# MIT, © 2026 Amyang — part of reze-design (tools/stages).

bl_info = {
    "name": "reze Stage Export",
    "author": "Amyang",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "File > Export > reze Stage (.glb)",
    "description": "Export the scene as a reze-design stage: lights, world, view, baked emission, WebP textures",
    "category": "Import-Export",
}

import base64
import math
import os
import subprocess
import sys
import tempfile

import bpy

BAKE_SIZE = 1024


# ── The export itself (runs on the scene it is given; changes it in memory) ──


def _linked_from(socket):
    """The node feeding a socket, reroutes followed, or (None, None)."""
    while socket.links:
        node = socket.links[0].from_node
        if node.type != "REROUTE":
            return node, socket.links[0].from_socket
        socket = node.inputs[0]
    return None, None


def _constant_colour(node, from_socket):
    """A node's colour output as a constant, or None when it cannot be folded."""
    if node is None:
        return None
    if node.type == "RGB":
        return tuple(node.outputs[0].default_value)[:3]
    if node.type == "VALTORGB":
        fac = node.inputs["Fac"]
        if not fac.links:  # a ramp on a constant is a constant; on position it is a gradient
            return tuple(node.color_ramp.evaluate(fac.default_value))[:3]
        return None
    if node.type == "MIX" and node.data_type == "RGBA":
        a, b = node.inputs[6], node.inputs[7]
        ca = _constant_colour(*_linked_from(a)) if a.links else tuple(a.default_value)[:3]
        cb = _constant_colour(*_linked_from(b)) if b.links else tuple(b.default_value)[:3]
        if ca and cb:
            f = node.inputs["Factor"].default_value if not node.inputs["Factor"].links else 0.5
            return tuple(ca[c] * (1 - f) + cb[c] * f for c in range(3))
    return None


def _output(mat):
    if not mat.use_nodes or not mat.node_tree:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)


def _surface_bsdf(mat):
    """The Principled BSDF feeding the material's active output, or None."""
    out = _output(mat)
    if not out or not out.inputs["Surface"].links:
        return None
    node = out.inputs["Surface"].links[0].from_node
    return node if node.type == "BSDF_PRINCIPLED" else None


def _volume_only(mat):
    out = _output(mat)
    return bool(out and out.inputs["Volume"].links and not out.inputs["Surface"].links)


def _bake_emission(scene, ob, mat):
    """Bake this object's emission colour at the current frame into an image, on a
    copy of the material that this object alone wears."""
    copy = mat.copy()
    copy.name = f"{mat.name}~{ob.name}"
    for slot in ob.material_slots:
        if slot.material == mat:
            slot.material = copy
    nt = copy.node_tree
    bsdf = _surface_bsdf(copy)
    strength = bsdf.inputs["Emission Strength"]
    kept = strength.default_value
    for link in list(strength.links):
        nt.links.remove(link)
    strength.default_value = 1.0
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


def _stored(previous, key):
    v = previous.get(key) if hasattr(previous, "get") else None
    return v.to_dict() if hasattr(v, "to_dict") else v


def export_stage(out_path, webp=True, quality=90):
    """Write the current scene as a stage .glb. Returns the notes it made."""
    scene = bpy.context.scene
    notes = []

    # Fog and other volume-only objects
    for ob in scene.objects:
        if ob.type == "MESH" and ob.material_slots and all(s.material and _volume_only(s.material) for s in ob.material_slots):
            ob.hide_render = True
            notes.append(f"{ob.name}: a volume, left out")

    # Emission colours the exporter cannot fold (it would write white)
    to_bake = []
    for mat in bpy.data.materials:
        node = _surface_bsdf(mat)
        if not node:
            continue
        colour = node.inputs["Emission Color"]
        if not colour.links:
            continue
        value = _constant_colour(*_linked_from(colour))
        if value is None:
            to_bake.append(mat)
            continue
        for link in list(colour.links):
            mat.node_tree.links.remove(link)
        colour.default_value = (value[0], value[1], value[2], 1.0)
    if to_bake:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 1
        scene.cycles.use_denoising = False
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        for mat in to_bake:
            users = [
                ob for ob in scene.objects
                if ob.type == "MESH" and ob.visible_get() and not ob.hide_render and len(ob.data.polygons) > 0
                and any(s.material == mat for s in ob.material_slots)
            ]
            for ob in users:
                _bake_emission(scene, ob, mat)
            notes.append(f"{mat.name}: emission colour from nodes, baked at frame {scene.frame_current} for {len(users)} object(s)")

    # Area lights as points
    for ob in scene.objects:
        if ob.type == "LIGHT" and ob.data.type == "AREA":
            ob.data.type = "POINT"
            notes.append(f"{ob.name}: an area light, exported as a point light of the same power")

    # The world
    world = None
    if scene.world and scene.world.use_nodes and scene.world.node_tree:
        bg = next((n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND"), None)
        if bg:
            strength = bg.inputs["Strength"].default_value
            src, _ = _linked_from(bg.inputs["Color"])
            if src and src.type == "TEX_ENVIRONMENT" and src.image:
                image = src.image
                path = bpy.path.abspath(image.filepath) if image.filepath else ""
                ext = os.path.splitext(path)[1].lower()
                data = bytes(image.packed_file.data) if image.packed_file else (
                    open(path, "rb").read() if path and os.path.exists(path) else None)
                if data and ext in (".hdr", ".exr"):
                    world = {"format": ext[1:], "base64": base64.b64encode(data).decode("ascii"), "strength": strength}
                elif data:
                    notes.append(f"world image {os.path.basename(path)} is {ext or 'packed'}, not .hdr/.exr: the world is its colour")
                else:
                    notes.append(f"world image {os.path.basename(path)} is neither packed nor on disk: the world is its colour")
            if world is None:
                c = tuple(bg.inputs["Color"].default_value)[:3]
                world = {"color": [c[0], c[1], c[2]], "strength": strength}

    # The view
    vs = scene.view_settings
    view = {"transform": vs.view_transform, "look": vs.look, "exposure": vs.exposure, "gamma": vs.gamma}

    # What a Unity stage build stored on the scene rides along
    previous = scene.get("reze")
    carried = {k: _stored(previous, k) for k in ("grading", "ambient", "fog", "groundShadow")}
    scene["reze"] = {"version": 1, "world": world, "view": view, "notes": notes,
                     **{k: v for k, v in carried.items() if v}}

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
        export_image_format="WEBP" if webp else "AUTO",
        export_image_webp_fallback=False,
        export_image_quality=quality,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
    )
    lights = sum(1 for ob in scene.objects if ob.type == "LIGHT" and ob.visible_get())
    sky = "image" if world and "base64" in world else ("colour" if world else "none")
    notes.insert(0, f"wrote {os.path.basename(out_path)} ({os.path.getsize(out_path) / 1e6:.1f} MB): "
                    f"{lights} lights, world {sky}, view {view['transform']} at {view['exposure']:+.2f}, "
                    f"textures {'WebP q%d' % quality if webp else 'PNG/JPEG'}")
    return notes


# ── The menu entry ──

try:
    from bpy_extras.io_utils import ExportHelper
except ImportError:  # pragma: no cover
    ExportHelper = object


class EXPORT_OT_reze_stage(bpy.types.Operator, ExportHelper):
    """Export the scene as a reze-design stage (.glb). The open file is not changed"""
    bl_idname = "export_scene.reze_stage"
    bl_label = "Export reze Stage"
    bl_options = {"PRESET"}

    filename_ext = ".glb"
    filter_glob: bpy.props.StringProperty(default="*.glb", options={"HIDDEN"})
    webp: bpy.props.BoolProperty(name="WebP textures", default=True,
                                 description="About five times smaller; off keeps PNG/JPEG")
    quality: bpy.props.IntProperty(name="Quality", default=90, min=1, max=100,
                                   description="WebP quality (same resolution either way)")

    def execute(self, context):
        # Everything the export does to the scene happens on a copy, in a
        # background Blender, so the file you have open stays as it is.
        tmp_dir = tempfile.mkdtemp(prefix="reze_stage_")
        tmp_blend = os.path.join(tmp_dir, "stage.blend")
        bpy.ops.wm.save_as_mainfile(filepath=tmp_blend, copy=True, relative_remap=True, check_existing=False)
        cmd = [bpy.app.binary_path, "-b", tmp_blend, "--python", os.path.abspath(__file__), "--",
               self.filepath, "--quality", str(self.quality)] + ([] if self.webp else ["--png"])
        self.report({"INFO"}, "Exporting the stage in the background…")
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        lines = [l[len("[reze] "):] for l in r.stdout.splitlines() if l.startswith("[reze] ")]
        try:
            os.remove(tmp_blend)
            os.rmdir(tmp_dir)
        except OSError:
            pass
        if r.returncode or not os.path.isfile(self.filepath):
            print(r.stdout[-4000:], r.stderr[-4000:])
            self.report({"ERROR"}, "The stage export failed; see the system console")
            return {"CANCELLED"}
        for l in lines[1:]:
            print("reze stage:", l)
        self.report({"INFO"}, lines[0] if lines else f"wrote {self.filepath}")
        return {"FINISHED"}


def _menu(self, context):
    self.layout.operator(EXPORT_OT_reze_stage.bl_idname, text="reze Stage (.glb)")


def register():
    bpy.utils.register_class(EXPORT_OT_reze_stage)
    bpy.types.TOPBAR_MT_file_export.append(_menu)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(_menu)
    bpy.utils.unregister_class(EXPORT_OT_reze_stage)


# ── From a terminal: blender -b Stage.blend --python reze_stage_export.py -- Stage.glb ──

if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if bpy.app.background and args:
        out = args[0]
        q = int(args[args.index("--quality") + 1]) if "--quality" in args else 90
        for note in export_stage(out, webp="--png" not in args, quality=q):
            print("[reze]", note, flush=True)
    else:
        register()  # run from the Text Editor: adds the menu entry for this session
