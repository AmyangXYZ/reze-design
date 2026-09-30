"""Everything a Unity stage draws, against what its converted .glb carries.

    python3 tools/stages/stage_audit.py <ExportedProject> <Assets/.../Scene.unity> <stage.glb> [report.md]

Lists every active renderer by shader family and which of their materials the
glb has, the game-shader switches each exported family turns on (what the app
may not draw), every particle system and what became of it (a mesh, a
generated particle effect, a flame point, or DROPPED), and the converter's own notes. Run it
after a conversion: a gap is a line here rather than a surprise on screen.
"""
import collections
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from unity_scene import Scene, Project, read_material  # noqa: E402

ROOT, SCENE, GLB = sys.argv[1:4]
REPORT = sys.argv[4] if len(sys.argv) > 4 else None

proj = Project(ROOT)
scene = Scene(os.path.join(ROOT, SCENE))
b = open(GLB, 'rb').read()
n = struct.unpack('<I', b[12:16])[0]
gj = json.loads(b[20:20 + n])
glb_mats = {m['name']: (m.get('extras') or {}).get('reze', {}) for m in gj['materials']}
glb_base = collections.defaultdict(list)
for name, r in glb_mats.items():
    glb_base[name.split(' tint ')[0]].append(r)
notes = gj['scenes'][0]['extras']['reze'].get('notes', [])
points = collections.Counter(re.sub(r'(\.|_)\d+$', '', x.get('name', '')) for x in gj['nodes'] if re.match(r'^((flame|splash|spray)\.\d+|ps\d+_\d+)$', x.get('name', '')))

mat_cache = {}


def mat(guid):
    if guid not in mat_cache:
        p = proj.path(guid)
        mat_cache[guid] = read_material(p) if p and p.endswith('.mat') and os.path.exists(p) else None
    return mat_cache[guid]


def shader(m):
    if not m:
        return None
    return proj.shader_name(m['shader_guid']) if m.get('shader_guid') else None


def features(m):
    """The game shader switches this material turns on."""
    f = m['floats']
    on = sorted(k[1:] for k, v in f.items() if (k.startswith('_Use') or k.startswith('_Is')) and v and v > 0.5)
    kw = sorted(set(m.get('keywords') or []))
    return on, kw


out = []
w = out.append

# ── Renderers ──
w('# Renderers (MeshRenderer), active, by shader family and material\n')
fam = collections.defaultdict(lambda: collections.defaultdict(int))
missing = collections.defaultdict(int)
for r in scene.renderers():
    if not r['enabled'] or not scene.active_in_hierarchy(r['object']):
        continue
    for g in r['materials']:
        m = mat(g)
        s = (shader(m) or '?').rsplit('/', 1)[-1]
        name = m['name'] if m else f'?{g[:8]}'
        fam[s][name] += 1
        if name not in glb_base:
            missing[(s, name)] += 1
for s in sorted(fam, key=lambda k: -sum(fam[k].values())):
    names = fam[s]
    inglb = sum(1 for nm in names if nm in glb_base)
    w(f'- {s}: {sum(names.values())} renderers, {len(names)} materials, {inglb} in glb')
w('\n## Renderer materials NOT in the glb\n')
for (s, name), c in sorted(missing.items(), key=lambda kv: -kv[1]):
    w(f'- [{s}] {name} x{c}')

# ── Per-family features of what IS exported ──
w('\n# Game shader features switched on, per exported material family\n')
featmap = collections.defaultdict(lambda: collections.Counter())
examples = collections.defaultdict(dict)
seen = set()
for r in scene.renderers() + scene.mesh_particles():
    for g in r['materials']:
        if g in seen:
            continue
        seen.add(g)
        m = mat(g)
        if not m or m['name'] not in glb_base:
            continue
        s = (shader(m) or '?').rsplit('/', 1)[-1]
        on, kw = features(m)
        for k in on + [f'kw:{x}' for x in kw]:
            featmap[s][k] += 1
            examples[s].setdefault(k, m['name'])
for s in sorted(featmap):
    w(f'## {s}')
    for k, c in featmap[s].most_common():
        w(f'  - {k}: {c} (e.g. {examples[s][k]})')

# ── Particle systems ──
w('\n# Particle systems (active)\n')
MODES = {0: 'billboard', 1: 'stretched', 2: 'horizontal', 3: 'vertical', 4: 'mesh'}
mp_ids = {p['object'] for p in scene.mesh_particles()}
# the systems the converter hands the app as generated effects (unity_to_glb.particle_classes):
# drawn through the game's effect shader, and not a standing card mesh_particles took
from unity_particles import systems
from unity_materials import is_effect_decal
# every billboard through the effect shader or Tong_jichu_Add, Local ones included
# (unity_to_glb.drawn_as_particles): the app draws them live, not as still quads
effect_gos = {go for _spec, mats, go, tf, _n in systems(scene)
              if mats and tf is not None and (is_effect_decal(shader(mat(mats[0]))) or shader(mat(mats[0])) == "ZTong/Tong_jichu_Add")}
by = collections.Counter()
dropped = collections.Counter()
for fid, (cls, body) in scene.docs.items():
    if cls != 199:
        continue
    go = int(re.search(r'm_GameObject:\s*\{fileID:\s*(-?\d+)', body)[1])
    if not scene.active_in_hierarchy(go) or re.search(r'\n  m_Enabled: 0', body):
        continue
    mode = MODES.get(int((re.search(r'\n  m_RenderMode: (\d+)', body) or [0, 0])[1]), '?')
    mats = [mat(g) for g in re.findall(r'guid:\s*([0-9a-f]{32})', body[body.find('m_Materials'):].split('\n  m_', 1)[0])]
    mname = ','.join(m['name'] for m in mats if m) or '-'
    name = scene.name_of(go)
    if go in effect_gos:
        how = 'particle effect (generated)'
    elif go in mp_ids:
        how = 'mesh particle -> mesh'
    else:
        if go in effect_gos:
            how = 'particle effect (generated)'
        elif any(w_ in mname.lower() for w_ in ('huomiao', 'huoyan', 'flame', 'candle')):
            how = 'flame point'
        else:
            how = 'DROPPED'
            dropped[(name, mode, mname)] += 1
    by[(how, mode)] += 1
for (how, mode), c in sorted(by.items()):
    w(f'- {how} [{mode}]: {c}')
w('\n## Particle systems dropped\n')
for (name, mode, mname), c in sorted(dropped.items(), key=lambda kv: -kv[1]):
    w(f'- {name} [{mode}] {mname} x{c}')

# ── Other renderers: skinned meshes, lines, trails ──
w('\n# Other drawing components\n')
cls_names = {137: 'SkinnedMeshRenderer', 120: 'LineRenderer', 96: 'TrailRenderer', 212: 'SpriteRenderer', 1971053207: 'SpriteShape', 218: 'Terrain', 331: 'SpriteMask'}
cc = collections.Counter(cls for cls, _ in scene.docs.values())
for k, v in cls_names.items():
    if cc.get(k):
        w(f'- {v}: {cc[k]}')

# ── Notes the converter itself wrote ──
w('\n# Converter notes\n')
for x in notes:
    w(f'- {x[:300]}')
w(f'\n# Points in glb: {dict(points)}')
if REPORT:
    open(REPORT, 'w', encoding='utf8').write('\n'.join(out))
print('\n'.join(out))
