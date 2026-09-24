# Reading a Unity scene the way AssetRipper wrote it.
#
# Unity's YAML is not YAML: a file is a stream of documents headed
# `--- !u!108 &12345`, where 108 is the class and 12345 the fileID other
# documents point at with `{fileID: 12345}`. A real YAML parser chokes on the
# tag; a regex per document does not, and this only needs a handful of fields.
#
# WHAT IT IS FOR. A stage converted to PMX keeps its geometry and its names and
# loses everything else — which shader each material was, the numbers that fed
# it, and the lamps standing in the room. All of that is here, and this is the
# half that reads it. `profile.py` is the half that writes it out in the shape
# the app takes.

import os
import re
import struct

# Unity's LightType. Spot is 0 and Point is 2, which is the opposite of the
# order anyone guesses, and reading them swapped turns a room's lamps into
# thirty cones pointing at the floor.
LIGHT_TYPES = {0: "spot", 1: "directional", 2: "point", 3: "area"}


def documents(text):
    """Every document in a Unity YAML file, as (class id, fileID, body)."""
    out = []
    for m in re.finditer(r"^--- !u!(\d+) &(\d+)(?:\s+stripped)?\s*$", text, re.M):
        end = text.find("\n--- ", m.end())
        out.append((int(m.group(1)), int(m.group(2)), text[m.end() : end if end != -1 else len(text)]))
    return out


def field(body, name, default=None):
    """A scalar field at any depth, first occurrence. Unity indents nested
    blocks, so `m_Type` inside `m_Shadows` reads as `m_Type` too — callers that
    care ask for the shallow one with `depth=2`."""
    m = re.search(rf"^\s+{name}:\s*(.*)$", body, re.M)
    return m.group(1).strip() if m else default


def shallow(body, name, default=None):
    """A field of the document itself, not of a block nested inside it."""
    m = re.search(rf"^  {name}:\s*(.*)$", body, re.M)
    return m.group(1).strip() if m else default


def vector(text, default=(0.0, 0.0, 0.0)):
    """`{x: 1, y: 2, z: 3}` → a tuple. Unity writes these inline."""
    if not text:
        return default
    got = dict(re.findall(r"([xyzwrgba]):\s*(-?[\d.eE+-]+)", text))
    keys = "xyz" if "x" in got else "rgb"
    try:
        return tuple(float(got[k]) for k in keys)
    except KeyError:
        return default


def vector2(text, default):
    """`{x: 2, y: 1}` → (2.0, 1.0). A texture's tiling and offset are 2D, and
    `vector` reads x, y and z together."""
    got = dict(re.findall(r"([xy]):\s*(-?[\d.eE+-]+)", text or ""))
    try:
        return (float(got["x"]), float(got["y"]))
    except KeyError:
        return default


def quaternion(text):
    got = dict(re.findall(r"([xyzw]):\s*(-?[\d.eE+-]+)", text or ""))
    try:
        return tuple(float(got[k]) for k in "xyzw")
    except KeyError:
        return (0.0, 0.0, 0.0, 1.0)


def quat_matrix(q):
    """A quaternion as a 3x3 row-major matrix."""
    x, y, z, w = q
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


