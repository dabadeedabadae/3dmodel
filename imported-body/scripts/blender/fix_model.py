# blender -b -P fix_model.py -- <in.fbx> <out.fbx> <json options>
# options: {"sym": "+X"|"-X"|null, "minIsland": 20, "dropShellsBelow": verts, "dropThin": true,
#           "smoothShellsZ": [[z0,z1,iters]], "blend": "<path.blend>"}
# Prints FIXREPORT {...}. Keeps the faceted look: no subdivision, no remesh, flat shading.
import bpy, bmesh, sys, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[0], a[1]
opt = json.loads(a[2]) if len(a) > 2 else {}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1: bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
# bake transform so the mirror plane is world X = centre
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bm = bmesh.new(); bm.from_mesh(o.data)
H = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
rep = {'before': [len(bm.verts), len(bm.faces)]}

def shells(bm):
    seen = {}; out = []
    for v in bm.verts:
        if v in seen: continue
        st = [v]; seen[v] = len(out); isl = [v]
        while st:
            x = st.pop()
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen: seen[y] = len(out); st.append(y); isl.append(y)
        out.append(isl)
    return out

def self_hits(bm):
    bm.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm); n = 0
    sh = {}
    for i, s in enumerate(shells(bm)):
        for v in s: sh[v] = i
    for i, j in bvh.overlap(bvh):
        if i >= j: continue
        fi, fj = bm.faces[i], bm.faces[j]
        if set(fi.verts) & set(fj.verts): continue
        if sh[fi.verts[0]] == sh[fj.verts[0]]: n += 1
    return n

bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
rep['selfHitsBefore'] = self_hits(bm)
# centre on X (generator output is centred up to ~1e-3)
xs = [v.co.x for v in bm.verts]; cx = (max(xs) + min(xs)) / 2
for v in bm.verts: v.co.x -= cx
rep['centreShift'] = round(cx / H * 100, 3)
# 5) mirror symmetry: keep one half, mirror it, weld on the plane
if opt.get('sym'):
    d = {'+X': 'X', '-X': '-X'}[opt['sym']]
    # snap near-centre verts onto the plane so the cut is clean
    for v in bm.verts:
        if abs(v.co.x) < H * 0.002: v.co.x = 0.0
    bmesh.ops.symmetrize(bm, input=bm.verts[:] + bm.edges[:] + bm.faces[:], direction=d, dist=H * 1e-4)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
# 1) degenerate geometry
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=H * 1e-5)
zero = [f for f in bm.faces if f.calc_area() < (H * 1e-4) ** 2]
bmesh.ops.delete(bm, geom=zero, context='FACES'); rep['zeroFaces'] = len(zero)
# 2) edges with 3+ faces: keep the two largest
dropped = 0
for _ in range(6):
    kill = set()
    for e in bm.edges:
        if len(e.link_faces) > 2:
            kill.update(sorted(e.link_faces, key=lambda f: f.calc_area(), reverse=opt.get('nmKeep', 'large') == 'large')[2:])
    if not kill: break
    dropped += len(kill); bmesh.ops.delete(bm, geom=list(kill), context='FACES')
rep['nonManifoldFaces'] = dropped
# 2b) close small holes left by dropped faces (real openings — neck, cuffs, hem — have many more edges)
if opt.get('fillHoles'):
    nb0 = len(bm.faces)
    res = bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=opt['fillHoles'])
    bmesh.ops.triangulate(bm, faces=res['faces'])
    rep['holesFilledFaces'] = len(bm.faces) - nb0
# 3) loose verts/edges, tiny islands, thin shards (a shell whose bbox is long but has few verts)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
mi = opt.get('minIsland', 20); small = 0; shards = 0; dropShells = []
for s in shells(bm):
    if len(s) < mi:
        small += 1; bmesh.ops.delete(bm, geom=s, context='VERTS'); continue
