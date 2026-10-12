import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const PACK = '2D assets/Shooting Gallery/Spritesheets';
export const ATLASES = ['hud', 'objects', 'stall'] as const;
export type Atlas = (typeof ATLASES)[number];

const DESERT = '2D assets/Desert Shooter Pack/Sounds';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  shoot: ['a', 'b', 'c', 'd'].map((v) => `${DESERT}/shoot-${v}.ogg`),
  bonus: ['a', 'b'].map((v) => `${DESERT}/coin-${v}.ogg`),
  hitWood: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactWood_light_00${n}.ogg`),
  hitMetal: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactPlate_light_00${n}.ogg`),
  miss: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactSoft_medium_00${n}.ogg`),
  empty: [1, 2].map((n) => `Audio/Interface Sounds/Audio/click_00${n}.ogg`),
  load: [1, 2, 3, 4].map((n) => `Audio/Interface Sounds/Audio/toggle_00${n}.ogg`),
} satisfies SfxGroups;

export const VOICES = ['ready', 'go', 'hurry_up', 'time_over', 'new_highscore', '1', '2', '3', '4', '5'] as const;
export type Voice = (typeof VOICES)[number];

export function preloadAssets(scene: Phaser.Scene) {
  for (const atlas of ATLASES) {
    scene.load.atlasXML(atlas, kenney(`${PACK}/spritesheet_${atlas}.png`), kenney(`${PACK}/spritesheet_${atlas}.xml`));
  }
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Polka Train.ogg'));
}
