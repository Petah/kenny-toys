import { setupGamePage } from '@shared/shell';
import { MATTER_RUNNER, createFixedGame } from '@shared/phaser';
import { LevelScene } from './LevelScene';
import { TitleScene } from './TitleScene';
import { HEIGHT, WIDTH } from './ui';

await setupGamePage();

const game = createFixedGame(document.querySelector('#stage')!, [TitleScene, LevelScene], WIDTH, HEIGHT, {
  physics: {
    default: 'matter',
    matter: {
      runner: MATTER_RUNNER,
      gravity: { x: 0, y: 1 },
      enableSleeping: true,
      positionIterations: 10,
      velocityIterations: 8,
    },
  },
});

// Handy for poking at the game from devtools and automated checks: `scene` is whichever scene is running.
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'scene', { get: () => game.scene.getScenes(true)[0] });
  Object.assign(window, { game });
}
