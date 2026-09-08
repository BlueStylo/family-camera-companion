"""Build an editable villa study in Blender, then export its web copy.

Coordinates in the shared spec are (x, plan-z, height). Blender uses
(x, -plan-z, height), which exports to glTF (x, height, plan-z).
"""
import bpy
import json
import math
import random
import shutil
import subprocess
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parent.parent
SPEC = json.loads((BASE / 'public/assets/site.json').read_text())
OUT = BASE / 'assets/models'
WEB = BASE / 'public/assets'
OUT.mkdir(parents=True, exist_ok=True)
WEB.mkdir(parents=True, exist_ok=True)
random.seed(24)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene['status'] = SPEC['status']
scene['estimated_eave_m'] = SPEC['eave']
scene['layout_version'] = SPEC['version']

root = bpy.data.objects.new('Villa_Blender_v4', None)
scene.collection.objects.link(root)
root['layoutVersion'] = SPEC['version']
root['source'] = 'Blender editable model; user roof-outline reference'
root['status'] = SPEC['status']
root['estimatedEaveM'] = SPEC['eave']
groups = {}
for name, title in [('structure', '01_Buildings_Decks_Ground'), ('roofs', '02_Connected_Roofs'), ('plants', '03_Planting')]:
    collection = bpy.data.collections.new(title)
    scene.collection.children.link(collection)
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.parent = root
    groups[name] = (collection, obj)
owners = {}

def v(x, z, y):
    return Vector((x, -z, y))

def place(obj, name, zone, layer='structure'):
    obj.name = name
    collection, parent = groups[layer]
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
    key = (layer, zone)
    if key not in owners:
        owner = bpy.data.objects.new(f'{layer}_{zone}', None)
        collection.objects.link(owner)
        owner.parent = parent
        owner['siteId'] = zone
        owners[key] = owner
    obj.parent = owners[key]
    obj['siteId'] = zone
    obj['layer'] = layer
    return obj

