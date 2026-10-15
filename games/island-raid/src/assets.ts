import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import { createPixelFont } from '@shared/pixelfont';
import { TILE } from './terrain';

const SHMUP = '2D assets/Pixel Shmup/Tilemap';
const RETRO1 = 'Audio/Retro Sounds 1/Audio';
const RETRO2 = 'Audio/Retro Sounds 2/Audio';
const SCIFI = 'Audio/Sci-Fi Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  shoot: [1, 2].map((n) => `${RETRO1}/laser${n}.ogg`),
  hit: [1, 2, 3].map((n) => `${RETRO2}/hit${n}.ogg`),
  pop: [1, 2, 3].map((n) => `${RETRO2}/explosion${n}.ogg`),
  boom: [0, 1].map((n) => `${SCIFI}/lowFrequency_explosion_00${n}.ogg`),
  bombDrop: [1, 2].map((n) => `${RETRO2}/fall${n}.ogg`),
  bombHit: [0, 1, 2].map((n) => `${SCIFI}/explosionCrunch_00${n}.ogg`),
  splash: [1, 2].map((n) => `Audio/Impact Sounds/Audio/impactSoft_medium_00${n}.ogg`),
  enemyShot: [1, 2].map((n) => `Audio/Digital Audio/Audio/laser${n + 4}.ogg`),
  powerUp: [`${RETRO2}/upgrade1.ogg`],
  pickup: [1, 2].map((n) => `${RETRO1}/pickup${n}.ogg`),
  shield: [`${SCIFI}/forceField_000.ogg`],
  hurt: [1, 2].map((n) => `${RETRO2}/hurt${n}.ogg`),
  warn: [`${RETRO1}/radar1.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  record: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_01.ogg'],
  victory: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_04.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'game_over', 'new_highscore', 'power_up', 'war_look_out', 'war_target_destroyed'] as const;
export type Voice = (typeof VOICES)[number];

/** Texture keys: the pack's 16px tiles and 32px ships, numbered like its Tiles and Ships folders. */
export const TILES = 'tiles';
export const SHIPS = 'ships';
export const SHIP = 32;
const SKI = 'ski';

/** Tile numbers in the tile sheet. */
export const T = {
  bullet: 0,
  bulletDouble: 1,
  enemyBullet: 9,
  flash: [4, 5, 6, 7],
  smoke: 8,
  bomb: 12,
  bunker: 16,
  truck: 17,
  repair: 24,
  power: 25,
  shield: 26,
  reticle: 27,
  gun: 28,
  tank: 29,
  shell: 30,
} as const;

/** Ships by colour, in three sizes; each has a grey twin twelve along, used to flash when hit. */
export const COLOURS = ['blue', 'red', 'green', 'yellow'] as const;
export type Colour = (typeof COLOURS)[number];
export const shipFrame = (size: 'large' | 'medium' | 'small', colour: Colour) => ({ large: 0, medium: 4, small: 8 })[size] + COLOURS.indexOf(colour);
export const GREY = 12;

export const PIXEL_FONT = 'raid-font';
/** Tiny Ski's lettering is the same Kenney pixel alphabet as this pack's numbers; it's recoloured to match. */
const FONT_CHARS = '0123456789:~ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%+-*/=.';

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.spritesheet(TILES, kenney(`${SHMUP}/tiles_packed.png`), { frameWidth: TILE, frameHeight: TILE });
  scene.load.spritesheet(SHIPS, kenney(`${SHMUP}/ships_packed.png`), { frameWidth: SHIP, frameHeight: SHIP });
  scene.load.spritesheet(SKI, kenney('2D assets/Tiny Ski/Tilemap/tilemap_packed.png'), { frameWidth: TILE, frameHeight: TILE });
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Mission Plausible.ogg'));
}

export function createFont(scene: Phaser.Scene) {
  createPixelFont(scene, PIXEL_FONT, {
    image: SKI,
    tile: TILE,
    chars: FONT_CHARS,
    charsPerRow: 12,
    offset: { x: 0, y: 7 * TILE },
    recolor: [[0x3f2631, 0x434a5f]],
  });
}
