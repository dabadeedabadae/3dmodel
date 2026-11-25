# blender -b -P flare_hem.py -- <in.fbx> <out.fbx> <below_frac> <factor> : widens the lower part of a top so a
# close-fitting hem does not sink into the trousers at the hips. Vertices below below_frac of the height (near the
# torso axis, not the sleeves) move away from the vertical axis: by 1 at below_frac, rising smoothly to `factor` at
# the bottom edge. Heights do not change. Same FBX axes as fix_model.py.
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, frac, k = a[0], a[1], float(a[2]), float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [(o.matrix_world @ v.co) for o in objs for v in o.data.vertices]
z0 = min(p.z for p in pts); z1 = max(p.z for p in pts); zl = z0 + (z1 - z0) * frac
low = [p for p in pts if p.z < zl]
cx = (min(p.x for p in low) + max(p.x for p in low)) / 2; cy = (min(p.y for p in low) + max(p.y for p in low)) / 2
n = 0
for o in objs:
    mw = o.matrix_world; inv = mw.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        if w.z >= zl: continue
        t = (zl - w.z) / (zl - z0); s = 1 + (k - 1) * t * t * (3 - 2 * t)
        w.x = cx + (w.x - cx) * s; w.y = cy + (w.y - cy) * s
        v.co = inv @ w; n += 1
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('FLARE_HEM', n, round(zl, 4))
