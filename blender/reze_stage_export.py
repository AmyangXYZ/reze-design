# REZE DESIGN Stage Export — a Blender add-on that writes a scene as a stage reze-design loads.
#
# INSTALL (one file, nothing else needed):
#   Blender 4.2+ → Edit → Preferences → Add-ons → ▾ (top right) → Install from Disk…
#   → pick this reze_stage_export.py → tick "REZE DESIGN Stage Export".
#   Then: File → Export → REZE DESIGN Stage (.glb).
#
# OR WITHOUT INSTALLING, from a terminal:
#   blender -b "Stage.blend" --python reze_stage_export.py -- "Stage.glb" [--quality 90] [--png]
#
# Your .blend is never changed. From the menu, the add-on saves a temporary copy
# and exports that in a background Blender; from the terminal, nothing is saved.
#
# WHAT A PLAIN glTF EXPORT LOSES, AND WHAT THIS DOES ABOUT IT
#
# Materials go out exactly as Blender's own glTF exporter writes them. What it
# loses is the scene around them — how the stage is lit, its air and its glow —
# and that is this add-on's job:
#
#   - Geometry-node scatters, hair scatters of objects and collection instances
#     are made real first: glTF has no instances, and a scatter exported as its
#     base plane.
#   - PARTICLES: an emitter system (sparks, embers, snow, petals) becomes the
#     app's particle effect — the one a Unity stage's systems draw through — so
#     it keeps moving instead of standing frozen at the exported frame: its
#     rate, life, speed, gravity, size and spin, its emitter's shape, and the
#     instanced object's picture or colour, glowing when it is emissive.
#   - Lights: an area light becomes a spot of the same reach — a hemisphere
#     cone at four times the power, which is what a panel throws straight out
#     where a point of the same power would throw a quarter. A light's
#     exposure, its colour temperature and an unnormalised area's size are
#     folded into its colour and power, which glTF can say.
#   - The WORLD under extras.reze.world: its colour and strength; its
#     environment image (.hdr/.exr); or, for a world built from nodes (a Sky
#     Texture, a gradient), the world itself rendered to an HDR panorama.
#   - The VIEW under extras.reze.view: view transform, look and exposure, so
#     the app shows it as you tuned it.
#   - Fog left out: a volume-only object would export as a solid box.
#   - Textures as WebP (about five times smaller); --png / the option keeps PNG.
#   - A grade, ambient, fog or ground shadow a Unity stage build stored on the
#     scene (scene["reze"]) is carried through.
#   - Candle flames: an empty named flame.01, flame.02, … at a wick, its local
#     +Y up the flame and scaled to its length, becomes a bone the app stands
#     its Candle Flames effect on.
#
# MIT, © 2026 AmyangXYZ — part of reze-design (blender/).

bl_info = {
    "name": "REZE DESIGN Stage Export",
    "author": "AmyangXYZ <amyang.xyz@gmail.com>",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "File > Export > REZE DESIGN Stage (.glb)",
    "description": "Export the scene as a reze-design stage: lights, world, haze, glow, particles",
    "category": "Import-Export",
}

import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bpy

def note(notes, text):
    notes.append(text)
    if bpy.app.background:
        print("[reze:progress]", text, flush=True)


def step(fraction, text):
    """Where the export has got to, for the menu's progress bar: the operator
    reads these off the background Blender's output."""
    if bpy.app.background:
        print(f"[reze:step] {fraction:.2f} {text}", flush=True)


# ── Reading node trees ──


def _linked_from(socket):
    """The node feeding a socket, reroutes followed, or (None, None)."""
    while socket.links:
        link = socket.links[0]
        if not link.is_valid or link.is_muted:
            return None, None
        node = link.from_node
        if node.type != "REROUTE":
            return node, link.from_socket
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
        if ca and cb and not node.inputs["Factor"].links:
            f = node.inputs["Factor"].default_value
            return tuple(ca[c] * (1 - f) + cb[c] * f for c in range(3))
    return None


