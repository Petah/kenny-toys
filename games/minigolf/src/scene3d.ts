import * as THREE from 'three';
import { FLOOR, TILES, type Course } from './course.ts';
import { OUT_DEPTH, tilePoint } from './physics.ts';

/** Models drawn besides the tiles. */
export const EXTRA_MODELS = ['ball-red', 'flag-red', 'club-red', 'support', 'support-low'];
export const ALL_MODELS = [...new Set([...Object.values(TILES).map((t) => t.model), ...EXTRA_MODELS])];

/** Where the pond's surface sits: just under the tiles, a little above where physics calls a ball out. */
export const WATER_Y = 0.03 - OUT_DEPTH;

export type Models = Record<string, THREE.Object3D>;

/** Sky, fog, sun and the pond. Built once; courses come and go on top. */
export function buildWorld(scene: THREE.Scene) {
  scene.background = new THREE.Color(0xa8dcf0);
  scene.fog = new THREE.Fog(0xa8dcf0, 9, 22);
  scene.add(new THREE.HemisphereLight(0xf2fbff, 0x5f8a6a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x4fb3d9, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);
  return { sun };
}

export interface CourseView {
  group: THREE.Group;
  blades: THREE.Object3D[];
  flag: THREE.Object3D;
  /** Middle of the course and how far it reaches, for framing the camera and the sun's shadow. */
  centre: THREE.Vector3;
  radius: number;
}

/** Tiles, pillars under raised tiles, and the flag in the cup. */
export function buildCourse(course: Course, models: Models): CourseView {
  const group = new THREE.Group();
  const blades: THREE.Object3D[] = [];
  for (const t of course.tiles) {
    const tile = models[t.def.model].clone();
    tile.position.set(t.x, t.y, t.z);
    tile.rotation.y = t.angle;
    group.add(tile);
    const b = tile.getObjectByName('blades');
    if (b) blades.push(b);
    // Anything above the pond stands on a pillar reaching down to the water.
    if (t.y > 0.001) {
      const pillar = models[t.y > 0.3 ? 'support' : 'support-low'].clone();
      const height = t.y > 0.3 ? 1 : 0.5;
      pillar.position.set(t.x, WATER_Y, t.z);
      pillar.scale.y = (t.y - WATER_Y) / height;
      group.add(pillar);
    }
  }
  const cup = tilePoint(course.cup, 0, FLOOR, 0);
  const flag = models['flag-red'].clone();
  // Full size it towers over a 6cm ball; smaller reads better at putting distance.
  flag.scale.setScalar(0.55);
  flag.position.set(cup.x, cup.y - 0.03, cup.z);
  group.add(flag);

  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  return { group, blades, flag, centre, radius };
}

/** Points the sun's shadow camera at the course so the shadow map covers just what's there. */
export function aimSun(sun: THREE.DirectionalLight, view: CourseView) {
  const { centre, radius } = view;
  sun.position.copy(centre).add(new THREE.Vector3(-0.6, 1.4, 0.8).multiplyScalar(radius + 4));
  sun.target.position.copy(centre);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -radius - 0.5;
  cam.right = cam.top = radius + 0.5;
  cam.near = 0.5;
  cam.far = (radius + 4) * 3;
  cam.updateProjectionMatrix();
}
