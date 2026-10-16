import { Sounds } from '@shared/audio';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { MODELS, PIRATE_DIR, SFX } from './assets.ts';
import { CoveGame } from './game.ts';

await setupGamePage();

const sounds = new Sounds();
const [models] = await Promise.all([
  Promise.all(MODELS.map(async (name) => [name, (await loadGlb(`${PIRATE_DIR}/${name}.glb`)).gltf.scene] as const)),
  sounds.load(SFX),
]);
shareMaterials(models.map(([, s]) => s));

const game = new CoveGame(document.querySelector('#stage')!, Object.fromEntries(models), sounds, createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { cove: game });
