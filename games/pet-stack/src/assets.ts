import type { SfxGroups } from '@shared/phaser';

export const PET_DIR = '3D assets/Cube Pets/Models/GLB format';
export const SCENERY_DIR = '3D assets/Platformer Kit/Models/GLB format';
export const SCENERY = ['block-grass-large-tall', 'tree', 'tree-pine', 'flowers', 'flowers-tall', 'grass', 'rocks', 'fence-straight', 'flag', 'hedge', 'mushrooms', 'plant', 'heart'];

const UI = 'Audio/Interface Sounds/Audio';
const IMPACT = 'Audio/Impact Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const PIZZ = 'Audio/Music Jingles/Audio (Pizzicato)';

export const SFX = {
  turn: [1, 2, 3].map((n) => `${UI}/select_00${n}.ogg`),
  drop: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  land: [0, 1, 2, 3, 4].map((n) => `${IMPACT}/impactSoft_medium_00${n}.ogg`),
  knock: [0, 1, 2, 3, 4].map((n) => `${IMPACT}/impactWood_light_00${n}.ogg`),
  settle: [1, 2].map((n) => `${UI}/pluck_00${n}.ogg`),
  fall: ['Audio/Digital Audio/Audio/lowDown.ogg'],
  oops: [`${UI}/error_005.ogg`],
  poof: [3, 4].map((n) => `${UI}/minimize_00${n}.ogg`),
  tick: [`${UI}/tick_001.ogg`],
  metre: [`${PIZZ}/jingles-pizzicato_01.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  go: [`${VOICE}/go.ogg`],
  over: [`${VOICE}/game_over.ogg`],
  sad: [`${PIZZ}/jingles-pizzicato_09.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Farm Frolics.ogg';
