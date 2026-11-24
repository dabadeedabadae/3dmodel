# blender -b -P decimate.py -- <in.fbx> <out.fbx> <ratio> : collapse decimation with X symmetry, borders kept
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=a[0])
o = [x for x in bpy.context.scene.objects if x.type == 'MESH'][0]
for x in bpy.context.scene.objects: x.select_set(x == o)
bpy.context.view_layer.objects.active = o
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
m = o.modifiers.new('d', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = float(a[2])
m.use_symmetry = True; m.symmetry_axis = 'X'; m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='d')
for p in o.data.polygons: p.use_smooth = False
print('DECIMATED', len(o.data.polygons))
bpy.ops.export_scene.fbx(filepath=a[1], use_selection=True, object_types={'MESH'}, axis_forward='-Z', axis_up='Y', mesh_smooth_type='FACE', add_leaf_bones=False, bake_anim=False)
