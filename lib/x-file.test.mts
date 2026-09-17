// Tests for lib/x-file — a .x accessory read back as the PMX it converts to.
//
//   npx esbuild lib/x-file.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/xf.mjs && node /tmp/xf.mjs
//
// Every assertion goes through readPmxDocument, so what is checked is the file
// the scene will load rather than the converter's intermediate arrays.

import { readPmxDocument } from "reze-engine"
import { xToPmx } from "@/lib/x-file"

let failures = 0
const eq = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failures++; console.error(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}
const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000 + 0)
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

// A unit quad (one 4-gon) and a triangle, in two frames: the second frame moves
// by +2 on x and mirrors z, which turns its faces inside out. Normals are
// indexed separately from positions. The quad wears a named material defined
// at the top level; the triangle wears an inline one bright enough that MMD
// ignores the light.
const X = `xof 0303txt 0032
template Vector { <3d82ab5e-62da-11cf-ab39-0020af71e433> FLOAT x; FLOAT y; FLOAT z; }
// a comment { with braces }
Material Paint {
 1.0;0.5;0.25;1.0;;
 8.0;
 0.1;0.1;0.1;;
 0.0;0.0;0.0;;
 TextureFilename { "tex\\\\\\\\wall.png*shine.sph"; }
}
Frame Root {
 FrameTransformMatrix { 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1;; }
 Mesh Quad {
  4;
  0.0;0.0;0.0;, 1.0;0.0;0.0;, 1.0;1.0;0.0;, 0.0;1.0;0.0;;
  1;
  4;0,3,2,1;;
  MeshNormals { 1; 0.0;0.0;-1.0;; 1; 4;0,0,0,0;; }
  MeshTextureCoords { 4; 0.0;1.0;, 1.0;1.0;, 1.0;0.0;, 0.0;0.0;; }
  MeshMaterialList { 1; 1; 0;; { Paint } }
 }
 Frame Mirror {
  FrameTransformMatrix { 1,0,0,0, 0,1,0,0, 0,0,-1,0, 2,0,0,1;; }
  Mesh {
   3;
   0.0;0.0;0.0;, 1.0;0.0;0.0;, 0.0;1.0;0.0;;
   1;
   3;0,2,1;;
   MeshMaterialList {
    1; 1; 0;;
    Material {
     1.0;1.0;1.0;1.0;;
     5.0;
     0.0;0.0;0.0;;
     0.6;0.6;0.6;;
     TextureFilename { "tex\\\\\\\\wall.png"; }
    }
   }
  }
 }
}
`

const { pmx, unlit } = xToPmx(bytes(X), "set/Test.x")
const doc = readPmxDocument(pmx)

eq(doc.name, "Test", "model named after the file")
eq(doc.bones.length, 1, "one root bone")

// The quad's four corners share one normal index, so they stay four vertices;
// the triangle adds three. Positions are ten times the file's.
eq(doc.vertices.length, 7, "vertex count")
eq(round(doc.vertices[2].position), [10, 10, 0], "quad corner scaled by ten")
eq(round(doc.vertices[1].uv), [0, 0], "uv follows its position")

// The 4-gon fans into two triangles, in file order.
eq(doc.materials.map((m) => m.indexCount), [6, 3], "index runs per material")
eq(Array.from(doc.indices.slice(0, 6)), [0, 1, 2, 0, 2, 3], "quad fan")

// The mirrored triangle: x moved by 20 after scaling, z negated, and two
// corners swapped so its front still faces the way its normal points.
const tri = Array.from(doc.indices.slice(6, 9)).map((i) => doc.vertices[i])
eq(round(tri[0].position), [20, 0, 0], "frame translation applied")
const [a, b, c] = tri.map((v) => v.position)
const e1 = [0, 1, 2].map((j) => b[j] - a[j]), e2 = [0, 1, 2].map((j) => c[j] - a[j])
const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
const n = tri[0].normal
eq(face[0] * n[0] + face[1] * n[1] + face[2] * n[2] > 0, true, "mirrored face winds toward its normal")

// Materials: the referenced one by its own name, the inline one by its texture.
eq(doc.materials.map((m) => m.name), ["Paint", "wall"], "material names")
eq(doc.textures, ["tex/wall.png", "shine.sph"], "texture table, separators collapsed")
eq([doc.materials[0].textureIndex, doc.materials[0].sphereIndex, doc.materials[0].sphereMode], [0, 1, 1], "sphere map split off")
eq(doc.materials[1].sphereIndex, -1, "no sphere map")
eq(round(doc.materials[1].ambient), [0.6, 0.6, 0.6], "emissive carried as ambient")

// 1 × 0.604 + 0.6 clears 1; 0.25 × 0.604 + 0 does not.
eq(unlit, ["wall"], "unlit materials")
eq(doc.materials.map((m) => (m.drawFlags & 0x04) !== 0), [true, false], "only lit materials cast shadows")

let threw = ""
try { xToPmx(bytes("xof 0303bin 0032...."), "b.x") } catch (e) { threw = (e as Error).message }
eq(threw.includes("binary"), true, "binary .x is refused by name")

if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("x-file: all passed")
