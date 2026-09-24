# A stage .glb with its textures as WebP.
#
#   python tools/stages/glb_webp.py stages/x340-glb/X340.glb [--quality 90] [--out other.glb]
#
# Blender writes PNG, and a converted stage is a quarter of a gigabyte of it.
# The app turns textures into WebP at upload anyway (texturesToWebp), at the
# same resolution; doing it once here makes the file itself about five times
# smaller, so the upload, the bundle and a download all carry the small one.
#
# Every PNG/JPEG image is re-encoded at the same size, lossy at `quality`, with
# exact=True so the colour under a transparent texel survives — a painted
# sheet's picture lives there. An image WebP would make larger is kept. Each
# texture then names its image through EXT_texture_webp, which gltf-stage.ts
# reads first; there is no PNG fallback left in the file, so the extension is
# listed as required.

import argparse
import io
import json
import os
import struct
import sys

from PIL import Image


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise SystemExit(f"{path}: not a glTF 2 binary")
    off = 12
    js, binary = None, b""
    while off < len(data):
        n, kind = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + n]
        if kind == 0x4E4F534A:
            js = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        off += 8 + n
    return js, binary


def write_glb(path, js, binary):
    j = json.dumps(js, separators=(",", ":")).encode("utf-8")
    j += b" " * (-len(j) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(j) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(j), 0x4E4F534A) + j)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


def to_webp(raw, quality):
    im = Image.open(io.BytesIO(raw))
    im.load()
    alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if alpha else "RGB")
    out = io.BytesIO()
    im.save(out, "WEBP", quality=quality, method=6, exact=True)
    return out.getvalue()


def convert(src, dst, quality):
    js, binary = read_glb(src)
    images = js.get("images", [])
    views = js.get("bufferViews", [])
    replaced = {}
    before = after = 0
    for i, img in enumerate(images):
        if img.get("bufferView") is None or img.get("mimeType") not in ("image/png", "image/jpeg"):
            continue
        bv = views[img["bufferView"]]
        raw = binary[bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv["byteLength"]]
        webp = to_webp(raw, quality)
        before += len(raw)
        if len(webp) >= len(raw):
            after += len(raw)
            continue
        after += len(webp)
        replaced[img["bufferView"]] = webp
        img["mimeType"] = "image/webp"
        replaced.setdefault(("image", i), True)
    # Lay the binary out again, every view in order, 4-byte aligned.
    out = bytearray()
    for k, bv in enumerate(views):
        start = bv.get("byteOffset", 0)
        payload = replaced.get(k, binary[start : start + bv["byteLength"]])
        out += b"\0" * (-len(out) % 4)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(payload)
        bv.pop("byteStride", None) if k in replaced else None
        out += payload
    js["buffers"][0]["byteLength"] = len(out)
    webp_images = {i for (tag, i) in (k for k in replaced if isinstance(k, tuple))}
    for t in js.get("textures", []):
        src_i = t.get("source")
        if src_i in webp_images:
            t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": src_i}
    if webp_images:
        for key in ("extensionsUsed", "extensionsRequired"):
            js[key] = sorted(set(js.get(key, [])) | {"EXT_texture_webp"})
    write_glb(dst, js, bytes(out))
    return len(webp_images), before, after


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", nargs="+")
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--out", help="output path (one input only); default replaces the input")
    args = ap.parse_args()
    if args.out and len(args.glb) > 1:
        raise SystemExit("--out takes one input")
    for src in args.glb:
        dst = args.out or src
        tmp = dst + ".tmp"
        size0 = os.path.getsize(src)
        n, before, after = convert(src, tmp, args.quality)
        os.replace(tmp, dst)
        print(f"{src}: {n} images to WebP q{args.quality}, textures {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB, "
              f"file {size0 / 1e6:.1f} MB -> {os.path.getsize(dst) / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
