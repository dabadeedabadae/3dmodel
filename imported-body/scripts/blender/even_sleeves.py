# blender -b -P even_sleeves.py -- <in.fbx> <out.fbx> <x0_frac> <x1_frac> [strength=0.75] [zmin_frac=0.6] : even out
# lumpy sleeves of a T-pose figure without shrinking them. Between x0_frac and x1_frac of the half arm span (0 = the
# body's centre, 1 = the fingertips) every vertex above zmin_frac of the height is moved towards a smooth tube around
# the arm: its distance from the arm's axis is pulled to the running median distance at that place along the arm.
# Positions along the arm do not change, so the cuff and the shoulder stay where they were; the facets stay flat.
import bpy, sys, math
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, f0, f1 = a[0], a[1], float(a[2]), float(a[3])
strength = float(a[4]) if len(a) > 4 else 0.75
zfrac = float(a[5]) if len(a) > 5 else 0.6
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [(o, v, o.matrix_world @ v.co) for o in objs for v in o.data.vertices]
xs = [w.x for _, _, w in pts]; zs = [w.z for _, _, w in pts]
cx = (min(xs) + max(xs)) / 2; half = (max(xs) - min(xs)) / 2
zmin = min(zs) + (max(zs) - min(zs)) * zfrac
BINS = 24
moved = 0
for side in (-1, 1):
    arm = [(o, v, w) for o, v, w in pts if w.z > zmin and f0 <= side * (w.x - cx) / half <= f1]
    if len(arm) < BINS: continue
    bins = [[] for _ in range(BINS)]
    for p in arm:
        t = (side * (p[2].x - cx) / half - f0) / (f1 - f0)
        bins[min(BINS - 1, int(t * BINS))].append(p)
    # axis of the arm per bin (centre of the vertices there), then smoothed along the arm
    cen = [(sum(w.y for _, _, w in b) / len(b), sum(w.z for _, _, w in b) / len(b)) if b else None for b in bins]
    for i in range(BINS):
        if cen[i] is None: cen[i] = next(c for c in cen[i:] + cen[:i][::-1] if c is not None)
    cen = [tuple(sum(cen[max(0, min(BINS - 1, j))][k] for j in range(i - 2, i + 3)) / 5 for k in (0, 1)) for i in range(BINS)]
    rad = []
    for i, b in enumerate(bins):
        r = sorted(math.hypot(w.y - cen[i][0], w.z - cen[i][1]) for _, _, w in b)
        rad.append(r[len(r) * 6 // 10] if r else None)  # a little above the median: never tighter than the sleeve was
    for i in range(BINS):
        if rad[i] is None: rad[i] = next(r for r in rad[i:] + rad[:i][::-1] if r is not None)
    rad = [sum(rad[max(0, min(BINS - 1, j))] for j in range(i - 2, i + 3)) / 5 for i in range(BINS)]
    for i, b in enumerate(bins):
        # fade the effect in and out at the ends so the shoulder seam and the cuff do not get a step
        t = (i + 0.5) / BINS
        k = strength * min(1.0, t / 0.15, (1 - t) / 0.15)
        for o, v, w in b:
            dy, dz = w.y - cen[i][0], w.z - cen[i][1]
            r = math.hypot(dy, dz)
            if r < 1e-9: continue
            # only the outer shell (the sleeve): what lies well inside the tube is the arm, left alone
            if r < rad[i] * 0.6: continue
            s = (r + (rad[i] - r) * k) / r
            w2 = w.copy(); w2.y = cen[i][0] + dy * s; w2.z = cen[i][1] + dz * s
            v.co = o.matrix_world.inverted() @ w2; moved += 1
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, axis_forward='-Z', axis_up='Y')
print('EVEN_SLEEVES', 'half', round(half, 4), 'moved', moved)
