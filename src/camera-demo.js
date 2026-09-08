import * as THREE from 'three';
import { DEMO_CAMERAS } from './site-data.js';
import { DemoPTZ } from './ptz-state.js';

export function createCameraDemo(scene) {
  const $ = id => document.getElementById(id);
  const ptz = new DemoPTZ();
  const host = $('cameraPreview');
  const controls = document.querySelectorAll('.camera-demo button');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
  catch { $('cameraError').textContent = '가상 영상을 열지 못했습니다.'; controls.forEach(b => b.disabled = true); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.setAttribute('aria-label', '실제 영상이 아닌 가상 카메라 영상');
  host.append(renderer.domElement);
  $('cameraError').hidden = true;
  let active = DEMO_CAMERAS[0], last = performance.now();
  const camera = new THREE.PerspectiveCamera(70, 16/9, .1, 200);
  for (const c of DEMO_CAMERAS) {
    const option = document.createElement('option'); option.value = c.id; option.textContent = c.name;
    $('demoCamera').append(option);
  }
  $('demoCamera').onchange = event => { active = DEMO_CAMERAS.find(c => c.id === event.target.value); ptz.reset(); };
  const stop = () => ptz.stop();
  for (const button of document.querySelectorAll('[data-ptz]')) {
    button.onpointerdown = event => {
      if (event.button !== 0) return;
      button.setPointerCapture(event.pointerId);
      ptz.move(button.dataset.ptz, performance.now());
    };
    button.onpointerup = stop;
    button.onpointercancel = stop;
    button.onlostpointercapture = stop;
    button.onkeydown = event => {
      if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) ptz.move(button.dataset.ptz, performance.now()); }
    };
    button.onkeyup = stop;
    button.onblur = stop;
  }
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('pointerup', stop);
  $('ptzStop').onclick = stop;
  $('ptzZoomIn').onclick = () => ptz.zoom(-5);
  $('ptzZoomOut').onclick = () => ptz.zoom(5);
  $('ptzReset').onclick = () => ptz.reset();
  const resize = new ResizeObserver(() => renderer.setSize(host.clientWidth, host.clientWidth * 9/16));
  resize.observe(host);
  return {
    render() {
      const now = performance.now(); ptz.tick(now-last, now); last = now;
      if (!host.clientWidth) { stop(); return; }
      const pan = THREE.MathUtils.degToRad(active.angle + ptz.pan), tilt = THREE.MathUtils.degToRad(ptz.tilt);
      camera.position.set(active.x, active.y, active.z);
      camera.lookAt(active.x + Math.sin(pan)*Math.cos(tilt), active.y + Math.sin(tilt), active.z - Math.cos(pan)*Math.cos(tilt));
      camera.fov = ptz.fov; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      $('ptzStatus').textContent = `PAN ${ptz.pan.toFixed(0)}° · TILT ${ptz.tilt.toFixed(0)}° · FOV ${ptz.fov}°`;
    },
    get status() { return { id: active.id, simulated: true, ...ptz.state }; }
  };
}
