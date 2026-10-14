import type { SfxGroups } from '@shared/phaser';

export const KIT = '3D assets/Marble Kit';
export const MODEL_DIR = `${KIT}/Models/GLB format`;
const IMPACT = 'Audio/Impact Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';

export const SFX = {
  clack: [0, 1, 2, 3, 4].map((n) => `${IMPACT}/impactGlass_light_00${n}.ogg`),
  place: [1, 2, 3, 4].map((n) => `${UI}/drop_00${n}.ogg`),
  undo: [`${UI}/back_001.ogg`, `${UI}/back_002.ogg`],
  nope: [`${UI}/error_004.ogg`],
  drop: [`${UI}/confirmation_001.ogg`],
  finish: [1, 2, 3].map((n) => `Audio/Retro Sounds 2/Audio/coin${n}.ogg`),
  pop: [`${UI}/drop_002.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Wacky Waiting.ogg';

/** The kit's own 64px render of a piece, for its palette button. */
export const preview = (model: string) => `${KIT}/Previews/${model}.png`;
