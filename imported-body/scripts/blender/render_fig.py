# blender -b -P render_fig.py -- <outfit.json> <out.png> [title]
# Renders a prepared figure (imported-body/out/outfit-*.json): front, 3/4, back side by side, flat-shaded facets.
import bpy, bmesh, sys, json, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
d = json.load(open(a[0], encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
COL = {'top': (0.55, 0.62, 0.78), 'inner': (0.93, 0.93, 0.93), 'bottom': (0.30, 0.33, 0.40), 'head': (0.86, 0.76, 0.68),
       'arm_left': (0.86, 0.76, 0.68), 'arm_right': (0.86, 0.76, 0.68), 'shoe_left': (0.18, 0.18, 0.2), 'shoe_right': (0.18, 0.18, 0.2)}
b = d['base']; idx = d['index']
verts = [(b[i], -b[i + 2], b[i + 1]) for i in range(0, len(b), 3)]  # y-up -> z-up, front faces -Y
faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
kind = ['top'] * len(verts)
for p in d.get('partsIndex', []):
    for v in p['vertices']: kind[v] = p['kind']
me = bpy.data.meshes.new('fig'); me.from_pydata(verts, [], faces); me.update()
mats = {}
for k, c in COL.items():
    m = bpy.data.materials.new(k); m.diffuse_color = (*c, 1); mats[k] = len(me.materials); me.materials.append(m)
for f in me.polygons:
    ks = [kind[v] for v in f.vertices]; f.material_index = mats.get(max(set(ks), key=ks.count), 0)
    f.use_smooth = False
H = max(v[2] for v in verts)
xs = [v[0] for v in verts]; W = max(xs) - min(xs)
gap = W * 0.15
for i, rot in enumerate([0, -40, 180]):
    o = bpy.data.objects.new(f'fig{i}', me); sc.collection.objects.link(o)
    o.rotation_euler = (0, 0, math.radians(rot)); o.location = (i * (W + gap), 0, 0)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'
totalW = 3 * W + 2 * gap
cam.data.ortho_scale = max(totalW, H * 3 / 2) * 1.04
cam.location = ((totalW - W) / 2, -10, H / 2); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_backface_culling = False
sh.show_cavity = True; sh.cavity_type = 'WORLD'
sc.display.render_aa = '16'
sc.render.resolution_x = 1500; sc.render.resolution_y = 1000
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.96, 0.96, 0.97)
sc.view_settings.view_transform = 'Standard'
if len(a) > 2 and a[2] == 'neck':
    for o in [x for x in sc.collection.objects if x.name.startswith('fig')]:
        o.location.x = [0, 0.5, 1.0][int(o.name[3])]
    cam.data.ortho_scale = 1.6; cam.location = (0.5, -10, H * 0.84)
    sc.render.resolution_x = 1500; sc.render.resolution_y = 700
sc.render.filepath = a[1]
bpy.ops.render.render(write_still=True)
