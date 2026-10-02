// Tests for the lazy scene bundle: zips opened by their directory and read per
// entry (lib/uploads), and the IndexedDB record that keeps a zip whole instead
// of its unpacked files (lib/asset-store).
//
//   npx esbuild lib/zip-bundle.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/zb.mjs && node /tmp/zb.mjs
//
// What must not change is what a path reads back as: the same bytes whether an
// entry was stored or deflated, the same names whatever encoding the zip used,
// the same winner for a path a patch and the scene both have, and a record
// written by the old build still opening.

import assert from "node:assert/strict"
import { deflateRawSync } from "node:zlib"
import { buildZip, type BundleEntry } from "@/lib/bundle"
import { mergePatchFiles } from "@/lib/scene-patch"
import { packBundleRecord, unpackBundleRecord, type BundleRecord } from "@/lib/asset-store"
import { bundleFileOf, openZip, readBundleFile, readBundleFiles, unzipToFiles, ZipEntry, type BundleFile } from "@/lib/uploads"

/**
 * A zip the way other tools write one: per-entry method, and names given as raw
 * bytes with or without the UTF-8 flag — which is the whole of the legacy
 * encoding problem. CRCs are left zero; the reader never checks them.
 */
function zipOf(files: { name: Uint8Array; data: Uint8Array; deflate?: boolean; utf8?: boolean }[]): Blob {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const comp = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data
    const flags = f.utf8 ? 0x800 : 0
    const method = f.deflate ? 8 : 0
    // A local extra field the central record does not have, as some writers
    // produce: the data offset must come from the local header.
    const extra = new Uint8Array([0xfe, 0xca, 2, 0, 0, 0])
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    local.setUint32(18, comp.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, f.name.length, true)
    local.setUint16(28, extra.length, true)
    parts.push(new Uint8Array(local.buffer), f.name, extra, comp)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, flags, true)
    dir.setUint16(10, method, true)
    dir.setUint32(20, comp.length, true)
    dir.setUint32(24, f.data.length, true)
    dir.setUint16(28, f.name.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), f.name)
    offset += 30 + f.name.length + extra.length + comp.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[])
}

const utf8 = (s: string) => new TextEncoder().encode(s)
const text = async (f: BundleFile) => new TextDecoder().decode(await f.arrayBuffer())
/** Something deflate actually shrinks, so a stored/deflated mix-up cannot pass. */
const body = (s: string) => utf8(s.repeat(200))

// ── The index: names in UTF-8, flagged or not, and in legacy code pages ──
{
  const sjis = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x2f, 0x83, 0x82, 0x83, 0x66, 0x83, 0x8b, 0x2e, 0x70, 0x6d, 0x78]) // テスト/モデル.pmx
  const sjisTex = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x5c, 0x61, 0x2e, 0x70, 0x6e, 0x67]) // テスト\a.png
  const legacy = await openZip(
    zipOf([
      { name: sjis, data: body("pmx"), deflate: true },
      { name: sjisTex, data: body("png") },
      { name: sjis.slice(0, 7), data: new Uint8Array(0) }, // テスト/, a directory entry
    ]),
  )
  assert.deepEqual(
    legacy.map((e) => e.name),
    ["テスト/モデル.pmx", "テスト/a.png"],
    "Shift-JIS names decode, backslashes become slashes, directories are left out",
  )
  const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xa3, 0xd0, 0xcd, 0x2e, 0x70, 0x6d, 0x78]) // 中文模型.pmx
  assert.deepEqual((await openZip(zipOf([{ name: gbk, data: body("x") }]))).map((e) => e.name), ["中文模型.pmx"])
  const flagged = await openZip(
    zipOf([
      { name: utf8("stage/舞台.json"), data: body("{}"), utf8: true, deflate: true },
      { name: utf8("props/扇子/a.webp"), data: body("w") }, // valid UTF-8, no flag
    ]),
  )
  assert.deepEqual(flagged.map((e) => e.name), ["stage/舞台.json", "props/扇子/a.webp"])
  assert.equal(flagged[1].type, "image/webp", "typed from the path, as unzipped files were")
  assert.equal(flagged[0].size, body("{}").length, "size is the uncompressed size")
  await assert.rejects(openZip(new Blob([utf8("not a zip at all")])), /Not a zip/)
}

