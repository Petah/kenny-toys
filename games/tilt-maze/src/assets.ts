import * as Phaser from 'phaser';
import { preloadIcons } from '@shared/icons';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const PACK = '2D assets/Rolling Ball Assets/Spritesheet/rollingBall_sheet';
const RETRO = 'Audio/Retro Sounds 2/Audio';
const DIGITAL = 'Audio/Digital Audio/Audio';
const SCIFI = 'Audio/Sci-Fi Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  knock: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactPlate_light_00${n}.ogg`),
  fall: [1, 2, 3].map((n) => `${RETRO}/fall${n}.ogg`),
  respawn: [`${DIGITAL}/phaseJump1.ogg`],
  star: [1, 2, 3].map((n) => `${RETRO}/coin${n}.ogg`),
  key: [`${RETRO}/secret1.ogg`],
  unlock: [`${SCIFI}/doorOpen_000.ogg`],
  zap: [`${DIGITAL}/zap1.ogg`, `${DIGITAL}/zap2.ogg`],
  laser: [`${SCIFI}/forceField_000.ogg`],
  goal: [`${DIGITAL}/threeTone1.ogg`],
  click: [`${UI}/click_001.ogg`, `${UI}/click_002.ogg`],
  fail: [`${UI}/error_004.ogg`],
} satisfies SfxGroups;

export const JINGLES = {
  win: 'Audio/Music Jingles/Audio (Hit)/jingles-hit_00.ogg',
  finale: 'Audio/Music Jingles/Audio (Hit)/jingles-hit_04.ogg',
};

export const VOICES = ['level', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'you_win', 'congratulations', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

export function preloadAssets(scene: Phaser.Scene) {
  preloadIcons(scene);
  scene.load.atlasXML('rb', kenney(`${PACK}.png`), kenney(`${PACK}.xml`));
  scene.load.image('sparkle', kenney('2D assets/Particle Pack/PNG (Transparent)/star_06.png'));
  preloadSfx(scene, SFX);
  for (const [name, file] of Object.entries(JINGLES)) scene.load.audio(`jingle:${name}`, kenney(file));
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Flowing Rocks.ogg'));
}
