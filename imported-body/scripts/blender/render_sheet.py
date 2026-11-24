# blender -b -P render_sheet.py -- <out.png> <view: front|tq|back> <rowA.json,rowA2.json,...> [<rowB...>]
# One row per comma list (e.g. before / after), figures side by side, arms overlapping is fine (front view crop).
import bpy, sys, json, math
a = sys.argv[sys.argv.index('--') + 1:]
out, view, rows = a[0], a[1], [r.split(',') for r in a[2:]]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
COL = {'top': (0.55, 0.62, 0.78), 'inner': (0.93, 0.93, 0.93), 'bottom': (0.30, 0.33, 0.40), 'head': (0.86, 0.76, 0.68),
       'arm_left': (0.86, 0.76, 0.68), 'arm_right': (0.86, 0.76, 0.68), 'shoe_left': (0.18, 0.18, 0.2), 'shoe_right': (0.18, 0.18, 0.2)}
mats = {}
for k, c in COL.items():
    m = bpy.data.materials.new(k); m.diffuse_color = (*c, 1); mats[k] = m
rot = {'front': 0, 'tq': -40, 'back': 180}[view]
DX, DY = 0.62, 2.0
for r, files in enumerate(rows):
    for c, f in enumerate(files):
        if not f: continue
        d = json.load(open(f, encoding='utf-8'))
        b = d['base']; idx = d['index']
        verts = [(b[i], -b[i + 2], b[i + 1]) for i in range(0, len(b), 3)]
        kind = ['top'] * len(verts)
        for p in d.get('partsIndex', []):
            for v in p['vertices']: kind[v] = p['kind']
        me = bpy.data.meshes.new('m'); me.from_pydata(verts, [], [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]); me.update()
        names = list(COL)
        for k in names: me.materials.append(mats[k])
        for poly in me.polygons:
            ks = [kind[v] for v in poly.vertices]; poly.material_index = names.index(max(set(ks), key=ks.count)); poly.use_smooth = False
        o = bpy.data.objects.new('f', me); sc.collection.objects.link(o)
        o.rotation_euler = (0, 0, math.radians(rot)); o.location = (c * DX, 0, -r * DY)
ncol = max(len(x) for x in rows)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'
W = (ncol - 1) * DX + 0.75; Hh = (len(rows) - 1) * DY + 1.85
cam.data.ortho_scale = max(W, Hh * 1.6) * 1.02
cam.location = ((ncol - 1) * DX / 2, -10, 0.88 - (len(rows) - 1) * DY / 2); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_backface_culling = False
sh.show_cavity = True; sh.cavity_type = 'WORLD'
sc.display.render_aa = '16'
sc.render.resolution_x = 2000; sc.render.resolution_y = 1250
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.96, 0.96, 0.97)
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
