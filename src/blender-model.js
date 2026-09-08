import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SITE } from './site-data.js';

export const MODEL_URL = './assets/villa.glb';
export async function loadVilla() {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const root = gltf.scene;
  let model;
  root.traverse(node => { if (node.userData.layoutVersion !== undefined) model = node; });
  if (!model || model.userData.layoutVersion !== SITE.version) throw new Error('Blender model and layout versions differ');
  const structure = root.getObjectByName('structure'), roofs = root.getObjectByName('roofs'), plants = root.getObjectByName('plants');
  if (!structure || !roofs || !plants) throw new Error('Blender layer metadata missing');
  root.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    if (!node.userData.siteId) {
      let parent = node.parent;
      while (parent && !parent.userData.siteId) parent = parent.parent;
      node.userData.siteId = parent?.userData.siteId || 'context';
    }
  });
  const cameras = new THREE.Group(); cameras.name = 'Illustrative_demo_cameras_only';
  const material = new THREE.MeshStandardMaterial({ color: '#1d6cc4' });
  for (const c of SITE.cameras) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 6), material); marker.position.set(c.x, c.y, c.z); cameras.add(marker);
    const endpoints = [-c.fov / 2, c.fov / 2].map(offset => { const angle = THREE.MathUtils.degToRad(c.angle + offset); return new THREE.Vector3(c.x + Math.sin(angle) * 5, .2, c.z - Math.cos(angle) * 5); });
    const vertices = [new THREE.Vector3(c.x, c.y, c.z), endpoints[0], endpoints[1]];
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices); geometry.setIndex([0, 1, 2]); geometry.computeVertexNormals();
    cameras.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#3685d8', opacity: .18, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  }
  cameras.visible = false; root.add(cameras);
  return { root, structure, roofs, plants, cameras, source: 'Blender', version: model.userData.layoutVersion };
}
