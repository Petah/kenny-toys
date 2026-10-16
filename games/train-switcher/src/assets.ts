import type { SfxGroups } from '@shared/phaser';

export const TRAIN_DIR = '3D assets/Train Kit/Models/GLB format';
export const NATURE_DIR = '3D assets/Nature Kit/Models/GLTF format';
export const RAILS = ['railroad-straight', 'railroad-corner-small'];
export const NATURE = [
  'tree_default', 'tree_oak', 'tree_cone', 'tree_fat', 'tree_pineRoundA', 'tree_pineRoundC',
  'rock_largeA', 'rock_largeC', 'rock_smallA', 'rock_smallC', 'flower_redA', 'flower_yellowA', 'flower_purpleA',
  'grass', 'grass_large', 'plant_bush', 'cliff_block_rock', 'cliff_cave_rock', 'cliff_top_rock', 'cliff_large_rock',
];

const UI = 'Audio/Interface Sounds/Audio';
const STEEL = 'Audio/Music Jingles/Audio (Steeldrum)';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  flip: [2, 3, 5, 7].map((n) => `Audio/UI Audio/Audio/switch${n}.ogg`),
  locked: [`${UI}/error_008.ogg`],
  right: [`${UI}/confirmation_001.ogg`, `${UI}/confirmation_002.ogg`],
  bell: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactBell_heavy_00${n}.ogg`),
  wrong: [`${UI}/error_006.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [`${UI}/tick_002.ogg`],
  go: [`${VOICE}/go.ogg`],
  levelUp: [`${VOICE}/level_up.ogg`],
  over: [`${VOICE}/game_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  clear: [`${STEEL}/jingles-steel_00.ogg`],
  perfect: [`${STEEL}/jingles-steel_04.ogg`],
  sad: [`${STEEL}/jingles-steel_09.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Polka Train.ogg';
