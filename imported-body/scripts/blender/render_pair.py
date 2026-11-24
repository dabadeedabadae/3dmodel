# blender -b -P render_pair.py -- <before.fbx> <after.fbx> <out.png> : front + back of each, broken faces red
import bpy, bmesh, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
grey = bpy.data.materials.new('g'); grey.diffuse_color = (0.80, 0.80, 0.82, 1)
red = bpy.data.materials.new('r'); red.diffuse_color = (1, 0.08, 0.08, 1)
meshes = []
for path in a[:2]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    ms = [o for o in new if o.type == 'MESH']
    bm = bmesh.new()
    for o in ms:
        t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
        m = bpy.data.meshes.new('t'); t.to_mesh(m); t.free(); bm.from_mesh(m)
    for o in new: bpy.data.objects.remove(o)
    H = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=H * 1e-5)
    for f in bm.faces:
        f.smooth = False
        f.material_index = 1 if any(len(e.link_faces) > 2 or (len(e.link_faces) == 2 and not e.is_contiguous) for e in f.edges) else 0
    mn = Vector([min(v.co[i] for v in bm.verts) for i in range(3)]); mx = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    c = (mn + mx) / 2
    for v in bm.verts: v.co = (v.co - c) / H
    me = bpy.data.meshes.new('m'); bm.to_mesh(me); bm.free()
    me.materials.append(grey); me.materials.append(red)
    meshes.append(me)
step = 1.08
xs = []
for k, me in enumerate(meshes):
    for j, rot in enumerate([0, 180]):
        o = bpy.data.objects.new(f'o{k}{j}', me); sc.collection.objects.link(o)
        o.rotation_euler = (0, 0, math.radians(rot)); o.location = ((k * 2 + j) * step, 0, 0); xs.append(o.location.x)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 4 * step
cam.location = ((xs[0] + xs[-1]) / 2, -10, 0); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_backface_culling = False
sh.show_cavity = True; sh.cavity_type = 'WORLD'
sc.display.render_aa = '16'
sc.render.resolution_x = 1800; sc.render.resolution_y = 560
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.96, 0.96, 0.97)
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = a[2]
bpy.ops.render.render(write_still=True)
