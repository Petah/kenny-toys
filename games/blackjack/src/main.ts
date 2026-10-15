import { setupGamePage } from '@shared/shell';
import { loadKenneyFont } from '@shared/fonts';
import { createGame } from '@shared/phaser';
import { TableScene } from './TableScene';

// The table's lettering is drawn from Kenney Pixel, so it has to be loaded before the scene builds it.
await Promise.all([setupGamePage(), loadKenneyFont('Kenney Pixel')]);

// Pixel art: nearest-neighbour scaling, and whole-pixel positions so cards don't shimmer.
const game = createGame(document.querySelector('#stage')!, [TableScene], { pixelArt: true });
// Handy for poking at the scene from devtools and automated checks.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { game, scene: game.scene.getScene('table') }));
