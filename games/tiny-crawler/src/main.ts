import { loadKenneyFont } from '@shared/fonts';
import { createGame } from '@shared/phaser';
import { setupGamePage } from '@shared/shell';
import { CrawlScene } from './CrawlScene';

await Promise.all([setupGamePage(), loadKenneyFont('Kenney Pixel')]);

const game = createGame(document.querySelector('#stage')!, [CrawlScene], { pixelArt: true });
// Handy for poking at the scene from devtools and automated checks.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('crawl') }));
