import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import type { Kind } from './board';

const SVG = '2D assets/Emote Pack/Vector/emotes_vector.svg';
const UI = 'Audio/Interface Sounds/Audio';
const IMPACT = 'Audio/Impact Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const JINGLE = 'Audio/Music Jingles/Audio (Hit)';

export const SFX = {
  shoot: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  bounce: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  stick: [0, 1, 2].map((n) => `${IMPACT}/impactSoft_medium_00${n}.ogg`),
  pop: [1, 2, 3].map((n) => `${UI}/drop_00${n}.ogg`),
  fall: [0, 1, 2, 3].map((n) => `${IMPACT}/impactGeneric_light_00${n}.ogg`),
  stone: [0, 1, 2].map((n) => `${IMPACT}/impactMining_00${n}.ogg`),
  bomb: [0, 1].map((n) => `${IMPACT}/impactPunch_heavy_00${n}.ogg`),
  push: [0, 1].map((n) => `${IMPACT}/impactPlank_medium_00${n}.ogg`),
  swap: [1, 2].map((n) => `${UI}/switch_00${n}.ogg`),
  warn: [`${UI}/glitch_001.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  earn: ['Audio/Digital Audio/Audio/powerUp2.ogg'],
  clear: [`${JINGLE}/jingles-hit_04.ogg`],
  record: [`${JINGLE}/jingles-hit_09.ogg`],
  over: [`${JINGLE}/jingles-hit_13.ogg`],
} satisfies SfxGroups;

export const VOICES = ['go', 'game_over', 'new_highscore', 'level_up', 'power_up'] as const;
export type Voice = (typeof VOICES)[number];

export const MUSIC = 'Audio/Music Loops/Loops/Cheerful Annoyance.ogg';

export function preloadAssets(scene: Phaser.Scene) {
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney(MUSIC));
}

// ---- Art ------------------------------------------------------------------------------------
//
// The pack's PNGs are 32×38, too small to scale up for a bubble the size of a thumb, but its
// vector sheet draws every icon and balloon. It's one flat drawing with no viewBox, laid out
// like Preview.png: three rows of icons on square balloons 40 units apart from (20, 20), then
// the bare balloons along y = 290. We draw it twice at a high scale, once as it is (for the
// round balloon) and once with the square balloons taken out (for clean icons), then build a
// texture per bubble kind: the round balloon filled with the kind's colour, a darker outline,
// a little shine and the icon on top.

/** SVG units → texture pixels. A bubble is 32 units across, so 96px, drawn at 40-70px. */
const S = 3;
/** The round balloon in the SVG: its circle's top-left, the circle's size, and its tail's tip. */
const BALLOON = { x: 100, y: 290, size: 32, tail: 38 };
/** Room round the balloon in the texture for its outline. */
const PAD = 2.5;
const OUTLINE = 1.7;

/** Icon names by where they sit in the SVG's grid of vector icons. */
const ICON_GRID = [
  ['empty', 'dots1', 'dots2', 'dots3', 'heartBroken', 'heart', 'hearts', 'exclamations', 'exclamation', 'question'],
  ['sleep', 'sleeps', 'bars', 'faceHappy', 'faceSad', 'faceAngry', 'alert', 'star', 'stars', 'music'],
  ['drop', 'drops', 'anger', 'cash', 'swirl', 'cross', 'circle', 'idea', 'laugh', 'cloud'],
];

export interface Look {
  icon: string;
  /** Balloon fill and outline. */
  fill: string;
  line: string;
  /** For effects in this kind's colour (aim dots, sparks). */
  tint: number;
}

/** What each kind looks like. Colour and icon both differ, so neither alone has to carry it. */
export const LOOKS: Record<string, Look> = {
  0: { icon: 'heart', fill: '#ffa3c2', line: '#d6336c', tint: 0xff5c93 },
  1: { icon: 'star', fill: '#ffe066', line: '#e09400', tint: 0xffc61a },
  2: { icon: 'drop', fill: '#a5d8ff', line: '#2f7fd0', tint: 0x4dabf7 },
  3: { icon: 'faceHappy', fill: '#8ce99a', line: '#2b8a3e', tint: 0x51cf66 },
  4: { icon: 'music', fill: '#d0b3ff', line: '#7048c8', tint: 0x9775fa },
  5: { icon: 'laugh', fill: '#ffffff', line: '#7a8a9c', tint: 0xf1f3f5 },
  stone: { icon: 'cloud', fill: '#adb5bd', line: '#5c6670', tint: 0x868e96 },
  bomb: { icon: 'exclamations', fill: '#ff8787', line: '#c92a2a', tint: 0xff6b6b },
};

export const bubbleKey = (kind: Kind | string) => `bubble:${kind}`;
export const ICONS_KEY = 'emote-icons';
/** A plain white balloon for the backdrop and flashes. */
export const PLAIN_KEY = 'bubble:plain';
/** Texture pixels across a bubble's circle, for scaling sprites to a cell. */
export const BUBBLE_PX = BALLOON.size * S;
/** Where the circle's centre sits in a bubble texture, as an origin. */
export const BUBBLE_ORIGIN = {
  x: (PAD + BALLOON.size / 2) / (BALLOON.size + PAD * 2),
  y: (PAD + BALLOON.size / 2) / (BALLOON.tail + PAD * 2),
};

export interface Art {
  icons: HTMLCanvasElement;
  bubbles: Record<string, HTMLCanvasElement>;
  plain: HTMLCanvasElement;
}

/** Draws every texture from the pack's SVG. Run before the game starts (it's async: the SVG has to decode). */
export async function bakeArt(): Promise<Art> {
  const text = await (await fetch(kenney(SVG))).text();
  const [sheet, icons] = await Promise.all([rasterise(text), rasterise(withoutSquareBalloons(text))]);

  const w = (BALLOON.size + PAD * 2) * S;
  const h = (BALLOON.tail + PAD * 2) * S;
  const silhouette = canvas(w, h);
  silhouette.getContext('2d')!.drawImage(sheet, BALLOON.x * S, BALLOON.y * S, BALLOON.size * S, BALLOON.tail * S, PAD * S, PAD * S, BALLOON.size * S, BALLOON.tail * S);

  const bubbles: Record<string, HTMLCanvasElement> = {};
  for (const [kind, look] of Object.entries(LOOKS)) bubbles[kind] = bakeBubble(silhouette, icons, look);
  return { icons, bubbles, plain: recolour(silhouette, '#ffffff') };
}

function bakeBubble(silhouette: HTMLCanvasElement, icons: HTMLCanvasElement, look: Look) {
  const out = canvas(silhouette.width, silhouette.height);
  const g = out.getContext('2d')!;
  // Outline: the balloon in the line colour, stamped in a ring round where it goes.
  const line = recolour(silhouette, look.line);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.drawImage(line, Math.cos(a) * OUTLINE * S, Math.sin(a) * OUTLINE * S);
  }
  // Fill, with a soft shine up and left and a little shade low down, kept inside the balloon.
  const fill = recolour(silhouette, look.fill);
  const f = fill.getContext('2d')!;
  f.globalCompositeOperation = 'source-atop';
  const cx = (PAD + BALLOON.size / 2) * S;
  const cy = (PAD + BALLOON.size / 2) * S;
  const r = (BALLOON.size / 2) * S;
  const shade = f.createLinearGradient(0, cy - r, 0, cy + r * 1.4);
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.14)');
  f.fillStyle = shade;
  f.fillRect(0, 0, fill.width, fill.height);
  const shine = f.createRadialGradient(cx - r * 0.45, cy - r * 0.5, 0, cx - r * 0.45, cy - r * 0.5, r * 0.55);
  shine.addColorStop(0, 'rgba(255,255,255,0.75)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  f.fillStyle = shine;
  f.fillRect(0, 0, fill.width, fill.height);
  g.drawImage(fill, 0, 0);
  // The icon, centred on the circle.
  const { x, y } = iconCell(look.icon);
  g.drawImage(icons, x * S, y * S, 32 * S, 32 * S, PAD * S, PAD * S, 32 * S, 32 * S);
  return out;
}

/** Top-left of an icon's 32-unit square in the SVG. */
function iconCell(name: string) {
  const row = ICON_GRID.findIndex((r) => r.includes(name));
  if (row < 0) throw new Error(`no emote icon ${name}`);
  return { x: 20 + 40 * ICON_GRID[row].indexOf(name), y: 20 + 40 * row };
}

/** Registers the baked canvases as textures, with a frame per icon on the icon sheet. */
export function addArt(scene: Phaser.Scene, art: Art) {
  const tex = scene.textures;
  for (const [kind, c] of Object.entries(art.bubbles)) if (!tex.exists(bubbleKey(kind))) tex.addCanvas(bubbleKey(kind), c);
  if (!tex.exists(PLAIN_KEY)) tex.addCanvas(PLAIN_KEY, art.plain);
  if (!tex.exists(ICONS_KEY)) {
    const sheet = tex.addCanvas(ICONS_KEY, art.icons)!;
    ICON_GRID.flat().forEach((name) => {
      const { x, y } = iconCell(name);
      sheet.add(name, 0, x * S, y * S, 32 * S, 32 * S);
    });
  }
}

/** The SVG's square balloons and their tails, which sit behind every icon. */
function withoutSquareBalloons(svg: string) {
  return svg
    .replace(/<path stroke="none" fill="#FFFFFF" d="M\d+ \d+ L\d+ \d+ Q[^"]*"\/>/g, (p) => (isSquareBalloon(p) ? '' : p))
    .replace(/<path stroke="none" fill="url\(#gradient\d+\)"[^>]*\/>/g, '');
}

/** A white rounded square 32 units across, as the sheet draws every icon's balloon. */
function isSquareBalloon(path: string) {
  const m = /d="M(\d+) (\d+) L(\d+) \2 /.exec(path);
  return !!m && Number(m[3]) - Number(m[1]) === 24;
}

async function rasterise(svg: string): Promise<HTMLCanvasElement> {
  const W = 420;
  const H = 380;
  const sized = svg.replace('<svg ', `<svg viewBox="0 0 ${W} ${H}" width="${W * S}" height="${H * S}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = canvas(W * S, H * S);
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A shape in one flat colour. */
function recolour(shape: HTMLCanvasElement, colour: string) {
  const c = canvas(shape.width, shape.height);
  const g = c.getContext('2d')!;
  g.drawImage(shape, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
}