def _output(mat):
    if not mat.node_tree:
        return None
    outs = [n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL"]
    return next((n for n in outs if n.is_active_output), outs[0] if outs else None)


def _surface(mat):
    out = _output(mat)
    return _linked_from(out.inputs["Surface"])[0] if out else None


def _volume_only(mat):
    out = _output(mat)
    return bool(out and out.inputs["Volume"].links and not out.inputs["Surface"].links)


def _all_nodes(tree, seen=None):
    """Every node of a tree and of the groups inside it."""
    seen = seen if seen is not None else set()
    for n in tree.nodes:
        yield n
        if n.type == "GROUP" and n.node_tree and n.node_tree.name not in seen:
            seen.add(n.node_tree.name)
            yield from _all_nodes(n.node_tree, seen)


def _trees(mat):
    """A material's node tree and every group tree inside it, once each."""
    yield mat.node_tree
    seen = set()
    for n in _all_nodes(mat.node_tree):
        if n.type == "GROUP" and n.node_tree and n.node_tree.name not in seen:
            seen.add(n.node_tree.name)
            yield n.node_tree


def _uv_vector_ok(tex):
    """An image texture read through the mesh's UVs (optionally a Mapping)."""
    src, sock = _linked_from(tex.inputs["Vector"])
    if src is None or src.type == "UVMAP":
        return True
    if src.type == "TEX_COORD":
        return sock.name == "UV"
    if src.type == "MAPPING" and src.vector_type in ("POINT", "TEXTURE"):
        inner, s2 = _linked_from(src.inputs["Vector"])
        return inner is None or inner.type == "UVMAP" or (inner.type == "TEX_COORD" and s2.name == "UV")
    return False


def _image_fed(socket, outputs=("Color",)):
    src, sock = _linked_from(socket)
    return src is not None and src.type == "TEX_IMAGE" and src.image is not None and sock.name in outputs and _uv_vector_ok(src)


def _fold_emission(mat):
    """A Principled emission colour that comes from constant nodes, written as the constant."""
    node = _surface(mat)
    if node is None or node.type != "BSDF_PRINCIPLED":
        return
    e = node.inputs["Emission Color"]
    if e.links and not _image_fed(e):
        value = _constant_colour(*_linked_from(e))
        if value is not None:
            for link in list(e.links):
                mat.node_tree.links.remove(link)
            e.default_value = (value[0], value[1], value[2], 1.0)


# ── Instances made real ──


def _coplanar(scene, notes, lift=0.002, min_area=0.05):
    """Surfaces of different objects that lie in one plane facing the same way
    — a runway's top laid flush on its base, a dance floor on a deck. Cycles
    picks one per ray and never flickers; a depth buffer cannot tell them
    apart and they fight. The smaller of each pair (the one laid ON the other)
    is lifted along the plane's normal by `lift` metres: under a pixel at any
    distance the app is viewed from, and enough to settle the order."""
    from collections import defaultdict
    dg = bpy.context.evaluated_depsgraph_get()
    planes = defaultdict(lambda: defaultdict(list))   # plane -> object -> [(area, lo, hi)]
    normals = {}
    for ob in scene.objects:
        if ob.type != "MESH" or not ob.visible_get() or ob.hide_render or not ob.data.polygons:
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        sc = abs(mw.to_scale().x * mw.to_scale().y)
        for p in me.polygons:
            if p.area * sc < min_area:
                continue
            n = (nm @ p.normal).normalized()
            c = mw @ p.center
            key = (round(n.x, 2), round(n.y, 2), round(n.z, 2), round(n.dot(c) / 0.002))
            vs = [mw @ me.vertices[i].co for i in p.vertices]
            lo = [min(v[k] for v in vs) for k in range(3)]
            hi = [max(v[k] for v in vs) for k in range(3)]
            planes[key][ob.name].append((p.area * sc, lo, hi))
            normals[key] = n
        ev.to_mesh_clear()
    total = defaultdict(float)
    for by in planes.values():
        for name, faces in by.items():
            total[name] += sum(f[0] for f in faces)
    shared = defaultdict(float)   # (small, big) -> overlapping area, and the normal
    normal_of = {}
    for key, by in planes.items():
        if len(by) < 2:
            continue
        # Overlap AREA in the plane, not contact: pleats side by side share an
        # edge and must not count. The axis the normal runs along is dropped.
        n = normals[key]
        flat = max(range(3), key=lambda k: abs(n[k]))
        axes = [k for k in range(3) if k != flat]

        def overlap(a, b):
            area = 1.0
            for k in axes:
                ext = min(a[2][k], b[2][k]) - max(a[1][k], b[1][k])
                if ext <= 0.01:
                    return 0.0
                area *= ext
            return area

        names = sorted(by, key=lambda k: (total[k], k))
        for i, small in enumerate(names):
            for big in names[i + 1:]:
                a = sum(overlap(x, y) for x in by[small][:400] for y in by[big][:400])
                if a > 0:
                    shared[(small, big)] += a
                    normal_of[(small, big)] = n
    # LAID ON, not touching: the overlap is a real share of the smaller object
    # (a runway's top), not the caps of two columns that happen to meet.
    pairs = [(s_, b_) for (s_, b_), a in shared.items() if a >= 0.25 or (a >= 0.01 and a >= 0.1 * total[s_])]
    # Layered from the biggest down, so a surface laid on a lifted one goes
    # above it rather than back level with it.
    offset = {}
    for small, big in sorted(pairs, key=lambda p: (-total[p[1]], -total[p[0]], p)):
        k = offset.get(big, 0.0) + lift
        before = offset.get(small, 0.0)
        if k > before:
            offset[small] = k
            ob = scene.objects[small]
            ob.matrix_world.translation += normal_of[(small, big)] * (k - before)
            note(notes, f"{small}: flush on {big} — lifted {k * 1000:.0f} mm so the two do not flicker")


def _realize(scene, notes):
    """Geometry-node scatters, particle instances and collection instances as
    real objects: glTF has no instances, and a scatter exported as its base."""
    view = bpy.context.view_layer

    def only(ob):
        for o in view.objects:
            o.select_set(False)
        ob.select_set(True)
        view.objects.active = ob

    def shown(source):
        """The copies just made real, rendering: they inherit the instanced
        object's switches, and a particle's object is usually hidden from render
        (a collection's own hidden members stay hidden, as Blender draws them)."""
        for o in bpy.context.selected_objects:
            if o != source:
                o.hide_render = False
                o.hide_set(False)

    for ob in list(scene.objects):
        if not ob.visible_get() or ob.hide_render:
            continue
        if ob.instance_type == "COLLECTION" and ob.instance_collection:
            only(ob)
            bpy.ops.object.duplicates_make_real(use_base_parent=True, use_hierarchy=True)
            note(notes, f"{ob.name}: a collection instance, made real")
        elif ob.type == "MESH" and any(ps.settings.type == "HAIR" and ps.settings.render_type in ("OBJECT", "COLLECTION")
                                       for ps in ob.particle_systems):
            # hair is a scatter that stands still (grass, pebbles): real geometry
            only(ob)
            bpy.ops.object.duplicates_make_real()
            shown(ob)
            if not ob.show_instancer_for_render:
                ob.hide_render = True
            note(notes, f"{ob.name}: scattered instances, made real")
    realize = None
    for ob in list(scene.objects):
        if ob.type in ("MESH", "CURVE", "SURFACE", "META", "FONT") and ob.visible_get() and not ob.hide_render \
                and any(m.type == "NODES" for m in ob.modifiers):
            # Converting keeps a scatter's instances as instances, which the
            # mesh then drops: realize them at the end of the stack first.
            if realize is None:
                realize = bpy.data.node_groups.new("reze_realize", "GeometryNodeTree")
                realize.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
                realize.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
                gi = realize.nodes.new("NodeGroupInput")
                go = realize.nodes.new("NodeGroupOutput")
                rn = realize.nodes.new("GeometryNodeRealizeInstances")
                realize.links.new(gi.outputs[0], rn.inputs[0])
                realize.links.new(rn.outputs[0], go.inputs[0])
            ob.modifiers.new("reze_realize", "NODES").node_group = realize
            only(ob)
            try:
                bpy.ops.object.convert(target="MESH")
                note(notes, f"{ob.name}: geometry nodes, made real")
            except RuntimeError as e:
                note(notes, f"{ob.name}: geometry nodes could not be made real ({e})")


# ── Particles ──
#
# A Blender EMITTER system becomes the app's generated particle effect — the one
# a Unity stage's systems draw through (lib/unity-particles.ts) — so sparks,
# embers, snow and petals keep moving in the app instead of standing frozen at
# the frame the export ran. glTF carries none of it: the systems go to
# extras.reze.particlesJson in Unity's ParticleSystem terms, and each emitter as
# a pair of empties ps<k>_NNN (its emitting axis, then its sideways axis, each
# one metre long; metresPerUnit 1, so the effect's units are metres).
#
# What carries: count over the frame range as a rate, lifetime and its random,
# normal velocity and its random, velocity along the object's axes, gravity (its
# field weight), size and its random, random rotation and spin, an emitter
# that started before the scene (prewarm). The emitter's shape is its mesh's
# bounds: a flat mesh is a box across it that emits along its normal, a round
# one a sphere that emits outward, anything else a box sending every way. The
# picture is the instanced object's image texture, or a soft dot of its colour;
# an emissive instance glows (added), any other is laid over. Not carried:
# physics other than Newtonian, forces besides gravity, brownian motion,
# children, and anything a particle does over its life in nodes.


def _soft_dot(size=64):
    import numpy as np
    y, x = np.mgrid[0:size, 0:size]
    r = np.hypot(x - (size - 1) / 2, y - (size - 1) / 2) / (size / 2)
    a = np.clip(1 - r, 0, 1) ** 2
    px = np.ones((size, size, 4), np.float32)
    px[..., 3] = a
    img = bpy.data.images.new("reze_dot", size, size, alpha=True)
    img.pixels.foreach_set(px.ravel())
    return img


def _png(img, max_size=512):
    """An image as base64 PNG bytes, no larger than max_size across."""
    copy = img.copy()
    w, h = copy.size
    if max(w, h) > max_size:
        k = max_size / max(w, h)
        copy.scale(max(1, round(w * k)), max(1, round(h * k)))
    path = os.path.join(tempfile.mkdtemp(prefix="reze_ps_"), "p.png")
    copy.filepath_raw = path
    copy.file_format = "PNG"
    copy.save()
    with open(path, "rb") as f:
        data = f.read()
    bpy.data.images.remove(copy)
    return base64.b64encode(data).decode("ascii")


def _instance_look(settings):
    """(picture image or None, linear colour, emission strength, size of the instance)
    from what the system instances."""
    ob = settings.instance_object if settings.render_type == "OBJECT" else next(
        (o for o in (settings.instance_collection.all_objects if settings.instance_collection else []) if o.type == "MESH"), None)
    if ob is None:
        return None
    extent = max(ob.dimensions) or 1.0
    mat = next((s.material for s in ob.material_slots if s.material), None) if ob.type == "MESH" else None
    image, colour, strength = None, (1.0, 1.0, 1.0), 0.0
    node = _surface(mat) if mat and mat.node_tree else None
    if node is not None and node.type == "BSDF_PRINCIPLED":
        i = node.inputs
        src, _ = _linked_from(i["Base Color"])
        image = src.image if src is not None and src.type == "TEX_IMAGE" else None
        colour = tuple(i["Base Color"].default_value)[:3] if not i["Base Color"].links else (1.0, 1.0, 1.0)
        strength = i["Emission Strength"].default_value if not i["Emission Strength"].links else 1.0
        e = i["Emission Color"]
        esrc, _ = _linked_from(e)
        if esrc is not None and esrc.type == "TEX_IMAGE":
            image = image or esrc.image
            ecol = (1.0, 1.0, 1.0)
        else:
            ecol = _constant_colour(esrc, None) if esrc is not None else tuple(e.default_value)[:3]
        if strength > 0 and ecol and max(ecol) > 0:
            colour, strength = ecol, strength
        else:
            strength = 0.0
    elif node is not None and node.type == "EMISSION":
        src, _ = _linked_from(node.inputs["Color"])
        image = src.image if src is not None and src.type == "TEX_IMAGE" else None
        colour = (1.0, 1.0, 1.0) if image else (_constant_colour(src, None) if src is not None else tuple(node.inputs["Color"].default_value)[:3]) or (1.0, 1.0, 1.0)
        strength = node.inputs["Strength"].default_value if not node.inputs["Strength"].links else 1.0
    elif mat is not None:
        colour = tuple(mat.diffuse_color)[:3]
    return image, colour, strength, extent


def _emitter_frame(ob):
    """The emitter's shape and axes from its mesh: (shape dict, origin, z axis, x axis), world space."""
    import numpy as np
    from mathutils import Vector
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    centre_l = (lo + hi) / 2
    m = ob.matrix_world
    axes = [m.col[k].to_3d() for k in range(3)]
    scale = [a.length for a in axes]
    dims = (hi - lo) * np.array(scale)
    units = [a.normalized() for a in axes]
    origin = m @ Vector(centre_l.tolist())
    flat = int(np.argmin(dims))
    shape = {"on": True, "type": 5, "radius": 1.0, "radiusThickness": 1.0, "angle": 0.0, "arc": 360.0, "length": 0.0,
             "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "randomDirection": 0.0}
    if dims[flat] < 0.01 * max(dims.max(), 1e-6):
        # a sheet: a box across it, sending along its normal
        others = [k for k in range(3) if k != flat]
        z, x = units[flat], units[others[0]]
        normal = np.zeros(3)
        for poly in me.polygons:
            normal += np.array(poly.normal) * poly.area
        if normal[flat] < 0:
            z = -z
        shape["scale"] = [float(dims[others[0]]), float(dims[others[1]]), 0.0]
        return shape, origin, z, x, "a sheet"
    r = np.linalg.norm((co - centre_l) * np.array(scale), axis=1)
    if r.mean() > 0 and r.std() / r.mean() < 0.03 and dims.max() / max(dims.min(), 1e-6) < 1.05:
        shape.update(type=0, radius=float(r.mean()), radiusThickness=0.0)
        return shape, origin, units[2], units[0], "a sphere"
    shape["scale"] = [float(dims[0]), float(dims[1]), float(dims[2])]
    shape["randomDirection"] = 1.0
    return shape, origin, units[2], units[0], "a box sending every way"


def _curve(lo, hi=None):
    hi = lo if hi is None else hi
    return {"mode": 0, "lo": lo, "hi": lo} if abs(hi - lo) < 1e-9 else {"mode": 3, "lo": min(lo, hi), "hi": max(lo, hi)}


def _particles(scene, notes):
    """Emitter systems as the app's particle effects: (classes, empties made)."""
    from mathutils import Matrix
    fps = scene.render.fps / (scene.render.fps_base or 1.0)
    g = (abs(scene.gravity[2]) / 9.81) if scene.use_gravity else 0.0
    classes, keys = [], {}
    stage = scene.collection
    for ob in list(scene.objects):
        if ob.type != "MESH" or not ob.visible_get() or ob.hide_render or not ob.particle_systems:
            continue
        for psys in ob.particle_systems:
            st = psys.settings
            if st.type != "EMITTER":
                continue
            if st.render_type not in ("OBJECT", "COLLECTION"):
                note(notes, f"{ob.name} / {psys.name}: renders as {st.render_type.lower()}, which Blender's renderers draw as nothing; left out")
                continue
            if st.physics_type not in ("NEWTON", "NO"):
                note(notes, f"{ob.name} / {psys.name}: {st.physics_type.lower()} physics is not carried; left out")
                continue
            look = _instance_look(st)
            if look is None:
                note(notes, f"{ob.name} / {psys.name}: instances nothing drawable; left out")
                continue
            image, colour, strength, extent = look
            span = max((st.frame_end - st.frame_start) / fps, 1.0 / fps)
            life = st.lifetime / fps
            speed = st.normal_factor
            rnd = st.factor_random
            shape, origin, z, x, kind = _emitter_frame(ob)
            if rnd > 0:
                shape["randomDirection"] = max(shape["randomDirection"], min(1.0, rnd / max(speed + rnd, 1e-6)))
                speed = speed if speed > 0 else rnd
            size = st.particle_size * extent
            spin = st.angular_velocity_factor if (st.use_rotations and st.angular_velocity_mode != "NONE") else 0.0
            # velocity along the object's axes, in Unity's world axes (Blender
            # (x, y, z) → glTF (x, z, −y) → Unity (−x, y, z) of glTF)
            av = st.object_align_factor
            world_v = ob.matrix_world.to_3x3() @ av if any(abs(c) > 1e-6 for c in av) else None
            spec = {
                "duration": span, "looping": True, "prewarm": st.frame_start < scene.frame_start,
                "scalingMode": 1, "simulationSpace": 1, "max": int(st.count),
                "lifetime": _curve(life * (1 - st.lifetime_random), life),
                "speed": _curve(speed),
                "size3D": False,
                "size": [_curve(size * (1 - st.size_random), size)] * 3,
                "rotation3D": False,
                "rotation": _curve(0.0, 2 * math.pi * st.rotation_factor_random) if st.use_rotations else _curve(0.0),
                "rotationX": _curve(0.0), "rotationY": _curve(0.0),
                "color": {"mode": 0, "lo": [1, 1, 1, 1], "hi": [1, 1, 1, 1]},
                "gravity": _curve(g * st.effector_weights.gravity),
                "emission": {"on": True, "rate": _curve(st.count / span), "bursts": []},
                "shape": shape,
                "sizeOverLife": None,
                "rotationOverLife": {"on": True, "z": _curve(spin)} if spin else None,
                "colorOverLife": None, "uv": None, "clamp": None, "noise": None, "custom": None,
                "velocity": {
                    "linear": [_curve(-world_v.x), _curve(world_v.z), _curve(-world_v.y)],
                    "orbital": [_curve(0.0)] * 3, "offset": [_curve(0.0)] * 3, "radial": _curve(0.0),
                    "speedModifier": _curve(1.0), "world": True,
                } if world_v is not None else None,
                "renderer": {"mode": 0, "pivot": [0.0, 0.0, 0.0], "lengthScale": 2.0, "velocityScale": 0.0,
                             "linear": True, "alignment": 0},
            }
            glow = strength > 0
            key = (st.name, image.name if image else None, tuple(round(c, 4) for c in colour), round(strength, 4))
            if key not in keys:
                dot = None if image else _soft_dot()
                picture = _png(image or dot)
                if dot:
                    bpy.data.images.remove(dot)
                layer = {"scale": [1.0, 1.0], "offset": [0.0, 0.0], "rotation": 0.0, "tiling": False, "speed": [0.0, 0.0], "srgb": True}
                tint = [c * (strength if glow else 1.0) for c in colour]
                material = {"layers": {"main": layer}, "mainPow": [1, 1, 1, 0], "color": tint + [1.0], "redAlphaMain": False,
                            "plusPow": [1, 1, 1, 0], "plusColor": [1, 1, 1, 1], "redAlphaPlus": False, "plusStrength": 0,
                            "plusColorOn": 0, "plusAlphaOn": 0, "plusMode": 0, "redAlphaMask": False, "maskStrength": 0,
                            # Unity's blend factors: One adds (a glow), OneMinusSrcAlpha lays over
                            "dstBlend": 1 if glow else 10}
                keys[key] = len(classes)
                classes.append({"name": f"{st.name} ({ob.name})", "prefix": f"ps{len(classes)}_", "emitters": 0,
                                "metresPerUnit": 1.0, "spec": spec, "material": material,
                                "textures": [{"png": picture, "srgb": True}], "_points": []})
            c = classes[keys[key]]
            c["emitters"] += 1
            for axis in (z, x):
                n = len(c["_points"]) + 1
                e = bpy.data.objects.new(f"{c['prefix']}{n:03d}", None)
                e.empty_display_type = "SINGLE_ARROW"
                e.matrix_world = Matrix.Translation(origin) @ axis.to_track_quat("Z", "Y").to_matrix().to_4x4()
                stage.objects.link(e)
                c["_points"].append(e.name)
            note(notes, f"{ob.name} / {psys.name}: {int(st.count)} particles over {span:.1f}s, {life:.1f}s each, "
                        f"from {kind}, {'glowing' if glow else 'laid over'} — drawn as a particle effect")
        # "Show Emitter" off: Blender renders the particles and not the mesh
        if not ob.show_instancer_for_render and any(ps.settings.type == "EMITTER" for ps in ob.particle_systems):
            ob.hide_render = True
    for c in classes:
        c.pop("_points")
    return classes


# ── Lights ──
#
# THE APP'S LAMPS ARE UNITY'S, Blender's are Cycles', and glTF carries only the
# part the two agree on. The loader divides Blender's watts by π (Unity's
# lit term has none) and that much is exact; what glTF cannot say is the rest
# of how a Cycles light behaves, and each gap here is a number the app reads:
#
#   - REACH. glTF writes no range, and the app fades every lamp to nothing at
#     its range — 10 m when none is given — by (1 − (d/R)⁴)². A rig 7 m up was
#     lighting its own deck at a fraction of its power. Each lamp now states
#     the distance where it falls under RANGE_FLOOR of white, which Cycles'
#     plain inverse square never cuts.
#   - SIZE. A point in the app gets brighter without limit as a surface comes
#     close; a Cycles area light cannot — beside it a wall sees the panel's
#     radiance and no more. The app's bulb (near: the inverse square held flat
#     inside it) is set so the peak matches: a panel of area A at radiance L
#     peaks at L, and a point of the same on-axis intensity L·A peaks at
#     L·A/near², so near = √(A/π). A sphere light's bulb is its radius.
#   - AREA LIGHTS become spots: a hemisphere cone, at four times the power,
#     which is a panel's on-axis intensity (P/π where a point's is P/4π).
#   - A light's exposure, its colour temperature and an unnormalised area's
#     size fold into its colour and power.

RANGE_FLOOR = 0.002   # app light units: a lamp this dim is dark on any albedo
LAMP_CAP = 256        # the app's lamps, all told


def _blackbody(kelvin):
    """Linear RGB of a black body, normalised to its brightest channel
    (Tanner Helland's fit, linearised)."""
    t = max(1000.0, min(40000.0, kelvin)) / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    srgb = [max(0.0, min(255.0, c)) / 255.0 for c in (r, g, b)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    top = max(lin) or 1.0
    return [c / top for c in lin]


def _reach(energy, colour):
    """Metres to where a point or spot of this power falls under RANGE_FLOOR:
    its app intensity is P/(4π²) per channel (the loader's P/4π/683·683/π)."""
    peak = energy * max(colour) / (4 * math.pi ** 2)
    return round(min(300.0, max(10.0, math.sqrt(max(peak, 0.0) / RANGE_FLOOR))), 2)


# A PANEL'S CONE. The app shapes a spot by aim², aim running linearly in the
# cosine from the outer edge to the inner; a Lambertian panel falls as cos θ.
# Outer 179°, inner 74.5° is the least-squares fit of the one to the other
# over the hemisphere: exact on the axis, within 0.15 everywhere.
LAMBERT_CONE = {"angle": 179.0, "innerAngle": 74.5}


def _lamp_extras(ob, near, panel=False):
    L = ob.data
    if L.type == "SUN":
        return
    # A light with glossy visibility off fills the room and puts no highlight
    # on anything — a stage rig's way of lighting a shiny floor without
    # flaring it. The app's lamp says so with specular: false.
    glossy = getattr(ob, "visible_glossy", True)
    ob["reze"] = {"range": _reach(L.energy, tuple(L.color)), "near": round(max(near, 0.02), 4),
                  **(LAMBERT_CONE if panel else {}), **({} if glossy else {"specular": False})}


def _lights(scene, notes):
    for ob in scene.objects:
        if ob.type != "LIGHT" or not ob.visible_get() or ob.hide_render:
            continue
        L = ob.data
        exposure = getattr(L, "exposure", 0.0)
        if exposure:
            L.energy *= 2.0 ** exposure
            L.exposure = 0.0
        if getattr(L, "use_temperature", False):
            k = _blackbody(L.temperature)
            L.color = (L.color[0] * k[0], L.color[1] * k[1], L.color[2] * k[2])
            L.use_temperature = False
        if L.type == "AREA":
            w = L.size
            h = L.size_y if L.shape in ("RECTANGLE", "ELLIPSE") else L.size
            area = w * h * (math.pi / 4 if L.shape in ("DISK", "ELLIPSE") else 1.0)
            if hasattr(L, "normalize") and not L.normalize:
                L.energy *= area
            spread = getattr(L, "spread", math.pi)
            power = L.energy * 4.0
            colour = tuple(L.color)
            L.type = "SPOT"
            L = ob.data
            L.energy = power
            L.color = colour
            L.spot_size = min(spread, math.pi)
            L.spot_blend = 1.0
            _lamp_extras(ob, math.sqrt(area / math.pi), panel=spread >= math.pi * 0.99)
            note(notes, f"{ob.name}: an area light, as a hemisphere spot of its on-axis power, its bulb the panel's size")
        else:
            _lamp_extras(ob, getattr(L, "shadow_soft_size", 0.0))


# ── Glowing surfaces as lamps ──
#
# Cycles lights a room from everything that glows — a neon tube, an LED strip,
# a screen — and the app only blooms an emissive surface; it lights nothing.
# So each glowing surface also brings lamps that throw what it emits into the
# room, in Cycles' terms: a surface of emission strength S and colour c has
# radiance L = S·c, and a patch of area A on-axis intensity L·A (a Lambertian
# emitter).
#
#   - a broad, flat panel facing one way (a screen) → a spot along its normal,
#     a hemisphere cone at on-axis intensity L·A, its bulb √(A/π);
#   - anything else (tubes, strips, bulbs, signs) emits every way: points along
#     its length, together of intensity L·A/4 — a closed surface's mean over
#     all directions — gathered into GLOW_CELL cells so a hundred LEDs on one
#     bar are one lamp, and the strongest kept up to the app's lamp cap.
#
# Named "<object> glow" so they can be told apart. A surface whose glow comes
# from nodes (a picture, a gradient) is left to bloom, with a note.

GLOW_CELL = 1.0          # metres
GLOW_MIN = 0.05          # app intensity at 1 m below which a cell lights nothing
PANEL_MIN_AREA = 0.5     # m², a flat emitter smaller than this is a point


def _emission_of(mat):
    """(radiance rgb, from-a-picture) of a material's glow, or None."""
    if not mat or not mat.node_tree:
        return None
    node = _surface(mat)
    if node is None:
        return None
    if node.type == "EMISSION":
        c, s = node.inputs["Color"], node.inputs["Strength"]
        if s.links:
            return None
        col = tuple(c.default_value)[:3]
        return (tuple(v * s.default_value for v in col), bool(c.links))
    if node.type != "BSDF_PRINCIPLED":
        return None
    c, s = node.inputs["Emission Color"], node.inputs["Emission Strength"]
    if s.links or s.default_value <= 0:
        return None
    col = tuple(c.default_value)[:3]
    if c.links:
        folded = _constant_colour(*_linked_from(c))
        if folded is None:
            return ((s.default_value,) * 3, True)
        col = folded
    return (tuple(v * s.default_value for v in col), False)


def _glow_lamps(scene, notes):
    import numpy as np
    from mathutils import Vector
    existing = sum(1 for ob in scene.objects if ob.type == "LIGHT" and ob.visible_get() and not ob.hide_render)
    budget = max(0, LAMP_CAP - existing - 8)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    cells = {}      # (ix, iy, iz) → [intensity rgb (Cycles W/sr), Σ weight·position, Σ weight, names]
    panels = []     # (position, normal, radiance, area, name)
    pictured = set()
    for ob in list(scene.objects):
        if ob.type != "MESH" or not ob.visible_get() or ob.hide_render:
            continue
        # the haze's glow cards are air, not a surface that lights the room
        if any(sl.material and (sl.material.get("reze") or {}).get("additive") for sl in ob.material_slots):
            continue
        glows = {}
        for i, slot in enumerate(ob.material_slots):
            e = _emission_of(slot.material)
            if e and max(e[0]) > 0:
                if e[1]:
                    pictured.add(slot.material.name)
                    continue
                glows[i] = np.array(e[0], dtype=np.float64)
        if not glows:
            continue
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        try:
            mw = ob.matrix_world
            n3 = mw.to_3x3().inverted().transposed()
            by = {}
            for p in me.polygons:
                if p.material_index not in glows:
                    continue
                c = mw @ p.center
                n = (n3 @ p.normal)
                # world area: the face's own, through the object's scale
                area = p.area * abs(mw.to_3x3().determinant()) ** (2 / 3)
                if n.length > 0:
                    n.normalize()
                by.setdefault(p.material_index, []).append((np.array(c), np.array(n), area))
        finally:
            ev.to_mesh_clear()
        for i, faces in by.items():
            L = glows[i]
            centres = np.array([f[0] for f in faces])
            normals = np.array([f[1] for f in faces])
            areas = np.array([f[2] for f in faces])
            A = float(areas.sum())
            if A <= 0:
                continue
            # A PANEL is most of its area facing one axis — a sheet, or a thin
            # slab glowing on both sides (each side its own spot).
            axis = np.linalg.eigh((normals * areas[:, None]).T @ normals)[1][:, -1]
            along = normals @ axis
            rest = np.ones(len(faces), dtype=bool)
            if areas[np.abs(along) > 0.9].sum() > 0.85 * A:
                for side in (1.0, -1.0):
                    pick = along * side > 0.9
                    As = float(areas[pick].sum())
                    if As >= PANEL_MIN_AREA:
                        centre = (centres[pick] * areas[pick, None]).sum(0) / As
                        panels.append((centre, axis * side, L, As, ob.name))
                        rest &= ~pick
            # every way: each face's share, L·a/4, into its cell
            for c, a in zip(centres[rest], areas[rest]):
                key = tuple(np.floor(c / GLOW_CELL).astype(int))
                w = float(a * max(L))
                cell = cells.setdefault(key, [np.zeros(3), np.zeros(3), 0.0, set()])
                cell[0] += L * a / 4
                cell[1] += c * w
                cell[2] += w
                cell[3].add(ob.name)
    for name in sorted(pictured):
        note(notes, f"{name}: its glow comes from nodes (a picture or a gradient), so it blooms but lights nothing")

    lamps = []
    for centre, normal, L, A, name in panels:
        I = L * A                                   # on-axis, Cycles W/sr
        lamps.append((max(I) / math.pi, "panel", centre + normal * 0.05, normal, I, math.sqrt(A / math.pi), name))
    for key, (I, pw, w, names) in cells.items():
        if w <= 0:
            continue
        name = sorted(names)[0] + (f" +{len(names) - 1}" if len(names) > 1 else "")
        lamps.append((max(I) / math.pi, "point", pw / w, None, I, GLOW_CELL / 2, name))
    lamps = [l for l in lamps if l[0] >= GLOW_MIN]
    lamps.sort(key=lambda l: -l[0])
    kept, dropped = lamps[:budget], lamps[budget:]
    for k, (peak, kind, pos, normal, I, near, name) in enumerate(kept):
        top = float(max(I))
        data = bpy.data.lights.new(f"{name} glow {k + 1}", "SPOT" if kind == "panel" else "POINT")
        data.color = tuple(float(v) / top for v in I)
        # Blender writes a point's and a spot's watts as P/4π per steradian
        data.energy = 4 * math.pi * top
        data.shadow_soft_size = 0.0
        if kind == "panel":
            data.spot_size = math.pi
            data.spot_blend = 1.0
        ob = bpy.data.objects.new(data.name, data)
        ob.location = Vector(pos.tolist())
        if normal is not None:
            ob.rotation_euler = Vector(normal.tolist()).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
        _lamp_extras(ob, near, panel=kind == "panel")
    if kept:
        note(notes, f"glowing surfaces: {len(kept)} lamp(s) throwing their light into the room "
                    f"({sum(1 for l in kept if l[1] == 'panel')} panel spot(s), {sum(1 for l in kept if l[1] == 'point')} point(s))")
    if dropped:
        share = sum(l[0] for l in dropped) / max(1e-9, sum(l[0] for l in lamps))
        note(notes, f"glowing surfaces: {len(dropped)} weaker lamp(s) left out at the app's {LAMP_CAP}-lamp cap ({share:.0%} of the glow)")


# ── The room's own light: ambient and haze ──
#
# AMBIENT. Cycles bounces a pink rig's light off the deck and the walls, so a
# shadow on that stage is pink. The app's diffuse ambient is nine spherical-
# harmonic coefficients (extras.reze.ambient.sh, glTF axes, the basis the
# loader evaluates: c0 + c1·y + c2·z + c3·x + c4·xy + c5·yz + c6·(3z² − 1) +
# c7·xz + c8·(x² − y²)), and their value multiplies albedo — Unity's units, so
# it is irradiance over π. It is measured, not guessed: Cycles renders the
# room around where the cast stands as a small panorama, with every light and
# glow as Blender has them, the irradiance it delivers is integrated for a
# spread of normals, and the coefficients are fitted to it. The lamps the app
# draws light surfaces directly; this is what those surfaces, the world and
# the haze send back.
#
# HAZE. A volume (a Principled Volume or Volume Scatter box, or the world's
# volume) becomes the app's distance fog (extras.reze.fog, glTF metres): per
# vertex, the colour is pulled toward the fog's by 1 − f, f = 1 − σ·(depth −
# d₀), σ the volume's extinction and d₀ how far the scene camera stands
# outside the box. The fog's colour is the light the haze scatters toward the
# eye once it is thick enough to hide what is behind it: its albedo × the
# radiance the lamps deliver, averaged over the volume (isotropic, no
# shadowing). It is uniform: a beam through it is not drawn.

PROBE_HEIGHT = 1.2


def _cycles_device(scene):
    """Cycles on a GPU when there is one; the name of what it runs on."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type != "CPU" for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type != "CPU"
                scene.cycles.device = "GPU"
                return kind
    except Exception:  # noqa: BLE001 — any trouble here means CPU
        pass
    scene.cycles.device = "CPU"
    return "CPU"


def _probe_render(scene, at, width=128):
    """The room seen from `at` as an equirect panorama (centre +X, up +Z), as
    linear float pixels (H, W, 3), with Cycles."""
    import numpy as np
    from mathutils import Vector
    cam_data = bpy.data.cameras.new("reze_probe_cam")
    cam_data.type = "PANO"
    if hasattr(cam_data, "panorama_type"):
        cam_data.panorama_type = "EQUIRECTANGULAR"
    else:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("reze_probe_cam", cam_data)
    cam.location = Vector(at)
    cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
    scene.collection.objects.link(cam)
    r = scene.render
    keep = (scene.camera, r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
            r.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising)
    path = os.path.join(tempfile.mkdtemp(prefix="reze_probe_"), "probe.hdr")
    try:
        scene.camera = cam
        r.engine = "CYCLES"
        r.resolution_x, r.resolution_y, r.resolution_percentage = width, width // 2, 100
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
        r.image_settings.file_format = "HDR"
        r.filepath = path
        bpy.ops.render.render(write_still=True, scene=scene.name)
        img = bpy.data.images.load(path)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        out = px.reshape(img.size[1], img.size[0], 4)[..., :3].astype(np.float64)
        bpy.data.images.remove(img)
        return out
    finally:
        (scene.camera, r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
         r.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising) = keep
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(cam_data)
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)


def _sh_basis(d):
    """The loader's nine-term basis at glTF directions d (N, 3)."""
    import numpy as np
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    return np.stack([np.ones_like(x), y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y], axis=1)


def _ambient(scene, notes):
    """Nine RGB coefficients (glTF axes) fitted to the irradiance/π Cycles
    delivers where the cast stands, or None."""
    import numpy as np
    # INDIRECT ONLY. The app adds every light and every glowing surface as a
    # lamp of its own, so what the probe may count is what the room sends back,
    # not those sources seen straight on: they are hidden from camera rays for
    # the probe (they still light the walls it sees), and the light arriving
    # from them directly is left to the lamps.
    hidden = []
    for ob in scene.objects:
        if not ob.visible_get() or ob.hide_render or not hasattr(ob, "visible_camera"):
            continue
        glows = ob.type == "MESH" and any(_emission_of(s.material) for s in ob.material_slots)
        if (ob.type == "LIGHT" or glows) and ob.visible_camera:
            ob.visible_camera = False
            hidden.append(ob)
    try:
        pano = _probe_render(scene, (0.0, 0.0, PROBE_HEIGHT))
    finally:
        for ob in hidden:
            ob.visible_camera = True
    H, W, _ = pano.shape
    # pixel directions, Blender axes: rows bottom-up, u = 0.5 − atan2(y, x)/2π
    v = (np.arange(H) + 0.5) / H
    u = (np.arange(W) + 0.5) / W
    lat = (v - 0.5) * math.pi
    lon = (0.5 - u) * 2 * math.pi
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    bx, by, bz = np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)
    omega = np.stack([bx, bz, -by], axis=-1).reshape(-1, 3)          # glTF (x, z, −y)
    dA = (2 * math.pi / W) * (math.pi / H) * np.cos(LA).reshape(-1)
    radiance = pano.reshape(-1, 3)
    # normals over the sphere (Fibonacci), the irradiance/π each receives
    n = 400
    k = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * k / n)
    th = math.pi * (1 + 5 ** 0.5) * k
    normals = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], axis=1)
    cosines = np.clip(normals @ omega.T, 0, None) * dA[None, :]
    target = cosines @ radiance / math.pi                              # (n, 3)
    coeffs, *_ = np.linalg.lstsq(_sh_basis(normals), target, rcond=None)
    sh = [float(coeffs[i, ch]) for i in range(9) for ch in range(3)]
    mean = target.mean(0)
    note(notes, f"ambient: measured by Cycles where the cast stands — irradiance/π mean "
                f"({mean[0]:.3f}, {mean[1]:.3f}, {mean[2]:.3f})")
    return sh


