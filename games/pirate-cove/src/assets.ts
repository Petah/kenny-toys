import type { SfxGroups } from '@shared/phaser';

export const PIRATE_DIR = '3D assets/Pirate Kit/Models/GLB format';
export const MODELS = [
  'ship-pirate-small', 'ship-small', 'ship-medium', 'ship-large', 'cannon-ball', 'barrel', 'crate', 'chest',
  'patch-sand', 'patch-sand-foliage', 'patch-grass-foliage', 'palm-straight', 'palm-bend', 'palm-detailed-straight',
  'rocks-a', 'rocks-b', 'rocks-c', 'rocks-sand-a', 'rocks-sand-b', 'tower-complete-small', 'flag-pirate', 'ship-wreck',
];

const SCI = 'Audio/Sci-Fi Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  cannon: [0, 1].map((n) => `${SCI}/lowFrequency_explosion_00${n}.ogg`),
  hit: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactWood_heavy_00${n}.ogg`),
  boom: [`${SCI}/explosionCrunch_000.ogg`, `${SCI}/explosionCrunch_002.ogg`],
  splash: [1, 2].map((n) => `Audio/Foley Sounds/Audio/Water/sinkWater${n}.ogg`),
  coins: ['Audio/RPG Audio/Audio/handleCoins.ogg', 'Audio/RPG Audio/Audio/handleCoins2.ogg'],
  creak: ['Audio/RPG Audio/Audio/creak1.ogg', 'Audio/RPG Audio/Audio/creak2.ogg'],
  scrape: ['Audio/Foley Sounds/Audio/Rocks/stoneDragHit1.ogg'],
  click: [1, 2].map((n) => `Audio/Interface Sounds/Audio/click_00${n}.ogg`),
  tick: ['Audio/Interface Sounds/Audio/tick_002.ogg'],
  go: [`${VOICE}/go.ogg`],
  hurry: [`${VOICE}/hurry_up.ogg`],
  timeOver: [`${VOICE}/time_over.ogg`],
  sunk: [`${VOICE}/game_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  done: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_06.ogg'],
  sad: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_11.ogg'],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Italian Mom.ogg';
