import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { JumpScene } from './JumpScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [JumpScene]);
// Handy for poking at the scene from devtools and automated checks.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('jump') }));