def _volume_params(mat):
    """(extinction per metre, albedo rgb) of a volume material, or None."""
    out = _output(mat)
    node = _linked_from(out.inputs["Volume"])[0] if out else None
    if node is None:
        return None
    if node.type == "PRINCIPLED_VOLUME":
        d = node.inputs["Density"].default_value
        c = tuple(node.inputs["Color"].default_value)[:3]
    elif node.type == "VOLUME_SCATTER":
        d = node.inputs["Density"].default_value
        c = tuple(node.inputs["Color"].default_value)[:3]
    elif node.type == "VOLUME_ABSORPTION":
        d = node.inputs["Density"].default_value
        c = (0.0, 0.0, 0.0)
    else:
        return None
    return (d, c) if d > 0 else None


def _lamp_radiance(points, scene):
    """Σ over the lights of the radiance an isotropic medium scatters at each
    point per unit albedo: E/4π, Cycles units. points (N, 3), Blender axes."""
    import numpy as np
    S = np.zeros((len(points), 3))
    for ob in scene.objects:
        if ob.type != "LIGHT" or not ob.visible_get() or ob.hide_render:
            continue
        L = ob.data
        col = np.array(tuple(L.color))
        if L.type == "SUN":
            S += col * L.energy / (4 * math.pi)
            continue
        I = L.energy / (4 * math.pi)
        rel = points - np.array(ob.matrix_world.translation)
        d2 = np.maximum((rel * rel).sum(1), max(L.shadow_soft_size, 0.05) ** 2)
        e = I / d2
        if L.type == "SPOT":
            aim = -np.array(ob.matrix_world.to_3x3().col[2])
            cosang = (rel @ aim) / np.sqrt(d2)
            outer = math.cos(L.spot_size / 2)
            inner = math.cos(L.spot_size / 2 * (1 - L.spot_blend))
            t = np.clip((cosang - outer) / max(inner - outer, 1e-4), 0, 1)
            e = e * t * t * (3 - 2 * t)
        elif L.type == "AREA":
            aim = -np.array(ob.matrix_world.to_3x3().col[2])
            e = e * 4 * np.clip((rel @ aim) / np.sqrt(d2), 0, None)
        S += e[:, None] * col[None, :] / (4 * math.pi)
    return S


