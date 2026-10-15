import type { SfxGroups } from '@shared/phaser';

export const KIT = '3D assets/Toy Car Kit/Models';
export const MODEL_DIR = `${KIT}/GLB format`;

export const VEHICLES = ['racer', 'speedster', 'racer-low', 'vintage-racer', 'drag-racer', 'suv', 'truck', 'monster-truck'] as const;
export type Vehicle = (typeof VEHICLES)[number];
export const VEHICLE_NAMES: Record<Vehicle, string> = {
  racer: 'Racer',
  speedster: 'Speedster',
  'racer-low': 'Low Rider',
  'vintage-racer': 'Vintage',
  'drag-racer': 'Dragster',
  suv: 'SUV',
  truck: 'Van',
  'monster-truck': 'Monster',
};

export const PROPS = ['gate-finish', 'gate', 'item-box', 'item-banana', 'item-coin-gold', 'item-cone', 'smoke', 'tree', 'tree-pine', 'supports-wide'];

const IMPACT = 'Audio/Impact Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  engine: ['Audio/Sci-Fi Sounds/Audio/engineCircular_000.ogg'],
  wall: [0, 1, 2].map((n) => `${IMPACT}/impactPlate_light_00${n}.ogg`),
  bump: [0, 1, 2].map((n) => `${IMPACT}/impactPunch_medium_00${n}.ogg`),
  land: [0, 1, 2].map((n) => `${IMPACT}/impactSoft_heavy_00${n}.ogg`),
  box: ['Audio/Digital Audio/Audio/powerUp3.ogg'],
  coin: [1, 2, 3].map((n) => `Audio/Retro Sounds 1/Audio/pickup${n}.ogg`),
  boost: [0, 1].map((n) => `Audio/Sci-Fi Sounds/Audio/thrusterFire_00${n}.ogg`),
  drop: [0, 1].map((n) => `${IMPACT}/impactSoft_medium_00${n}.ogg`),
  spin: ['Audio/Digital Audio/Audio/phaserDown1.ogg'],
  fall: [`${UI}/error_006.ogg`],
  lap: [`${UI}/confirmation_002.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  three: [`${VOICE}/3.ogg`],
  two: [`${VOICE}/2.ogg`],
  one: [`${VOICE}/1.ogg`],
  go: [`${VOICE}/go.ogg`],
  finalLap: [`${VOICE}/final_round.ogg`],
  win: [`${VOICE}/you_win.ogg`],
  congrats: [`${VOICE}/congratulations.ogg`],
  podium: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_02.ogg'],
  placed: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_00.ogg'],
  meh: ['Audio/Music Jingles/Audio (Saxophone)/jingles-saxophone_05.ogg'],
} satisfies SfxGroups;

export const MUSIC = 'Audio/Music Loops/Loops/Time Driving.ogg';
