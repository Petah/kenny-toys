import { Sounds } from '@shared/audio';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { FOOD_DIR, MODELS, SFX } from './assets.ts';
import { BurgerGame } from './game.ts';

await setupGamePage();

const sounds = new Sounds();
const [models] = await Promise.all([
  Promise.all(MODELS.map(async (name) => [name, (await loadGlb(`${FOOD_DIR}/${name}.glb`)).gltf.scene] as const)),
  sounds.load(SFX),
]);
shareMaterials(models.map(([, s]) => s));

const game = new BurgerGame(document.querySelector('#stage')!, Object.fromEntries(models), sounds, createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { grill: game });
