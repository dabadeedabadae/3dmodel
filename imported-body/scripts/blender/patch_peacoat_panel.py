# One-off repair of f-peacoat.fbx (I-82): the lower front panel had a hole and two inward triangles, the inner
# T-shirt showed through as patches by the pockets. Indices are of that mesh only.
# rebuild the coat's lower front panel: drop the four overlapping, partly inward triangles, add clean front faces
import bpy, bmesh, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.fbx(filepath=a[0])
o = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
M = o.matrix_world.copy()
bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(M)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
V = bm.verts
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in (0, 2, 3, 394)], context='FACES_ONLY')
for q in [(1, 7, 6), (1, 6, 0), (7, 5, 6), (0, 6, 9, 2), (6, 5, 8, 9)]:
    f = bm.faces.new([V[i] for i in q]); f.normal_update(); print('NEW', q, 'ny %.2f' % f.normal.y)
bm.transform(M.inverted()); bm.to_mesh(o.data); bm.free()
o.select_set(True)
bpy.ops.export_scene.fbx(filepath=a[1], use_selection=True, axis_forward='-Z', axis_up='Y')
