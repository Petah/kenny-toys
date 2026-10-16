import * as THREE from 'three';
import { Sounds } from '@shared/audio';
import { setupGamePage } from '@shared/shell';
import { createRenderer, loadGlb, shareMaterials } from '@shared/three';
import { NATURE, NATURE_DIR, RAILS, SFX, TRAIN_DIR } from './assets.ts';
import { SwitcherGame } from './game.ts';
import { CARGO, ENGINES } from './trains.ts';

await setupGamePage();

const sounds = new Sounds();
const trainNames = [...RAILS, ...ENGINES, ...CARGO.map((c) => c.wagon)];
const [trains, nature] = await Promise.all([
  Promise.all(trainNames.map(async (name) => [name, (await loadGlb(`${TRAIN_DIR}/${name}.glb`)).gltf.scene] as const)),
  Promise.all(NATURE.map(async (name) => [name, (await loadGlb(`${NATURE_DIR}/${name}.glb`)).gltf.scene] as const)),
  sounds.load(SFX),
]);
// The Train Kit shares one colormap; the Nature Kit's flat colours are shared by name.
shareMaterials(trains.map(([, s]) => s));
shareMaterials(nature.map(([, s]) => s));
// Nature Kit materials are exported fully metallic, which draws black without an environment
// map, and its teal greens clash with the meadow, so they're recoloured to match.
const NATURE_COLOURS: Record<string, number> = { leafsGreen: 0x5aa83e, leafsDark: 0x3f8a46, grass: 0x78b84e, dirt: 0x9c7a5e, woodBark: 0x8a5a3c, woodBarkDark: 0x7a4e36 };
for (const [, s] of nature) {
  s.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    m.metalness = 0;
    if (NATURE_COLOURS[m.name] !== undefined) m.color.setHex(NATURE_COLOURS[m.name]);
  });
}

const game = new SwitcherGame(document.querySelector('#stage')!, Object.fromEntries([...trains, ...nature]), sounds, createRenderer);
document.body.classList.remove('loading');

// Handy for poking at the game from devtools and automated checks.
if (import.meta.env.DEV) Object.assign(window, { yard: game });
