import bpy
import json
import math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

base = Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(base / 'assets/models/villa.blend'))
scene = bpy.context.scene
roof = bpy.data.objects['Main_and_front_wing_CONNECTED_ROOF']
assert scene['layout_version'] == 4
assert abs(scene['estimated_eave_m'] - .25) < 1e-8
assert not any(o.get('siteId') == 'vegetable-side' for o in bpy.data.objects)
assert all(any(o.get('siteId') == name for o in bpy.data.objects) for name in ['garage', 'storage', 'side-cover', 'garden-border', 'vegetable-front'])

adjacency = {i: set() for i in range(len(roof.data.vertices))}
for edge in roof.data.edges:
    a, b = edge.vertices
    adjacency[a].add(b); adjacency[b].add(a)
seen, pending = set(), [0]
while pending:
    current = pending.pop()
    if current not in seen:
        seen.add(current); pending.extend(adjacency[current] - seen)
assert len(seen) == len(adjacency), 'Main roof and small gable must be connected'
ridge = [vertex.co for vertex in roof.data.vertices if abs(vertex.co.x - 5.4) < 1e-4 and .0001 >= vertex.co.y >= -2.701]
assert len(ridge) == 2 and abs(ridge[0].z - ridge[1].z) < 1e-6, 'Small gable ridge must be level'
side_wall = bpy.data.objects['Wing_inner_junction_wall']
assert max(vertex.co.z for vertex in side_wall.data.vertices) < 3.6, 'Side wall must not protrude through the small roof'
for polygon in roof.data.polygons:
    points = [roof.data.vertices[i].co for i in polygon.vertices]
    if len(points) < 4:
        continue
    normal = (points[1] - points[0]).cross(points[2] - points[0]).normalized()
    assert all(abs(normal.dot(p - points[0])) < 1e-6 for p in points[3:]), 'Roof face must not be warped'

