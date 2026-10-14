import * as THREE from 'three';
import { pillarBox, type Placed } from './track.ts';

export type Models = Record<string, THREE.Object3D>;

/** Sky, ground, sun and a ring of trees. Built once; the run is rebuilt on top as it changes. */
export function buildWorld(scene: THREE.Scene, models: Models) {
  scene.background = new THREE.Color(0xbfe3f2);
  scene.fog = new THREE.Fog(0xbfe3f2, 40, 95);
  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x6f8f5a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: 0x86c96b, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Trees on a loose ring, far enough out that runs rarely reach them.
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const kinds = ['tree', 'tree-tall', 'tree-large'];
  // The kit's trees are charcoal, made for a dark backdrop; on grass they read better green.
  const leafy = new Map<THREE.Material, THREE.Material>();
  const greenUp = (o: THREE.Object3D) =>
    o.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const src = m.material as THREE.MeshStandardMaterial;
      if (!leafy.has(src)) leafy.set(src, Object.assign(src.clone(), { color: new THREE.Color(0xc8f5b0), emissive: new THREE.Color(0x2f6b2a) }));
      m.material = leafy.get(src)!;
    });
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 15 + rand() * 14;
    const tree = models[kinds[i % 3]].clone();
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    tree.rotation.y = rand() * Math.PI * 2;
    tree.scale.setScalar(1.4 + rand() * 1.2);
    greenUp(tree);
    scene.add(tree);
  }
  return { sun };
}

/** The run's pieces and the pillars holding up the raised ones. */
export function buildRun(pieces: Placed[], models: Models) {
  const group = new THREE.Group();
  for (const p of pieces) {
    const piece = models[p.model].clone();
    piece.position.set(p.x, p.y, p.z);
    piece.rotation.y = p.angle;
    group.add(piece);
    const pillar = pillarBox(p);
    if (pillar) {
      const x = (pillar.minX + pillar.maxX) / 2;
      const z = (pillar.minZ + pillar.maxZ) / 2;
      const foot = models['support-color-single-bottom'].clone();
      foot.position.set(x, 0, z);
      group.add(foot);
      const shaft = models['support-color-single-middle'].clone();
      shaft.position.set(x, 0.5, z);
      shaft.scale.y = Math.max(0.01, (pillar.maxY - 0.5) / 0.5);
      group.add(shaft);
    }
  }
  return group;
}

/** Points the sun's shadow camera at the run so shadows stay sharp whatever its size. */
export function aimSun(sun: THREE.DirectionalLight, box: THREE.Box3) {
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(4, box.getSize(new THREE.Vector3()).length() / 2);
  sun.position.copy(centre).add(new THREE.Vector3(-0.5, 1.3, 0.7).multiplyScalar(radius + 6));
  sun.target.position.copy(centre);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -radius - 1;
  cam.right = cam.top = radius + 1;
  cam.near = 0.5;
  cam.far = (radius + 6) * 3;
  cam.updateProjectionMatrix();
}

/** Glossy marbles in a few colours. */
export const MARBLE_COLORS = [0xff5a6e, 0xffd23f, 0x4fb8ff, 0x7be37b, 0xc58bff, 0xff9f43, 0xffffff];
export function marbleMaterials() {
  return MARBLE_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.1 }));
}
