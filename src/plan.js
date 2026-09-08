import { SITE, corners, localOutline, labelPoint } from './site-data.js';
export const PLAN_BOX = [-16,-16,39,43];
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
export function planSvg({selected='',labels=true,trees=true,cameras=false,roofs=true,exported=false}={}) {
  const rect=(o,fill,extra='')=>{const[x,z,w,d]=corners(o);return `<rect x="${x}" y="${z}" width="${w}" height="${d}" fill="${fill}" ${extra}/>`;};
  const polygon=(points,fill,extra='')=>`<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
  const labelParts=[];
  const objects=[...SITE.objects].sort((a,b)=>Number(['lawn','entry'].includes(b.type))-Number(['lawn','entry'].includes(a.type)));
  const shapes=objects.map(o=>{
    const shape=!roofs&&o.wall?o.wall:o,[x,z,w,d]=corners(shape);let details='';
    if(o.type.includes('deck')||o.type==='pergola')details+=rect(o,'url(#boards)');
    if(o.type==='pergola'&&roofs)details+=`<path data-porch-roof="true" d="M${x},${z}h${o.coverWidth}v${d}h${-o.coverWidth}ZM${x+o.coverWidth/2},${z}v${d}" fill="none" stroke="#759d9f" stroke-width=".075"/>`;
    if(o.type==='steps')for(let n=1;n<(o.treadCount||4);n++)details+=`<path data-tread-edge="${o.id}" d="M${x},${z+d*n/(o.treadCount||4)}h${w}" stroke="#e5ceb1" stroke-width=".06"/>`;
    if(o.railing) {
      for(const path of o.railing.paths)details+=`<path data-right-deck-rail="true" d="M${path.map(p=>p.join(',')).join('L')}" fill="none" stroke="#76513d" stroke-width=".12"/>`;
      for(const [px,pz] of o.railing.posts)details+=`<rect data-right-deck-post="true" x="${px-o.railing.postWidth/2}" y="${pz-o.railing.postWidth/2}" width="${o.railing.postWidth}" height="${o.railing.postWidth}" fill="#624330"/>`;
    }
    if(o.type==='vegetable')details+=rect(o,'url(#crops)','stroke="#5f9887" stroke-dasharray=".2 .1" stroke-width=".1"');
    if(o.type==='side-cover'&&roofs)for(let dz=z;dz<=z+d;dz+=d/5)details+=`<path d="M${x},${dz}h${w}" stroke="#93b1b8" stroke-width=".06"/>`;
    if(o.type==='jars')for(let r=0;r<4;r++)for(let c=0;c<3;c++)details+=`<circle cx="${x+.46+c*.71}" cy="${z+.48+r*.86}" r=".25" fill="#6b5041"/>`;
    if(o.type==='flower-l') {
      for(let dx=.5;dx<w;dx+=.8)details+=`<circle cx="${x+dx}" cy="${z+o.bandWidth/2}" r=".16" fill="#b56d90"/>`;
      for(let dz=o.bandWidth+.4;dz<d;dz+=.8)details+=`<circle cx="${x+w-o.bandWidth/2}" cy="${z+dz}" r=".16" fill="#b56d90"/>`;
    }
    const [lx,ly]=labelPoint(o),fill=selected===o.id?'#92b7a2':o.color;
    const surface=shape.points?polygon(shape.points,fill,'class="zone-shape"'):o.type==='flower-l'?`<polygon points="${localOutline(o).map(([dx,dz])=>`${o.x+dx},${o.z+dz}`).join(' ')}" fill="${fill}" class="zone-shape"/>`:rect(shape,fill,'class="zone-shape"');
    if(labels&&!['wing','steps','deck','deck-railed'].includes(o.type))labelParts.push(`<text data-zone-label="${o.id}" x="${lx}" y="${ly}" class="zone-label"${['retaining','bbq','side-cover'].includes(o.type)?` transform="rotate(90 ${lx} ${ly})"`:''}>${esc(o.name)}</text>`);
    return `<g data-zone="${o.id}" class="zone ${selected===o.id?'selected':''}" tabindex="0" role="button" aria-label="${esc(o.name)}"${o.rotation?` transform="rotate(${o.rotation} ${o.x} ${o.z})"`:''}><title>${esc(o.name)} · ${esc(o.evidence)}</title>${surface}${details}</g>`;
  }).join('');
  const roof=roofs?`<polygon points="${SITE.roofOutline.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#456e65" stroke-width=".12"/><path data-main-roof-ridge="true" d="M${SITE.roof.ridgeX},-8.9V0" fill="none" stroke="#849a91" stroke-width=".075"/><polygon points="${SITE.wallOutline.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#a7b1a8" stroke-width=".04" stroke-dasharray=".12 .08"/>`:'';
  const planting=trees?SITE.trees.map(t=>`<circle cx="${t.x}" cy="${t.z}" r="${t.size*.48}" fill="${t.type==='flower'?'#ca95b1':'#8dab74'}" fill-opacity=".8" stroke="#77966c" stroke-width=".06"/>`).join(''):'';
  const stones=Array.from({length:18},(_,i)=>`<rect x="${-9+i*1.2}" y="${4.7+.25*Math.sin(i*.2)}" width=".65" height=".42" rx=".1" fill="#a7b1aa"/>`).join('');
  const [gateA,gateB]=SITE.entryGate.endpoints;
  const cams=cameras?SITE.cameras.map(c=>{const p=[-c.fov/2,c.fov/2].map(offset=>{const a=(c.angle+offset)*Math.PI/180;return[c.x+Math.sin(a)*5,c.z-Math.cos(a)*5];});return `<g><path d="M${c.x},${c.z}L${p[0]}L${p[1]}Z" fill="#4589da" fill-opacity=".13" stroke="#4485c3" stroke-width=".09" stroke-dasharray=".2 .13"/><circle cx="${c.x}" cy="${c.z}" r=".24" fill="#2164ba"/><text class="camera-label" x="${c.x}" y="${c.z-.65}">${esc(c.name)} · 모의 위치</text></g>`;}).join(''):'';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLAN_BOX.join(' ')}" ${exported?'width="1400" height="1544"':''} role="img" aria-label="처마 외곽 기준 별장 배치도">
  <title>별장 배치도 · 처마 외곽 기준</title><desc>${esc(SITE.status)} ${esc(SITE.eaveStatus)}</desc>
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:0}.zone{cursor:pointer}.zone-shape{stroke:#8e9c92;stroke-width:.075}.zone:hover .zone-shape,.zone:focus .zone-shape{stroke:#14735a;stroke-width:.17}.zone.selected .zone-shape{stroke:#167359;stroke-width:.18}.zone-label{font-size:.49px;fill:#29443a;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:#f5f8ef;stroke-width:.16;stroke-linejoin:round;pointer-events:none}.camera-label{font-size:.4px;fill:#2265a0;text-anchor:middle}.zone:focus{outline:none}</style>
  <defs><pattern id="boards" width="1" height=".27" patternUnits="userSpaceOnUse"><path d="M0,0h1" stroke="#926747" stroke-width=".025"/></pattern><pattern id="crops" width="1" height=".65" patternUnits="userSpaceOnUse"><path d="M0,.3h1" stroke="#7e9068" stroke-width=".2"/></pattern></defs>
  <rect x="-16" y="-16" width="39" height="43" fill="#f0f4ed"/>${polygon(SITE.road.outline,'#d7ddda','data-road-outline="true"')}
  ${polygon(SITE.terrain.outline,'#e0e7d5','data-terrain-outline="true" stroke="#91a890" stroke-width=".08" stroke-dasharray=".25 .15"')}
  ${shapes}<g pointer-events="none">${roof}${stones}${planting}${labelParts.join('')}</g>${cams}
  <path data-entry-gate="true" d="M${gateA}L${gateB}M${gateA[0]},${gateA[1]-.3}v.6M${gateB[0]},${gateB[1]-.3}v.6" fill="none" stroke="#8b644c" stroke-width=".13"><title>잔디 진입 나무문</title></path>
  <text x="18.5" y="5" font-size=".6" fill="#788a80" text-anchor="middle" transform="rotate(90 18.5 5)">도로</text>
  <text x="-12" y="-14.8" font-size=".65" fill="#344c3e">별장 · 처마 외곽 기준</text>
  <text x="-12" y="24.8" font-size=".41" fill="#617665">외곽: 처마 끝 / 점선: 추정 외벽 · 북향 미확정</text>
  <text x="-12" y="25.8" font-size=".39" fill="#617665">실측 도면이 아닙니다. 처마 0.25 m는 조정 가능한 임시값입니다.</text>
  <path d="M8,24.4v.3h5v-.3" stroke="#617665" stroke-width=".07"/><text x="10.5" y="25.5" font-size=".4" fill="#617665" text-anchor="middle">5 m · 추정</text></svg>`;
}
