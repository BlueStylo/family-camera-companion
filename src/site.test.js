import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SITE, corners, byId, footprint, localOutline, planPoint, labelPoint } from './site-data.js';
import { planSvg } from './plan.js';
import { offsetPath, pointAtZ, postsAlongPaths } from './site-geometry.js';
test('valid distinct regions and explicit estimate metadata',()=>{
  assert.equal(new Set(SITE.objects.map(o=>o.id)).size,SITE.objects.length);
  for(const o of SITE.objects){assert.ok(corners(o).every(Number.isFinite));assert.ok(o.w>0&&o.d>0&&o.h>0);assert.match(o.evidence,/추정/);}
  assert.match(SITE.status,/처마/);assert.match(SITE.eaveStatus,/실측값 아님/);
});
test('garage, storage and transparent side space are distinct adjoining zones',()=>{
  const a=byId('garage'),b=byId('storage'),c=byId('side-cover');
  assert.ok(Math.abs(a.z+a.d/2-(b.z-b.d/2))<1e-8);
  assert.ok(Math.abs(b.z+b.d/2-(c.z-c.d/2))<1e-8);
  assert.ok(Math.abs(c.z+c.d/2)<1e-8);
  assert.notEqual(a.id,b.id);
});
test('jars follow latest map and the neighboring plot is excluded',()=>{
  assert.ok(byId('jars').x< -6 && byId('jars').z<10);
  assert.equal(byId('vegetable-side'),undefined);
  assert.ok(SITE.excluded.some(v=>v.includes('옆땅')));
});
test('flowerbed only follows the house-facing and right edges at soil level',()=>{
  const border=byId('garden-border'),inner=byId('vegetable-front');
  assert.equal(border.type,'flower-l');assert.equal(border.rotation,inner.rotation);assert.equal(border.h,inner.h);
  const outline=localOutline(border);
  assert.equal(outline.length,6);
  const area=Math.abs(outline.reduce((sum,p,i)=>{const q=outline[(i+1)%outline.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
  assert.ok(Math.abs(area-border.bandWidth*(border.w+border.d-border.bandWidth))<1e-8);
  assert.deepEqual(outline,[[-6.5,-2.9],[6.5,-2.9],[6.5,2.9],[5.3,2.9],[5.3,-1.7],[-6.5,-1.7]]);
  const close=(a,b)=>a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<1e-8));
  close(planPoint(border,border.w/2-border.bandWidth,-border.d/2+border.bandWidth),planPoint(inner,inner.w/2,-inner.d/2));
  close(planPoint(border,border.w/2-border.bandWidth,border.d/2),planPoint(inner,inner.w/2,inner.d/2));
  close(labelPoint(border),planPoint(border,0,(-border.d+border.bandWidth)/2));
  const svg=planSvg(),zone=svg.match(/<g data-zone="garden-border"[\s\S]*?<\/g>/)[0];
  assert.match(zone,/<polygon/);assert.doesNotMatch(zone,/<rect/);
});
test('right garden end is shortened without shifting the old left anchors',()=>{
  const border=byId('garden-border'),inner=byId('vegetable-front');
  const oldBorder={x:3.7,z:14.5,w:14.3,d:7,rotation:-13},oldInner={...oldBorder,w:11.9,d:4.6};
  for(const [current,old] of [[border,oldBorder],[inner,oldInner]]) {
    assert.ok(Math.abs(old.w-current.w-1.3)<1e-8);
    const before=planPoint(old,-old.w/2,-old.d/2),after=planPoint(current,-current.w/2,-current.d/2);
    assert.ok(Math.hypot(before[0]-after[0],before[1]-after[1])<1e-8);
  }
});
test('terrain, road and retaining wall share the non-rectangular traced edge',()=>{
  const edge=SITE.road.edge,wall=byId('retaining');
  assert.deepEqual(wall.path.slice(1),edge.slice(1));
  assert.deepEqual(wall.points.slice(0,wall.path.length),wall.path);
  assert.deepEqual(SITE.terrain.outline.slice(2,2+edge.length),edge);
  assert.deepEqual(SITE.road.outline.slice(0,edge.length),edge);
  assert.ok(edge[5][0]-edge[0][0]>5);
  assert.ok(edge.at(-1)[0]<-14&&edge.at(-1)[1]>24);
  for(const [path,width] of [[wall.path,wall.width],[edge,-3.6]]) {
    const offset=offsetPath(path,width);
    for(let i=0;i<path.length-1;i++) {
      const [x,z]=path[i],dx=path[i+1][0]-x,dz=path[i+1][1]-z,length=Math.hypot(dx,dz);
      const distance=(dx*(offset[i][1]-z)-dz*(offset[i][0]-x))/length;
      assert.ok(Math.abs(distance-width)<1e-8);
    }
  }
  assert.deepEqual(offsetPath([[0,0],[3,0],[3,3]],1),[[0,1],[2,1],[2,3]]);
  assert.throws(()=>offsetPath([[0,0],[0,0]],1),/Duplicate/);
  const contains=([x,z],poly)=>{
    let result=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const [xi,zi]=poly[i],[xj,zj]=poly[j];
      if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)result=!result;
    }
    return result;
  };
  for(const id of ['house','wing','garage','storage','bbq','garden-border','vegetable-front']) {
    assert.ok(footprint(byId(id)).every(p=>contains(p,SITE.terrain.outline)),id);
  }
  assert.ok(SITE.trees.every(t=>contains([t.x,t.z],SITE.terrain.outline)));
  assert.match(planSvg(),/data-terrain-outline="true"/);assert.match(planSvg(),/data-road-outline="true"/);
});
test('gate spans the side lawn entrance and retaining wall stops before the entry yard',()=>{
  const wall=byId('retaining'),entry=byId('entry'),front=entry.z+entry.d/2;
  const [left,right]=SITE.entryGate.endpoints,inner=offsetPath(wall.path,wall.width);
  assert.ok(wall.points.every(([,z])=>z>=front-1e-8));
  assert.ok(Math.abs(wall.path[0][1]-front)<1e-8);
  assert.equal(left[1],right[1]);assert.ok(left[1]>front&&left[1]<front+.6);
  assert.ok(left[0]>7.5&&left[0]<7.8);
  assert.deepEqual(right,pointAtZ(inner,left[1]));
  assert.ok(right[0]-left[0]>3.5&&right[0]-left[0]<4.5);
  assert.match(planSvg(),/data-entry-gate="true"/);assert.doesNotMatch(planSvg(),/M10,-10\.7/);
  assert.deepEqual(pointAtZ([[1,0],[3,2]],1),[2,1]);
  assert.throws(()=>pointAtZ([[1,0],[3,2]],3),/outside/);
});
test('connected roof lift exceeds the thickness without changing the eave footprint',()=>{
  const roof=SITE.roof,slope=(roof.ridgeHeight-roof.eaveHeight)/7.35;
  assert.ok(roof.renderLift-roof.thickness*Math.sqrt(1+slope*slope)>.02);
  assert.ok(roof.renderLift<=.2);assert.match(roof.liftBasis,/실측값 아님/);
  assert.deepEqual(SITE.roofOutline,[[-7.2,-8.9],[7.5,-8.9],[7.5,2.7],[3.3,2.7],[3.3,0],[-7.2,0]]);
});
test('plan omits the small front roof guide lines while preserving the main ridge',()=>{
  for(const exported of [false,true]) {
    const svg=planSvg({exported});
    assert.ok(svg.includes(`data-main-roof-ridge="true" d="M${SITE.roof.ridgeX},-8.9V0"`));
    assert.doesNotMatch(svg,/M5\.4,0V2\.7|M3\.3,0L5\.4,2\.7/);
    assert.ok(svg.includes(`points="${SITE.roofOutline.map(p=>p.join(',')).join(' ')}"`));
  }
  assert.doesNotMatch(planSvg({roofs:false}),/data-main-roof-ridge/);
});
test('front windows follow roof and enlarged bed, with a smaller stacked side window',()=>{
  const {upperWindow:upper,upperSmallWindow:small,gardenWindow:large,awning}=SITE.facade;
  assert.equal(upper.anchor,'roof-ridge');assert.equal(large.anchor,'flowerbed');assert.equal(awning.anchor,'flowerbed');
  assert.equal(small.division,'horizontal');assert.ok(small.w<.7&&small.h<1.2);
  assert.deepEqual(large.divisions,[.23,.77]);assert.ok(upper.w>small.w*3);
  const bed=byId('flowerbed'),left=byId('deck-left'),center=byId('deck-center'),steps=byId('steps-left');
  assert.ok(Math.abs(bed.w-3.35-.6)<1e-8);
  assert.ok(Math.abs(bed.x+bed.w/2-2.55)<1e-8);
  assert.ok(Math.abs(bed.x-bed.w/2-(left.x+left.w/2))<1e-8);
  assert.ok(Math.abs(center.z+center.d/2-(bed.z-bed.d/2))<1e-8);
  assert.ok(steps.x-steps.w/2>=left.x-left.w/2 && steps.x+steps.w/2<=left.x+left.w/2);
  assert.ok(left.coverWidth>4.2*1.3);assert.equal(left.coverWidth,left.w);assert.ok(left.coverRidgeHeight>4.05);
  assert.match(planSvg(),/data-porch-roof="true"/);assert.doesNotMatch(planSvg({roofs:false}),/data-porch-roof/);
});
test('short eaves contain the wall outline and connected decks touch',()=>{
  assert.equal(SITE.eave,.25);assert.equal(SITE.roofOutline.length,6);assert.equal(SITE.wallOutline.length,6);
  const [roofLeft]=SITE.roofOutline[0], [wallLeft]=SITE.wallOutline[0];
  assert.ok(Math.abs(wallLeft-roofLeft-SITE.eave)<1e-8);
  const left=byId('deck-left'),middle=byId('deck-center'),ret=byId('deck-return'),right=byId('deck-right');
  assert.ok(Math.abs(left.x+left.w/2-(middle.x-middle.w/2))<1e-8);
  assert.ok(middle.x+middle.w/2>=ret.x-ret.w/2);
  assert.ok(Math.abs(ret.x+ret.w/2-(right.x-right.w/2))<1e-8);
  assert.equal(new Set([left.h,middle.h,ret.h,right.h]).size,1);
});
test('right stairs have three descending treads and asymmetric rails leave the opening clear',()=>{
  const deck=byId('deck-right'),steps=byId('steps-right'),rail=deck.railing,ret=byId('deck-return');
  const left=steps.x-steps.w/2,right=steps.x+steps.w/2;
  assert.equal(steps.treadCount,3);assert.equal(steps.h,deck.h);
  assert.ok(steps.w<2.65&&steps.x<deck.x);
  assert.ok(Math.abs(steps.z-steps.d/2-(deck.z+deck.d/2))<1e-8);
  assert.equal(rail.paths.length,2);assert.equal(rail.paths[0].length,3);
  assert.ok(rail.paths[0][0][0]>ret.x-ret.w/2&&rail.paths[0][0][0]<ret.x+ret.w/2);
  assert.ok(Math.abs(rail.paths[0].at(-1)[0]+rail.postWidth/2-left)<1e-8);
  assert.ok(Math.abs(rail.paths[1][0][0]-rail.postWidth/2-right)<1e-8);
  assert.ok(rail.paths[1][1][0]-rail.paths[1][0][0]>rail.paths[0][2][0]-rail.paths[0][1][0]);
  assert.equal(rail.posts.length,7);assert.equal(rail.boardLevels.length,3);assert.ok(rail.boardHeight>.1);
  assert.ok(rail.posts.every(([x])=>x+rail.postWidth/2<=left+1e-8||x-rail.postWidth/2>=right-1e-8));
  assert.deepEqual(postsAlongPaths([[[0,0],[0,2],[1,2]]],1),[[0,0],[0,1],[0,2],[1,2]]);
  assert.throws(()=>postsAlongPaths([],0),/positive/);
  const svg=planSvg();assert.equal((svg.match(/data-right-deck-rail=/g)||[]).length,2);
  assert.equal((svg.match(/data-right-deck-post=/g)||[]).length,rail.posts.length);
  assert.equal((svg.match(/data-tread-edge="steps-right"/g)||[]).length,2);
  assert.equal((svg.match(/data-tread-edge="steps-left"/g)||[]).length,3);
});
test('public model has no reference photographs or household camera identifiers',()=>{
  assert.deepEqual(SITE.photos,[]);
  for(const o of SITE.objects)assert.equal(o.photos,undefined);
  assert.equal(SITE.cameras.length,5);
  assert.ok(SITE.cameras.every(c=>c.id.startsWith('demo-')&&!c.ip&&!c.serialHint));
});
test('plan keeps each footprint, rotated garden and opt-in camera drafts',()=>{
  const svg=planSvg({exported:true});assert.doesNotMatch(svg,/NaN|undefined/);
  for(const o of SITE.objects){assert.ok(svg.includes('data-zone="'+o.id+'"'));assert.ok(footprint(o).flat().every(Number.isFinite));}
  assert.match(svg,/rotate\(-13/);assert.doesNotMatch(svg,/· 모의 위치<\/text>/);assert.match(planSvg({cameras:true}),/· 모의 위치<\/text>/);
  assert.match(svg,/실측 도면이 아닙니다/);assert.doesNotMatch(planSvg({labels:false}),/class="zone-label"/);
});
test('Blender GLB has embedded assets, expected layers and no adjacent plot',()=>{
  const data=readFileSync(new URL('../public/assets/villa.glb',import.meta.url));
  assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
  const length=data.readUInt32LE(12),gltf=JSON.parse(data.toString('utf8',20,20+length));
  assert.ok(gltf.nodes.some(n=>n.extras?.layoutVersion===SITE.version));
  for(const name of ['structure','roofs','plants'])assert.ok(gltf.nodes.some(n=>n.name===name));
  for(const o of SITE.objects)assert.ok(gltf.nodes.some(n=>n.extras?.siteId===o.id),o.id);
  assert.ok(!gltf.nodes.some(n=>n.extras?.siteId==='vegetable-side'));
  assert.ok(gltf.images.every(i=>i.bufferView!==undefined));
});
