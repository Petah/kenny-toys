import type { SfxGroups } from '@shared/phaser';

export const MODEL_DIR = '3D assets/Minigolf Kit/Models/GLB format';
const IMPACT = 'Audio/Impact Sounds/Audio';
const five = (name: string) => [0, 1, 2, 3, 4].map((n) => `${IMPACT}/${name}_00${n}.ogg`);

export const SFX = {
  putt: five('impactMetal_light'),
  knock: five('impactWood_light'),
  cup: five('impactTin_medium'),
  splash: [1, 2, 3, 4].map((n) => `Audio/Foley Sounds/Audio/Water/sinkWater${n}.ogg`),
  click: ['Audio/Interface Sounds/Audio/click_001.ogg', 'Audio/Interface Sounds/Audio/click_002.ogg'],
  good: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_00.ogg'],
  great: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_02.ogg'],
  meh: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_05.ogg'],
  holeInOne: ['Audio/Voiceover Pack/Audio (Male)/congratulations.ogg'],
  record: ['Audio/Voiceover Pack/Audio (Male)/new_highscore.ogg'],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Swinging Pants.ogg';
