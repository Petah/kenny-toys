import type { SfxGroups } from '@shared/phaser';

export const TD_DIR = '3D assets/Tower Defense Kit/Models/GLB format';
export const MODELS = [
  'tile', 'tile-straight', 'tile-corner-round', 'tile-end', 'tile-spawn-end', 'tile-tree', 'tile-tree-double', 'tile-tree-quad', 'tile-rock', 'tile-crystal', 'tile-hill', 'tile-dirt',
  ...['round', 'square'].flatMap((s) => ['bottom-a', 'middle-a', 'top-a', 'roof-a'].map((p) => `tower-${s}-${p}`)),
  'weapon-turret', 'weapon-cannon', 'weapon-ballista', 'weapon-catapult', 'weapon-ammo-bullet', 'weapon-ammo-cannonball', 'weapon-ammo-arrow', 'weapon-ammo-boulder',
  'enemy-ufo-a', 'enemy-ufo-b', 'enemy-ufo-c', 'enemy-ufo-d', 'enemy-ufo-beam', 'selection-a', 'spawn-round', 'detail-tree', 'detail-rocks', 'detail-crystal',
];

const SCI = 'Audio/Sci-Fi Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  turret: [0, 1].map((n) => `${SCI}/laserSmall_00${n}.ogg`),
  cannon: [`${SCI}/explosionCrunch_000.ogg`],
  ballista: [`${SCI}/laserRetro_002.ogg`],
  catapult: [`${SCI}/thrusterFire_002.ogg`],
  hit: [0, 1].map((n) => `${SCI}/impactMetal_00${n}.ogg`),
  boom: [1, 2].map((n) => `${SCI}/explosionCrunch_00${n}.ogg`),
  bigBoom: [`${SCI}/lowFrequency_explosion_000.ogg`],
  leak: [`${SCI}/forceField_000.ogg`],
  build: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactPlank_medium_00${n}.ogg`),
  upgrade: ['Audio/Digital Audio/Audio/powerUp3.ogg'],
  sell: ['Audio/Digital Audio/Audio/phaserDown2.ogg'],
  coin: [1, 2].map((n) => `Audio/Retro Sounds 2/Audio/coin${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  nope: [`${UI}/error_004.ogg`],
  cleared: [`${UI}/confirmation_002.ogg`],
  close: [`${UI}/minimize_004.ogg`],
  go: [`${VOICE}/go.ogg`],
  final: [`${VOICE}/final_round.ogg`],
  won: [`${VOICE}/you_win.ogg`],
  lost: [`${VOICE}/game_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Space Cadet.ogg';
