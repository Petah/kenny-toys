import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { GemScene } from './GemScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [GemScene]);
// Handy for poking at the scene from devtools and automated checks.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('gems') }));
