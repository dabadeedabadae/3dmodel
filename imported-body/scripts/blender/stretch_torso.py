# blender -b -P stretch_torso.py -- <in.fbx> <out.fbx> <cut_frac> <factor> : stretch everything below cut_frac of the height
# downward by factor (keeps the sleeves and shoulders, lengthens the torso). Same FBX axes as fix_model.py.
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, cut, k = a[0], a[1], float(a[2]), float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
zs = [(o.matrix_world @ v.co).z for o in objs for v in o.data.vertices]
z0, z1 = min(zs), max(zs); zc = z0 + (z1 - z0) * cut
for o in objs:
    mw = o.matrix_world; inv = mw.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        if w.z < zc: w.z = zc - (zc - w.z) * k; v.co = inv @ w
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('STRETCH', z0, z1, zc)