class Scene:
    """A parsed scene: transforms composed to world space, lights, renderers.

    The hierarchy matters and is easy to skip. A Unity light's own transform is
    LOCAL to whatever GameObject it hangs under — a lamp at (0, 3, 0) beneath a
    fixture at (40, 0, -12) stands at (40, 3, -12), and a converter that reads
    the local number puts thirty-three lamps in a heap at the origin.
    """

    def __init__(self, path):
        text = open(path, encoding="utf-8", errors="replace").read()
        self.docs = {fid: (cls, body) for cls, fid, body in documents(text)}
        self._world = {}

    def _transform(self, fid):
        cls, body = self.docs.get(fid, (None, None))
        if body is None:
            return None
        return {
            "parent": int(re.search(r"m_Father:\s*\{fileID:\s*(-?\d+)", body).group(1))
            if re.search(r"m_Father:\s*\{fileID:\s*(-?\d+)", body)
            else 0,
            "pos": vector(shallow(body, "m_LocalPosition")),
            "rot": quaternion(shallow(body, "m_LocalRotation")),
            "scale": vector(shallow(body, "m_LocalScale"), (1.0, 1.0, 1.0)),
            "object": int(re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body).group(1))
            if re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body)
            else 0,
        }

    def world_position(self, transform_id):
        """Where a transform stands, with its whole chain of parents applied."""
        if transform_id in self._world:
            return self._world[transform_id]
        t = self._transform(transform_id)
        if t is None:
            return (0.0, 0.0, 0.0)
        p = t["pos"]
        if t["parent"] and t["parent"] in self.docs:
            m = quat_matrix(self._transform(t["parent"])["rot"])
            s = self._transform(t["parent"])["scale"]
            local = tuple(p[i] * s[i] for i in range(3))
            rotated = tuple(sum(m[r][c] * local[c] for c in range(3)) for r in range(3))
            parent = self.world_position(t["parent"])
            p = tuple(parent[i] + rotated[i] for i in range(3))
        self._world[transform_id] = p
        return p

    def world_rotation_matrix(self, transform_id):
        """The transform's world rotation, parents applied, as a 3x3 matrix."""
        t = self._transform(transform_id)
        if t is None:
            return quat_matrix((0, 0, 0, 1))
        m = quat_matrix(t["rot"])
        if t["parent"] and t["parent"] in self.docs:
            p = self.world_rotation_matrix(t["parent"])
            m = tuple(tuple(sum(p[r][k] * m[k][c] for k in range(3)) for c in range(3)) for r in range(3))
        return m

    def world_matrix(self, transform_id):
        """The transform's world TRS as (3x3 rows, translation).

        Position alone is not enough for geometry: a scene instances one shrub
        thirty-one times at different rotations and scales, and the mesh has to
        be placed with all three or the stage comes back as thirty-one copies of
        the same pose scattered around the origin.
        """
        t = self._transform(transform_id)
        if t is None:
            return ((1, 0, 0), (0, 1, 0), (0, 0, 1)), (0.0, 0.0, 0.0)
        m = quat_matrix(t["rot"])
        s = t["scale"]
        local = tuple(tuple(m[r][c] * s[c] for c in range(3)) for r in range(3))
        if t["parent"] and t["parent"] in self.docs:
            pm, pt = self.world_matrix(t["parent"])
            composed = tuple(tuple(sum(pm[r][k] * local[k][c] for k in range(3)) for c in range(3)) for r in range(3))
            p = t["pos"]
            moved = tuple(pt[r] + sum(pm[r][c] * p[c] for c in range(3)) for r in range(3))
            return composed, moved
        return local, t["pos"]

    def transform_of(self, game_object_id):
        for fid, (cls, body) in self.docs.items():
            if cls == 4 and f"m_GameObject: {{fileID: {game_object_id}}}" in body:
                return fid
        return None

    def name_of(self, game_object_id):
        cls, body = self.docs.get(game_object_id, (None, ""))
        return shallow(body, "m_Name", "")

    def active_in_hierarchy(self, game_object_id):
        """Whether the GameObject is switched on, and every parent above it too.

        Unity shows an object only when its whole chain is active. An artist
        parks a lamp by switching off it or the fixture it hangs under, and the
        lamp's own flag still reads 1 in the second case.
        """
        seen = set()
        go = game_object_id
        while go and go not in seen:
            seen.add(go)
            body = self.docs.get(go, (None, ""))[1]
            if shallow(body, "m_IsActive", "1") != "1":
                return False
            tf = self.transform_of(go)
            parent = self._transform(tf)["parent"] if tf else 0
            go = self._transform(parent)["object"] if parent and parent in self.docs else 0
        return True

    def light_extension(self, game_object_id):
        """The studio's ReplicaAdditionalLightData beside a Light, if it has one.

        Found by its fields, like SceneSetting. Its shape radius caps the
        inverse square: the game's shader takes min(1/d², 1/radius), so a lamp
        inside its own lantern does not blow the lantern out.
        """
        for fid, (cls, body) in self.docs.items():
            if cls != 114 or "m_ShapeRadius:" not in body:
                continue
            if f"m_GameObject: {{fileID: {game_object_id}}}" not in body:
                continue
            return {
                "shapeRadius": float(shallow(body, "m_ShapeRadius", "0") or 0),
                "extensionType": int(float(shallow(body, "m_ExtensionType", "0") or 0)),
                "dummy": shallow(body, "m_Dummy", "0") != "0",
            }
        return {"shapeRadius": 0.0, "extensionType": 0, "dummy": False}

    def lights(self):
        """Every light, in world space, with the numbers that describe it."""
        out = []
        for fid, (cls, body) in self.docs.items():
            if cls != 108:
                continue
            go = int(re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body).group(1))
            tf = self.transform_of(go)
            # The composed matrix, not world_position: a lamp hangs under a
            # fixture that hangs under a room, and each of them may be turned.
            m, position = self.world_matrix(tf) if tf else (quat_matrix((0, 0, 0, 1)), (0.0, 0.0, 0.0))
            forward = (m[0][2], m[1][2], m[2][2])
            n = sum(c * c for c in forward) ** 0.5 or 1.0
            cookie = re.search(r"m_Cookie:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?", body)
            culling = re.search(r"m_CullingMask:\s*\n\s+serializedVersion: \d+\n\s+m_Bits: (\d+)", body)
            ext = self.light_extension(go)
            out.append(
                {
                    "name": self.name_of(go),
                    "type": LIGHT_TYPES.get(int(float(shallow(body, "m_Type", "2"))), "point"),
                    "position": position,
                    # The whole world matrix, scale included, because a cookie is
                    # projected through it.
                    "matrix": m,
                    # A Unity light shines down its local +Z, so the third column
                    # of its world rotation is where it points.
                    "direction": tuple(c / n for c in forward),
                    "color": vector(shallow(body, "m_Color"), (1.0, 1.0, 1.0)),
                    "intensity": float(shallow(body, "m_Intensity", "1")),
                    "range": float(shallow(body, "m_Range", "10")),
                    "angle": float(shallow(body, "m_SpotAngle", "30")),
                    "innerAngle": float(shallow(body, "m_InnerSpotAngle", "0") or 0),
                    "shadows": (re.search(r"m_Shadows:\s*\n\s+m_Type:\s*(\d+)", body) or [None, "0"])[1] != "0",
                    "baked": shallow(body, "m_Lightmapping", "4"),
                    "on": shallow(body, "m_Enabled", "1") == "1" and self.active_in_hierarchy(go),
                    # Which renderers it lights: their GameObject layer against
                    # the culling mask, their rendering-layer mask against this.
                    "cullingMask": int(culling.group(1)) if culling else 0xFFFFFFFF,
                    "renderingLayerMask": int(shallow(body, "m_RenderingLayerMask", "1") or 1),
                    "cookie": cookie.group(2) if cookie and cookie.group(1) != "0" else None,
                    **ext,
                }
            )
        return out

    def particle_systems(self):
        """Every ParticleSystemRenderer with the numbers that size what it draws.

        A candle flame in this studio's stages is one of these: a single
        particle, a stretched billboard standing on the wick, `startSize` wide
        and `lengthScale` times that tall, sized again by the transform the
        system's scaling mode names.
        """
        out = []
        for fid, (cls, body) in self.docs.items():
            if cls != 199:
                continue
            go = int(re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body).group(1))
            tf = self.transform_of(go)
            system = next(
                (b for c, b in self.docs.values() if c == 198 and f"m_GameObject: {{fileID: {go}}}" in b),
                "",
            )
            initial = system[system.find("InitialModule:") :]
            size = re.search(r"startSize:\s*\n(?:\s+serializedVersion: \d+\n)?\s+minMaxState: \d+\n\s+scalar: (-?[\d.eE+-]+)", initial)
            matrix, position = self.world_matrix(tf) if tf else (quat_matrix((0, 0, 0, 1)), (0.0, 0.0, 0.0))
            out.append(
                {
                    "name": self.name_of(go),
                    "position": position,
                    "matrix": matrix,
                    "localScale": self._transform(tf)["scale"] if tf else (1.0, 1.0, 1.0),
                    "materials": re.findall(r"guid:\s*([0-9a-f]{32})", body[body.find("m_Materials") :].split("\n  m_", 1)[0]),
                    "on": shallow(body, "m_Enabled", "1") == "1" and self.active_in_hierarchy(go),
                    "renderMode": int(shallow(body, "m_RenderMode", "0") or 0),
                    "lengthScale": float(shallow(body, "m_LengthScale", "1") or 1),
                    "scalingMode": int(shallow(system, "scalingMode", "1") or 1),
                    "startSize": float(size.group(1)) if size else 0.0,
                }
            )
        return out

    def lod_fallback_renderers(self):
        """Renderer ids that belong to LOD1 and below.

        A LODGroup holds the SAME object at several detail levels and shows one
        at a time by distance. Exported blindly they all draw at once: the
        stage carries its own low-poly copies inside the high-poly ones, which
        costs triangles, costs overdraw, and puts tree impostor cards floating
        inside the trees they stand in for. X305 has 117 groups and 90 such
        renderers — a third of the scene.

        Level 0 is the one the camera sees up close, and it is the one a stage
        meant for a music video should keep.
        """
        out = set()
        for fid, (cls, body) in self.docs.items():
            if cls != 205:
                continue
            levels = re.findall(r"- screenRelativeHeight:.*?renderers:\n((?:\s+- renderer: \{fileID: -?\d+\}\n)*)", body, re.S)
            for i, block in enumerate(levels):
                if i == 0:
                    continue
                out.update(int(m) for m in re.findall(r"renderer: \{fileID: (-?\d+)\}", block))
        return out

    def scene_setting(self):
        """The game's own SceneSetting component: exposure, bloom, fog, ambient.

        A Unity scene's LOOK is not in RenderSettings — that holds the ambient
        and little else. This studio keeps the rest on a MonoBehaviour the
        renderer reads every frame (see AGTools/AGSimPostFX.cs), and it is the
        difference between guessing a stage's exposure and knowing it: 2.5 with
        a contrast of 1.3, a bloom threshold of 0.5, and a blue fog from 8 to
        100 metres are all stated there.

        Found by its FIELDS rather than by its script guid, which changes
        between games and between rips of the same game.
        """
        for fid, (cls, body) in self.docs.items():
            if cls != 114 or "_tonemapping:" not in body:
                continue
            num = lambda k, d=0.0: float(shallow(body, k, d) or d)  # noqa: E731
            return {
                "exposure": num("_exposure", 1.0),
                "contrast": num("_contrast", 1.0),
                "tonemapping": num("_tonemapping", 0.0) > 0.5,
                "bloomThreshold": num("_threshold", 1.0),
                "fog": {
                    "enabled": num("_fogEnabled", 0.0) > 0.5,
                    "color": vector(shallow(body, "_fogColor")),
                    "start": num("_fogStart", 0.0),
                    "end": num("_fogEnd", 0.0),
                    "mode": num("_fogMode", 0.0),
                },
                "sky": vector(shallow(body, "_skyColor"), (1.0, 1.0, 1.0)),
                "equator": vector(shallow(body, "_equatorColor"), (1.0, 1.0, 1.0)),
                "ground": vector(shallow(body, "_groundColor"), (0.0, 0.0, 0.0)),
                "shadowColor": vector(shallow(body, "_realtimeShadowColor"), (0.0, 0.0, 0.0)),
                # The base light the game gives what its light probes light — its
                # characters — apart from the room's own ambient.
                "probeLightingBase": vector(shallow(body, "_probeLightingBase"), None) if "_probeLightingBase:" in body else None,
                # The scene's baked reflection probe — what its glossy surfaces
                # actually mirror.
                # The character shadow the game lays on the ground (SimPipeline
                # GroundShadowSystem): its own direction, colour and alpha,
                # whether or not the stage switches it on.
                "groundShadow": {
                    "enable": num("_groundShadowEnable", 0.0) > 0.5,
                    "inclination": num("_groundShadowInclination", 45.0),
                    "azimuth": num("_groundShadowAzimuth", 0.0),
                    "fade": num("_groundShadowFade", 0.0),
                    "color": vector(shallow(body, "_groundShadowColor"), (0.0, 0.0, 0.0)),
                    "alpha": float((re.search(r"a:\s*(-?[\d.eE+-]+)", shallow(body, "_groundShadowColor", "") or "") or [None, "0"])[1]),
                },
                "reflectionGuid": (re.search(r"bakeReflectionTex:\s*\{fileID:\s*\d+,\s*guid:\s*([0-9a-f]{32})", body) or [None, None])[1],
            }
        return None

    def renderers(self):
        """Every MeshRenderer: where it stands and which materials it wears."""
        out = []
        for fid, (cls, body) in self.docs.items():
            if cls != 23:
                continue
            go = int(re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)", body).group(1))
            tf = self.transform_of(go)
            mats = re.findall(r"guid:\s*([0-9a-f]{32})", body[body.find("m_Materials") :])
            # STATIC BATCHING, which changes two things at once. Unity merges
            # several objects into one combined mesh and points each renderer at
            # a RANGE of its submeshes — so the material slot i is submesh
            # firstSubMesh + i, not i — and it bakes their transforms into that
            # mesh, so the renderer's own transform must NOT be applied again.
            # Read only the first half and a converter draws whichever submesh
            # happens to sit at index 0: parts of the scene appear twice and
            # other parts, a plaza floor among them, never appear at all.
            batch = re.search(r"m_StaticBatchInfo:\s*\n\s+firstSubMesh:\s*(\d+)\s*\n\s+subMeshCount:\s*(\d+)", body)
            first_submesh = int(batch.group(1)) if batch else 0
            submesh_count = int(batch.group(2)) if batch else 0
            out.append(
                {
                    "name": self.name_of(go),
                    "id": fid,
                    "object": go,
                    "transform": tf,
                    "position": self.world_position(tf) if tf else (0, 0, 0),
                    "materials": mats,
                    "mesh": self.mesh_of(go),
                    "enabled": shallow(body, "m_Enabled", "1") == "1",
                    "layer": int(shallow(self.docs.get(go, (None, ""))[1], "m_Layer", "0") or 0),
                    "renderingLayerMask": int(shallow(body, "m_RenderingLayerMask", "1") or 1),
                    "firstSubMesh": first_submesh,
                    "batched": submesh_count > 0,
                }
            )
        return out

    def mesh_of(self, game_object_id):
        """The mesh guid the GameObject's MeshFilter names, if it has one."""
        for fid, (cls, body) in self.docs.items():
            if cls != 33 or f"m_GameObject: {{fileID: {game_object_id}}}" not in body:
                continue
            m = re.search(r"m_Mesh:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?", body)
            # Unity's built-in meshes live in its default resources, under this
            # guid; the fileID says which one.
            if m and m.group(2) == "0000000000000000e000000000000000":
                return f"builtin:{m.group(1)}"
            return m.group(2) if m and m.group(2) else None
        return None

    def ambient(self):
        for fid, (cls, body) in self.docs.items():
            if cls != 104:
                continue
            return {
                "mode": int(float(shallow(body, "m_AmbientMode", "0"))),
                "sky": vector(shallow(body, "m_AmbientSkyColor")),
                "equator": vector(shallow(body, "m_AmbientEquatorColor")),
                "ground": vector(shallow(body, "m_AmbientGroundColor")),
                "intensity": float(shallow(body, "m_AmbientIntensity", "1")),
            }
        return None


