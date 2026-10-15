import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { WellScene } from './WellScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [WellScene]);
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('well') }));
