# blender -b -P stretch_mid.py -- <in.fbx> <out.fbx> <hi_frac> <lo_frac> <factor> : lengthen the torso without
# deforming the hem band: what lies between lo_frac and hi_frac of the height is stretched downward by factor, what
# lies below lo_frac (the rib band) moves down unchanged. Sleeves and shoulders above hi_frac stay.
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, hi, lo, k = a[0], a[1], float(a[2]), float(a[3]), float(a[4])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
zs = [(o.matrix_world @ v.co).z for o in objs for v in o.data.vertices]
z0, z1 = min(zs), max(zs); zh = z0 + (z1 - z0) * hi; zl = z0 + (z1 - z0) * lo
drop = (zh - zl) * (k - 1)
for o in objs:
    mw = o.matrix_world; inv = mw.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        if w.z < zl: w.z -= drop
        elif w.z < zh: w.z = zh - (zh - w.z) * k
        else: continue
        v.co = inv @ w
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('STRETCH_MID', z0, z1, zh, zl, drop)