class Project:
    """The exported project's asset table: guid ↔ path, and shader names."""

    def __init__(self, root):
        self.root = root
        self.by_guid = {}
        for dirpath, _dirs, files in os.walk(os.path.join(root, "Assets")):
            for f in files:
                if not f.endswith(".meta"):
                    continue
                path = os.path.join(dirpath, f)
                try:
                    head = open(path, encoding="utf-8", errors="replace").read(400)
                except OSError:
                    continue
                g = re.search(r"guid:\s*([0-9a-f]{32})", head)
                if g:
                    self.by_guid[g.group(1)] = path[:-5]
        self._shader_names = {}

    def path(self, guid):
        return self.by_guid.get(guid)

    def shader_name(self, guid):
        """The name a shader declares, which is what a material means by it —
        `SimPipeline/PBR/Standard`, not `Standard.shader`."""
        if guid in self._shader_names:
            return self._shader_names[guid]
        path = self.path(guid)
        name = None
        if path and os.path.exists(path):
            with open(path, encoding="utf-8", errors="replace") as fh:
                head = fh.read(2000)
            m = re.search(r'Shader\s+"([^"]+)"', head)
            name = m.group(1) if m else None
        self._shader_names[guid] = name
        return name


def read_material(path):
    """One .mat: its name, its shader's guid, its texture bindings and values.

    Unity writes a material's property maps either as sequence items (`- _Tex:`)
    or as plain keys (`_Tex:`) depending on the serialisation the exporter used,
    and a reader that knows only one of the two comes back with every texture
    unbound and every float missing — which looks exactly like a stage whose
    materials genuinely carry nothing.
    """
    t = open(path, encoding="utf-8", errors="replace").read()
    shader = re.search(r"m_Shader:.*?guid:\s*([0-9a-f]{32})", t, re.S)
    body = t[t.find("m_SavedProperties") :]
    textures = {}
    for m in re.finditer(
        r"^\s+-?\s*(_\w+):\s*\n\s+m_Texture: \{fileID: (\d+)(?:, guid: ([0-9a-f]{32}))?[^}]*\}"
        r"(?:\s*\n\s+m_Scale: \{([^}]*)\})?(?:\s*\n\s+m_Offset: \{([^}]*)\})?",
        body,
        re.M,
    ):
        if not m.group(3):
            continue
        textures[m.group(1)] = {
            "guid": m.group(3),
            # Tiling and offset ride with the binding and are easy to lose; a
            # water overlay tiled 80x80 sampled at 1x1 is a flat wash.
            "scale": vector2(m.group(4), (1.0, 1.0)),
            "offset": vector2(m.group(5), (0.0, 0.0)),
        }
    floats_block = body[body.find("m_Floats") : body.find("m_Colors")] if "m_Colors" in body else body[body.find("m_Floats") :]
    colors_block = body[body.find("m_Colors") :] if "m_Colors" in body else ""
    floats = {k: float(v) for k, v in re.findall(r"^\s+-?\s*(_\w+):\s*(-?[\d.eE+-]+)\s*$", floats_block, re.M)}
    colors, alpha = {}, {}
    for k, v in re.findall(r"^\s+-?\s*(_\w+):\s*\{(r:[^}]*)\}", colors_block, re.M):
        colors[k] = vector("{" + v + "}")
        alpha[k] = float(dict(re.findall(r"([rgba]):\s*(-?[\d.eE+-]+)", v)).get("a", 1.0))
    keywords = [k for k in re.findall(r"^\s+- (\w+)$", t, re.M) if k.isupper() or k.startswith("_")]
    return {
        "name": re.search(r"m_Name:\s*(.+)", t).group(1).strip(),
        "shader_guid": shader.group(1) if shader else None,
        "textures": textures,
        "floats": floats,
        "colors": colors,
        "alpha": alpha,
        "keywords": keywords,
        "path": path,
    }


