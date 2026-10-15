import * as THREE from 'three';
import { Sounds } from '@shared/audio';
import { readGlb, type Triangles } from '@shared/glb';
import { kenney } from '@shared/kenney';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { KIT, MODEL_DIR, PROPS, SFX, VEHICLES } from './assets.ts';
import { KartGame } from './game.ts';
import { initPhysics } from './physics.ts';
import { CIRCUITS, build } from './track.ts';

await setupGamePage();

// Every piece any circuit uses, plus the cars and props.
const pieces = new Set(CIRCUITS.flatMap((c) => build(c).pieces.map((p) => p.model)));
const names = [...pieces, ...VEHICLES.map((v) => `vehicle-${v}`), ...PROPS];
const sounds = new Sounds();
const loader = new THREE.TextureLoader();
const [loaded, textures] = await Promise.all([
  Promise.all(names.map(async (name) => [name, await loadGlb(`${MODEL_DIR}/${name}.glb`)] as const)),
  Promise.all(['variation-a', 'variation-b'].map(async (v) => [v, await loader.loadAsync(kenney(`${KIT}/Textures/${v}.png`))] as const)),
  initPhysics(),
  sounds.load(SFX),
]);

const models = Object.fromEntries(loaded.map(([name, glb]) => [name, glb.gltf.scene]));
shareMaterials(Object.values(models));
const buffers = new Map(loaded.map(([name, glb]) => [name, glb.buffer]));
const cache = new Map<string, Triangles>();
const triangles = (model: string) => {
  if (!cache.has(model)) cache.set(model, readGlb(buffers.get(model)!));
  return cache.get(model)!;
};

const game = new KartGame(document.querySelector('#stage')!, models, triangles, sounds, Object.fromEntries(textures), createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { kart: game });
