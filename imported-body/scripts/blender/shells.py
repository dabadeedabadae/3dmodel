# blender -b -P shells.py -- <fbx> : per-shell stats, intersections by shell pair, asymmetry by shell
import bpy, bmesh, sys, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
f = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=f)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bm = bmesh.new()
for o in objs:
    t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
    m = bpy.data.meshes.new('t'); t.to_mesh(m); t.free(); bm.from_mesh(m)
H = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
shell = {}; sid = 0
for v in bm.verts:
    if v in shell: continue
    st = [v]; shell[v] = sid
    while st:
        x = st.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if y not in shell: shell[y] = sid; st.append(y)
    sid += 1
info = {}
for s in range(sid):
    vs = [v for v in bm.verts if shell[v] == s]
    c = sum((v.co for v in vs), Vector()) / len(vs)
    info[s] = {'verts': len(vs), 'center': [round(x / H, 3) for x in c],
               'zmin': round(min(v.co.z for v in vs) / H, 3), 'zmax': round(max(v.co.z for v in vs) / H, 3)}
bvh = BVHTree.FromBMesh(bm)
pairs = {}
for i, j in bvh.overlap(bvh):
    if i >= j: continue
    fi, fj = bm.faces[i], bm.faces[j]
    if set(fi.verts) & set(fj.verts): continue
    a, b = shell[fi.verts[0]], shell[fj.verts[0]]
    k = f'{min(a,b)}-{max(a,b)}'; pairs[k] = pairs.get(k, 0) + 1
xs = [v.co.x for v in bm.verts]; cx = (max(xs) + min(xs)) / 2
kd = KDTree(len(bm.verts))
for v in bm.verts: kd.insert(v.co, v.index)
kd.balance()
for s in range(sid):
    ds = sorted(kd.find(Vector((2 * cx - v.co.x, v.co.y, v.co.z)))[2] / H * 100 for v in bm.verts if shell[v] == s)
    info[s]['asymP50'] = round(ds[len(ds) // 2], 2); info[s]['asymP90'] = round(ds[int(len(ds) * .9)], 2)
print('SHELLJSON', json.dumps({'H': H, 'cx_pct': round(cx / H * 100, 3), 'shells': info, 'intersectPairs': pairs}))