def pmx_materials(path):
    """The material names a PMX carries, in file order — the join key between
    the geometry and everything this module reads."""
    d = open(path, "rb").read()
    n = d[8]
    flags = d[9 : 9 + n]
    enc, addl, vidx, tidx, _midx, bidx = flags[0], flags[1], flags[2], flags[3], flags[4], flags[5]
    codec = "utf-16-le" if enc == 0 else "utf-8"
    o = 9 + n

    def text(o):
        ln = struct.unpack_from("<i", d, o)[0]
        return d[o + 4 : o + 4 + ln].decode(codec, "replace"), o + 4 + ln

    for _ in range(4):
        _, o = text(o)
    vc = struct.unpack_from("<i", d, o)[0]
    o += 4
    weights = {0: lambda b: b, 1: lambda b: b * 2 + 4, 2: lambda b: b * 4 + 16, 3: lambda b: b * 2 + 4 + 36, 4: lambda b: b * 4 + 16}
    for _ in range(vc):
        o += 12 + 12 + 8 + 16 * addl
        wt = d[o]
        o += 1 + weights[wt](bidx) + 4
    fc = struct.unpack_from("<i", d, o)[0]
    o += 4 + fc * vidx
    tc = struct.unpack_from("<i", d, o)[0]
    o += 4
    for _ in range(tc):
        _, o = text(o)
    mc = struct.unpack_from("<i", d, o)[0]
    o += 4

    def index(o, size):
        return struct.unpack_from({1: "<b", 2: "<h", 4: "<i"}[size], d, o)[0], o + size

    names = []
    for _ in range(mc):
        nj, o = text(o)
        _, o = text(o)
        o += 16 + 16 + 12 + 1 + 16 + 4
        _, o = index(o, tidx)
        _, o = index(o, tidx)
        o += 1
        shared = d[o]
        o += 1
        if shared == 0:
            _, o = index(o, tidx)
        else:
            o += 1
        _, o = text(o)
        o += 4
        names.append(nj)
    return names


