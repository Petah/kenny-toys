import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { LevelScene } from './LevelScene';
import { TitleScene } from './TitleScene';

await setupGamePage();

// The board scales to whatever space there is, so this one fills the page rather than letterboxing.
const game = createGame(document.querySelector('#stage')!, [TitleScene, LevelScene]);

// Handy for poking at the game from devtools and automated checks: `scene` is whichever scene is running.
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'scene', { get: () => game.scene.getScenes(true)[0] });
  Object.assign(window, { game });
}
