import * as Phaser from 'phaser';
import { padAtlas } from '@shared/atlas';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import { PAWN_COLOURS, THEMES } from './rounds';

const DOMINO = '2D assets/Domino Pack/Tilesheets';
const BOARD = '2D assets/Boardgame Pack';
const CASINO = 'Audio/Casino Audio/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const UI = 'Audio/Interface Sounds/Audio';

export const SFX = {
  place: [1, 2, 3].map((n) => `${CASINO}/chip-lay-${n}.ogg`),
  clack: [1, 2, 3, 4].map((n) => `${CASINO}/chips-collide-${n}.ogg`),
  pawn: [1, 2, 3, 4].map((n) => `${CASINO}/die-throw-${n}.ogg`),
  chip: [1, 2, 3].map((n) => `${CASINO}/chips-stack-${n}.ogg`),
  rewind: [`${CASINO}/card-shuffle.ogg`],
  undo: [1, 2].map((n) => `${CASINO}/card-slide-${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  empty: [`${UI}/error_004.ogg`],
  clear: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_00.ogg'],
  miss: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_09.ogg'],
  record: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_05.ogg'],
} satisfies SfxGroups;

export const VOICES = ['round', 'go', 'game_over', 'new_highscore', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;
export type Voice = (typeof VOICES)[number];

/** Texture keys. */
export const DICE = 'dice';
export const CHIPS = 'chips';
export const dominoKey = (set: string) => `domino:${set}`;
export const pawnKey = (colour: number) => `pawn:${colour}`;

/** The pack numbers each colour's pieces a little differently; these are the big round-headed pawn. */
const PAWN_FILE: Partial<Record<string, string>> = { Yellow: '18', Blue: '01' };

/** The chip frames used as bonus pickups, seen from above. */
export const CHIP_FRAMES = ['chipRedWhite_border.png', 'chipBlueWhite_border.png', 'chipGreenWhite_border.png', 'chipBlackWhite_border.png'];

/** Each domino frame is shrunk to this before use; tiles are drawn about a tenth of their 256×512 source. */
const TILE_W = 96;
const TILE_H = 192;
const PAD = 3;

export function preloadAssets(scene: Phaser.Scene) {
  for (const t of THEMES) scene.load.image(`${dominoKey(t.set)}:raw`, kenney(`${DOMINO}/${t.set}.png`));
  PAWN_COLOURS.forEach((c, i) => scene.load.image(pawnKey(i), kenney(`${BOARD}/PNG/Pieces (${c})/piece${c}_border${PAWN_FILE[c] ?? '00'}.png`)));
  scene.load.atlasXML(`${DICE}:raw`, kenney(`${BOARD}/Spritesheets/diceWhite_border.png`), kenney(`${BOARD}/Spritesheets/diceWhite_border.xml`));
  scene.load.atlasXML(`${CHIPS}:raw`, kenney(`${BOARD}/Spritesheets/chips.png`), kenney(`${BOARD}/Spritesheets/chips.xml`));
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
}

export function unpackAssets(scene: Phaser.Scene) {
  for (const key of [DICE, CHIPS]) padAtlas(scene, `${key}:raw`, key);
  for (const t of THEMES) shrinkDominoes(scene, t.set);
}

/**
 * Cuts a domino tilesheet (ten 256×512 tiles a row: 0-0, 0-1 … 6-6, then a blank) into frames
 * 0-28 of a smaller texture with gaps between them. Drawn at a tenth of their size straight from
 * the sheet, the pips shimmer and the tiles pick up their neighbours' edges.
 */
function shrinkDominoes(scene: Phaser.Scene, set: string) {
  const key = dominoKey(set);
  if (scene.textures.exists(key)) return;
  const src = scene.textures.get(`${key}:raw`).getSourceImage() as HTMLImageElement;
  const cols = 8;
  const tex = scene.textures.createCanvas(key, cols * (TILE_W + PAD * 2), Math.ceil(29 / cols) * (TILE_H + PAD * 2))!;
  const ctx = tex.context;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < 29; i++) {
    const x = (i % cols) * (TILE_W + PAD * 2) + PAD;
    const y = Math.floor(i / cols) * (TILE_H + PAD * 2) + PAD;
    // Halve twice through a scratch canvas: one big drawImage step skips most source pixels.
    const half = document.createElement('canvas');
    half.width = 128;
    half.height = 256;
    const h = half.getContext('2d')!;
    h.imageSmoothingQuality = 'high';
    h.drawImage(src, (i % 10) * 256, Math.floor(i / 10) * 512, 256, 512, 0, 0, 128, 256);
    ctx.drawImage(half, 0, 0, 128, 256, x, y, TILE_W, TILE_H);
    tex.add(i, 0, x, y, TILE_W, TILE_H);
  }
  tex.refresh();
  scene.textures.remove(`${key}:raw`);
}

/** Frame index of the blank domino in each set. */
export const BLANK = 28;
