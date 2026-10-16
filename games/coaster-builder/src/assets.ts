import type { SfxGroups } from '@shared/phaser';

export const COASTER_DIR = '3D assets/Coaster Kit/Models/GLB format';
export const MODELS = [
  'coaster-steel-track', 'coaster-steel-cap-back', 'coaster-train-front', 'coaster-train', 'support-small', 'support-small-bottom',
  'station', 'station-fence', 'station-gate', 'ride-entrance', 'ride-exit', 'tree', 'tree-large', 'stall-drinks', 'stall-food',
  'stall-information', 'stall-toilets', 'bench', 'trash', 'flowers', 'grass', 'park-entrance', 'path-straight', 'path-corner',
];

const UI = 'Audio/Interface Sounds/Audio';
const STEEL = 'Audio/Music Jingles/Audio (Steeldrum)';

export const SFX = {
  place: [1, 2].map((n) => `${UI}/drop_00${n}.ogg`),
  undo: [`${UI}/back_001.ogg`],
  nope: [`${UI}/error_004.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  clank: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactMetal_light_00${n}.ogg`),
  bell: ['Audio/Impact Sounds/Audio/impactBell_heavy_000.ogg'],
  rumble: ['Audio/Sci-Fi Sounds/Audio/engineCircular_000.ogg'],
  whoosh: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  done: [`${STEEL}/jingles-steel_02.ogg`],
  great: [`${STEEL}/jingles-steel_05.ogg`],
  sad: [`${STEEL}/jingles-steel_10.ogg`],
  go: ['Audio/Voiceover Pack/Audio (Female)/go.ogg'],
  best: ['Audio/Voiceover Pack/Audio (Female)/new_highscore.ogg'],
  ok: [`${UI}/confirmation_002.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Mishief Stroll.ogg';
