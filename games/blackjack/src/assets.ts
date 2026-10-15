import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import { createPixelFont, drawFontSheet } from '@shared/pixelfont';
import type { Card } from './rules';
import { SUITS } from './rules';

const CARDS = '2D assets/Playing Cards Pack/Tilesheet/cardsLarge_tilemap_packed.png';
const CASINO = 'Audio/Casino Audio/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const SAX = 'Audio/Music Jingles/Audio (Saxophone)';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  deal: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${CASINO}/card-slide-${n}.ogg`),
  place: [1, 2, 3, 4].map((n) => `${CASINO}/card-place-${n}.ogg`),
  flip: [1, 2].map((n) => `${CASINO}/card-fan-${n}.ogg`),
  collect: [1, 2, 3, 4].map((n) => `${CASINO}/card-shove-${n}.ogg`),
  shuffle: [`${CASINO}/card-shuffle.ogg`],
  chip: [1, 2, 3].map((n) => `${CASINO}/chip-lay-${n}.ogg`),
  chips: [1, 2, 3, 4, 5, 6].map((n) => `${CASINO}/chips-stack-${n}.ogg`),
  rake: [1, 2, 3, 4].map((n) => `${CASINO}/chips-collide-${n}.ogg`),
  handle: [1, 2, 3, 4, 5, 6].map((n) => `${CASINO}/chips-handle-${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  nope: [`${UI}/error_004.ogg`],
  bust: [`${UI}/error_006.ogg`],
  win: [`${SAX}/jingles-saxophone_04.ogg`],
  blackjack: [`${SAX}/jingles-saxophone_00.ogg`],
  lose: [`${SAX}/jingles-saxophone_09.ogg`],
  record: [`${SAX}/jingles-saxophone_05.ogg`],
} satisfies SfxGroups;

export const VOICES = ['final_round', 'game_over', 'new_highscore', 'you_win', 'its_a_tie'] as const;
export type Voice = (typeof VOICES)[number];

/** Texture keys. */
export const CARD_SHEET = 'cards';
export const CHIP = 'chip';
export const CHIP_FLAT = 'chip-flat';
export const FONT = 'bj-font';

/** Cards are drawn 42×60 in the middle of a 64-pixel tile. */
export const TILE = 64;
export const CARD_W = 42;
export const CARD_H = 60;

/** The pack's colours, for everything drawn to match it. */
export const INK = 0x4d5766;
export const RED = 0xf52c4e;
export const PALE = 0xc7d7ec;

/** Sheet rows are hearts, diamonds, clubs, spades; columns ace to king, then the blank and back. */
export const cardFrame = (c: Card) => SUITS.indexOf(c.suit) * 14 + c.rank - 1;
export const BACK = 14 + 13;
export const BLANK = 13;

/** Chip denominations and their colours: body, rim stripes and shadow side. */
export const CHIPS = [
  { value: 5, body: '#f52c4e', stripe: '#ffffff', side: '#a8182f' },
  { value: 25, body: '#3aa55c', stripe: '#ffffff', side: '#226a3a' },
  { value: 100, body: '#4d5766', stripe: '#ffffff', side: '#2b313b' },
  { value: 500, body: '#f5b82e', stripe: '#ffffff', side: '#b07b10' },
] as const;

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.spritesheet(CARD_SHEET, kenney(CARDS), { frameWidth: TILE, frameHeight: TILE });
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Swinging Pants.ogg'));
}

const FONT_CHARS = '!$%\'+,-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function createAssets(scene: Phaser.Scene) {
  // Kenney Pixel at 16px puts every pixel on a whole pixel: capitals seven tall, outlined in ink.
  drawFontSheet(scene, `${FONT}:sheet`, { family: 'Kenney Pixel', size: 16, chars: FONT_CHARS, tile: 12, charsPerRow: 16, baseline: 9, outline: '#2b313b' });
  createPixelFont(scene, FONT, { image: `${FONT}:sheet`, tile: 12, chars: FONT_CHARS, charsPerRow: 16, offset: { x: 0, y: 0 }, overlap: 1, space: 4 });
  CHIPS.forEach((c, i) => {
    drawChip(scene, `${CHIP}:${i}`, c);
    drawFlatChip(scene, `${CHIP_FLAT}:${i}`, c);
  });
}

/**
 * A chip seen from a low angle, 16×11: an oval top with stripes round its rim, and its edge
 * showing three pixels thick below. Stacked chips sit three pixels apart.
 */
function drawChip(scene: Phaser.Scene, key: string, c: (typeof CHIPS)[number]) {
  if (scene.textures.exists(key)) return;
  const w = 16;
  const h = 11;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.context;
  const cx = 7.5;
  const cy = 3.5;
  const rx = 8;
  const ry = 4;
  const inside = (x: number, y: number) => ((x + 0.5 - (cx + 0.5)) / rx) ** 2 + ((y + 0.5 - (cy + 0.5)) / ry) ** 2 <= 1;
  const put = (x: number, y: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inside(x, y)) {
        // The top: an outer rim with stripes every quarter turn, and a ring inside it.
        const a = Math.atan2((y - cy) * (rx / ry), x - cx);
        const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 === 0;
        if (r > 0.72) put(x, y, stripe ? c.stripe : c.body);
        else if (r > 0.5) put(x, y, c.side);
        else put(x, y, c.body);
      } else if (inside(x, y - 3) || inside(x, y - 2) || inside(x, y - 1)) {
        // The edge below, striped in the same places as the rim.
        const stripe = Math.floor(x / 3) % 2 === 1;
        put(x, y, stripe ? c.stripe : c.side);
      }
    }
  }
  // An ink outline all round, so chips read against the felt and each other.
  const img = ctx.getImageData(0, 0, w, h);
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && img.data[(y * w + x) * 4 + 3] > 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (filled(x, y) && (!filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1))) edge.push([x, y]);
  ctx.fillStyle = '#2b313b';
  for (const [x, y] of edge) ctx.fillRect(x, y, 1, 1);
  tex.refresh();
}

/** The same chip seen from straight above, 15×15, for the chips you bet with. */
function drawFlatChip(scene: Phaser.Scene, key: string, c: (typeof CHIPS)[number]) {
  if (scene.textures.exists(key)) return;
  const n = 15;
  const tex = scene.textures.createCanvas(key, n, n)!;
  const ctx = tex.context;
  const mid = 7;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - mid, y - mid);
      if (r > 7.4) continue;
      const a = Math.atan2(y - mid, x - mid);
      const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8 + 0.5) % 2 === 0;
      let col: string = c.body;
      if (r > 6.5) col = '#2b313b';
      else if (r > 5) col = stripe ? c.stripe : c.body;
      else if (r > 3.6) col = c.side;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  tex.refresh();
}
