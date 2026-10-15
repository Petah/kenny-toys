import * as THREE from 'three';
import { lineYaw } from './ai.ts';
import { DECK, WIDTH, type Built } from './track.ts';
import { FLOOR_Y } from './physics.ts';

export type Models = Record<string, THREE.Object3D>;

/** Light, the bedroom floor and a rug. Built once; circuits come and go on top. */
export function buildWorld(scene: THREE.Scene) {
  scene.background = new THREE.Color(0xe9dcc8);
  scene.fog = new THREE.Fog(0xe9dcc8, 30, 70);
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a6a4a, 1.7));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: planks(), roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);
  return { sun };
}

/** Wooden floorboards, drawn once into a repeating texture. */
function planks() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rows = 8;
  const h = c.height / rows;
  const tones = ['#c8955f', '#bd8a55', '#d19f6a', '#b98352', '#c99862'];
  for (let r = 0; r < rows; r++) {
    // Boards in each row break at a different place.
    let x = -((r * 173) % 512);
    let i = r;
    while (x < 512) {
      const w = 220 + ((i * 97) % 200);
      g.fillStyle = tones[i % tones.length];
      g.fillRect(x, r * h, w, h);
      // A little grain.
      g.strokeStyle = 'rgba(90,50,20,0.08)';
      g.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const y = r * h + 8 + ((k * 13 + i * 7) % (h - 12));
        g.beginPath();
        g.moveTo(x + 4, y);
        g.bezierCurveTo(x + w * 0.3, y + 4, x + w * 0.6, y - 4, x + w - 4, y + 1);
        g.stroke();
      }
      g.fillStyle = 'rgba(70,40,15,0.35)';
      g.fillRect(x, r * h, 2, h);
      x += w;
      i++;
    }
    g.fillStyle = 'rgba(70,40,15,0.4)';
    g.fillRect(0, r * h, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A round rug with rings, under the circuit. */
function rug(radiusX: number, radiusZ: number, colours: string[]) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  colours.forEach((col, i) => {
    const r = 256 * (1 - i / colours.length) - (i ? 6 : 0);
    g.fillStyle = col;
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

const RUGS = [
  ['#a8343a', '#f1e4c8', '#a8343a', '#e3b04b', '#a8343a'],
  ['#5b4a8c', '#f2d3c4', '#5b4a8c', '#e98a6a', '#5b4a8c'],
  ['#3d6b4f', '#f4e6c2', '#3d6b4f', '#d9653b', '#3d6b4f'],
];

export interface CircuitView {
  group: THREE.Group;
  centre: THREE.Vector3;
  radius: number;
}

/**
 * The circuit: its pieces (in the circuit's paint), stands under raised track, the finish gate,
 * a rug under it all and toy trees and cones round the outside.
 */
export function buildCircuit(built: Built, models: Models, paint: THREE.Material | undefined, index: number): CircuitView {
  const group = new THREE.Group();
  for (const p of built.pieces) {
    const m = models[p.model].clone();
    m.position.set(p.at.x, p.at.y + DECK, p.at.z);
    m.rotation.y = p.at.yaw;
    if (p.mirror) m.scale.x = -1;
    if (paint) m.traverse((o) => o instanceof THREE.Mesh && (o.material = paint));
    group.add(m);
    // Stands under any raised part of the piece, from the deck's underside down to the floor.
    for (const t of [0.1, 0.5, 0.9]) {
      const c = p.centre(t);
      const height = c.y - 0.1 - FLOOR_Y;
      if (height < 0.15) continue;
      const s = models['supports-wide'].clone();
      s.position.set(c.x, FLOOR_Y, c.z);
      const ahead = p.centre(Math.min(1, t + 0.05));
      const behind = p.centre(Math.max(0, t - 0.05));
      s.rotation.y = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
      s.scale.set(0.9, height, 0.35);
      group.add(s);
    }
  }

  // The finish gate over the start line, sized to the track.
  const start = built.line[0];
  const gate = models['gate-finish'].clone();
  gate.position.set(start.x, start.y, start.z);
  gate.rotation.y = lineYaw(built, 0);
  gate.scale.setScalar((WIDTH + 0.5) / 1.54);
  group.add(gate);

  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.hypot(size.x, size.z) / 2;

  const mat = rug(size.x / 2 + 5, size.z / 2 + 5, RUGS[index % RUGS.length]);
  mat.position.set(centre.x, FLOOR_Y + 0.005, centre.z);
  group.add(mat);

  // Trees and cones dotted round the outside, never on the track.
  let seed = 1234 + index * 77;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clear = (x: number, z: number, gap: number) => built.line.every((p) => Math.hypot(p.x - x, p.z - z) > gap);
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const r = radius * (0.3 + rand() * 0.95);
    const x = centre.x + Math.cos(a) * r;
    const z = centre.z + Math.sin(a) * r;
    if (!clear(x, z, WIDTH * 0.9)) continue;
    const kind = rand() < 0.3 ? 'item-cone' : rand() < 0.5 ? 'tree' : 'tree-pine';
    const prop = models[kind].clone();
    prop.position.set(x, FLOOR_Y, z);
    prop.rotation.y = rand() * Math.PI * 2;
    prop.scale.setScalar(kind === 'item-cone' ? 1.6 : 1.6 + rand() * 1.4);
    group.add(prop);
  }
  return { group, centre, radius };
}

/** Points the sun's shadow at the circuit so its map covers just what's there. */
export function aimSun(sun: THREE.DirectionalLight, view: CircuitView) {
  const { centre, radius } = view;
  sun.position.copy(centre).add(new THREE.Vector3(-0.5, 1.5, 0.7).multiplyScalar(radius + 6));
  sun.target.position.copy(centre);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -radius - 2;
  cam.right = cam.top = radius + 2;
  cam.near = 0.5;
  cam.far = (radius + 6) * 4;
  cam.updateProjectionMatrix();
}

/** A car model turned to face +z, with handles on its wheels to spin and steer. */
export function makeCar(models: Models, vehicle: string) {
  const root = new THREE.Group();
  const body = models[`vehicle-${vehicle}`].clone();
  // The kit's cars face -z.
  body.rotation.y = Math.PI;
  root.add(body);
  const wheels = ['fl', 'fr', 'bl', 'br'].map((w) => body.getObjectByName(`wheel-${w}`)).filter((w): w is THREE.Object3D => !!w);
  return { root, body, wheels, front: wheels.slice(0, 2) };
}
