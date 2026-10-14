import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const PACK = '2D assets/Fish Pack/Spritesheet/spritesheet-double';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const UI = 'Audio/Interface Sounds/Audio';

/** Texture key of the pack's atlas, repacked with gaps between frames by padAtlas(). */
export const SHEET = 'fish';
const RAW_SHEET = 'fish:raw';

export const SFX = {
  gulp: [1, 2, 3, 4].map((n) => `${UI}/drop_00${n}.ogg`),
  nibble: [1, 2].map((n) => `${UI}/pluck_00${n}.ogg`),
  hurt: [1, 2].map((n) => `Audio/Retro Sounds 2/Audio/hurt${n}.ogg`),
  grow: ['Audio/Retro Sounds 2/Audio/upgrade1.ogg'],
  shrink: ['Audio/Retro Sounds 2/Audio/upgrade3.ogg'],
  puff: ['Audio/Digital Audio/Audio/phaserUp1.ogg'],
  warn: ['Audio/Digital Audio/Audio/lowThreeTone.ogg'],
  dash: [2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  bubble: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Water/drip${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  stage: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_05.ogg'],
  wave: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_10.ogg'],
  record: ['Audio/Music Jingles/Audio (Steeldrum)/jingles-steel_03.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'level_up', 'game_over', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.atlasXML(RAW_SHEET, kenney(`${PACK}.png`), kenney(`${PACK}.xml`));
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Night at the Beach.ogg'));
}

/** A fish anyone can meet in the water. Every fish frame faces right. */
export interface Species {
  frame: string;
  /** Left behind when it's eaten. */
  skeleton: string;
  /** Length of the drawn fish in world units. */
  len: number;
  /** Place on the food chain, 1 (smallest) to 4. */
  tier: number;
  speed: [number, number];
  points: number;
  /** How far one of these fills the growth bar. */
  growth: number;
}

export const SPECIES: Species[] = [
  { frame: 'fish_pink', skeleton: 'fish_pink_skeleton', len: 34, tier: 1, speed: [50, 85], points: 10, growth: 1 },
  { frame: 'fish_green', skeleton: 'fish_green_skeleton', len: 56, tier: 2, speed: [60, 100], points: 25, growth: 2 },
  { frame: 'fish_blue', skeleton: 'fish_blue_skeleton', len: 84, tier: 3, speed: [55, 90], points: 50, growth: 3 },
  { frame: 'fish_red', skeleton: 'fish_red_skeleton', len: 122, tier: 4, speed: [45, 80], points: 100, growth: 4 },
];

export const PLAYER_FRAME = 'fish_orange';
export const PLAYER_SKELETON = 'fish_orange_skeleton';

/**
 * The player's length through each stage, from just grown to about to grow again. Each stage
 * is longer than the species it can now eat and shorter than the next one up.
 */
export const PLAYER_LEN: [number, number][] = [
  [42, 52],
  [66, 78],
  [98, 114],
  [138, 156],
];

/** How much growth each stage takes to fill. */
export const STAGE_GROWTH = [6, 12, 18, 24];

export const PUFFER = { frame: 'fish_brown', len: 64, speed: [28, 45] as [number, number] };
/** An eel is the long tail piece followed by the head piece. */
export const EEL = { tail: 'fish_grey_long_a', head: 'fish_grey_long_b', len: 250, speed: 330 };

/**
 * Copies the pack's atlas into one with clear gaps between frames, under the same frame names.
 * The original packs its 128px cells edge to edge, so scaled sprites pick up hairlines of their
 * neighbours (seaweed especially, whose cells sit next to full-bleed terrain tiles).
 */
export function padAtlas(scene: Phaser.Scene) {
  if (scene.textures.exists(SHEET)) return;
  const raw = scene.textures.get(RAW_SHEET);
  const names = raw.getFrameNames();
  const pad = 4;
  const cell = 128 + pad * 2;
  const cols = Math.ceil(Math.sqrt(names.length));
  const tex = scene.textures.createCanvas(SHEET, cols * cell, Math.ceil(names.length / cols) * cell)!;
  names.forEach((name, i) => {
    const f = raw.get(name);
    const x = (i % cols) * cell + pad;
    const y = Math.floor(i / cols) * cell + pad;
    tex.context.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, x, y, f.cutWidth, f.cutHeight);
    tex.add(name, 0, x, y, f.cutWidth, f.cutHeight);
  });
  tex.refresh();
  scene.textures.remove(RAW_SHEET);
}

/** The opaque part of a frame, in frame pixels relative to the frame's centre. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boundsCache = new Map<string, Bounds>();

/** Finds the opaque area of an atlas frame by scanning its alpha. */
export function frameBounds(scene: Phaser.Scene, frameName: string): Bounds {
  const cached = boundsCache.get(frameName);
  if (cached) return cached;
  const frame = scene.textures.getFrame(SHEET, frameName);
  const canvas = document.createElement('canvas');
  canvas.width = frame.cutWidth;
  canvas.height = frame.cutHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 64) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const b = x1 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0 - width / 2, y: y0 - height / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(frameName, b);
  return b;
}

/**
 * Lays terrain tiles side by side in one texture: a row of top pieces over a row of fill. The
 * atlas has no padding between its full-bleed tiles, so drawing them separately leaves seams.
 */
export function buildStrip(scene: Phaser.Scene, key: string, tops: string[], fill: string) {
  if (scene.textures.exists(key)) return;
  const cell = 128;
  const tex = scene.textures.createCanvas(key, tops.length * cell, cell * 2)!;
  const atlas = scene.textures.get(SHEET);
  tops.forEach((name, i) => {
    for (const [frameName, row] of [[name, 0], [fill, 1]] as const) {
      const f = atlas.get(frameName);
      tex.context.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, i * cell, row * cell, cell, cell);
    }
  });
  tex.refresh();
}
