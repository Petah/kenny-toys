import { Sounds } from '@shared/audio';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { COASTER_DIR, MODELS, SFX } from './assets.ts';
import { CoasterGame } from './game.ts';

await setupGamePage();

const sounds = new Sounds();
const [models] = await Promise.all([
  Promise.all(MODELS.map(async (name) => [name, (await loadGlb(`${COASTER_DIR}/${name}.glb`)).gltf.scene] as const)),
  sounds.load(SFX),
]);
shareMaterials(models.map(([, s]) => s));

const game = new CoasterGame(document.querySelector('#stage')!, Object.fromEntries(models), sounds, createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { park: game });
