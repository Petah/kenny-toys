import type { SfxGroups } from '@shared/phaser';

export const FOOD_DIR = '3D assets/Food Kit/Models/GLB format';
export const PROPS = ['bottle-ketchup', 'bottle-musterd', 'pot-stew-lid', 'frying-pan', 'knife-block', 'cutting-board', 'pepper-mill', 'shaker-salt', 'shaker-pepper', 'mug', 'soda-bottle', 'fries', 'hot-dog', 'cup-coffee', 'bowl-soup'];
export const MODELS = ['burger', 'burger-cheese-double', 'bacon', 'egg-cooked', 'fish-bones', 'soda-can-crushed', 'candy-bar-wrapper', 'plate', ...PROPS];

const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const SAX = 'Audio/Music Jingles/Audio (Saxophone)';

export const SFX = {
  plop: [0, 1, 2, 3, 4].map((n) => `Audio/Impact Sounds/Audio/impactSoft_medium_00${n}.ogg`),
  bell: [0, 1].map((n) => `Audio/Impact Sounds/Audio/impactBell_heavy_00${n}.ogg`),
  cash: [1, 2, 3].map((n) => `Audio/Casino Audio/Audio/chips-collide-${n}.ogg`),
  yuck: [`${UI}/error_004.ogg`],
  bin: [`${UI}/drop_002.ogg`, `${UI}/drop_003.ogg`],
  pop: [`${UI}/maximize_006.ogg`],
  whoosh: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [`${UI}/tick_002.ogg`],
  go: [`${VOICE}/go.ogg`],
  hurry: [`${VOICE}/hurry_up.ogg`],
  timeOver: [`${VOICE}/time_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  done: [`${SAX}/jingles-saxophone_00.ogg`],
  sad: [`${SAX}/jingles-saxophone_03.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Swinging Pants.ogg';
