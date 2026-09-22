# Unity Mesh assets, as geometry.
#
# An AssetRipper export writes a Mesh as YAML with its vertex buffer inline: a
# channel table saying where each attribute sits, one interleaved stream of
# floats as hex, and an index buffer as hex beside it. Nothing here is guessed —
# every offset comes out of the file.
#
# WHAT IS NOT HANDLED, loudly rather than silently: a compressed mesh
# (`m_MeshCompression` above 0, which stores quantised vertices in a different
# structure) and data kept in an external .resS stream. Both raise, because a
# stage converted from half a mesh is worse than one that failed.

import re
import struct

# Unity's VertexChannelFormat, and the struct code for each. Float16 is the one
# that actually turns up besides Float32, on meshes an artist imported with
# compression on.
FORMATS = {
    0: ("f", 4),  # Float32
    1: ("e", 2),  # Float16
    2: ("B", 1),  # UNorm8
    3: ("b", 1),  # SNorm8
    4: ("H", 2),  # UNorm16
    5: ("h", 2),  # SNorm16
    6: ("B", 1),  # UInt8
    7: ("b", 1),  # SInt8
    8: ("H", 2),  # UInt16
    9: ("h", 2),  # SInt16
    10: ("I", 4),  # UInt32
    11: ("i", 4),  # SInt32
}
NORMALISED = {2: 255.0, 3: 127.0, 4: 65535.0, 5: 32767.0}

# The channel order Unity serialises. Only the first five matter here; the rest
# are skinning and extra UV sets a stage does not use.
POSITION, NORMAL, TANGENT, COLOR, UV0, UV1 = 0, 1, 2, 3, 4, 5


def _hex_bytes(text):
    return bytes.fromhex(re.sub(r"\s+", "", text))


