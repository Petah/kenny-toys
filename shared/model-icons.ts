import * as THREE from 'three';

/**
 * Sharp HUD icons drawn from 3D models (the kits' preview PNGs are only 64px,
 * which blurs on a retina screen). One small offscreen renderer draws them all once.
 */
export function makeIcons(models: Record<string, THREE.Object3D>, size = 160) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const icons: Record<string, string> = {};
  for (const [name, model] of Object.entries(models)) {
    const m = model.clone();
    // A three-quarter view from the front, like the kits' previews.
    m.rotation.y = 0.5;
    scene.add(m);
    const box = new THREE.Box3().setFromObject(m);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.72;
    camera.position.copy(centre).add(new THREE.Vector3(0, 0.35, 1).normalize().multiplyScalar(dist));
    camera.lookAt(centre);
    renderer.render(scene, camera);
    icons[name] = renderer.domElement.toDataURL();
    scene.remove(m);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return icons;
}