def _scattered(probe, sigma, lo, hi):
    """The radiance the haze scatters toward the eye once thick enough to hide
    what is behind it, MEASURED: per ray from the probe, Cycles shows
    world·T + L·(1 − T), T = e^(−σd) over the ray's length d inside the box, and
    `bare` is the world alone — so L is solved for over the whole sphere."""
    import numpy as np
    pano, bare = probe
    if bare is None:
        return None
    H, W, _ = pano.shape
    v = (np.arange(H) + 0.5) / H
    u = (np.arange(W) + 0.5) / W
    lat = (v - 0.5) * math.pi
    lon = (0.5 - u) * 2 * math.pi
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    d = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)], axis=-1).reshape(-1, 3)
    p = np.array([0.0, 0.0, PROBE_HEIGHT])
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(d > 0, (hi - p) / d, np.where(d < 0, (lo - p) / d, np.inf))
    length = np.clip(t.min(axis=1), 0, None)
    T = np.exp(-sigma * length)
    w = np.cos(LA).reshape(-1)
    num = ((pano.reshape(-1, 3) - bare.reshape(-1, 3) * T[:, None]) * w[:, None]).sum(0)
    den = ((1 - T) * w).sum()
    return None if den <= 1e-6 else np.clip(num / den, 0, None)


