# blender -b -P trim_top.py -- <in.fbx> <out.fbx> <frac> : deletes the garment's vertices in the top `frac` of its height
# near the torso axis (a neckline or hood rim that rises above the mannequin's neck), leaving the opening lower.
# The sleeves are untouched (only |x| within 40 % of the half-width is cut). Same FBX axes as fix_model.py.
import bpy, bmesh, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, frac = a[0], a[1], float(a[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
W = [(o.matrix_world @ v.co) for o in objs for v in o.data.vertices]
z0, z1 = min(w.z for w in W), max(w.z for w in W)
xs = [w.x for w in W]; cx = (min(xs) + max(xs)) / 2; half = (max(xs) - min(xs)) / 2
cut = z1 - (z1 - z0) * frac
removed = 0
for o in objs:
    bm = bmesh.new(); bm.from_mesh(o.data)
    mw = o.matrix_world
    kill = [v for v in bm.verts if (mw @ v.co).z > cut and abs((mw @ v.co).x - cx) < 0.4 * half]
    removed += len(kill)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data); bm.free()
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('TRIM', removed, round(z0, 3), round(z1, 3), round(cut, 3))
