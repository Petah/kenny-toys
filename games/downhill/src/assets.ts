import * as Phaser from 'phaser';
import { preloadIcons } from '@shared/icons';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const IMPACT = 'Audio/Impact Sounds/Audio';
const RETRO1 = 'Audio/Retro Sounds 1/Audio';
const RETRO2 = 'Audio/Retro Sounds 2/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  carve: [0, 1, 2, 3, 4].map((n) => `${IMPACT}/footstep_snow_00${n}.ogg`),
  crash: [0, 1, 2].map((n) => `${IMPACT}/impactSoft_heavy_00${n}.ogg`),
  thud: [0, 1].map((n) => `${IMPACT}/impactWood_heavy_00${n}.ogg`),
  ouch: [1, 2].map((n) => `${RETRO2}/hurt${n}.ogg`),
  jump: [1, 2].map((n) => `${RETRO2}/jump${n}.ogg`),
  whoosh: [2, 5].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  gate: [1, 2, 3].map((n) => `${RETRO2}/coin${n}.ogg`),
  milestone: [`${RETRO2}/upgrade2.ogg`],
  roar: [1, 3].map((n) => `${RETRO1}/creature${n}.ogg`),
  rumble: [`${RETRO1}/rumble1.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  record: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_03.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'game_over', 'new_highscore', 'war_look_out'] as const;
export type Voice = (typeof VOICES)[number];

/** Every tile in the pack, as one sheet of 16px frames numbered like the pack's Tiles folder. */
export const SKI = 'ski';
export const TILE = 16;

export function preloadAssets(scene: Phaser.Scene) {
  preloadIcons(scene);
  scene.load.spritesheet(SKI, kenney('2D assets/Tiny Ski/Tilemap/tilemap_packed.png'), { frameWidth: TILE, frameHeight: TILE });
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Infinite Descent.ogg'));
}

/** Tile numbers in the pack's sheet. */
export const T = {
  skier: { green: [70, 71], blue: [82, 83] },
  yeti: { run: [78, 79], roar: 80 },
  snow: 0,
  tracks: 58,
  ramp: 36,
  flagRed: 20,
  flagBlue: 21,
  banner: [22, 23],
  lift: { top: 42, pole: 54, base: 66, cable: 46, chairHanger: 44, chair: 57, gondola: [55, 56, 67, 68] },
} as const;

/** The font tiles: digits and a colon, a blob, then A to Z and some symbols, twelve to a row from tile 84. */
const FONT_CHARS = '0123456789:~ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%+-*/=.';
export const PIXEL_FONT = 'ski-font';

/** Registers the pack's pixel letters as a bitmap font. */
export function createFont(scene: Phaser.Scene) {
  if (scene.cache.bitmapFont.exists(PIXEL_FONT)) return;
  // Phaser's types for RetroFont don't match what it takes and returns, hence the casts.
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: SKI,
    width: TILE,
    height: TILE,
    chars: FONT_CHARS,
    charsPerRow: 12,
    offset: { x: 0, y: 7 * TILE },
    spacing: { x: 0, y: 0 },
    lineSpacing: 2,
  } as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig) as unknown as { data: { chars: Record<number, { width: number; height: number; xAdvance: number }> } };
  const chars = entry.data.chars;
  // The letters are drawn with a pixel of margin either side, so they can sit a little closer.
  for (const c of Object.values(chars)) c.xAdvance = TILE - 2;
  // There's no space in the sheet: borrow a letter's entry with nothing to draw.
  chars[32] = { ...chars['A'.charCodeAt(0)], width: 0, height: 0, xAdvance: 8 };
  scene.cache.bitmapFont.add(PIXEL_FONT, entry);
}