def _camera_render(scene, width=192, samples=64):
    """The scene camera's view as linear float pixels (H, W, 3), rows bottom-up."""
    import numpy as np
    r = scene.render
    aspect = r.resolution_x / max(1, r.resolution_y)
    keep = (r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
            r.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising)
    path = os.path.join(tempfile.mkdtemp(prefix="reze_cam_"), "cam.hdr")
    try:
        r.engine = "CYCLES"
        r.resolution_x, r.resolution_y, r.resolution_percentage = width, max(1, round(width / aspect)), 100
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        r.image_settings.file_format = "HDR"
        r.filepath = path
        bpy.ops.render.render(write_still=True, scene=scene.name)
        img = bpy.data.images.load(path)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        out = px.reshape(img.size[1], img.size[0], 4)[..., :3].astype(np.float64)
        bpy.data.images.remove(img)
        return out
    finally:
        (r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
         r.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising) = keep
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)


def _scattered_seen(scene, box_ob, sigma, lo, hi):
    """The haze's scattered radiance AS THE CAMERA SEES IT, measured: Cycles
    renders the scene camera's view with the haze (C1) and without (C0); per
    pixel C1 = C0·T + L·(1 − T), T = e^(−σ·ℓ), ℓ the ray's length inside the
    volume up to the first surface — so L, the colour the app's fog pulls
    toward, is solved over the picture. The haze is not uniform (it glows by
    the lamps, dim in the stalls); this is its weight where the shot looks."""
    import numpy as np
    from mathutils import Vector
    cam = scene.camera
    if cam is None:
        return None
    # SMALL ON PURPOSE: one median colour comes out of this, and every pixel
    # costs a Python ray cast below — 192 px wide took 139 s on a real stage,
    # 64 px takes 8 s and lands within 3% of it.
    c1 = _camera_render(scene, width=64, samples=32)
    box_ob.hide_render = True
    try:
        c0 = _camera_render(scene, width=64, samples=32)
    finally:
        box_ob.hide_render = False
    H, W, _ = c1.shape
    frame = cam.data.view_frame(scene=scene)
    tr, br, bl, tl = [cam.matrix_world @ v for v in frame]
    o = cam.matrix_world.translation
    dg = bpy.context.evaluated_depsgraph_get()
    T = np.ones((H, W))
    for j in range(H):
        fv = 1 - (j + 0.5) / H                       # row 0 is the bottom
        for i in range(W):
            fu = (i + 0.5) / W
            p = tl.lerp(tr, fu).lerp(bl.lerp(br, fu), fv)
            d = (p - o).normalized()
            start, far = o, 1e9
            for _ in range(6):
                hit, loc, _n, _i, ob, _m = scene.ray_cast(dg, start, d)
                if not hit:
                    break
                if ob.name != box_ob.name:
                    far = (loc - o).length
                    break
                start = loc + d * 0.01
            dd = np.array(d)
            oo = np.array(o)
            with np.errstate(divide="ignore", invalid="ignore"):
                t1 = (lo - oo) / dd
                t2 = (hi - oo) / dd
            tn = np.nanmax(np.minimum(t1, t2))
            tf = np.nanmin(np.maximum(t1, t2))
            seg = max(0.0, min(tf, far) - max(tn, 0.0))
            T[j, i] = math.exp(-sigma * seg)
    w = (1 - T).reshape(-1)
    # THE MEDIAN, per channel, over every pixel the haze reaches enough to
    # measure (≥ 3% of the way to opaque): the haze glows hard by the lamps and
    # is dim where most of a shot looks, and one fog colour stands for all of
    # it — a mean is dragged up by the glow and lifts every shadow with it.
    ok = w > 0.03
    if ok.sum() < 16:
        return None
    per = (c1 - c0 * T[..., None]).reshape(-1, 3)[ok] / w[ok][:, None]
    return np.clip(np.median(per, axis=0), 0, None)


def _haze(scene, notes, probe=None):
    """The app's fog for the scene's haze, or None."""
    import numpy as np
    boxes = []
    for ob in scene.objects:
        if ob.type == "MESH" and ob.visible_get() and not ob.hide_render and ob.material_slots \
                and all(s.material and _volume_only(s.material) for s in ob.material_slots):
            p = _volume_params(ob.material_slots[0].material)
            if p:
                corners = [ob.matrix_world @ v.co for v in ob.data.vertices]
                lo = np.min(np.array(corners), 0)
                hi = np.max(np.array(corners), 0)
                boxes.append((ob.name, p, lo, hi))
    w = scene.world
    if not boxes and w and w.node_tree:
        out = next((n for n in w.node_tree.nodes if n.type == "OUTPUT_WORLD" and n.is_active_output), None)
        vol = _linked_from(out.inputs["Volume"])[0] if out else None
        if vol is not None and vol.type in ("PRINCIPLED_VOLUME", "VOLUME_SCATTER") and vol.inputs["Density"].default_value > 0:
            p = (vol.inputs["Density"].default_value, tuple(vol.inputs["Color"].default_value)[:3])
            if p:
                meshes = [o for o in scene.objects if o.type == "MESH" and o.visible_get()]
                pts = np.array([o.matrix_world @ v.co for o in meshes for v in o.data.vertices[:200]])
                boxes.append(("the world's volume", p, pts.min(0), pts.max(0)))
    if not boxes:
        return None
    name, (sigma, albedo), lo, hi = max(boxes, key=lambda b: b[1][0] * float(np.prod(b[3] - b[2])))
    box = next((ob for ob in scene.objects if ob.name == name), None)
    measured = None
    if box is not None:
        try:
            measured = _scattered_seen(scene, box, sigma, lo, hi)
        except Exception as e:  # noqa: BLE001
            note(notes, f"haze: could not be measured from the camera ({e})")
    if measured is not None:
        colour = measured.tolist()
        how = "measured by Cycles from the scene camera"
    else:
        rng = np.random.default_rng(7)
        pts = lo + rng.random((800, 3)) * (hi - lo)
        S = _lamp_radiance(pts, scene).mean(0)
        colour = (np.array(albedo) * S).tolist()
        how = "from the lamps it scatters"
    cam = scene.camera
    d0 = 0.0
    if cam:
        e = np.array(cam.matrix_world.translation)
        d0 = float(np.linalg.norm(np.maximum(0, np.maximum(lo - e, e - hi))))
    if len(boxes) > 1:
        note(notes, f"haze: {len(boxes)} volumes; the largest ({name}) is the fog")
    note(notes, f"haze: {name} as distance fog — extinction {sigma:.4f}/m from {d0:.1f} m out, "
                f"colour ({colour[0]:.3f}, {colour[1]:.3f}, {colour[2]:.3f}) {how}")
    return {"color": [round(c, 5) for c in colour], "amount": 1.0,
            "distance": [-sigma, 1.0 + sigma * d0], "height": [0.0, 1e6]}


# ── Glow in the haze ──

GLOW_FLOOR = 1.0 / 255.0   # radiance under which a glow is not drawn
GLOW_TEX = 128
# HOW MANY TIMES A GLOW THE CARDS SHOW, averaged over every view direction:
# an emissive plane is as bright per pixel at any tilt (tilting only squeezes
# it), so a pixel b from the light sees each plane's L at that plane's own
# distance. Integrated numerically for an L ∝ 1/b profile: the six planes of a
# point glow sum to 3.82 L(b), the three planes through a spot's axis to 1.91.
POINT_PLANE_SUM = 3.82
SPOT_PLANE_SUM = 1.91


def _haze_boxes(scene):
    """Each volume-only box in the scene: (object, extinction per metre,
    scattering colour, lo, hi), world axes."""
    import numpy as np
    out = []
    for ob in scene.objects:
        if ob.type == "MESH" and ob.visible_get() and not ob.hide_render and ob.material_slots \
                and all(s.material and _volume_only(s.material) for s in ob.material_slots):
            p = _volume_params(ob.material_slots[0].material)
            if p:
                corners = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
                out.append((ob, p[0], p[1], corners.min(0), corners.max(0)))
    return out


