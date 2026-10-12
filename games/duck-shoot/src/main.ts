import { setupGamePage } from '@shared/shell';
import { createFixedGame } from '@shared/phaser';
import { GalleryScene, HEIGHT, WIDTH } from './GalleryScene';

await setupGamePage();

const game = createFixedGame(document.querySelector('#stage')!, [GalleryScene], WIDTH, HEIGHT);
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('gallery') }));