// ── Reads: stored is a slice, deflated inflates, both give the same bytes ──
{
  const entries = await openZip(
    zipOf([
      { name: utf8("a/stored.bin"), data: body("stored ") },
      { name: utf8("a/deflated.bin"), data: body("deflated "), deflate: true },
      { name: utf8("a/empty.txt"), data: new Uint8Array(0), deflate: true },
    ]),
  )
  assert.deepEqual(
    entries.map((e) => e.method),
    [0, 8, 8],
  )
  assert.equal(await text(entries[0]), "stored ".repeat(200))
  assert.equal(await text(entries[1]), "deflated ".repeat(200))
  assert.equal(await text(entries[2]), "")
  const f = await readBundleFile(entries[1])
  assert.ok(f instanceof File)
  assert.equal(f.name, "a/deflated.bin", "a read file is named by its path")
  // Many at once: every read lands, in order, past the concurrency cap.
  const many = await openZip(
    zipOf(Array.from({ length: 200 }, (_, i) => ({ name: utf8(`m/${i}.txt`), data: body(`${i};`), deflate: i % 3 !== 0 }))),
  )
  const read = await readBundleFiles(many)
  assert.deepEqual(
    await Promise.all(read.map((r) => r.text())),
    Array.from({ length: 200 }, (_, i) => `${i};`.repeat(200)),
  )
  // unzipToFiles is the same reader, read whole — what a model upload gets.
  const all = await unzipToFiles(new File([zipOf([{ name: utf8("x/y.pmx"), data: body("y"), deflate: true }])], "m.zip"))
  assert.deepEqual(all.map((a) => a.name), ["x/y.pmx"])
  assert.equal(await all[0].text(), "y".repeat(200))
}

// ── The record: a zip stored whole, the scene's own files beside it ──
{
  // The scene before the patch: an upload of hers, and an earlier take's zip.
  const take1 = zipOf([
    { name: utf8("stage/stage.json"), data: body("old stage "), deflate: true },
    { name: utf8("stage/meshes/gone.bin"), data: body("gone ") },
    { name: utf8("camera.vmd"), data: body("old camera "), deflate: true },
    { name: utf8("props/lamp/lamp.pmx"), data: body("lamp "), deflate: true },
  ])
  const take1Files = await openZip(take1)
  const base: BundleEntry[] = [
    { path: "models/reze/reze.pmx", file: new Blob([body("reze ")]) },
    ...take1Files.map((f) => ({ path: f.name, file: f })),
  ]
  const take2 = zipOf([
    { name: utf8("stage/stage.json"), data: body("new stage "), deflate: true },
    { name: utf8("camera.vmd"), data: body("new camera ") },
    { name: utf8("props/fan/fan.pmx"), data: body("fan "), deflate: true },
  ])
  const take2Files = await openZip(take2)
  const merged = mergePatchFiles(
    base,
    take2Files.map((f) => ({ path: f.name, file: f })),
    ["stage/", "props/fan/"],
  )

  const rec = packBundleRecord("scene-1", merged)
  assert.equal(rec.zips?.length, 2, "each zip once, however many of its files are named")
  assert.ok(rec.zips!.includes(take1) && rec.zips!.includes(take2))
  assert.equal(rec.entries.filter((e) => "file" in e).length, 1, "only her upload is stored as its own bytes")

  const back = await unpackBundleRecord(rec)
  const read = Object.fromEntries(await Promise.all(back.map(async (f) => [f.name, await text(f)] as const)))
  // Exactly mergePatchFiles' answer: the patch wins a shared path, the old
  // take's files under a folder the patch brings whole are gone, the rest stay.
  assert.deepEqual(read, {
    "models/reze/reze.pmx": "reze ".repeat(200),
    "camera.vmd": "new camera ".repeat(200),
    "props/lamp/lamp.pmx": "lamp ".repeat(200),
    "stage/stage.json": "new stage ".repeat(200),
    "props/fan/fan.pmx": "fan ".repeat(200),
  })
  assert.deepEqual(
    back.map((f) => f.name),
    merged.map((e) => e.path),
    "same order as the merged list",
  )

  // A carried file under another path is a reference with its zip name.
  const renamed = packBundleRecord("scene-1", [{ path: "audio/track.wav", file: take2Files[1] }])
  assert.deepEqual(renamed.entries, [{ path: "audio/track.wav", zip: 0, name: "camera.vmd" }])
  const [r] = await unpackBundleRecord(renamed)
  assert.equal(r.name, "audio/track.wav")
  assert.equal(r.type, "audio/wav")
  assert.equal(await text(r), "new camera ".repeat(200))

  // A zip that will not open costs its files, not the record.
  const broken: BundleRecord = { sceneId: "s", zips: [new Blob([utf8("junk")])], entries: [{ path: "a", zip: 0 }, { path: "b.mp3", file: new Blob([utf8("b")]) }] }
  assert.deepEqual((await unpackBundleRecord(broken)).map((f) => f.name), ["b.mp3"])
}