def _glow_image(name, size, fn):
    """An emissive picture of a glow: fn(u, v) -> 0..1 shape, u and v in -1..1."""
    import numpy as np
    img = bpy.data.images.new(name, size, size, alpha=True)
    t = (np.arange(size) + 0.5) / size * 2 - 1
    u, v = np.meshgrid(t, t)
    shape = np.clip(fn(u, v), 0.0, 1.0)
    # STORED sRGB-ENCODED: an 8-bit picture is colour data, decoded to linear
    # where it is drawn — written raw, a tail at 0.15 came back as 0.02 and
    # the glow was its core alone.
    enc = np.where(shape <= 0.0031308, shape * 12.92, 1.055 * np.power(shape, 1 / 2.4) - 0.055)
    px = np.zeros((size, size, 4), dtype=np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = enc
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def _glow_material(name, colour, strength, image):
    """Unlit and added: light, not cover (stageLightSheetGraph in the app,
    which draws the emissive picture times its strength). The colour is
    multiplied into the picture's emission, so it travels in the picture."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], tint.inputs[6])
    tint.inputs[7].default_value = (colour[0], colour[1], colour[2], 1.0)
    nt.links.new(tint.outputs[2], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    # BLENDED, so it is drawn in the transparent pass after the room — where
    # the app's additive blend applies. An opaque sheet would cover what is
    # behind it with its own near-black.
    # under the app's transparent line (alpha < 0.999), which is what puts
    # a stage material in the transparent pass with depth left alone
    bsdf.inputs["Alpha"].default_value = 0.99
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    m["reze"] = {"unlit": True, "additive": True, "castShadow": False}
    return m


def _glow_planes(name, quads, material, scene):
    """A mesh of quads, each (centre, half-axis u, half-axis v); UVs 0..1 across."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for c, au, av in quads:
        vs = [bm.verts.new(c - au - av), bm.verts.new(c + au - av), bm.verts.new(c + au + av), bm.verts.new(c - au + av)]
        f = bm.faces.new(vs)
        for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = t
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def _glow_cards(scene, notes, only=None):
    """THE HAZE'S GLOW, as cards the app already draws.

    A light inside a haze lights the air around it: single scattering, which
    the app's one uniform fog cannot hold. Each light in a haze box gets soft
    additive cards whose radiance is that scattering, from the box's own
    density and scattering colour and the light's own power - no constants
    chosen for a look:
      a point (or area) light of power P, seen past its centre at distance b:
        L(b) = sigma_s * P / (16 pi b)        (isotropic phase; integral of 1/(b^2+t^2) = pi/b)
      a spot, across its beam at distance r from the lamp, u across the cone:
        L = sigma_s * I * tan(theta) * sqrt(1 - u^2) / (2 pi r),  I = P / 4pi
    held flat inside the lamp's bulb, faded to nothing where L < 1/255.
    A point glows on six planes through it, spread over directions; a spot on
    three planes through its axis; each divided by what the set sums to on
    average (POINT_PLANE_SUM, SPOT_PLANE_SUM). Cycles units, which are the
    app's. Checked against Cycles on a single light in a haze box."""
    import numpy as np
    from mathutils import Quaternion, Vector
    boxes = _haze_boxes(scene)
    if not boxes:
        return
    made = 0
    for ob in list(scene.objects):
        if ob.type != "LIGHT" or not ob.visible_get() or ob.hide_render:
            continue
        if only is not None and ob.name not in only:
            continue
        L = ob.data
        if L.type == "SUN":
            continue
        at = np.array(ob.matrix_world.translation)
        box = next((b for b in boxes if np.all(at >= b[3] - 0.01) and np.all(at <= b[4] + 0.01)), None)
        if box is None:
            continue
        sigma, albedo = box[1], np.array(box[2])
        power = L.energy * (2.0 ** getattr(L, "exposure", 0.0))
        col = np.array(L.color) * albedo * sigma            # sigma_s, per channel
        if col.max() <= 0 or power <= 0:
            continue
        r0 = max(getattr(L, "shadow_soft_size", 0.1), 0.15)
        mw = ob.matrix_world
        # a cone past 170° is a panel's hemisphere (a glowing screen), not a beam
        if L.type == "SPOT" and L.spot_size < math.radians(170):
            theta = L.spot_size / 2
            tan_t = math.tan(theta)
            I = power / (4 * math.pi)
            k = col * I * tan_t / (2 * math.pi)             # L = k * sqrt(1 - u^2) / r
            reach = float(min(25.0, max(0.5, k.max() / GLOW_FLOOR)))
            peak = k / r0
            strength = float(peak.max())
            blend = max(L.spot_blend, 0.05)
            ratio = r0 / reach

            def shape(u, v, ratio=ratio, blend=blend):
                r = (v + 1) / 2                              # 0 at the lamp, 1 at the reach
                rr = np.maximum(r, ratio)
                across = np.abs(u) / np.maximum(r, 1e-4)    # across the cone's width there
                edge = np.clip((1 - across) / blend, 0, 1)
                edge = edge * edge * (3 - 2 * edge)
                fade = np.clip(1 - r, 0, 1) ** 2
                return ratio / rr * np.sqrt(np.clip(1 - across ** 2, 0, 1)) * edge * fade
            img = _glow_image(f"{ob.name} glow", GLOW_TEX, shape)
            mat = _glow_material(f"{ob.name} haze glow", (peak / strength).tolist(), strength / SPOT_PLANE_SUM, img)
            axis = (mw.to_3x3() @ Vector((0, 0, -1))).normalized()
            side = axis.orthogonal().normalized()
            quads = []
            for j in range(3):
                q = side.copy()
                q.rotate(Quaternion(axis, j * math.pi / 3))
                quads.append((mw.translation + axis * (reach / 2), q * (reach * tan_t), axis * (reach / 2)))
            _glow_planes(f"{ob.name} haze glow", quads, mat, scene)
        else:
            k = col * power / (16 * math.pi)                 # L = k / b
            reach = float(min(20.0, max(0.3, k.max() / GLOW_FLOOR)))
            peak = k / r0
            strength = float(peak.max())
            ratio = r0 / reach

            def shape(u, v, ratio=ratio):
                b = np.sqrt(u * u + v * v)
                return ratio / np.maximum(b, ratio) * np.clip(1 - b * b, 0, 1) ** 2
            img = _glow_image(f"{ob.name} glow", GLOW_TEX, shape)
            mat = _glow_material(f"{ob.name} haze glow", (peak / strength).tolist(), strength / POINT_PLANE_SUM, img)
            phi = (1 + 5 ** 0.5) / 2
            dirs = [Vector(d).normalized() for d in ((0, 1, phi), (0, -1, phi), (1, phi, 0), (-1, phi, 0), (phi, 0, 1), (-phi, 0, 1))]
            quads = []
            for n in dirs:
                a = n.orthogonal().normalized()
                b = n.cross(a).normalized()
                quads.append((mw.translation.copy(), a * reach, b * reach))
            _glow_planes(f"{ob.name} haze glow", quads, mat, scene)
        made += 1
    if made:
        what = "glowing surface lamp(s)" if only is not None else "light(s)"
        note(notes, f"haze glow: {made} {what} light the air around them - additive cards from the haze's density and each light's power")


# ── The world ──


def _hdr_bytes(rgb, w=4, h=2):
    """A flat Radiance picture of one linear colour: how a flat world is seen
    behind the stage, as Cycles shows it — the app draws a world picture as
    the background and a world colour only as light."""
    def rgbe(c):
        m = max(c)
        if m < 1e-32:
            return bytes(4)
        mant, e = math.frexp(m)
        scale = mant * 256.0 / m
        return bytes([min(255, int(v * scale)) for v in c] + [e + 128])
    px = rgbe(rgb)
    return b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {h} +X {w}\n".encode() + px * (w * h)


def _hdr_bytes_image(px):
    """A Radiance picture of linear float pixels (H, W, 3), rows top-down, in
    flat (unencoded) RGBE scanlines."""
    import numpy as np
    h, w, _ = px.shape
    m = px.max(axis=2)
    mant, e = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = np.clip(px * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    return b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {h} +X {w}\n".encode() + out.tobytes()


def _world_panorama(scene, notes, width=1024):
    """Render a world built from nodes to an equirect HDR, as the app reads an
    environment image: centre +X, up +Z."""
    tmp = bpy.data.scenes.new("reze_world")
    tmp.world = scene.world
    tmp.render.engine = "CYCLES"
    tmp.cycles.samples = 16
    tmp.cycles.use_denoising = False
    tmp.cycles.device = scene.cycles.device
    tmp.render.resolution_x = width
    tmp.render.resolution_y = width // 2
    tmp.render.resolution_percentage = 100
    tmp.render.film_transparent = False
    tmp.render.image_settings.file_format = "HDR"
    cam_data = bpy.data.cameras.new("reze_world_cam")
    cam_data.type = "PANO"
    if hasattr(cam_data, "panorama_type"):
        cam_data.panorama_type = "EQUIRECTANGULAR"
    else:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("reze_world_cam", cam_data)
    cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
    tmp.collection.objects.link(cam)
    tmp.camera = cam
    path = os.path.join(tempfile.mkdtemp(prefix="reze_world_"), "world.hdr")
    tmp.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True, scene=tmp.name)
        with open(path, "rb") as f:
            data = f.read()
    finally:
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(cam_data)
        bpy.data.scenes.remove(tmp)
    return data


def _has_haze(scene):
    if scene.world and scene.world.node_tree:
        out = next((n for n in scene.world.node_tree.nodes if n.type == "OUTPUT_WORLD" and n.is_active_output), None)
        if out and out.inputs["Volume"].links:
            return True
    return any(ob.type == "MESH" and ob.visible_get() and not ob.hide_render and ob.material_slots
               and all(sl.material and _volume_only(sl.material) for sl in ob.material_slots) for ob in scene.objects)


def _haze_world(scene, notes, width=512):
    """THE SKY THROUGH THE HAZE. Where a room's haze glows, Cycles shows that
    glow wherever there is nothing behind it — lamp light scattered toward the
    eye in front of the dark world — and the app's fog tints surfaces only. So
    the world travels as Cycles sees it from where the cast stands with every
    surface hidden from camera rays: the world, plus what the haze scatters of
    the lights and glows (which still shine, just unseen). Rendered before the
    lights are converted, so it is Blender's own rig that lights it. Equirect
    HDR bytes."""
    import numpy as np
    hidden = []
    volumes = []
    for ob in scene.objects:
        if not ob.visible_get() or ob.hide_render or not hasattr(ob, "visible_camera"):
            continue
        volume = ob.type == "MESH" and ob.material_slots and all(sl.material and _volume_only(sl.material) for sl in ob.material_slots)
        if volume:
            volumes.append(ob)
        elif ob.type in ("MESH", "CURVE", "SURFACE", "META", "FONT", "LIGHT") and ob.visible_camera:
            ob.visible_camera = False
            hidden.append(ob)
    try:
        pano = _probe_render(scene, (0.0, 0.0, PROBE_HEIGHT), width)
        # the same sky with the haze taken away — what the haze dims
        bare = None
        if volumes:
            for ob in volumes:
                ob.hide_render = True
            try:
                bare = _probe_render(scene, (0.0, 0.0, PROBE_HEIGHT), width)
            finally:
                for ob in volumes:
                    ob.hide_render = False
    finally:
        for ob in hidden:
            ob.visible_camera = True
    note(notes, "world: rendered by Cycles through the haze, so the haze glows where nothing stands behind it")
    return _hdr_bytes_image(np.ascontiguousarray(pano[::-1])), (pano, bare)


def _world(scene, notes, haze=None):
    if haze is not None:
        return {"format": "hdr", "base64": base64.b64encode(haze).decode("ascii"), "strength": 1.0}
    w = scene.world
    if not w or not w.node_tree:
        return None
    out = next((n for n in w.node_tree.nodes if n.type == "OUTPUT_WORLD" and n.is_active_output), None)
    bg, _ = _linked_from(out.inputs["Surface"]) if out else (None, None)
    if bg is None:
        return None
    if bg.type == "BACKGROUND" and not bg.inputs["Strength"].links:
        strength = bg.inputs["Strength"].default_value
        src, _ = _linked_from(bg.inputs["Color"])
        if src is None:
            c = tuple(bg.inputs["Color"].default_value)[:3]
            data = _hdr_bytes(c)
            return {"format": "hdr", "base64": base64.b64encode(data).decode("ascii"), "strength": strength}
        if src.type == "TEX_ENVIRONMENT" and src.image and not src.inputs["Vector"].links:
            image = src.image
            path = bpy.path.abspath(image.filepath) if image.filepath else ""
            ext = os.path.splitext(path)[1].lower()
            data = bytes(image.packed_file.data) if image.packed_file else (
                open(path, "rb").read() if path and os.path.exists(path) else None)
            if data and ext in (".hdr", ".exr"):
                return {"format": ext[1:], "base64": base64.b64encode(data).decode("ascii"), "strength": strength}
    # anything else — a sky texture, a gradient, a rotated or 8-bit image —
    # is rendered as the world shows it
    data = _world_panorama(scene, notes)
    note(notes, "world: built from nodes, rendered to an HDR panorama")
    return {"format": "hdr", "base64": base64.b64encode(data).decode("ascii"), "strength": 1.0}


# THE VIEW, AS BLENDER COMPUTES IT. AgX's curve ships as a LUT inside
# Blender's colour configuration, not as a formula, and every Look bends it
# further — so instead of naming the nearest curve the app has, the add-on asks
# Blender's own colour management what each colour becomes: a cube of
# scene-linear inputs on the engine's fixed log2 range (VIEW_LUT_LOG2 in the
# engine, 2^-12.5 to 2^7, a texel every 19.5/(n − 1) stops), saved through the
# scene's view transform and look at exposure 0 — the app applies the exposure
# before the cube, as Blender does before the transform.

# THE GLARE. Cycles and EEVEE (4.2+) bloom only through a compositor Glare
# node, so the stage carries the .blend's own: its threshold (scene-linear, the
# brightest channel the app tests), its strength as the glow's intensity, its
# tint, and its size as how wide the glow leans (the app's scatter, 0..1). No
# Glare node — or compositing off — is no bloom, which is what Blender renders.


def _glare(scene):
    """extras.reze.bloom for the scene's compositor glare, {enabled: False} for none."""
    if not getattr(scene.render, "use_compositing", True):
        return {"enabled": False}
    # 5.x keeps the compositor as a node group; 4.x as scene.node_tree, behind
    # use_nodes — and a 5.x scene without one has no node_tree attribute at all.
    nt = getattr(scene, "compositing_node_group", None)
    if nt is None and getattr(scene, "use_nodes", False):
        nt = getattr(scene, "node_tree", None)
    glare = next((n for n in nt.nodes if n.type == "GLARE" and not n.mute), None) if nt else None
    if glare is None:
        return {"enabled": False}

    def value(name, legacy=None, default=None):
        if name in glare.inputs and not glare.inputs[name].links:
            v = glare.inputs[name].default_value
            return tuple(v) if hasattr(v, "__len__") and not isinstance(v, str) else v
        return getattr(glare, legacy, default) if legacy else default

    kind = value("Type", "glare_type", "FOG_GLOW")
    kind = "".join(kind) if isinstance(kind, tuple) else str(kind)
    if kind.replace(" ", "").upper() not in ("FOGGLOW", "FOG_GLOW", "BLOOM"):
        return {"enabled": False, "note": f"a {kind} glare, which the app does not draw"}
    tint = value("Tint", None, (1.0, 1.0, 1.0, 1.0))
    size = value("Size", None, None)
    if size is None:                                   # legacy 6..9 → 0..1
        size = (getattr(glare, "size", 8) - 6) / 3
    return {"enabled": True, "threshold": float(value("Threshold", "threshold", 1.0)),
            "intensity": float(value("Strength", None, 1.0)), "scatter": float(min(max(size, 0.0), 1.0)),
            "color": [float(c) for c in tint[:3]]}


VIEW_LUT_LOG2 = (-12.5, 7.0)
VIEW_LUT_SIZE = 33


def _view_lut(scene):
    """{size, format, range, base64} — the scene's view transform and look as
    16-bit display values over VIEW_LUT_LOG2, red fastest — or None."""
    import numpy as np
    n = VIEW_LUT_SIZE
    lo, hi = VIEW_LUT_LOG2
    steps = 2.0 ** (lo + (hi - lo) * np.arange(n) / (n - 1))
    b, g, r = np.meshgrid(steps, steps, steps, indexing="ij")          # texel r + n·g + n²·b
    px = np.stack([r, g, b, np.ones_like(r)], axis=-1).reshape(-1).astype(np.float32)
    img = bpy.data.images.new("reze_view_lut", n * n, n, alpha=True, float_buffer=True)
    for name in ("Linear Rec.709", "Linear"):
        try:
            img.colorspace_settings.name = name
            break
        except TypeError:
            continue
    img.pixels.foreach_set(px)
    vs, fmt = scene.view_settings, scene.render.image_settings
    keep = (vs.exposure, vs.gamma, fmt.file_format, fmt.color_depth, fmt.color_mode)
    path = os.path.join(tempfile.mkdtemp(prefix="reze_view_"), "view.png")
    try:
        vs.exposure, vs.gamma = 0.0, 1.0
        fmt.file_format, fmt.color_depth, fmt.color_mode = "PNG", "16", "RGB"
        img.save_render(path, scene=scene)
        out = bpy.data.images.load(path)
        out.colorspace_settings.name = "Non-Color"
        got = np.empty(out.size[0] * out.size[1] * 4, dtype=np.float32)
        out.pixels.foreach_get(got)
        bpy.data.images.remove(out)
    finally:
        vs.exposure, vs.gamma, fmt.file_format, fmt.color_depth, fmt.color_mode = keep
        bpy.data.images.remove(img)
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
    rgb = got.reshape(-1, 4)[:, :3]
    data = np.clip(np.round(rgb * 65535), 0, 65535).astype("<u2").tobytes()
    return {"size": n, "format": "rgb16-display", "range": list(VIEW_LUT_LOG2), "base64": base64.b64encode(data).decode("ascii")}


def _missing_pictures(notes):
    """Pictures a material uses that cannot travel: a video, or a file that is
    neither packed nor on disk.

    A MISSING ONE IS DRAWN AS BLENDER DRAWS IT: magenta (1, 0, 1). That is
    what Cycles and EEVEE show for an image with no data, and on a stage it is
    rarely small — a missing screen video lit by the key lights tints the
    floor that mirrors it and the bounce around it. Exporting it white (glTF's
    "no texture") made the app a different room from the one in the viewport.
    A video that IS on disk cannot travel either and is left as it was, noted."""
    seen = set()
    for mat in bpy.data.materials:
        if not mat.node_tree or mat.users == 0:
            continue
        for tree in list(_trees(mat)):
            for n in list(tree.nodes):
                if n.type != "TEX_IMAGE" or not n.image:
                    continue
                im = n.image
                path = bpy.path.abspath(im.filepath) if im.filepath else ""
                on_disk = bool(im.packed_file) or (path and os.path.exists(path))
                missing = not on_disk and im.source in ("FILE", "MOVIE", "SEQUENCE")
                if not missing:
                    if im.source == "MOVIE" and im.name not in seen:
                        note(notes, f"{mat.name}: its picture is a video ({os.path.basename(path)}), which glTF cannot carry — it shows white")
                    seen.add(im.name)
                    continue
                rgb = tree.nodes.new("ShaderNodeRGB")
                rgb.outputs[0].default_value = (1.0, 0.0, 1.0, 1.0)
                for link in list(n.outputs["Color"].links):
                    tree.links.new(rgb.outputs[0], link.to_socket)
                for link in list(n.outputs["Alpha"].links):
                    to = link.to_socket
                    tree.links.remove(link)
                    if hasattr(to, "default_value") and not hasattr(to.default_value, "__len__"):
                        to.default_value = 1.0
                tree.nodes.remove(n)
                if im.name not in seen:
                    note(notes, f"{mat.name}: its picture {os.path.basename(path) or im.name} is missing (not packed, not on disk) — "
                                "drawn magenta, as Blender draws it")
                seen.add(im.name)


# ── The export ──


def _stored(previous, key):
    v = previous.get(key) if hasattr(previous, "get") else None
    return v.to_dict() if hasattr(v, "to_dict") else v


# ── Occlusion: the room's own contact darkening, baked by Cycles ──

OCC_TEXELS_PER_M = 16    # texels per metre across the atlas, before the size cap
OCC_MAX = 1024           # the atlas' side at most
OCC_SAMPLES = 16


def _plain_material(mat):
    """A lit material with no pictures at all: its UVs are free for the bake,
    and its roughness and metal are single numbers the occlusion map can carry."""
    if not mat or not mat.use_nodes or not mat.node_tree or _volume_only(mat):
        return False
    if (mat.get("reze") or {}).get("unlit"):
        return False
    src = _surface(mat)
    if src is None or src.type != "BSDF_PRINCIPLED":
        return False
    if any(n.type in ("TEX_IMAGE", "TEX_ENVIRONMENT") for n in _all_nodes(mat.node_tree)):
        return False
    return not (src.inputs["Roughness"].links or src.inputs["Metallic"].links)


def _occlusion(scene, notes):
    """AMBIENT OCCLUSION, LIGHT ONLY, into glTF's occlusion channel.

    The app's ambient and its reflection probe light every point of a surface
    alike: nothing darkens a corner, the floor under a chair or a stage's lip.
    Cycles bakes how much of the room each point sees (AO, out to the world's
    own AO distance) and it goes out as the R of each plain material's
    occlusion-roughness-metal map; the colours are not touched. Only
    materials without pictures (their UVs are free, so the add-on lays them out
    afresh, one atlas for the scene). The app scales only the ambient and the
    reflections by it, as glTF and Unity do: a lamp's direct light is not
    shadowed by it.

    Returns {material name: (atlas (H, W) floats, roughness, metal)} for
    _write_occlusion, which adds the maps to the written .glb."""
    import numpy as np
    plain = {m.name for m in bpy.data.materials if _plain_material(m)}
    meshes = [ob for ob in scene.objects if ob.type == "MESH" and ob.visible_get() and not ob.hide_render and ob.data.polygons]
    # a material also worn by an object that cannot be laid out is left as it is
    while True:
        obs = [ob for ob in meshes if ob.material_slots and all(s.material and s.material.name in plain for s in ob.material_slots)]
        keep_obs = set(obs)
        drop = {s.material.name for ob in meshes if ob not in keep_obs for s in ob.material_slots if s.material} & plain
        if not drop:
            break
        plain -= drop
    if not obs:
        return {}
    dg = bpy.context.evaluated_depsgraph_get()
    area = 0.0
    for ob in obs:
        # its own mesh, modifiers applied, one UV layer: the atlas
        if ob.modifiers:
            ob.data = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            ob.modifiers.clear()
        elif ob.data.users > 1:
            ob.data = ob.data.copy()
        me = ob.data
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)
        me.uv_layers.new(name="UVMap")
        s = ob.matrix_world.to_scale()
        area += sum(p.area for p in me.polygons) * abs(s.x * s.y)
    size = int(min(OCC_MAX, max(64, 2 ** math.ceil(math.log2(max(1.0, math.sqrt(area) * OCC_TEXELS_PER_M))))))
    vl = bpy.context.view_layer
    for ob in scene.objects:
        ob.select_set(False)
    for ob in obs:
        ob.select_set(True)
    vl.objects.active = obs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=2.0 / size, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("reze_occlusion", size, size, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    added = []
    for name in plain:
        nt = bpy.data.materials[name].node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        added.append((nt, n))
    # what is not a surface does not occlude: the haze's glow cards
    hidden = [ob for ob in scene.objects if ob.type == "MESH" and not ob.hide_render and ob.material_slots
              and all(s.material and (s.material.get("reze") or {}).get("unlit") for s in ob.material_slots)]
    for ob in hidden:
        ob.hide_render = True
    # BAKED AS ONE OBJECT: Cycles bakes the selected objects one by one, each
    # a whole scene sync, so two thousand props took minutes. A joined copy
    # stands in for them (the originals hidden meanwhile), one sync, one pass.
    copies = []
    for ob in obs:
        cp = bpy.data.objects.new("reze_occ_part", ob.data.copy())
        cp.matrix_world = ob.matrix_world
        scene.collection.objects.link(cp)
        copies.append(cp)
        ob.hide_render = True
    for ob in scene.objects:
        ob.select_set(False)
    for cp in copies:
        cp.select_set(True)
    vl.objects.active = copies[0]
    bpy.ops.object.join()
    joined = vl.objects.active
    c = scene.cycles
    keep = (scene.render.engine, c.samples, c.use_denoising)
    distance = scene.world.light_settings.distance if scene.world else 10.0
    try:
        scene.render.engine = "CYCLES"
        c.samples = OCC_SAMPLES
        bpy.ops.object.bake(type="AO", margin=2, use_clear=True)
    finally:
        scene.render.engine, c.samples, c.use_denoising = keep
        me = joined.data
        bpy.data.objects.remove(joined)
        bpy.data.meshes.remove(me)
        for ob in obs:
            ob.hide_render = False
        for ob in hidden:
            ob.hide_render = False
        for nt, n in added:
            nt.nodes.remove(n)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    ao = px.reshape(size, size, 4)[..., 0].astype(np.float64)
    # the bake's grain, smoothed over 3x3 texels
    pad = np.pad(ao, 1, mode="edge")
    ao = sum(pad[1 + dy:1 + dy + size, 1 + dx:1 + dx + size] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9.0
    bpy.data.images.remove(img)
    out = {}
    for name in plain:
        src = _surface(bpy.data.materials[name])
        out[name] = (ao, float(src.inputs["Roughness"].default_value), float(src.inputs["Metallic"].default_value))
    note(notes, f"occlusion: {len(out)} plain material(s) on {len(obs)} object(s) baked by Cycles into one {size}x{size} atlas "
                f"(AO out to {distance:.1f} m); it darkens their ambient and reflections, not the lamps")
    return out


def _write_occlusion(path, occ, webp=True, quality=90):
    """Add each plain material's occlusion-roughness-metal map to the written
    .glb: R the baked occlusion, G its roughness, B its metal, as glTF packs
    them, on TEXCOORD_0 (the atlas)."""
    import struct
    import numpy as np
    if not occ:
        return
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    g = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from("<I", data, 20 + jlen)[0]
    binary = bytearray(data[28 + jlen:28 + jlen + blen])
    ext = "webp" if webp else "png"
    tmp = tempfile.mkdtemp(prefix="reze_occ_")
    settings = bpy.context.scene.render.image_settings
    keep = (settings.file_format, settings.quality, settings.color_mode)
    try:
        settings.file_format = "WEBP" if webp else "PNG"
        settings.quality = quality
        settings.color_mode = "RGB"
        for m in g.get("materials", []):
            if m["name"] not in occ:
                continue
            ao, rough, metal = occ[m["name"]]
            h, w = ao.shape
            img = bpy.data.images.new("reze_orm", w, h)
            img.colorspace_settings.name = "Non-Color"
            px = np.empty((h, w, 4), dtype=np.float32)
            px[..., 0] = np.clip(ao, 0, 1)
            px[..., 1] = rough
            px[..., 2] = metal
            px[..., 3] = 1.0
            img.pixels.foreach_set(px.ravel())
            file = os.path.join(tmp, f"orm.{ext}")
            img.filepath_raw = file
            img.file_format = settings.file_format
            img.save()
            bpy.data.images.remove(img)
            with open(file, "rb") as f:
                blob = f.read()
            while len(binary) % 4:
                binary.append(0)
            g.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(blob)})
            binary += blob
            g.setdefault("images", []).append({"bufferView": len(g["bufferViews"]) - 1, "mimeType": f"image/{ext}"})
            image = len(g["images"]) - 1
            g.setdefault("textures", []).append({"extensions": {"EXT_texture_webp": {"source": image}}} if webp else {"source": image})
            t = len(g["textures"]) - 1
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr["metallicRoughnessTexture"] = {"index": t}
            pbr["metallicFactor"] = 1.0
            pbr["roughnessFactor"] = 1.0
            m["occlusionTexture"] = {"index": t}
    finally:
        settings.file_format, settings.quality, settings.color_mode = keep
        shutil.rmtree(tmp, ignore_errors=True)
    if webp and "EXT_texture_webp" not in g.setdefault("extensionsUsed", []):
        g["extensionsUsed"].append("EXT_texture_webp")
    while len(binary) % 4:
        binary.append(0)
    g["buffers"][0]["byteLength"] = len(binary)
    js = json.dumps(g, separators=(",", ":"), ensure_ascii=False).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack("<II", len(js), 0x4E4F534A) + js \
        + struct.pack("<II", len(binary), 0x004E4942) + bytes(binary)
    with open(path, "wb") as f:
        f.write(out)


