import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createIcons, House, Map as MapIcon, Box, Cctv, PanelRight, Plus, Minus, Scan, FileImage, Download, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Square, RotateCcw, CodeXml } from 'lucide';
import { SITE, byId, footprint, labelPoint } from './site-data.js';
import { loadVilla, MODEL_URL } from './blender-model.js';
import { PLAN_BOX, planSvg } from './plan.js';
import { createCameraDemo } from './camera-demo.js';

const $ = id => document.getElementById(id);
createIcons({ icons: { House, Map: MapIcon, Box, Cctv, PanelRight, Plus, Minus, Scan, FileImage, Download, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Square, RotateCcw, CodeXml } });
const state = { mode: 'model', selected: 'house', roofs: true, trees: true, labels: true, cameras: false, planBox: [...PLAN_BOX] };
let renderer, scene, camera, controls, villa, selection, cameraDemo, renderCount = 0;
const stage = $('stage'), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const labels = new Map();

function updatePlan() {
  $('planView').innerHTML = planSvg({ selected: state.selected, roofs: state.roofs, trees: state.trees, labels: state.labels, cameras: state.cameras });
  $('planView').firstElementChild.setAttribute('viewBox', state.planBox.join(' '));
  updatePlanLabels();
}
function updatePlanLabels() {
  const scale = Math.min(stage.clientWidth / state.planBox[2], stage.clientHeight / state.planBox[3]);
  const compact = stage.clientWidth < 500;
  const names = { house: '본채', bbq: '바비큐장', 'deck-left': '데크', flowerbed: '화단', lawn: '잔디마당', 'vegetable-front': '안쪽 텃밭', 'garden-border': 'ㄱ자 화단', jars: '장독대', garage: '차고', storage: '창고', 'side-cover': '투명 지붕', entry: '진입 마당', retaining: '돌축대' };
  document.querySelectorAll('[data-zone-label]').forEach(label => {
    const o = byId(label.dataset.zoneLabel); label.style.fontSize = `${(compact ? 10 : 11) / scale}px`;
    label.textContent = compact ? names[o.id] || o.name : o.name;
    if (['bbq','side-cover','retaining'].includes(o.id)) label.setAttribute('transform', `rotate(90 ${label.getAttribute('x')} ${label.getAttribute('y')})`);
    else label.removeAttribute('transform');
  });
}
function select(id) {
  const object = byId(id); if (!object) return;
  state.selected = id;
  document.querySelectorAll('[data-select-zone]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectZone === id)));
  $('selectedName').textContent = object.name;
  $('evidenceTag').textContent = object.evidence;
  $('selectedNote').textContent = object.note || '사진에 보이는 배치를 간략화했습니다. 정확한 위치와 치수는 실측 전입니다.';
  $('dimensionWidth').textContent = `${object.w.toFixed(1)} m`;
  $('dimensionDepth').textContent = `${object.d.toFixed(1)} m`;
  $('dimensionHeight').textContent = `${(object.h + (object.roof || 0)).toFixed(1)} m`;
  if (selection) {
    selection.geometry.dispose();
    const y = ['house', 'wing', 'bbq'].includes(object.type) ? .58 : object.h + .06;
    selection.geometry = new THREE.BufferGeometry().setFromPoints(footprint(object).map(([x,z])=>new THREE.Vector3(x,y,z)));
  }
  updatePlan(); updateLabels();
}
for (const o of SITE.objects) {
  const button = document.createElement('button'); button.dataset.selectZone = o.id; button.setAttribute('aria-pressed', 'false');
  const dot = document.createElement('span'); dot.className = 'zone-dot'; dot.style.setProperty('--zone-color', o.color);
  button.append(dot, document.createTextNode(o.name)); button.onclick = () => select(o.id); $('zoneList').append(button);
}
document.querySelector('.inspector-title span').textContent = `${SITE.objects.length}개`;

function fit(preset = 'overview') {
  if (!camera) return;
  const narrow = camera.aspect < .95;
  const presets = {
    overview: { target: [1, .7, 4], direction: [.42, .95, 1], radius: 24 },
    garden: { target: [0, 2, 0], direction: [-.18, .28, 1], radius: 12 },
    entry: { target: [-1, 1.5, -6], direction: [.35, .38, -1], radius: 15 },
    road: { target: [3, .5, 7], direction: [1, .42, .33], radius: 23 }
  };
  const p = presets[preset];
  controls.target.set(...p.target);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = p.radius / Math.sin(fov / 2) * (narrow ? Math.min(1.6, 1 / camera.aspect) : 1);
  camera.position.copy(controls.target).add(new THREE.Vector3(...p.direction).normalize().multiplyScalar(distance));
  controls.update();
}
function resize() {
  if (!renderer) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  const wasNarrow = camera.aspect < .95;
  renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
  if (wasNarrow !== (camera.aspect < .95)) fit($('viewPreset').value);
  updatePlanLabels();
}
function updateLabels() {
  if (!camera) return;
  $('sceneLabels').hidden = state.mode !== 'model' || !state.labels;
  if ($('sceneLabels').hidden) return;
  const occupied = [], width = stage.clientWidth, height = stage.clientHeight;
  const sorted = [...labels.entries()].sort(([a], [b]) => a === state.selected ? -1 : b === state.selected ? 1 : 0);
  for (const [id, element] of sorted) {
    const o = byId(id), y = ['house', 'wing', 'bbq'].includes(o.type) ? o.h + (state.roofs ? o.roof : 0) + .55 : o.h + .65;
    const [anchorX,anchorZ] = o.id === 'garden-border' || o.labelAt ? labelPoint(o) : [o.x,o.z];
    const world = new THREE.Vector3(anchorX, y, anchorZ);
    const point = world.clone().project(camera);
    const x = (point.x + 1) * width / 2, z = (1 - point.y) * height / 2;
    const box = { x: x - element.offsetWidth / 2, y: z - 10, w: element.offsetWidth || 80, h: 25 };
    const overlap = occupied.some(b => box.x < b.x + b.w + 8 && box.x + box.w + 8 > b.x && box.y < b.y + b.h + 6 && box.y + box.h + 6 > b.y);
    const direction = world.clone().sub(camera.position), distance = direction.length();
    raycaster.set(camera.position, direction.normalize());
    const blockers = villa ? raycaster.intersectObjects([villa.structure, ...(state.roofs ? [villa.roofs] : [])], true) : [];
    const occluded = blockers.some(hit => hit.distance < distance - .6 && hit.object.userData.siteId !== id);
    element.hidden = point.z > 1 || point.z < -1 || x < 45 || x > width - 50 || z < 16 || z > height - 60 || overlap || occluded;
    if (!element.hidden) occupied.push(box);
    element.style.left = `${x}px`; element.style.top = `${z}px`; element.classList.toggle('selected', id === state.selected);
  }
}
async function start3D() {
  $('exportGlb').disabled = true;
  $('saveStatus').textContent = 'Blender 모델 불러오는 중';
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
    renderer.domElement.setAttribute('aria-label', '별장 3D 모델');
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); $('sceneError').textContent = '3D 연결이 중단되었습니다. 페이지를 새로 열거나 평면도를 확인해 주세요.'; $('sceneError').hidden = false; });
    $('threeView').append(renderer.domElement);
    scene = new THREE.Scene(); scene.background = new THREE.Color('#e6ece7');
    camera = new THREE.PerspectiveCamera(37, 1, .1, 350);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .09;
    controls.minDistance = 7; controls.maxDistance = 150; controls.maxPolarAngle = Math.PI * .47;
    scene.add(new THREE.HemisphereLight('#f4faff', '#74846a', 2.1));
    const sun = new THREE.DirectionalLight('#fff4df', 3); sun.position.set(-16, 28, 15); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 85 }); sun.shadow.normalBias = .05;
    scene.add(sun);
    villa = await loadVilla(); scene.add(villa.root);
    villa.roofs.visible = state.roofs; villa.plants.visible = state.trees; villa.cameras.visible = state.cameras;
    selection = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#158366', depthTest: false, transparent: true, opacity: .9 })); selection.renderOrder = 10; scene.add(selection);
    for (const id of ['house', 'bbq', 'deck-left', 'flowerbed', 'lawn', 'vegetable-front', 'garden-border', 'jars', 'garage', 'storage', 'side-cover']) {
      const element = document.createElement('span'); element.className = 'scene-label'; element.textContent = byId(id).name;
      $('sceneLabels').append(element); labels.set(id, element);
    }
    cameraDemo = createCameraDemo(scene);
    resize(); fit(); select(state.selected);
    $('exportGlb').disabled = false; $('saveStatus').textContent = 'Blender 원본 · 실내 미확인';
    const observer = new ResizeObserver(() => { resize(); updateLabels(); }); observer.observe(stage);
    let down;
    renderer.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
    renderer.domElement.addEventListener('pointerup', event => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const groups = [villa.structure, ...(state.roofs ? [villa.roofs] : []), ...(state.trees ? [villa.plants] : [])];
      const hit = raycaster.intersectObjects(groups, true).find(h => byId(h.object.userData.siteId)); if (hit) select(hit.object.userData.siteId);
    });
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      cameraDemo?.render();
      if (state.mode === 'model') { controls.update(); updateLabels(); renderer.render(scene, camera); renderCount++; }
    });
  } catch (error) {
    console.error(error); $('sceneError').textContent = '이 브라우저에서 3D를 열지 못했습니다. 평면도는 계속 볼 수 있습니다.'; $('sceneError').hidden = false;
    $('exportGlb').disabled = true; $('mode-model').disabled = true; mode('plan');
  }
}
function mode(value) {
  state.mode = value;
  $('threeView').hidden = value !== 'model'; $('planView').hidden = value !== 'plan'; $('sceneLabels').hidden = value !== 'model' || !state.labels;
  $('mode-model').setAttribute('aria-pressed', String(value === 'model')); $('mode-plan').setAttribute('aria-pressed', String(value === 'plan'));
  $('viewPreset').disabled = value !== 'model';
  if (value === 'plan') updatePlan(); else { resize(); updateLabels(); }
}
$('mode-plan').onclick = () => mode('plan'); $('mode-model').onclick = () => mode('model');
$('viewPreset').onchange = event => fit(event.target.value);
for (const [id, key, group] of [['layerRoof', 'roofs', 'roofs'], ['layerTrees', 'trees', 'plants'], ['layerLabels', 'labels'], ['layerCameras', 'cameras', 'cameras']]) {
  $(id).onchange = event => { state[key] = event.target.checked; if (villa && group) villa[group].visible = state[key]; updatePlan(); updateLabels(); $('viewStatus').textContent = state.cameras ? '가상 카메라 · 실제 설치 위치 아님' : '정원 정면 기준 · 북향 미공개'; };
}
$('toggleInspector').onclick = () => {
  const hidden = !$('inspector').hidden; $('inspector').hidden = hidden;
  document.querySelector('.studio').classList.toggle('inspector-hidden', hidden);
  $('toggleInspector').setAttribute('aria-expanded', String(!hidden));
};
function zoom(factor) {
  if (state.mode === 'model' && camera) { const delta = camera.position.clone().sub(controls.target).multiplyScalar(factor); if (delta.length() < 7 || delta.length() > 150) return; camera.position.copy(controls.target).add(delta); controls.update(); }
  else {
    const [x, y, w, h] = state.planBox; if (w * factor < 8 || w * factor > 100) return;
    state.planBox = [x + w * (1 - factor) / 2, y + h * (1 - factor) / 2, w * factor, h * factor]; updatePlan();
  }
}
$('zoomIn').onclick = () => zoom(.82); $('zoomOut').onclick = () => zoom(1.22);
$('resetView').onclick = () => { state.planBox = [...PLAN_BOX]; updatePlan(); $('viewPreset').value = 'overview'; fit(); };
$('planView').addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.08 : .92); }, { passive: false });
let planDrag;
$('planView').addEventListener('pointerdown', event => { planDrag = { x: event.clientX, y: event.clientY, box: [...state.planBox], zone: event.target.closest('[data-zone]')?.dataset.zone }; $('planView').setPointerCapture(event.pointerId); });
$('planView').addEventListener('pointermove', event => {
  if (!planDrag) return;
  const svg = $('planView').firstElementChild, scale = Math.min(svg.clientWidth / planDrag.box[2], svg.clientHeight / planDrag.box[3]);
  state.planBox = [planDrag.box[0] - (event.clientX - planDrag.x) / scale, planDrag.box[1] - (event.clientY - planDrag.y) / scale, ...planDrag.box.slice(2)];
  svg.setAttribute('viewBox', state.planBox.join(' '));
});
$('planView').addEventListener('pointerup', event => { if (planDrag && Math.hypot(event.clientX - planDrag.x, event.clientY - planDrag.y) < 5 && planDrag.zone) select(planDrag.zone); planDrag = null; });
$('planView').addEventListener('pointercancel', () => { planDrag = null; });
$('planView').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { const zone = event.target.closest('[data-zone]'); if (zone) { event.preventDefault(); select(zone.dataset.zone); } } });

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }
$('exportSvg').onclick = () => { download(new Blob([planSvg({ exported: true })], { type: 'image/svg+xml' }), 'villa-estimated-site-plan.svg'); $('saveStatus').textContent = '평면도 내보내기 완료'; };
$('exportJson').onclick = () => { download(new Blob([JSON.stringify(SITE, null, 2)], { type: 'application/json' }), 'villa-estimated-site.json'); $('saveStatus').textContent = '배치 데이터 내보내기 완료'; };
$('exportGlb').onclick = async () => {
  if (!villa) return; $('exportGlb').disabled = true; $('saveStatus').textContent = '3D 파일 준비 중';
  try {
    const response = await fetch(MODEL_URL); if (!response.ok) throw new Error('Model download failed');
    download(await response.blob(), 'villa-blender-v4.glb'); $('saveStatus').textContent = '3D 내보내기 완료';
  } catch (error) { console.error(error); $('saveStatus').textContent = '3D 내보내기에 실패했습니다.'; }
  finally { $('exportGlb').disabled = false; }
};
start3D(); select('house');
if (new URLSearchParams(location.search).get('view') === 'plan') mode('plan');
// Read-only diagnostics for render and geometry checks, without CCTV access.
window.villaStudy = { get status() { return { mode: state.mode, selected: state.selected, source: villa?.source, version: villa?.version, renderCount, camera: camera?.position.toArray(), size: renderer?.getSize(new THREE.Vector2()).toArray(), draws: renderer?.info.render.calls, triangles: renderer?.info.render.triangles, objects: SITE.objects.length, demoCameras: state.cameras, roofVisible: villa?.roofs.visible, demo: cameraDemo?.status, errors: !$('sceneError').hidden }; } };
