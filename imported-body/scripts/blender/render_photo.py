# blender -b -P render_photo.py -- <map.json> <out.png> [photo.jpg] : figure with the photo print, front + 3/4 (+ the photo)
import bpy, bmesh, sys, json, math
a = sys.argv[sys.argv.index('--') + 1:]
d = json.load(open(a[0], encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
b = d['base']; idx = d['index']; part = d['part']
verts = [(b[i], -b[i + 2], b[i + 1]) for i in range(0, len(b), 3)]
faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
me = bpy.data.meshes.new('fig'); me.from_pydata(verts, [], faces); me.update()
hx = d['baseColor'].lstrip('#'); base = tuple(int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4))
lin = lambda c: tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)
def mat(name, col, img=None):
    m = bpy.data.materials.new(name); m.diffuse_color = (*col, 1); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Base Color'].default_value = (*lin(col), 1)
    if img:
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(img); t.interpolation = 'Linear'
        m.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    me.materials.append(m); return len(me.materials) - 1
skin = mat('skin', (0.86, 0.76, 0.68)); shoe = mat('shoe', (0.18, 0.18, 0.2)); inner = mat('inner', (0.93, 0.93, 0.93))
pants = mat('pants', (0.30, 0.33, 0.40)); top = mat('top', (0.55, 0.62, 0.78))
garment = mat('garment', base); photo = mat('photo', base, d['texture'])
pants_cat = d['category'] == 'pants'
code_mat = {0: skin, 1: skin, 2: top, 3: pants, 4: shoe, 5: inner}
gcode = 3 if pants_cat else 2
uvl = me.uv_layers.new(name='UV')
for f in me.polygons:
    ks = [part[v] for v in f.vertices]; k = max(set(ks), key=ks.count)
    f.material_index = garment if k == gcode else code_mat.get(k, skin); f.use_smooth = False
for j, t in enumerate(d['photoTriangles']):
    f = me.polygons[t]; f.material_index = photo
    for c, li in enumerate(f.loop_indices):
        uvl.data[li].uv = (d['uv'][j * 6 + c * 2], d['uv'][j * 6 + c * 2 + 1])
H = max(v[2] for v in verts)
for i, rot in enumerate([0, -35]):
    o = bpy.data.objects.new(f'fig{i}', me); sc.collection.objects.link(o)
    o.rotation_euler = (0, 0, math.radians(rot)); o.location = (i * 1.25, 0, 0)
if len(a) > 2:  # the source photo on a card beside the figures
    img = bpy.data.images.load(a[2]); w, h = img.size; s = H * 0.55
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-1.25, 0.3, H * 0.62), rotation=(math.pi / 2, 0, 0))
    card = bpy.context.object; card.scale = (s * w / h, s, 1)
    m = bpy.data.materials.new('card'); m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    card.data.materials.append(m)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 3.9 if len(a) > 2 else 3.0
cam.location = (0.0 if len(a) > 2 else 0.62, -10, H * 0.56); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_backface_culling = False
sc.display.render_aa = '16'
sc.render.resolution_x = 1600; sc.render.resolution_y = 1000
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.96, 0.96, 0.97)
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = a[1]
bpy.ops.render.render(write_still=True)