def export_stage(out_path, webp=True, quality=90):
    """Write the current scene as a stage .glb. Returns the notes it made."""
    scene = bpy.context.scene
    notes = []
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    step(0.05, "Reading the scene")
    _missing_pictures(notes)

    step(0.15, "Particles")
    particles = _particles(scene, notes)
    step(0.3, "Making instances real")
    _realize(scene, notes)
    _coplanar(scene, notes)
    for mat in bpy.data.materials:
        _fold_emission(mat)

    previous = scene.get("reze")
    carried = {k: _stored(previous, k) for k in ("grading", "ambient", "fog", "groundShadow")}
    device = _cycles_device(scene)
    ambient = None
    if not carried.get("ambient"):
        step(0.35, f"Measuring the room's light (Cycles on {device})")
        try:
            ambient = {"sh": _ambient(scene, notes)}
        except Exception as e:  # noqa: BLE001 — the stage still exports without it
            note(notes, f"ambient: could not be measured ({e})")
    haze_world = None
    haze_probe = None
    if _has_haze(scene):
        step(0.45, "The sky through the haze")
        try:
            haze_world, haze_probe = _haze_world(scene, notes)
        except Exception as e:  # noqa: BLE001
            note(notes, f"world: the haze could not be rendered into it ({e})")
    # the haze is measured with Blender's own rig, before any light is converted
    fog = None if carried.get("fog") else _haze(scene, notes, haze_probe)
    step(0.48, "Glow in the haze")
    try:
        _glow_cards(scene, notes)
    except Exception as e:  # noqa: BLE001
        note(notes, f"haze glow: could not be built ({e})")
    step(0.5, "Lights")
    _lights(scene, notes)
    step(0.55, "Glowing surfaces")
    before = {ob.name for ob in scene.objects if ob.type == "LIGHT"}
    _glow_lamps(scene, notes)
    # the glowing surfaces light the haze as the lights do
    try:
        _glow_cards(scene, notes, only={ob.name for ob in scene.objects if ob.type == "LIGHT"} - before)
    except Exception as e:  # noqa: BLE001
        note(notes, f"haze glow: the glowing surfaces' could not be built ({e})")
    # the volumes themselves stay behind: glTF would draw each as a solid box
    for ob in scene.objects:
        if ob.type == "MESH" and ob.material_slots and all(s.material and _volume_only(s.material) for s in ob.material_slots):
            ob.hide_render = True
    step(0.6, "World")
    world = _world(scene, notes, haze_world)

    step(0.65, "Occlusion")
    occ = {}
    try:
        occ = _occlusion(scene, notes)
    except Exception as e:  # noqa: BLE001 — the stage still exports without it
        note(notes, f"occlusion: could not be baked ({e})")

    vs = scene.view_settings
    view = {"transform": vs.view_transform, "look": vs.look, "exposure": vs.exposure, "gamma": vs.gamma}
    try:
        view["lut"] = _view_lut(scene)
        note(notes, f"view: {vs.view_transform}" + (f" / {vs.look}" if vs.look not in ("", "None") else "") + " baked from Blender's colour management")
    except Exception as e:  # noqa: BLE001 — the app's nearest curve then stands in
        note(notes, f"view: could not be baked ({e}); the app's nearest curve stands in")

    bloom = _glare(scene)
    note(notes, "glare: " + (f"bloom from {bloom['threshold']:.2f} at {bloom['intensity']:.2f}, scatter {bloom['scatter']:.2f}" if bloom["enabled"]
                             else bloom.get("note", "none in the compositor, so no bloom")))
    bloom.pop("note", None)
    scene["reze"] = {"version": 1, "world": world, "view": view, "bloom": bloom, "notes": notes,
                     **({"ambient": ambient} if ambient else {}), **({"fog": fog} if fog else {}),
                     # The world picture is what Cycles sees from the stage,
                     # haze included, so the stage reflects that rather than the
                     # app's own capture (lit without the lamps' shadows, it
                     # comes out too bright on a shiny floor).
                     **({"reflections": "world"} if world.get("format") == "hdr" else {}),
                     **{k: v for k, v in carried.items() if v},
                     **({"particlesJson": json.dumps(particles)} if particles else {})}

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    step(0.75, "Writing the glTF")
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
    _write_occlusion(out_path, occ, webp, quality)
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
    bl_label = "Export REZE DESIGN Stage"
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
        self._tmp_dir = tempfile.mkdtemp(prefix="reze_stage_")
        tmp_blend = os.path.join(self._tmp_dir, "stage.blend")
        bpy.ops.wm.save_as_mainfile(filepath=tmp_blend, copy=True, relative_remap=True, check_existing=False)
        cmd = [bpy.app.binary_path, "-b", tmp_blend, "--python", os.path.abspath(__file__), "--",
               self.filepath, "--quality", str(self.quality)] + ([] if self.webp else ["--png"])
        if bpy.app.background or context.window is None:
            # From a script with no window: a modal has nothing to run in, so wait.
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            return self._finish(r.returncode, r.stdout.splitlines())
        # From the menu: run it beside Blender and show how far it has got.
        import queue
        import threading
        self._lines = []
        self._queue = queue.Queue()
        self._proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                      encoding="utf-8", errors="replace", bufsize=1)

        def read(proc, q):
            for line in proc.stdout:
                q.put(line.rstrip("\n"))

        self._reader = threading.Thread(target=read, args=(self._proc, self._queue), daemon=True)
        self._reader.start()
        wm = context.window_manager
        wm.progress_begin(0, 1)
        self._timer = wm.event_timer_add(0.1, window=context.window)
        wm.modal_handler_add(self)
        self._status(context, "Exporting the stage… (Esc cancels)")
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type == "ESC":
            self._proc.terminate()
            self._end(context)
            self.report({"WARNING"}, "Stage export cancelled")
            return {"CANCELLED"}
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
        while not self._queue.empty():
            line = self._queue.get_nowait()
            self._lines.append(line)
            if line.startswith("[reze:step] "):
                fraction, _, text = line[len("[reze:step] "):].partition(" ")
                context.window_manager.progress_update(float(fraction))
                self._status(context, f"Exporting the stage: {text}… (Esc cancels)")
                self.report({"INFO"}, f"Stage export: {text}")
        if self._proc.poll() is None:
            return {"PASS_THROUGH"}
        self._reader.join(timeout=2)
        while not self._queue.empty():
            self._lines.append(self._queue.get_nowait())
        code = self._proc.returncode
        self._end(context)
        return self._finish(code, self._lines)

    @staticmethod
    def _status(context, text):
        if context.workspace:
            context.workspace.status_text_set(text)

    def _end(self, context):
        wm = context.window_manager
        wm.event_timer_remove(self._timer)
        wm.progress_end()
        if context.workspace:
            context.workspace.status_text_set(None)
        self._cleanup()

    def _cleanup(self):
        shutil.rmtree(getattr(self, "_tmp_dir", ""), ignore_errors=True)

    def _finish(self, code, lines):
        self._cleanup()
        notes = [l[len("[reze] "):] for l in lines if l.startswith("[reze] ")]
        if code or not os.path.isfile(self.filepath):
            print("\n".join(lines[-80:]))
            self.report({"ERROR"}, "The stage export failed; see the system console")
            return {"CANCELLED"}
        for l in notes[1:]:
            print("reze stage:", l)
        self.report({"INFO"}, notes[0] if notes else f"wrote {self.filepath}")
        return {"FINISHED"}


def _menu(self, context):
    self.layout.operator(EXPORT_OT_reze_stage.bl_idname, text="REZE DESIGN Stage (.glb)")


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
        def opt(name, default):
            return type(default)(args[args.index(name) + 1]) if name in args else default
        out = args[0]
        for line in export_stage(out, webp="--png" not in args, quality=opt("--quality", 90)):
            print("[reze]", line, flush=True)
    else:
        register()  # run from the Text Editor: adds the menu entry for this session
