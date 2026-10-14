import * as Phaser from 'phaser';
import { preloadIcons } from '@shared/icons';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const DESERT = '2D assets/Desert Shooter Pack/Sounds';
const RPG = 'Audio/RPG Audio/Audio';

export const SFX = {
  slice: [`${RPG}/knifeSlice.ogg`, `${RPG}/knifeSlice2.ogg`],
  whoosh: [1, 2, 3, 4].map((n) => `${RPG}/cloth${n}.ogg`),
  splat: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactSoft_heavy_00${n}.ogg`),
  boom: ['a', 'b'].map((v) => `${DESERT}/explosion-${v}.ogg`),
  combo: ['a', 'c'].map((v) => `${DESERT}/coin-${v}.ogg`),
  miss: [`${DESERT}/hurt-a.ogg`],
} satisfies SfxGroups;

export const SPLAT_COUNT = 36;

export function preloadAssets(scene: Phaser.Scene) {
  preloadIcons(scene);
  scene.load.atlasXML('donuts', kenney('2D assets/Donuts/Spritesheet/donuts_sheet.png'), kenney('2D assets/Donuts/Spritesheet/donuts_sheet.xml'));
  for (let i = 0; i < SPLAT_COUNT; i++) {
    const n = String(i).padStart(2, '0');
    scene.load.image(`splat${n}`, kenney(`2D assets/Splat Pack/PNG/Default (256px)/splat${n}.png`));
  }
  scene.load.image('bomb', kenney('2D assets/New Platformer Pack/Sprites/Tiles/Double/bomb.png'));
  scene.load.image('bomb-flash', kenney('2D assets/New Platformer Pack/Sprites/Tiles/Double/bomb_active.png'));
  const boom = '2D assets/Explosion Pack/Spritesheets/spritesheet_regularExplosion';
  scene.load.atlasXML('boom', kenney(`${boom}.png`), kenney(`${boom}.xml`));
  scene.load.image('drop', kenney('2D assets/Particle Pack/PNG (Transparent)/circle_05.png'));
  preloadSfx(scene, SFX);
  scene.load.audio('voice:game_over', kenney('Audio/Voiceover Pack/Audio (Female)/game_over.ogg'));
  scene.load.audio('voice:new_highscore', kenney('Audio/Voiceover Pack/Audio (Female)/new_highscore.ogg'));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Wacky Waiting.ogg'));
}
