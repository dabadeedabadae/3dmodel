# blender -b -P locate_hits.py -- <fbx> : where faces of one shell cut through the same shell (clusters by height)
import bpy, bmesh, sys, json
from mathutils.bvhtree import BVHTree
f = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=f)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bm = bmesh.new()
for o in objs:
    t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
    m = bpy.data.meshes.new('t'); t.to_mesh(m); t.free(); bm.from_mesh(m)
H = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
z0 = min(v.co.z for v in bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
bm.faces.ensure_lookup_table()
sh = {}; n = 0
for v in bm.verts:
    if v in sh: continue
    st = [v]; sh[v] = n
    while st:
        x = st.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if y not in sh: sh[y] = n; st.append(y)
    n += 1
bvh = BVHTree.FromBMesh(bm)
hits = []
for i, j in bvh.overlap(bvh):
    if i >= j: continue
    a, b = bm.faces[i], bm.faces[j]
    if set(a.verts) & set(b.verts) or sh[a.verts[0]] != sh[b.verts[0]]: continue
    c = (a.calc_center_median() + b.calc_center_median()) / 2
    hits.append((sh[a.verts[0]], round((c.z - z0) / H, 2), round(c.x / H, 2), round(c.y / H, 2)))
from collections import Counter
print('HITS', json.dumps(sorted(Counter((s, z, round(x * 5) / 5, 'front' if y < 0 else 'back') for s, z, x, y in hits).items(), key=lambda kv: -kv[1])[:25]))
