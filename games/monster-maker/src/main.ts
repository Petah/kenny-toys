import './style.css';
import { setupGamePage } from '@shared/shell';
import { createGame } from '@shared/phaser';
import { MonsterScene } from './MonsterScene';
import { mountUI } from './ui';

await setupGamePage();

const game = createGame(document.querySelector('#stage')!, [MonsterScene]);
game.events.once('ready', () => {
  const scene = game.scene.getScene<MonsterScene>('monster')!;
  scene.events.once('ready', () => mountUI(scene));
  // Handy for poking at the scene from devtools.
  if (import.meta.env.DEV) Object.assign(window, { scene });
});