def top(name):
    obj = bpy.data.objects[name]
    return max((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)
spec=json.loads((base / 'public/assets/site.json').read_text())
bed=next(o for o in spec['objects'] if o['id']=='flowerbed')
porch=next(o for o in spec['objects'] if o['id']=='deck-left')
for name,x in [('Upper_pair_frame',spec['roof']['ridgeX']),('Large_garden_window_frame',bed['x']),('Green_retractable_awning',bed['x']),('Awning_valance',bed['x'])]:
    assert abs(bpy.data.objects[name].matrix_world.translation.x-x)<1e-5, f'{name} must align with its reference center'
small=bpy.data.objects['Upper_narrow_frame'];divider=bpy.data.objects['Upper_narrow_mullion']
assert small.dimensions.x<.7 and small.dimensions.z<1.2
assert divider.dimensions.x>divider.dimensions.z*6, 'Small upper window must be split top/bottom'
assert abs(divider.matrix_world.translation.z-small.matrix_world.translation.z)<1e-5
assert len([o for o in bpy.data.objects if o.name.startswith('Large_garden_window_mullion_')])==2
assert abs(bpy.data.objects['Large_garden_window_frame'].dimensions.x-bed['w'])<1e-5
porch_roofs=[o for o in bpy.data.objects if o.name.startswith('Porch_translucent_roof')]
assert len(porch_roofs)==2
porch_vertices=[o.matrix_world @ p.co for o in porch_roofs for p in o.data.vertices]
assert abs(max(p.x for p in porch_vertices)-min(p.x for p in porch_vertices)-porch['coverWidth'])<1e-5
assert abs(max(p.z for p in porch_vertices)-porch['coverRidgeHeight'])<1e-5
assert 'Porch_front_timber_gable' in bpy.data.objects
deck=next(o for o in spec['objects'] if o['id']=='deck-right')
steps=next(o for o in spec['objects'] if o['id']=='steps-right')
rail=deck['railing'];opening_left=steps['x']-steps['w']/2;opening_right=steps['x']+steps['w']/2
rail_posts=[o for o in bpy.data.objects if o.name.startswith('Right_rail_post')]
assert len(rail_posts)==len(rail['posts'])
for px,pz in rail['posts']:
    assert any(abs(o.matrix_world.translation.x-px)<1e-5 and abs(o.matrix_world.translation.y+pz)<1e-5 for o in rail_posts)
assert len([o for o in bpy.data.objects if o.name.startswith('Right_rail_horizontal_board')])==9
assert len([o for o in bpy.data.objects if o.name.startswith('Right_rail_top_cap')])==3
for obj in bpy.data.objects:
    if not obj.name.startswith('Right_rail_'):continue
    xs=[(obj.matrix_world @ Vector(corner)).x for corner in obj.bound_box]
    assert max(xs)<=opening_left+1e-5 or min(xs)>=opening_right-1e-5, 'Right rail must not block the stair opening'
    assert obj.get('siteId')=='deck-right'
assert len([o for o in bpy.data.objects if o.name.startswith('Right_stair_riser_')])==steps['treadCount']
assert len([o for o in bpy.data.objects if o.name.startswith('Right_stair_tread_')])==steps['treadCount']*2
for i in range(steps['treadCount']):
    expected=steps['h']*(steps['treadCount']-i)/(steps['treadCount']+1)
    assert abs(top(f'Right_stair_tread_{i+1}_1')-expected)<1e-5
    assert expected<deck['h'], 'First tread must be below the deck, not an extra landing'
assert not any(o.name.startswith('Right_deck_rail') for o in bpy.data.objects)
depsgraph=bpy.context.evaluated_depsgraph_get()
evaluated=roof.evaluated_get(depsgraph)
roof_tree=BVHTree.FromPolygons([evaluated.matrix_world @ p.co for p in evaluated.data.vertices],[list(p.vertices) for p in evaluated.data.polygons])
assert abs(roof.location.z-spec['roof']['renderLift'])<1e-8
clearances=[]
for name in ['Garden_gable','Gable_above_small_roof','Rear_gable','Front_wing_gable','Wing_inner_junction_wall']:
    obj=bpy.data.objects[name].evaluated_get(depsgraph)
    for vertex in obj.data.vertices:
        p=obj.matrix_world @ vertex.co
        hit,normal,index,distance=roof_tree.ray_cast(Vector((p.x,p.y,0)),Vector((0,0,1)),20)
        assert hit is not None, f'{name} must remain below the roof footprint'
        gap=hit.z-p.z
        assert gap>.02, f'{name} intersects roof thickness: {gap}'
        clearances.append(gap)
gate_posts=[o for o in bpy.data.objects if o.name.startswith('Garden_entry_gate_post')]
assert len(gate_posts)==2
for px,pz in spec['entryGate']['endpoints']:
    assert any(abs(o.matrix_world.translation.x-px)<1e-5 and abs(o.matrix_world.translation.y+pz)<1e-5 for o in gate_posts)
assert not any(o.name.startswith('Driveway_gate') for o in bpy.data.objects)
entry=next(o for o in spec['objects'] if o['id']=='entry')
front=entry['z']+entry['d']/2
wall=bpy.data.objects['Retaining_following_boundary']
assert all(-(wall.matrix_world @ vertex.co).y>=front-1e-5 for vertex in wall.data.vertices)
ground=bpy.data.objects['Raised_site_ground']
assert len(ground.data.vertices)==len(spec['terrain']['outline'])*2, 'Ground must follow the traced polygon, not a rectangular box'
assert 'Retaining_following_boundary' in bpy.data.objects and 'Road_following_boundary' in bpy.data.objects
assert 'Retaining_core' not in bpy.data.objects and 'Road_along_property' not in bpy.data.objects
assert abs(top('Road_following_boundary')-spec['road']['height'])<1e-5
for px,pz in spec['terrain']['outline']:
    assert any(abs(v.co.x-px)<1e-4 and abs(v.co.y+pz)<1e-4 and abs(v.co.z)<1e-5 for v in ground.data.vertices)
border=next(o for o in spec['objects'] if o['id']=='garden-border')
soil=[o for o in bpy.data.objects if o.name.startswith('Flower_soil_')]
assert {o.name for o in soil} == {'Flower_soil_house_side','Flower_soil_right_side'}, 'Only house-side and right-side flower bands are allowed'
assert all(abs(top(o.name)-top('Ground_vegetable-front')) < 1e-5 for o in soil), 'Flower border and soil must be at the same level'
angle=math.radians(border['rotation'])
for obj in bpy.data.objects:
    if obj.type!='MESH' or obj.get('siteId')!='garden-border':
        continue
    center=obj.matrix_world.translation
    dx,dz=center.x-border['x'],-center.y-border['z']
    local_x=dx*math.cos(angle)+dz*math.sin(angle)
    local_z=-dx*math.sin(angle)+dz*math.cos(angle)
    assert local_z <= -border['d']/2+border['bandWidth']+.01 or local_x >= border['w']/2-border['bandWidth']-.01, 'Flower objects must not wrap around the front or left'
assert not any(o.type == 'EMPTY' and o.empty_display_type == 'IMAGE' for o in bpy.data.objects)
assert not any('Reference' in c.name for c in bpy.data.collections)
assert len(bpy.data.images) == 2, 'Only the two procedural texture images may be packed'
assert all(image.packed_file for image in bpy.data.images)
assert all(not space.params.directory or space.params.directory.startswith(b'//')
    for screen in bpy.data.screens for area in screen.areas for space in area.spaces
    if space.type == 'FILE_BROWSER' and space.params), 'Editor file browser must not retain a home directory'
report = {'blendOpened': True, 'connectedRoof': True, 'planarRoofFaces': True, 'levelSmallGableRidge': True, 'roofWallMinClearanceM': min(clearances), 'alignedFacadeWindows': True, 'stackedSmallWindow': True, 'expandedPorchRoof': True, 'rightStairThreeTreads': True, 'rightRailOpeningClear': True, 'gateAtLawnEntrance': True, 'retainingStopsBeforeEntry': True, 'sameHeightGardenZones': True, 'lShapedFlowerBorder': True, 'tracedGroundAndRetainingWall': True, 'excludedNeighborPlot': True, 'editableMeshObjects': len([o for o in bpy.data.objects if o.type == 'MESH']), 'packedImages': len([i for i in bpy.data.images if i.packed_file])}
(base / 'assets/models/verification.json').write_text(json.dumps(report, indent=2))
print('VILLA_VERIFIED', json.dumps(report))
