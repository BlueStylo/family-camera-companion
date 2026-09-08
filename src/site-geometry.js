export function offsetPath(points, distance) {
  const normals=points.slice(1).map(([x,z],i)=>{
    const dx=x-points[i][0],dz=z-points[i][1],length=Math.hypot(dx,dz);
    if(length<1e-8)throw new Error('Duplicate boundary point');
    return [-dz/length,dx/length];
  });
  return points.map(([x,z],i)=>{
    const a=normals[Math.max(0,i-1)],b=normals[Math.min(i,normals.length-1)];
    const denominator=1+a[0]*b[0]+a[1]*b[1];
    if(denominator<.1)throw new Error('Boundary turn is too sharp');
    return [x+distance*(a[0]+b[0])/denominator,z+distance*(a[1]+b[1])/denominator];
  });
}
export function polygonBounds(points) {
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs),back=Math.min(...zs),front=Math.max(...zs);
  return {x:(left+right)/2,z:(back+front)/2,w:right-left,d:front-back};
}
export function pointAtZ(points,z) {
  const index=points.findIndex((p,i)=>i<points.length-1 && z>=p[1] && z<=points[i+1][1]);
  if(index<0)throw new Error('Requested z is outside the path');
  const a=points[index],b=points[index+1],t=(z-a[1])/(b[1]-a[1]);
  return [a[0]+(b[0]-a[0])*t,z];
}
export function postsAlongPaths(paths,maxSpan) {
  if(!Number.isFinite(maxSpan)||maxSpan<=0)throw new Error('Post span must be positive');
  const posts=new Map();
  for(const path of paths)for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/maxSpan));
    for(let j=0;j<=count;j++) {
      const p=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count];
      posts.set(p.map(v=>v.toFixed(6)).join(','),p);
    }
  }
  return [...posts.values()];
}
