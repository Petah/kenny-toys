import type { SfxGroups } from '@shared/phaser';

export const BLASTER_DIR = '3D assets/Blaster Kit/Models/GLB format';
export const MODELS = ['blaster-a', 'blaster-d', 'blaster-f', 'blaster-h', 'bullet-foam', 'bullet-foam-tip', 'target-large', 'target-small', 'target-fragment-large', 'target-fragment-small', 'crate-medium', 'crate-wide', 'crate-small', 'clip-small', 'smoke'];

const UI = 'Audio/Interface Sounds/Audio';
const IMPACT = 'Audio/Impact Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  fire: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  pop: [`Audio/Digital Audio/Audio/pepSound2.ogg`, `Audio/Digital Audio/Audio/pepSound4.ogg`],
  hit: [0, 1, 2].map((n) => `${IMPACT}/impactPlate_light_00${n}.ogg`),
  thunk: [0, 1, 2].map((n) => `${IMPACT}/impactWood_light_00${n}.ogg`),
  soft: [0, 1, 2].map((n) => `${IMPACT}/impactSoft_medium_00${n}.ogg`),
  reload: [`${UI}/switch_002.ogg`],
  ready: [`${UI}/switch_004.ogg`],
  empty: [`${UI}/error_008.ogg`],
  up: [`${UI}/maximize_004.ogg`],
  bull: [`${UI}/confirmation_004.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [`${UI}/tick_002.ogg`],
  buzzer: ['Audio/Digital Audio/Audio/lowThreeTone.ogg'],
  go: [`${VOICE}/go.ogg`],
  hurry: [`${VOICE}/hurry_up.ogg`],
  timeOver: [`${VOICE}/time_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Mission Plausible.ogg';