// ── A record written before zips were kept still opens ──
{
  const old: BundleRecord = {
    sceneId: "old",
    entries: [
      { path: "audio/track.mp3", file: new Blob([utf8("mp3")]) },
      { path: "models/a/a.pmx", file: new File([utf8("pmx")], "whatever.pmx") },
    ],
  }
  const back = await unpackBundleRecord(old)
  assert.deepEqual(back.map((f) => f.name), ["audio/track.mp3", "models/a/a.pmx"], "the path is the name")
  assert.ok(back.every((f) => f instanceof File))
  assert.equal(back[0].type, "audio/mpeg", "typed on the way out, as before")
  assert.equal(await text(back[1]), "pmx")
}

// ── Export: a lazy bundle zips back to the same files ──
{
  const src = await openZip(
    zipOf([
      { name: utf8("stage/a.json"), data: body("a "), deflate: true },
      { name: utf8("stage/t/b.webp"), data: body("b ") },
      { name: new Uint8Array([0x83, 0x65, 0x2e, 0x76, 0x6d, 0x64]), data: body("c "), deflate: true }, // テ.vmd, Shift-JIS
    ]),
  )
  const entries: BundleEntry[] = [
    ...src.map((f) => ({ path: f.name, file: f })),
    { path: "scene.json", file: new Blob([utf8('{"version":1}')], { type: "application/json" }) },
    { path: "models/m/m.pmx", file: bundleFileOf("models/m/m.pmx", new Blob([body("m ")])) as File },
  ]
  const zip = await buildZip(entries)
  const back = await openZip(zip)
  assert.deepEqual(back.map((f) => f.name), ["stage/a.json", "stage/t/b.webp", "テ.vmd", "scene.json", "models/m/m.pmx"])
  assert.ok(back.every((f) => f.method === 0), "export writes store-only, as before")
  assert.deepEqual(
    await Promise.all(back.map(text)),
    ["a ".repeat(200), "b ".repeat(200), "c ".repeat(200), '{"version":1}', "m ".repeat(200)],
  )
  // And stored again from the export, it is one zip and no loose bytes.
  const rec = packBundleRecord("exp", back.map((f) => ({ path: f.name, file: f })))
  assert.equal(rec.zips?.length, 1)
  assert.ok(back[0] instanceof ZipEntry)
}

console.log("zip-bundle: ok")
