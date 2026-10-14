import { Sounds } from '@shared/audio';
import { readGlb, type Triangles } from '@shared/glb';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { MODEL_DIR, SFX } from './assets.ts';
import { MarbleRunGame } from './game.ts';
import { initPhysics } from './physics.ts';
import { ALL_MODELS } from './pieces.ts';
import { bounds, findPorts } from './ports.ts';
import type { Models } from './scene3d.ts';
import type { Shape } from './track.ts';

await setupGamePage();

const sounds = new Sounds();
const [loaded] = await Promise.all([
  Promise.all(ALL_MODELS.map(async (name) => [name, await loadGlb(`${MODEL_DIR}/${name}.glb`)] as const)),
  initPhysics(),
  sounds.load(SFX),
]);

const models: Models = Object.fromEntries(loaded.map(([name, glb]) => [name, glb.gltf.scene]));
shareMaterials(Object.values(models));

// Physics and snapping read the very same files' triangles; ports are worked out once per piece.
const buffers = new Map(loaded.map(([name, glb]) => [name, glb.buffer]));
const triCache = new Map<string, Triangles>();
const triangles = (model: string) => {
  if (!triCache.has(model)) triCache.set(model, readGlb(buffers.get(model)!));
  return triCache.get(model)!;
};
const shapeCache = new Map<string, Shape>();
const shapes = (model: string) => {
  if (!shapeCache.has(model)) shapeCache.set(model, { ports: findPorts(triangles(model)), ...bounds(triangles(model)) });
  return shapeCache.get(model)!;
};

const game = new MarbleRunGame(document.querySelector('#stage')!, models, triangles, shapes, sounds, createRenderer);

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { marbles: game });