class Mesh:
    """One mesh: world-space-ready vertices and the faces of each submesh."""

    def __init__(self, path):
        text = open(path, encoding="utf-8", errors="replace").read()
        self.path = path
        self.name = (re.search(r"^  m_Name:\s*(.*)$", text, re.M) or [None, ""])[1].strip()
        if int(re.search(r"m_MeshCompression:\s*(\d+)", text).group(1)) != 0:
            raise ValueError(f"{path}: compressed mesh, not supported")
        if "m_StreamData" in text and re.search(r"m_StreamData:\s*\n\s+serializedVersion: \d+\s*\n\s+offset: (\d+)", text):
            offset = int(re.search(r"m_StreamData:\s*\n\s+serializedVersion: \d+\s*\n\s+offset: (\d+)", text).group(1))
            size = int(re.search(r"m_StreamData:.*?size: (\d+)", text, re.S).group(1))
            if size:
                raise ValueError(f"{path}: vertex data lives in an external .resS stream ({size} bytes at {offset})")

        count = int(re.search(r"m_VertexCount:\s*(\d+)", text).group(1))
        # DIMENSION IS A PACKED BYTE: the low nibble is how many components the
        # channel has, the high nibble carries flags. A mesh whose normals are
        # four half-floats writes 0x34, and reading that as "dimension 52"
        # computes a stride five times too wide — which fails as a buffer
        # overrun on the first mesh that uses it rather than as wrong geometry.
        channels = [
            {"stream": int(s), "offset": int(o), "format": int(f), "dimension": int(d) & 0x0F}
            for s, o, f, d in re.findall(
                r"- stream: (\d+)\s*\n\s+offset: (\d+)\s*\n\s+format: (\d+)\s*\n\s+dimension: (\d+)", text
            )
        ]
        data = _hex_bytes(re.search(r"_typelessdata:\s*([0-9a-f\s]*)", text).group(1))

        # A stream's stride is the widest (offset + size) any of its channels
        # reaches, and streams follow one another in the buffer, each starting
        # on a 16-byte boundary.
        strides = {}
        for c in channels:
            if c["dimension"] == 0:
                continue
            code, size = FORMATS[c["format"]]
            strides[c["stream"]] = max(strides.get(c["stream"], 0), c["offset"] + size * c["dimension"])
        starts = {}
        at = 0
        for s in sorted(strides):
            starts[s] = at
            at += ((strides[s] * count + 15) // 16) * 16

        def read(channel_index, expect):
            c = channels[channel_index] if channel_index < len(channels) else None
            if not c or c["dimension"] == 0:
                return None
            code, size = FORMATS[c["format"]]
            stride = strides[c["stream"]]
            base = starts[c["stream"]]
            dim = c["dimension"]
            scale = NORMALISED.get(c["format"])
            out = []
            for i in range(count):
                at = base + i * stride + c["offset"]
                v = struct.unpack_from("<" + code * dim, data, at)
                if scale:
                    v = tuple(x / scale for x in v)
                out.append(v[:expect] if len(v) >= expect else v + (0.0,) * (expect - len(v)))
            return out

        self.count = count
        self.positions = read(POSITION, 3) or []
        self.normals = read(NORMAL, 3) or [(0.0, 1.0, 0.0)] * count
        self.uvs = read(UV0, 2) or [(0.0, 0.0)] * count
        self.uv1 = read(UV1, 2)

        index_format = int(re.search(r"m_IndexFormat:\s*(\d+)", text).group(1))
        raw = _hex_bytes(re.search(r"m_IndexBuffer:\s*([0-9a-f\s]*)", text).group(1))
        code = "<H" if index_format == 0 else "<I"
        width = 2 if index_format == 0 else 4
        self.indices = [struct.unpack_from(code, raw, i)[0] for i in range(0, len(raw), width)]

        self.submeshes = [
            {
                "firstByte": int(fb),
                "indexCount": int(ic),
                "topology": int(tp),
                "baseVertex": int(bv),
                "firstVertex": int(fv),
                "vertexCount": int(vc),
            }
            for fb, ic, tp, bv, fv, vc in re.findall(
                r"firstByte: (\d+)\s*\n\s+indexCount: (\d+)\s*\n\s+topology: (\d+)\s*\n\s+baseVertex: (\d+)\s*\n"
                r"\s+firstVertex: (\d+)\s*\n\s+vertexCount: (\d+)",
                text,
            )
        ]
        if not self.submeshes:
            self.submeshes = [
                {"firstByte": 0, "indexCount": len(self.indices), "topology": 0, "baseVertex": 0, "firstVertex": 0, "vertexCount": count}
            ]

    def triangles(self, submesh):
        """The submesh's triangles, as index triples into this mesh's vertices.

        `baseVertex` is added rather than ignored: Unity stores it so several
        submeshes can share one index range, and dropping it draws the wrong
        part of the buffer — usually as a spray of stretched triangles across
        the scene, which reads as a broken export rather than as a wrong offset.
        """
        s = self.submeshes[submesh]
        if s["topology"] != 0:
            return []
        start = s["firstByte"] // (2 if len(self.indices) and max(self.indices) < 65536 else 4)
        idx = self.indices[start : start + s["indexCount"]]
        base = s["baseVertex"]
        return [(idx[i] + base, idx[i + 1] + base, idx[i + 2] + base) for i in range(0, len(idx) - 2, 3)]


# Unity's built-in meshes, which a scene references by fileID in the "unity
# default resources" rather than as an asset in the project — so the export has
# nothing to read for them. Only the Quad appears in these stages: X309's six
# columns of falling light are Quads stretched to hundreds of units.
BUILTIN_QUAD = 10210


class BuiltinMesh:
    """A built-in mesh, with the same fields the converter reads off a Mesh.

    The Quad is Unity's own: a unit square in the XY plane facing -Z, UVs 0..1,
    wound 0-3-1, 3-0-2.
    """

    def __init__(self, file_id):
        if file_id != BUILTIN_QUAD:
            raise ValueError(f"built-in mesh {file_id} is not one this converter builds")
        self.path = f"builtin:{file_id}"
        self.name = "Quad"
        self.positions = [(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (-0.5, 0.5, 0.0), (0.5, 0.5, 0.0)]
        self.normals = [(0.0, 0.0, -1.0)] * 4
        self.uvs = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        self.uv1 = None
        self.count = 4
        self.submeshes = [{"firstByte": 0, "indexCount": 6, "topology": 0, "baseVertex": 0, "firstVertex": 0, "vertexCount": 4}]

    def triangles(self, submesh):
        return [(0, 3, 1), (3, 0, 2)]
