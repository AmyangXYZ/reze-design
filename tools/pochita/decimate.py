# Pochita's mesh for the effect: every part of the GLB, merged, decimated to its
# budget and moved into pet space (+Z forward, +Y up, feet on y = 0, x centred).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/pochita/decimate.py -- pochita.glb tools/pochita/mesh.json
import bpy, bmesh, json, math, sys

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# part: GLB object prefix, triangle budget, a planar dissolve first for the flat ones.
PARTS = {
    "body":   ("Pochita Remesh.001_Material_0",     1000, False),
    "white":  ("Pochita Remesh.001_Material.003_0",   80, False),
    "pupil":  ("Pochita Remesh.001_Material.001_0",   80, False),
    "handle": ("Cube.016_Material.001_0",            110, False),
    "blade":  ("Cube.018_Material.002_0",            220, True),
    "wire":   ("NurbsPath.004_Material.001_0",        48, False),
    "loop":   ("Cube.017_Material.001_0",             44, False),
}
CX, FLOOR = 11.3767, 0.70861

parts = {}
for name, (obj, budget, planar) in PARTS.items():
    o = bpy.data.objects[obj]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    if planar:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(3), verts=bm.verts, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    d = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(d)
    bpy.context.view_layer.objects.active = d
    if len(me.polygons) > budget:
        m = d.modifiers.new("d", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = budget / len(me.polygons)
        bpy.ops.object.modifier_apply(modifier="d")
    me = d.data
    me.calc_loop_triangles()
    me.shade_smooth()
    vs = [[v.co.x - CX, v.co.z - FLOOR, -v.co.y] for v in me.vertices]
    ns = [[v.normal.x, v.normal.z, -v.normal.y] for v in me.vertices]
    ts = [list(t.vertices) for t in me.loop_triangles]
    parts[name] = {"v": vs, "n": ns, "t": ts}
    print("PART", name, len(vs), "verts", len(ts), "tris")

json.dump(parts, open(out, "w"))
print("TOTAL", sum(len(p["v"]) for p in parts.values()), "verts", sum(len(p["t"]) for p in parts.values()), "tris")