def rgb(code):
    channels = [int(code[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels)

def material(name, color, rough=.8, metal=0, alpha=1):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb(color), alpha)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Alpha'].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = 'DITHERED'
    return mat

mats = {
    'brick': material('01_Red_brick', '#b78065'),
    'wood': material('02_Timber', '#895b42', .67),
    'roof': material('03_Shingle', '#635957', .9),
    'stone': material('04_Stone', '#a0a49b'),
    'soil': material('05_Soil', '#7d735e'),
    'grass': material('06_Lawn', '#a9bb8e'),
    'frame': material('07_Dark_window_frames', '#414a4c', .4, .15),
    'glass': material('08_Window_glass', '#6a929b', .23, .25),
    'white': material('09_White_trim', '#e1e4dd', .6),
    'clear': material('10_Clear_roof_panels', '#b9d1d1', .25, .05, .48),
    'leaf': material('11_Pine_deep', '#547449'),
    'leafLight': material('12_Pine_light', '#829b61'),
    'trunk': material('13_Tree_bark', '#716554'),
    'jar': material('14_Onggi_glaze', '#574134', .32),
    'paving': material('15_Paving', '#c6cdc6'),
    'awning': material('16_Green_awning', '#337f78'),
    'flower': material('17_Pink_blossom', '#c781a3'),
    'yellow': material('18_Yellow_blossom', '#e1c862'),
    'net': material('19_Garden_mesh', '#5e9c89', .7, 0, .26),
    'base': material('20_Ground_edge', '#bdc6b2')
}

def create_texture(kind, width=512, height=512):
    image = bpy.data.images.new(kind + '_UV', width=width, height=height)
    pixels = [0.0] * (width * height * 4)
    for y in range(height):
        for x in range(width):
            if kind == 'brick':
                row = y // 32
                mortar = y % 32 < 2 or (x + (row % 2) * 32) % 64 < 2
                salt = ((x // 64) * 13 + row * 7) % 9 / 90
                base = (.71 + salt, .46 + salt, .32 + salt) if not mortar else (.78, .75, .68)
            else:
                row = y // 32
                seam = y % 32 < 2 or (x + (row % 2) * 32) % 64 < 1
                shade = ((x // 64) * 3 + row) % 5 * .012
                base = (.34 + shade, .31 + shade, .30 + shade) if not seam else (.24, .23, .22)
            noise = ((x * 17 + y * 31) % 13 - 6) / 500
            i = (y * width + x) * 4
            pixels[i:i+4] = [max(0, min(1, c + noise)) for c in base] + [1]
    image.pixels.foreach_set(pixels)
    image.pack()
    mat = mats[kind]
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    mat.node_tree.links.new(node.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return image

create_texture('brick')
create_texture('roof')

def finish(obj, mat, zone, name, layer='structure', bevel=0):
    place(obj, name, zone, layer)
    obj.data.materials.append(mats[mat])
    if bevel:
        modifier = obj.modifiers.new('Editable_edge_bevel', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
    return obj

def box(name, x, z, y, w, d, h, mat, zone, layer='structure', bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=v(x, z, y))
    obj = bpy.context.object
    obj.scale = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, zone, name, layer, bevel)

def mesh(name, points, faces, mat, zone, layer='structure', solid=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v(*p)) for p in points], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    groups[layer][0].objects.link(obj)
    finish(obj, mat, zone, name, layer)
    if solid:
        mod = obj.modifiers.new('Editable_roof_thickness', 'SOLIDIFY')
        mod.thickness = solid
        mod.offset = -1
    return obj

def polygon_slab(name, outline, bottom, top, mat, zone):
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outline,outline[1:]+outline[:1]))
    outline=outline if area>0 else list(reversed(outline))
    count=len(outline)
    points=[(x,z,y) for y in [bottom,top] for x,z in outline]
    faces=[tuple(range(count)),tuple(range(2*count-1,count-1,-1))]
    faces += [(i,i+count,(i+1)%count+count,(i+1)%count) for i in range(count)]
    return mesh(name,points,faces,mat,zone)

def beam(name, a, b, size, mat, zone, layer='structure'):
    start, end = v(*a), v(*b)
    obj = box(name, 0, 0, 0, size, size, (end-start).length, mat, zone, layer, .007)
    obj.location = (start+end)/2
    obj.rotation_euler = (end-start).to_track_quat('Z', 'Y').to_euler()
    return obj

def cylinder(name, x, z, y, r1, r2, height, mat, zone, layer='structure', vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=height, location=v(x, z, y))
    return finish(bpy.context.object, mat, zone, name, layer)

def stone(name, x, z, y, scale, zone, layer='structure', mat='stone'):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=v(x,z,y))
    obj = bpy.context.object
    obj.scale = scale
    obj.rotation_euler.z = random.random()*3
    return finish(obj, mat, zone, name, layer)

def rectangle_border(o, y, size=.22):
    x,z,w,d=o['x'],o['z'],o['w'],o['d']
    for side in [-1,1]:
        for i in range(math.ceil(w/.45)):
            stone('Basalt_border',x-w/2+(i+.5)*w/math.ceil(w/.45),z+side*d/2,y,(size,size*.8,size*.6),o['id'])
        for i in range(math.ceil(d/.45)):
            stone('Basalt_border',x+side*w/2,z-d/2+(i+.5)*d/math.ceil(d/.45),y,(size,size*.8,size*.6),o['id'])

def window(name,x,z,y,w,h,zone,side=0,white=False,division='vertical',divisions=(.5,)):
    angle=math.radians(side)
    def part(suffix,dx,dy,dz,pw,pd,ph,mat):
        obj=box(name+suffix,x+dx*math.cos(angle)+dz*math.sin(angle),z-dx*math.sin(angle)+dz*math.cos(angle),y+dy,pw,pd,ph,mat,zone,bevel=.008)
        obj.rotation_euler.z=angle
    frame='white' if white else 'frame'
    part('_frame',0,0,0,w,.12,h,frame)
    part('_glass',0,0,.08,w-.14,.05,h-.14,'glass')
    for i,fraction in enumerate(divisions):
        suffix='_mullion' if len(divisions)==1 else '_mullion_'+str(i+1)
        if division=='horizontal':part(suffix,0,h*(.5-fraction),.13,w-.14,.045,.045,frame)
        else:part(suffix,w*(fraction-.5),0,.13,.045,.045,h,frame)

def roof_height(x):
    roof=SPEC['roof']
    return roof['ridgeHeight']-(roof['ridgeHeight']-roof['eaveHeight'])*abs(x-roof['ridgeX'])/7.35

def front_height(x):
    ridge=roof_height(5.4)
    return ridge-(ridge-SPEC['roof']['eaveHeight'])*abs(x-5.4)/2.1

def joined_height(x,z):
    return front_height(x)

def profile_wall(name, xs, z, bottom, height_func, zone, depth=.12):
    profile=[(xs[0],bottom),(xs[-1],bottom)]+[(x,height_func(x)) for x in reversed(xs)]
    count=len(profile)
    points=[(x,z+dz,y) for dz in [-depth/2,depth/2] for x,y in profile]
    faces=[tuple(range(count-1,-1,-1)),tuple(range(count,2*count))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return mesh(name,points,faces,'brick',zone)

by_id={o['id']:o for o in SPEC['objects']}
polygon_slab('Raised_site_ground',SPEC['terrain']['outline'],-SPEC['terrain']['depth'],0,'base','context')
road=SPEC['road']
polygon_slab('Road_following_boundary',road['outline'],road['height']-.1,road['height'],'paving','context')

for o in SPEC['objects']:
    x,z,w,d,h,zone=o['x'],o['z'],o['w'],o['d'],o['h'],o['id']
    kind=o['type']
    start_objects=set(bpy.data.objects)
    if kind in ['house','wing']:
        wall=o['wall']
        wall_top=3.3 if kind=='house' else 3.12
        box('Foundation_'+zone,wall['x'],wall['z'],.25,wall['w'],wall['d'],.5,'stone',zone)
        box('Walls_'+zone,wall['x'],wall['z'],(.5+wall_top)/2,wall['w'],wall['d'],wall_top-.5,'brick',zone,bevel=0)
    elif kind=='bbq':
        box('BBQ_wood_base',x,z,.35,w-.16,d-.16,.7,'wood',zone)
        box('BBQ_enclosure',x,z,1.63,w-.22,d-.22,1.92,'wood',zone)
        for dz in [-d/2+.75,-d/2+2.05,-d/2+3.35,-d/2+4.65]:
            window('BBQ_side_window',x+w/2-.065,z+dz,1.8,1.16,1.62,zone,90,True)
        window('BBQ_front_window',x,z+d/2-.065,1.8,w-.3,1.65,zone,0,True)
        box('BBQ_low_roof',x,z,2.89,w,d,.15,'roof',zone,'roofs')
    elif kind=='storage':
        box('Storage_foundation',x,z,.15,w-.2,d-.2,.3,'stone',zone)
        box('Storage_walls',x,z,1.35,w-.3,d-.3,2.4,'wood',zone)
        window('Storage_door',x,z+d/2-.14,1.25,1.3,2.1,zone)
        box('Storage_roof',x,z,h,w,d,.12,'roof',zone,'roofs')
    elif kind in ['garage','side-cover']:
        box('Paved_floor_'+zone,x,z,.08,w,d,.16,'paving',zone)
        for dx in [-w/2+.12,w/2-.12]:
            for dz in [-d/2+.12,d/2-.12]:
                box('Post_'+zone,x+dx,z+dz,h/2,.14,.14,h,'wood',zone)
        panel=box('Roof_'+zone,x,z,h,w,d,.09,'clear' if kind=='side-cover' else 'roof',zone,'roofs')
        panel.rotation_euler.y=-.035
        for i in range(6):
            dz=-d/2+i*d/5
            beam('Rafter_'+zone,(x-w/2,z+dz,h-.04),(x+w/2,z+dz,h+.04),.085,'wood',zone,'roofs')
    elif kind in ['pergola','deck','deck-railed','steps']:
        if kind=='steps':
            if o.get('treadCount'):
                count=o['treadCount'];run=d/count;thickness=o['treadThickness']
                for i in range(count):
                    sh=h*(count-i)/(count+1);pz=z-d/2+(i+.5)*run
                    box('Right_stair_riser_'+str(i+1),x,pz,(sh-thickness)/2,w,run,sh-thickness,'wood',zone,bevel=.004)
                    for board in range(2):
                        box(f'Right_stair_tread_{i+1}_{board+1}',x,pz-run/4+board*run/2,sh-thickness/2,w,run/2-.006,thickness,'wood',zone,bevel=.003)
                    box('Right_stair_nosing_'+str(i+1),x,pz+run/2,sh-thickness/2,w+2*o['nosing'],2*o['nosing'],thickness,'wood',zone,bevel=.004)
            else:
                for i in range(4):
                    sh=h*(4-i)/4
                    box('Step_'+str(i+1),x,z-d/2+(i+.5)*d/4,sh/2,w,d/4,sh,'wood',zone)
        else:
            box('Deck_frame',x,z,(h-.12)/2,w,d,h-.12,'wood',zone)
            boards=math.ceil(d/.16)
            for i in range(boards):
                box('Deck_board',x,z-d/2+(i+.5)*d/boards,h-.06,w,d/boards-.008,.12,'wood',zone,bevel=.004)
        if kind=='pergola':
            cw=o['coverWidth'];cx=x-w/2+cw/2;back=z-d/2;front=z+d/2
            eave=o['coverEaveHeight'];ridge=o['coverRidgeHeight']
            for dx in [-cw/2+.08,cw/2-.08]:
                for dz in [-d/2+.08,d/2-.08]:box('Porch_post',cx+dx,z+dz,(h+eave)/2,.16,.16,eave-h,'wood',zone)
            for side in [-1,1]:
                pts=[(cx,back,ridge),(cx,front,ridge),(cx+side*cw/2,front,eave),(cx+side*cw/2,back,eave)]
                mesh('Porch_translucent_roof',pts,[(0,1,2,3)],'clear',zone,'roofs',.055)
            for i in range(5):
                dz=back+i*d/4
                for side in [-1,1]:beam('Porch_roof_frame',(cx+side*cw/2,dz,eave),(cx,dz,ridge),.12,'wood',zone,'roofs')
            if o['coverGablePanel']:
                mesh('Porch_front_timber_gable',[(cx-cw/2,front,eave-.11),(cx+cw/2,front,eave-.11),(cx,front,ridge-.11)],[(0,1,2)],'wood',zone,'roofs',.055)
                for i in range(1,math.ceil((ridge-eave)/.18)):
                    level=eave-.11+i*.18;span=cw*(ridge-.11-level)/(ridge-eave)
                    box('Porch_gable_board_joint',cx,front+.025,level,span,.022,.018,'frame',zone,'roofs',bevel=0)
            # Front rail leaves the photographed stair opening on the right.
            opening=by_id['steps-left']; left=x-w/2;right=x+w/2
            for a,bx in [(left,opening['x']-opening['w']/2),(opening['x']+opening['w']/2,right)]:
                if bx>a:
                    for y in [.92,1.22,1.52]:box('Porch_front_rail',(a+bx)/2,z+d/2,y,bx-a,.075,.105,'wood',zone)
                    for px in [a,bx]:box('Porch_rail_post',px,z+d/2,1.07,.13,.13,1.02,'wood',zone)
            for y in [.92,1.22,1.52]:box('Porch_side_rail',left,z,y,.075,d,.105,'wood',zone)
        if kind=='deck-railed':
            rail=o['railing']
            for px,pz in rail['posts']:
                box('Right_rail_post',px,pz,h+rail['height']/2,rail['postWidth'],rail['postWidth'],rail['height'],'wood',zone)
            for path in rail['paths']:
                for a,b in zip(path,path[1:]):
                    length=math.dist(a,b)+rail['postWidth'];angle=-math.atan2(b[1]-a[1],b[0]-a[0]);px=(a[0]+b[0])/2;pz=(a[1]+b[1])/2
                    for level in rail['boardLevels']:
                        board=box('Right_rail_horizontal_board',px,pz,h+level,length,rail['boardDepth'],rail['boardHeight'],'wood',zone,bevel=.004)
                        board.rotation_euler.z=angle
                    cap=box('Right_rail_top_cap',px,pz,h+rail['height'],length,rail['capDepth'],rail['capHeight'],'wood',zone,bevel=.005)
                    cap.rotation_euler.z=angle
    elif kind=='retaining':
        polygon_slab('Retaining_following_boundary',o['points'],-h,.02,'stone',zone)
        for a,b in zip(o['path'],o['path'][1:]):
            length=math.dist(a,b);dx=(b[0]-a[0])/length;dz=(b[1]-a[1])/length
            count=math.ceil(length/.72)
            for i in range(count):
                t=(i+.5)/count;px=a[0]+(b[0]-a[0])*t;pz=a[1]+(b[1]-a[1])*t
                for row in range(3):
                    rock=stone('Retaining_face_stone',px-dz*.10,pz+dx*.10,-h+(row+.5)*h/3,(length/count*.58,.23,h/5),zone)
                    rock.rotation_euler.z=-math.atan2(dz,dx)
                for across in [.28,.78]:
                    rock=stone('Retaining_cap_stone',px-dz*across,pz+dx*across,.035,(length/count*.5,.27,.09),zone)
                    rock.rotation_euler.z=-math.atan2(dz,dx)
    elif kind=='flower-l':
        width=o['bandWidth'];left=x-w/2;right=x+w/2;back=z-d/2;front=z+d/2
        box('Flower_soil_house_side',x,back+width/2,h/2,w,width,h,'soil',zone,bevel=0)
        box('Flower_soil_right_side',right-width/2,z+width/2,h/2,width,d-width,h,'soil',zone,bevel=0)
        # Only outline the two connected bands, leaving the left/front lawn open.
        outline=[(left,back),(right,back),(right,front),(right-width,front),(right-width,back+width),(left,back+width)]
        for a,b in zip(outline,outline[1:]+outline[:1]):
            count=math.ceil(math.dist(a,b)/.45)
            for i in range(count):
                t=(i+.5)/count
                stone('L_flower_border',a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,h+.03,(.18,.15,.11),zone)
        for side,length in [('house',w),('right',d-width)]:
            count=max(2,math.ceil(length/.65))
            for i in range(count):
                offset=(i+.5)*length/count
                px,pz=(left+offset,back+width/2) if side=='house' else (right-width/2,back+width+offset)
                cylinder('L_flower_stem',px,pz,h+.22,.018,.01,.4,'leaf',zone,'plants',6)
                stone('L_flower',px,pz,h+.44,(.14,.14,.10),zone,'plants',mat='flower' if i%3 else 'yellow')
    else:
        mat='grass' if kind=='lawn' else 'paving' if kind=='entry' else 'soil'
        if o.get('points'):polygon_slab('Ground_'+zone,o['points'],0,h,mat,zone)
        else:box('Ground_'+zone,x,z,h/2,w,d,h,mat,zone,bevel=0)
        if kind=='vegetable':
            for i in range(6):
                pz=z-d/2+.4+i*(d-.8)/5
                box('Cultivation_row',x,pz,h+.05,w-.4,.26,.1,'soil',zone)
            for side in [-1,1]:
                box('Garden_fence',x+side*w/2,z,h+.48,.02,d,.96,'net',zone,bevel=0)
                box('Garden_fence',x,z+side*d/2,h+.48,w,.02,.96,'net',zone,bevel=0)
                for i in range(8):cylinder('Garden_fence_post',x-w/2+i*w/7,z+side*d/2,h+.52,.025,.025,1.04,'frame',zone,vertices=6)
        elif kind=='jars':
            rectangle_border(o,h+.06)
            profile=[(.17,0),(.28,.1),(.35,.4),(.31,.64),(.24,.74),(.235,.8)]
            for row in range(4):
                for col in range(3):
                    px=x-.7+col*.7;pz=z-1.3+row*.87;size=.72+(row+col)%3*.14
                    pts=[]
                    for radius,py in profile:
                        for n in range(20):
                            angle=n*2*math.pi/20
                            pts.append((px+math.cos(angle)*radius*size,pz+math.sin(angle)*radius*size,h+py*size))
                    faces=[]
                    for r in range(len(profile)-1):
                        for n in range(20):faces.append((r*20+n,r*20+(n+1)%20,(r+1)*20+(n+1)%20,(r+1)*20+n))
                    obj=mesh('Onggi_jar',pts,faces,'jar',zone)
                    for poly in obj.data.polygons:poly.use_smooth=True
                    cylinder('Onggi_lid',px,pz,h+.82*size,.28*size,.26*size,.055,'jar',zone,vertices=20)
        elif kind=='flowerbed':rectangle_border(o,h+.04)
    if o.get('rotation'):
        from mathutils import Matrix
        bpy.context.view_layer.update()
        transform=Matrix.Translation(v(x,z,0)) @ Matrix.Rotation(-math.radians(o['rotation']),4,'Z') @ Matrix.Translation(-v(x,z,0))
        for obj in set(bpy.data.objects)-start_objects:
            if obj.type=='MESH':obj.matrix_world=transform @ obj.matrix_world

# One welded roof mesh, including the lower front projection.
roof_points=[];roof_faces=[];point_index={}
def roof_quad(points):
    face=[]
    for p in points:
        key=tuple(round(c,6) for c in p)
        if key not in point_index:point_index[key]=len(roof_points);roof_points.append(p)
        face.append(point_index[key])
    roof_faces.append(tuple(face))
xs=[-7.2,.15,3.3,5.4,7.5]
for a,b in zip(xs,xs[1:]):roof_quad([(a,-8.9,roof_height(a)),(a,0,roof_height(a)),(b,0,roof_height(b)),(b,-8.9,roof_height(b))])
for a,b in zip([3.3,5.4],[5.4,7.5]):
    # The small roof has two planar pitches and a level ridge. Its right
    # pitch continues the main pitch; its left pitch meets the gable wall.
    roof_quad([(a,0,front_height(a)),(a,2.7,front_height(a)),(b,2.7,front_height(b)),(b,0,front_height(b))])
joined=mesh('Main_and_front_wing_CONNECTED_ROOF',roof_points,roof_faces,'roof','house','roofs',SPEC['roof']['thickness'])
joined.location.z=SPEC['roof']['renderLift']
joined['render_lift_m']=SPEC['roof']['renderLift']
joined['eave_boundary_basis']='User marked eave ends, not walls'
joined['estimated_eave_m']=SPEC['eave']
profile_wall('Garden_gable',[-6.95,.15,3.55],-.25,3.3,roof_height,'house')
profile_wall('Gable_above_small_roof',[3.55,5.4],-.25,3.12,roof_height,'house')
profile_wall('Rear_gable',[-6.95,.15,7.25],-8.65,3.15,roof_height,'house')
profile_wall('Front_wing_gable',[3.55,5.4,7.25],2.45,3.12,lambda x:joined_height(x,2.45),'wing')
mesh('Wing_inner_junction_wall',[(3.55,-.25,3.1),(3.55,2.45,3.1),(3.55,2.45,front_height(3.55)),(3.55,-.25,front_height(3.55))],[(0,1,2,3)],'brick','wing',solid=.12)
facade=SPEC['facade'];bed=by_id['flowerbed'];large=facade['gardenWindow'];upper=facade['upperWindow'];small=facade['upperSmallWindow'];awning=facade['awning']
window('Large_garden_window',bed['x'],-.16,large['y'],bed['w'],large['h'],'house',divisions=large['divisions'])
window('Left_porch_window',-5.15,-.16,1.8,1.6,1.6,'house')
window('Upper_pair',SPEC['roof']['ridgeX'],-.15,upper['y'],upper['w'],upper['h'],'house')
window('Upper_narrow',small['x'],-.15,small['y'],small['w'],small['h'],'house',division=small['division'])
window('Front_wing_window',5.4,2.55,1.78,2.15,1.5,'wing')
window('Wing_inner_door',3.49,1.15,1.62,1.55,2.08,'wing',-90)
window('Rear_entry_door',-.7,-8.75,1.55,1.05,2.1,'house',180)
window('Rear_left_window',-4.2,-8.75,2,1.3,1,'house',180)
window('Rear_right_window',4.7,-8.75,2,1.3,1.1,'wing',180)
window('Rear_upper_window',.1,-8.76,4.9,.9,1.15,'house',180)
shade=box('Green_retractable_awning',bed['x'],.38,awning['y'],bed['w']+2*awning['overhang'],awning['d'],.10,'awning','house','roofs')
shade.rotation_euler.x=.08
box('Awning_valance',bed['x'],.38+awning['d']/2,awning['y']-.09,bed['w']+2*awning['overhang'],.06,.17,'awning','house','roofs')
box('Rear_door_canopy',-.7,-9.15,2.8,1.65,.8,.12,'roof','house','roofs')

for i in range(18):stone('Garden_stepping_stone',-9+i*1.2,4.9+.25*math.sin(i*.2),.06,(.43,.30,.06),'lawn')
gate=SPEC['entryGate'];a,b=gate['endpoints'];gate_width=math.dist(a,b)
for px,pz in [a,b]:
    box('Garden_entry_gate_post',px,pz,gate['height']/2,.18,.18,gate['height'],'wood','entry')
    cylinder('Garden_entry_gate_lamp',px,pz,gate['height']+.12,.16,.11,.23,'white','entry')
for y in [.48,1.23]:beam('Garden_entry_gate_rail',(a[0],a[1],y),(b[0],b[1],y),.10,'wood','entry')
panels=max(1,round(gate_width))
for i in range(panels):
    t=i/panels;end=(i+.8)/panels
    beam('Garden_entry_gate_diagonal',(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.48),(a[0]+(b[0]-a[0])*end,a[1]+(b[1]-a[1])*end,1.23),.075,'wood','entry')

for t in SPEC['trees']:
    x,z,size,zone=t['x'],t['z'],t['size'],t['zone']
    cylinder('Tree_trunk',x,z,size*.48,size*.075,size*.04,size*.96,'trunk',zone,'plants')
    for branch in range(5):
        angle=branch*2.4;radius=size*(.23+(branch%2)*.11);top=size*(.85+(branch%3)*.16)
        bx=x+math.cos(angle)*radius;bz=z+math.sin(angle)*radius
        beam('Tree_branch',(x,z,size*.48),(bx,bz,top),size*.045,'trunk',zone,'plants')
        for n in range(4):
            a=n*2.1;cx=bx+math.cos(a)*size*.18;cz=bz+math.sin(a)*size*.18
            stone('Blossom' if t['type']=='flower' else 'Pine_foliage',cx,cz,top+size*.09,(size*.30,size*.28,size*(.25 if t['type']=='flower' else .15)),zone,'plants',mat='flower' if t['type']=='flower' else 'leaf' if n%2 else 'leafLight')

# World-aligned UVs keep brick and shingle scales consistent across components.
bpy.context.view_layer.update()
for obj in list(bpy.data.objects):
    if obj.type!='MESH' or not obj.data.materials:continue
    mat=obj.data.materials[0]
    if mat not in [mats['brick'],mats['roof']]:continue
    uv=obj.data.uv_layers.new(name='Architectural_scale_UV') if not obj.data.uv_layers else obj.data.uv_layers[0]
    for poly in obj.data.polygons:
        normal=obj.matrix_world.to_3x3() @ poly.normal
        for loop_index in poly.loop_indices:
            co=obj.matrix_world @ obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            if mat==mats['brick']:uv.data[loop_index].uv=((co.y if abs(normal.x)>.5 else co.x)/2.1,co.z/1.18)
            else:uv.data[loop_index].uv=(co.x/2.7,co.y/2.7)

# Public builds contain procedural textures only, never source photographs.

world=bpy.data.worlds.new('Neutral_studio_world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.78,.76,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.8;scene.world=world
lights=bpy.data.collections.new('91_Render_Lights_Cameras');scene.collection.children.link(lights)
def light(name,location,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);lights.objects.link(obj);obj.location=location;obj.rotation_euler=(Vector((0,-4,0))-obj.location).to_track_quat('-Z','Y').to_euler()
light('Large_soft_key',(-12,-12,28),2300,12)
light('Soft_fill',(18,4,15),1500,10)
sun_data=bpy.data.lights.new('Sun','SUN');sun_data.energy=2;sun_data.angle=.15
sun=bpy.data.objects.new('Sun',sun_data);lights.objects.link(sun);sun.rotation_euler=(.4,-.6,-.7)
camera_data=bpy.data.cameras.new('Overview_camera');cam=bpy.data.objects.new('Overview_camera',camera_data);lights.objects.link(cam)
cam.location=(27,-34,26);target=Vector((1,-4.5,1));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=43
scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False
for prop in scene.render.bl_rna.properties:
    if prop.identifier.startswith('use_stamp'):
        setattr(scene.render, prop.identifier, False)
bpy.context.preferences.filepaths.save_version = 0
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type == 'FILE_BROWSER' and space.params:
                space.params.directory = b'//'
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=37
            area.spaces.active.region_3d.view_location=(1,-3,1)
            area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
            area.spaces.active.shading.type='MATERIAL'

text=bpy.data.texts.new('README_model_basis')
text.write('Photo-based editable villa study.\n'+SPEC['status']+'\n'+SPEC['eaveStatus']+'\nThe adjacent plot behind the jars is excluded.\nSeparate structure, roof and planting collections. Roof is one welded mesh.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'villa.blend'), compress=False)

# Keep editable parts in .blend; merge only the temporary export scene.
for owner in list(owners.values()):
    buckets={}
    for obj in list(owner.children):
        if obj.type=='MESH':buckets.setdefault(obj.data.materials[0].name,[]).append(obj)
    for objects in buckets.values():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        for obj in objects:
            bpy.context.view_layer.objects.active=obj
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        bpy.context.object['siteId']=owner['siteId']
bpy.ops.object.select_all(action='DESELECT')
def select_tree(obj):
    obj.select_set(True)
    for child in obj.children:select_tree(child)
select_tree(root)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(WEB/'villa.glb'),export_format='GLB',use_selection=True,export_extras=True,export_apply=True,export_yup=True,export_animations=False)
report={'layoutVersion':SPEC['version'],'source':'Blender 5.2 editable build','eaveM':SPEC['eave'],'roofOutline':SPEC['roofOutline'],'wallOutline':SPEC['wallOutline'],'objects':len(SPEC['objects']),'meshCount':len([o for o in root.children_recursive if o.type=='MESH']),'excluded':SPEC['excluded']}
(WEB/'model-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
(OUT/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
scene.render.filepath=str(WEB/'overview.png');bpy.ops.render.render(write_still=True)
cam.location=(1,-4.5,55);cam.rotation_euler=(Vector((1,-4.5,0))-cam.location).to_track_quat('-Z','Y').to_euler();camera_data.ortho_scale=54
scene.render.filepath=str(WEB/'top-view.png');bpy.ops.render.render(write_still=True)
subprocess.run(['node', str(BASE/'scripts/png-metadata.mjs'), '--clean', str(WEB/'overview.png'), str(WEB/'top-view.png')], check=True)
print('VILLA_BUILD_COMPLETE',json.dumps(report,ensure_ascii=False))
