import * as THREE from 'three';
import { Sounds } from '@shared/audio';
import { readGlbParts } from '@shared/glb';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { PET_DIR, SCENERY, SCENERY_DIR, SFX } from './assets.ts';
import { StackGame, type PetModel } from './game.ts';
import { PETS } from './pets.ts';
import { initPhysics, shapeOf } from './stack.ts';

await setupGamePage();

const sounds = new Sounds();
const [pets, scenery] = await Promise.all([
  Promise.all(PETS.map(async (kind) => [kind, await loadGlb(`${PET_DIR}/animal-${kind}.glb`)] as const)),
  Promise.all(SCENERY.map(async (name) => [name, (await loadGlb(`${SCENERY_DIR}/${name}.glb`)).gltf.scene] as const)),
  initPhysics(),
  sounds.load(SFX),
]);

// Each kit has its own colormap under the same material name, so they share within a kit only.
shareMaterials(pets.map(([, glb]) => glb.gltf.scene));
shareMaterials(scenery.map(([, scene]) => scene));

const models: Record<string, PetModel> = Object.fromEntries(
  pets.map(([kind, glb]) => [kind, { scene: glb.gltf.scene, clips: glb.gltf.animations, shape: shapeOf(readGlbParts(glb.buffer)) }]),
);
const game = new StackGame(document.querySelector('#stage')!, models, Object.fromEntries(scenery) as Record<string, THREE.Object3D>, sounds, createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { stack: game });
