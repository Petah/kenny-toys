import { setupGamePage } from '@shared/shell';
import { MATTER_RUNNER, createGame } from '@shared/phaser';
import { FarmScene } from './FarmScene';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [FarmScene], {
  physics: {
    default: 'matter',
    matter: { runner: MATTER_RUNNER, gravity: { x: 0, y: 1 } },
  },
});
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('farm') }));
