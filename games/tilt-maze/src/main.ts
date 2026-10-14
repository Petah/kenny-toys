import { setupGamePage } from '@shared/shell';
import { MATTER_RUNNER, createFixedGame } from '@shared/phaser';
import { LevelScene } from './LevelScene';
import { TitleScene } from './TitleScene';
import { gameSize, isPortrait } from './ui';

await setupGamePage();

let portrait = isPortrait();
const { width, height } = gameSize(portrait);
const game = createFixedGame(document.querySelector('#stage')!, [TitleScene, LevelScene], width, height, {
  physics: { default: 'matter', matter: { gravity: { x: 0, y: 0 }, runner: MATTER_RUNNER } },
});

// Turning the phone swaps to the mirrored layout: resize the game and start the scene again.
window.addEventListener('resize', () => {
  if (isPortrait() === portrait) return;
  portrait = isPortrait();
  const size = gameSize(portrait);
  game.scale.setGameSize(size.width, size.height);
  const scene = game.scene.getScenes(true)[0];
  scene?.scene.restart(scene.scene.settings.data);
});

// Handy for poking at the game from devtools and automated checks: `scene` is whichever scene is running.
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'scene', { get: () => game.scene.getScenes(true)[0] });
  Object.assign(window, { game });
}
