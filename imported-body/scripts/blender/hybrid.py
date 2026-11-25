# blender -b -P hybrid.py -- <orig.fbx> <mirrored.fbx> <out.fbx> <zsplit> : shells with centre below zsplit·H from mirrored, the rest from orig
import bpy, bmesh, sys
a = sys.argv[sys.argv.index('--') + 1:]
zs = float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
def load(path, keep_low):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    ms = [o for o in new if o.type == 'MESH']
    bm = bmesh.new()
    for o in ms:
        t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
        m = bpy.data.meshes.new('t'); t.to_mesh(m); t.free(); bm.from_mesh(m)
    for o in new: bpy.data.objects.remove(o)
    H = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3)); z0 = min(v.co.z for v in bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
    seen = set(); kill = []; kept = 0
    for v in bm.verts:
        if v in seen: continue
        st = [v]; isl = [v]; seen.add(v)
        while st:
            x = st.pop()
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen: seen.add(y); st.append(y); isl.append(y)
        cz = (sum(p.co.z for p in isl) / len(isl) - z0) / H
        if (cz < zs) != keep_low: kill += isl
        else: kept += 1
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    print('KEPT', path, kept)
    return bm
lo = load(a[1], True); hi = load(a[0], False)
me = bpy.data.meshes.new('m'); hi.to_mesh(me)
m2 = bpy.data.meshes.new('m2'); lo.to_mesh(m2)
o = bpy.data.objects.new('outfit', me); bpy.context.scene.collection.objects.link(o)
o2 = bpy.data.objects.new('lo', m2); bpy.context.scene.collection.objects.link(o2)
for x in (o, o2): x.select_set(True)
bpy.context.view_layer.objects.active = o; bpy.ops.object.join()
for p in o.data.polygons: p.use_smooth = False
bpy.ops.export_scene.fbx(filepath=a[2], use_selection=True, object_types={'MESH'}, axis_forward='-Z', axis_up='Y', mesh_smooth_type='FACE', add_leaf_bones=False, bake_anim=False)
