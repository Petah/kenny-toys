import { Sounds } from '@shared/audio';
import { readGlb, type Triangles } from '@shared/glb';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { MODEL_DIR, SFX } from './assets.ts';
import { MinigolfGame } from './game.ts';
import { initPhysics } from './physics.ts';
import { ALL_MODELS, type Models } from './scene3d.ts';

await setupGamePage();

const sounds = new Sounds();
const [loaded] = await Promise.all([
  Promise.all(ALL_MODELS.map(async (name) => [name, await loadGlb(`${MODEL_DIR}/${name}.glb`)] as const)),
  initPhysics(),
  sounds.load(SFX),
]);

const models: Models = Object.fromEntries(loaded.map(([name, glb]) => [name, glb.gltf.scene]));
shareMaterials(Object.values(models));

// Physics reads the very same files' triangles, cached per model and left-out nodes.
const buffers = new Map(loaded.map(([name, glb]) => [name, glb.buffer]));
const triCache = new Map<string, Triangles>();
const triangles = (model: string, skip: string[] = []) => {
  const key = `${model}|${skip.join(',')}`;
  if (!triCache.has(key)) triCache.set(key, readGlb(buffers.get(model)!, skip));
  return triCache.get(key)!;
};

const game = new MinigolfGame(document.querySelector('#stage')!, models, triangles, sounds, createRenderer);

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { minigolf: game });
