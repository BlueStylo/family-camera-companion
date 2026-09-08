import spec from '../public/assets/site.json' with { type: 'json' };

// Illustrative positions only. These are not the household's camera inventory.
export const DEMO_CAMERAS = [
  { id: 'demo-1', name: '데모 1', x: 0, y: 8, z: 17, angle: 0, fov: 70 },
  { id: 'demo-2', name: '데모 2', x: -13, y: 7, z: 10, angle: 65, fov: 70 },
  { id: 'demo-3', name: '데모 3', x: 15, y: 7, z: 12, angle: -50, fov: 70 },
  { id: 'demo-4', name: '데모 4', x: 2, y: 8, z: -15, angle: 180, fov: 70 },
  { id: 'demo-5', name: '데모 5', x: -13, y: 7, z: -5, angle: 110, fov: 70 }
];
export const SITE = { ...spec, cameras: DEMO_CAMERAS };
export const byId = id => SITE.objects.find(o => o.id === id);
export const corners = o => [o.x-o.w/2,o.z-o.d/2,o.w,o.d];
export function planPoint(o,dx=0,dz=0) {
  const a=(o.rotation||0)*Math.PI/180;
  return [o.x+dx*Math.cos(a)-dz*Math.sin(a),o.z+dx*Math.sin(a)+dz*Math.cos(a)];
}
export function localOutline(o) {
  const l=-o.w/2,r=o.w/2,t=-o.d/2,b=o.d/2;
  return o.type==='flower-l'
    ? [[l,t],[r,t],[r,b],[r-o.bandWidth,b],[r-o.bandWidth,t+o.bandWidth],[l,t+o.bandWidth]]
    : [[l,t],[r,t],[r,b],[l,b]];
}
export function labelPoint(o) {
  return o.labelAt || planPoint(o,0,o.type==='flower-l'?(-o.d+o.bandWidth)/2:o.id==='house'?1:0);
}
export function footprint(o,walls=false) {
  const s=walls&&o.wall?o.wall:o;
  if(s.points)return s.points;
  return localOutline(s).map(([dx,dz])=>planPoint(o,s.x-o.x+dx,s.z-o.z+dz));
}
