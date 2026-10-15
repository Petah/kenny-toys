import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { bakeArt } from './assets';
import { PopScene } from './PopScene';

const [, art] = await Promise.all([setupGamePage(), bakeArt()]);

const game = createGame(document.querySelector('#stage')!, [new PopScene(art)]);
// Handy for poking at the scene from devtools.
if (import.meta.env.DEV) game.events.once('ready', () => Object.assign(window, { scene: game.scene.getScene('pop') }));