for s in shells(bm):
    if opt.get('dropShellsBelow') and len(s) < opt['dropShellsBelow']:
        dropShells.append(len(s)); bmesh.ops.delete(bm, geom=s, context='VERTS')
rep['tinyIslands'] = small; rep['droppedShells'] = dropShells
# 4) duplicated stacked shells (e.g. a button made of a disc inside a ring): drop the smaller of two shells whose
#    bounding boxes nest within 2 mm·H
if opt.get('dropNested'):
    ss = shells(bm); boxes = []
    for s in ss:
        mn = Vector([min(v.co[i] for v in s) for i in range(3)]); mx = Vector([max(v.co[i] for v in s) for i in range(3)])
        boxes.append((mn, mx, s))
    kill = set(); tol = H * 0.004
    for i, (mn, mx, s) in enumerate(boxes):
        for j, (mn2, mx2, s2) in enumerate(boxes):
            if i == j or len(s2) < len(s) or j in kill: continue
            if all(mn[k] >= mn2[k] - tol and mx[k] <= mx2[k] + tol for k in range(3)) and (mx - mn).length < (mx2 - mn2).length * 0.6 + tol * 3:
                kill.add(i); break
    for i in kill: bmesh.ops.delete(bm, geom=boxes[i][2], context='VERTS')
    rep['nestedDropped'] = len(kill)
# 6) local Laplacian relax of crumpled zones (keeps vertex count; boundary verts fixed)
for z0, z1, it in opt.get('relaxZ', []):
    zs = [v.co.z for v in bm.verts]; zmin = min(zs)
    vs = [v for v in bm.verts if z0 * H <= v.co.z - zmin <= z1 * H and not v.is_boundary]
    for _ in range(it):
        bmesh.ops.smooth_vert(bm, verts=vs, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                              mirror_clip_x=bool(opt.get('sym')), clip_dist=H * 1e-4)
# 7) untangle: smooth only the vertices of faces that cut through their own shell, until none are left
def hit_verts(bm):
    bm.faces.ensure_lookup_table()
    sh = {}
    for i, s in enumerate(shells(bm)):
        for v in s: sh[v] = i
    bvh = BVHTree.FromBMesh(bm); vs = set()
    for i, j in bvh.overlap(bvh):
        if i >= j: continue
        fi, fj = bm.faces[i], bm.faces[j]
        if set(fi.verts) & set(fj.verts) or sh[fi.verts[0]] != sh[fj.verts[0]]: continue
        vs.update(fi.verts); vs.update(fj.verts)
    return vs
if opt.get('untangle'):
    rounds = 0
    for rounds in range(1, opt['untangle'] + 1):
        vs = hit_verts(bm)
        if not vs: break
        ring = set(vs)
        for v in vs:
            for e in v.link_edges: ring.add(e.other_vert(v))
        mov = [v for v in ring if not v.is_boundary or opt.get('untangleBoundary')]
        bmesh.ops.smooth_vert(bm, verts=mov, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                              mirror_clip_x=bool(opt.get('sym')), clip_dist=H * 1e-4)
    rep['untangleRounds'] = rounds
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
for f in bm.faces: f.smooth = False
rep['selfHitsAfter'] = self_hits(bm)
rep['nonManifoldAfter'] = sum(1 for e in bm.edges if len(e.link_faces) > 2)
rep['wrongWindingAfter'] = sum(1 for e in bm.edges if len(e.link_faces) == 2 and not e.is_contiguous)
rep['shellsAfter'] = len(shells(bm))
rep['after'] = [len(bm.verts), len(bm.faces)]
rep['trisAfter'] = sum(len(f.verts) - 2 for f in bm.faces)
bm.to_mesh(o.data); bm.free()
o.data.update()
if opt.get('blend'): bpy.ops.wm.save_as_mainfile(filepath=opt['blend'])
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, object_types={'MESH'}, axis_forward='-Z', axis_up='Y',
                         mesh_smooth_type='FACE', use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False)
print('FIXREPORT', json.dumps(rep))
