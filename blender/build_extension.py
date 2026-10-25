# Pack reze_stage_export.py as a Blender extension zip.
#
#   python blender/build_extension.py [out_dir] [--blender PATH]
#
# The add-on stays one file; this copies it in as the extension's __init__.py
# beside blender_manifest.toml and lets Blender's own `extension build` check
# and zip it. Out dir defaults to blender/dist (git-ignored).

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def blender_path(args):
    if "--blender" in args:
        return args[args.index("--blender") + 1]
    if os.environ.get("BLENDER"):
        return os.environ["BLENDER"]
    for base in (r"C:\Program Files\Blender Foundation", "/Applications"):
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base), reverse=True):
            for exe in ("blender.exe", "Contents/MacOS/Blender"):
                path = os.path.join(base, name, exe)
                if os.path.isfile(path):
                    return path
    return "blender"


def main():
    args = sys.argv[1:]
    out = next((a for a in args if not a.startswith("--") and a != blender_path(args)), os.path.join(HERE, "dist"))
    os.makedirs(out, exist_ok=True)
    src = tempfile.mkdtemp(prefix="reze_ext_")
    try:
        shutil.copy(os.path.join(HERE, "reze_stage_export.py"), os.path.join(src, "__init__.py"))
        shutil.copy(os.path.join(HERE, "blender_manifest.toml"), os.path.join(src, "blender_manifest.toml"))
        subprocess.run([blender_path(args), "--factory-startup", "--command", "extension", "build",
                        "--source-dir", src, "--output-dir", out], check=True)
    finally:
        shutil.rmtree(src, ignore_errors=True)


if __name__ == "__main__":
    main()
