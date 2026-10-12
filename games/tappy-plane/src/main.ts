import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { PlaneScene } from './PlaneScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [PlaneScene]);
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('tappy') }));
