import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const PACK = '2D assets/Physics Assets';
const IMPACT = 'Audio/Impact Sounds/Audio';
const DESERT = '2D assets/Desert Shooter Pack/Sounds';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const five = (name: string) => [0, 1, 2, 3, 4].map((n) => `${IMPACT}/${name}_00${n}.ogg`);

export const SFX = {
  glassHit: five('impactGlass_light'),
  glassBreak: five('impactGlass_heavy'),
  woodHit: five('impactWood_light'),
  woodBreak: five('impactPlank_medium'),
  stoneHit: five('impactGeneric_light'),
  stoneBreak: five('impactMining'),
  metalHit: five('impactMetal_light'),
  metalBreak: five('impactMetal_heavy'),
  softHit: five('impactSoft_medium'),
  pop: five('impactSoft_heavy'),
  creature: [1, 2, 3, 4, 5].map((n) => `Audio/Retro Sounds 1/Audio/creature${n}.ogg`),
  stretch: [1, 2, 3].map((n) => `Audio/RPG Audio/Audio/creak${n}.ogg`),
  launch: [1, 2, 3, 4].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  boom: ['a', 'b'].map((v) => `${DESERT}/explosion-${v}.ogg`),
  coin: ['a', 'b'].map((v) => `${DESERT}/coin-${v}.ogg`),
  click: [1, 2].map((n) => `Audio/Interface Sounds/Audio/click_00${n}.ogg`),
  star: ['Audio/Interface Sounds/Audio/confirmation_001.ogg'],
  fail: ['Audio/Interface Sounds/Audio/error_004.ogg'],
} satisfies SfxGroups;

export const JINGLES = {
  win: 'Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_00.ogg',
  start: 'Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_05.ogg',
  lose: 'Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_01.ogg',
};

export const VOICES = ['level', 'you_win', 'you_lose', 'new_highscore', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
export type Voice = (typeof VOICES)[number];

export const BACKDROPS = ['grass', 'desert', 'shroom', 'land'] as const;

export function preloadAssets(scene: Phaser.Scene) {
  for (const atlas of ['elements', 'aliens', 'debris', 'tiles']) {
    scene.load.atlasXML(atlas, kenney(`${PACK}/Spritesheet/spritesheet_${atlas}.png`), kenney(`${PACK}/Spritesheet/spritesheet_${atlas}.xml`));
  }
  for (const b of BACKDROPS) scene.load.image(`bg:${b}`, kenney(`${PACK}/PNG/Backgrounds/colored_${b}.png`));
  const boom = '2D assets/Explosion Pack/Spritesheets/spritesheet_regularExplosion';
  scene.load.atlasXML('boom', kenney(`${boom}.png`), kenney(`${boom}.xml`));
  scene.load.image('puff', kenney('2D assets/Smoke Particles/PNG/White puff/whitePuff00.png'));

  preloadSfx(scene, SFX);
  for (const [name, file] of Object.entries(JINGLES)) scene.load.audio(`jingle:${name}`, kenney(file));
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Farm Frolics.ogg'));
}

/** Textures and animations built once at boot. */
export function createShared(scene: Phaser.Scene) {
  if (!scene.textures.exists('dot')) {
    scene.make.graphics({}, false).fillStyle(0xffffff).fillCircle(8, 8, 8).generateTexture('dot', 16, 16).destroy();
  }
  if (!scene.anims.exists('boom')) {
    scene.anims.create({
      key: 'boom',
      frames: scene.anims.generateFrameNames('boom', { prefix: 'regularExplosion', start: 0, end: 8, zeroPad: 2, suffix: '.png' }),
      frameRate: 20,
    });
  }
}
