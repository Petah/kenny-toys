import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { RaidScene } from './RaidScene';

await setupGamePage();

// Pixel art: nearest-neighbour scaling, and whole-pixel positions so sprites don't shimmer.
const game = createGame(document.querySelector('#stage')!, [RaidScene], { pixelArt: true });
// Handy for poking at the scene from devtools and automated checks.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { game, scene: game.scene.getScene('raid') }));
