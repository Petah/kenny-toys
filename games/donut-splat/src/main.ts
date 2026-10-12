import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { SplatScene } from './SplatScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [SplatScene]);
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('splat') }));