def pmx_material_centroids(path):
    """Where each material's geometry sits, as the mean of its own vertices.

    The other half of the fit below: a material's name is the same on both
    sides, so its centre in the PMX against its centre in the scene is one
    equation, and sixty-eight of them decide the transform between the two
    without anybody having to remember which way a converter flipped Z.
    """
    d = open(path, "rb").read()
    n = d[8]
    flags = d[9 : 9 + n]
    enc, addl, vidx, tidx, _midx, bidx = flags[0], flags[1], flags[2], flags[3], flags[4], flags[5]
    codec = "utf-16-le" if enc == 0 else "utf-8"
    o = 9 + n

    def text(o):
        ln = struct.unpack_from("<i", d, o)[0]
        return d[o + 4 : o + 4 + ln].decode(codec, "replace"), o + 4 + ln

    for _ in range(4):
        _, o = text(o)
    vc = struct.unpack_from("<i", d, o)[0]
    o += 4
    weights = {0: lambda b: b, 1: lambda b: b * 2 + 4, 2: lambda b: b * 4 + 16, 3: lambda b: b * 2 + 4 + 36, 4: lambda b: b * 4 + 16}
    pos = []
    for _ in range(vc):
        pos.append(struct.unpack_from("<3f", d, o))
        o += 12 + 12 + 8 + 16 * addl
        wt = d[o]
        o += 1 + weights[wt](bidx) + 4
    fc = struct.unpack_from("<i", d, o)[0]
    o += 4
    faces = []
    fmt = {1: "<B", 2: "<H", 4: "<i"}[vidx]
    for i in range(fc):
        faces.append(struct.unpack_from(fmt, d, o + i * vidx)[0])
    o += fc * vidx
    tc = struct.unpack_from("<i", d, o)[0]
    o += 4
    for _ in range(tc):
        _, o = text(o)
    mc = struct.unpack_from("<i", d, o)[0]
    o += 4

    def index(o, size):
        return struct.unpack_from({1: "<b", 2: "<h", 4: "<i"}[size], d, o)[0], o + size

    out = {}
    start = 0
    for _ in range(mc):
        nj, o = text(o)
        _, o = text(o)
        o += 16 + 16 + 12 + 1 + 16 + 4
        _, o = index(o, tidx)
        _, o = index(o, tidx)
        o += 1
        shared = d[o]
        o += 1
        if shared == 0:
            _, o = index(o, tidx)
        else:
            o += 1
        _, o = text(o)
        count = struct.unpack_from("<i", d, o)[0]
        o += 4
        vs = faces[start : start + count]
        start += count
        if vs:
            sx = sum(pos[i][0] for i in vs) / len(vs)
            sy = sum(pos[i][1] for i in vs) / len(vs)
            sz = sum(pos[i][2] for i in vs) / len(vs)
            out[nj] = (sx, sy, sz)
    return out
