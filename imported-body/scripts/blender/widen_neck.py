# blender -b -P widen_neck.py -- <in.fbx> <out.fbx> <from_frac> <factor>
# Widens a garment's neckline: vertices above from_frac of the height (near the torso axis, not the sleeves) move
# away from the vertical axis, by 1 at from_frac rising smoothly to `factor` at the top. Used where the collar or
# hood rim cuts through the mannequin's neck (I-77, women's hoodie). Same FBX axes as fix_model.py.
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, frac, k = a[0], a[1], float(a[2]), float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
W = [(o.matrix_world @ v.co) for o in objs for v in o.data.vertices]
z0, z1 = min(w.z for w in W), max(w.z for w in W)
xs = [w.x for w in W]; cx = (min(xs) + max(xs)) / 2
top = [w for w in W if w.z > z0 + (z1 - z0) * frac]
cy = sum(w.y for w in top) / max(1, len(top))
half = max(abs(w.x - cx) for w in top) if top else 1
moved = 0
for o in objs:
    mw = o.matrix_world; inv = mw.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        t = (w.z - (z0 + (z1 - z0) * frac)) / ((z1 - z0) * (1 - frac))
        if t <= 0 or abs(w.x - cx) > 0.6 * half:
            continue
        s = 1 + (k - 1) * min(1.0, t) ** 0.7
        w.x = cx + (w.x - cx) * s; w.y = cy + (w.y - cy) * s
        v.co = inv @ w; moved += 1
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('WIDEN', moved)
