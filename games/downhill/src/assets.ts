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
  tracks: 58,
  ramp: 36,
  flagRed: 20,
  flagBlue: 21,
  banner: [22, 23],
  lift: { top: 42, pole: 54, base: 66, cable: 46, shadow: 53, chairHanger: 44, chair: 57, gondola: [55, 56, 67, 68] },
} as const;

/** The font tiles: digits and a colon, a blob, then A to Z and some symbols, twelve to a row from tile 84. */
const FONT_CHARS = '0123456789:~ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%+-*/=.';
export const PIXEL_FONT = 'ski-font';

/** The sheet's pixels, for measuring letters and cleaning up tiles. */
function sheetPixels(scene: Phaser.Scene) {
  const img = scene.textures.get(SKI).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { ctx, width: img.width, height: img.height };
}

/**
 * Registers the pack's pixel letters as a bitmap font. Each letter is trimmed to the pixels it
 * draws, and neighbours share their two-pixel outline, so words are spaced like real lettering
 * rather than one letter to a tile.
 */
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
  } as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig) as unknown as { data: { chars: Record<number, Glyph> } };
  const { ctx, width } = sheetPixels(scene);
  const chars = entry.data.chars;
  for (const c of Object.values(chars)) {
    const px = ctx.getImageData(c.x, c.y, TILE, TILE).data;
    let x0 = TILE;
    let x1 = -1;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 128) continue;
      const x = ((i - 3) / 4) % TILE;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    if (x1 < 0) continue;
    c.x += x0;
    c.width = x1 - x0 + 1;
    c.centerX = Math.floor(c.width / 2);
    c.u0 = c.x / width;
    c.u1 = (c.x + c.width) / width;
    c.xAdvance = c.width - 2;
  }
  // There's no space in the sheet: borrow a letter's entry with nothing to draw.
  chars[32] = { ...chars['A'.charCodeAt(0)], width: 0, height: 0, xAdvance: 5 };
  scene.cache.bitmapFont.add(PIXEL_FONT, entry);
}

interface Glyph {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  xAdvance: number;
  u0: number;
  u1: number;
}

/** The pack's ramp sits on a square of piste; this cuts it out so it stands on any snow. */
export const RAMP = 'ramp';
export function createRamp(scene: Phaser.Scene) {
  if (scene.textures.exists(RAMP)) return;
  const { ctx } = sheetPixels(scene);
  const f = scene.textures.getFrame(SKI, T.ramp);
  const img = ctx.getImageData(f.cutX, f.cutY, TILE, TILE);
  const px = img.data;
  const solid = (x: number, y: number) => !(px[(y * TILE + x) * 4] === 207 && px[(y * TILE + x) * 4 + 1] === 231);
  for (let y = 0; y < TILE; y++) {
    let l = 0;
    while (l < TILE && !solid(l, y)) l++;
    let r = TILE - 1;
    while (r >= 0 && !solid(r, y)) r--;
    for (let x = 0; x < TILE; x++) if (l > r || x < l || x > r) px[(y * TILE + x) * 4 + 3] = 0;
  }
  const tex = scene.textures.createCanvas(RAMP, TILE, TILE)!;
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
}
