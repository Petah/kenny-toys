import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const PACK = '2D assets/Tappy Plane/Spritesheet';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  flap: [1, 4, 5, 6].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  point: [1, 4].map((n) => `Audio/Retro Sounds 2/Audio/coin${n}.ogg`),
  rocks: [1, 2].map((n) => `Audio/Foley Sounds/Audio/Rocks/stonesHit${n}.ogg`),
  thud: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactPunch_heavy_00${n}.ogg`),
  fall: [1, 2].map((n) => `Audio/Retro Sounds 2/Audio/fall${n}.ogg`),
  tick: [1, 2].map((n) => `Audio/Interface Sounds/Audio/tick_00${n}.ogg`),
  medal: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_01.ogg'],
  record: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_05.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'game_over', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.atlasXML('sheet', kenney(`${PACK}/sheet.png`), kenney(`${PACK}/sheet.xml`));
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Farm Frolics.ogg'));
}

export const PLANES = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export type PlaneColour = (typeof PLANES)[number];

export interface Theme {
  name: string;
  rockUp: string;
  rockDown: string;
  ground: string;
  /** Multiplied into the sky so each terrain gets its own weather. */
  sky: number;
}

export const THEMES: Theme[] = [
  { name: 'grass', rockUp: 'rockGrass.png', rockDown: 'rockGrassDown.png', ground: 'groundGrass.png', sky: 0xffffff },
  { name: 'dirt', rockUp: 'rock.png', rockDown: 'rockDown.png', ground: 'groundDirt.png', sky: 0xffffff },
  { name: 'snow', rockUp: 'rockSnow.png', rockDown: 'rockSnowDown.png', ground: 'groundSnow.png', sky: 0xf2f7ff },
  { name: 'ice', rockUp: 'rockIce.png', rockDown: 'rockIceDown.png', ground: 'groundIce.png', sky: 0xe8f3ff },
];

/**
 * Outline of the upward rock spike in frame pixels (108×239), traced from its alpha.
 * The downward frames are the same shape flipped vertically.
 */
export const ROCK_W = 108;
export const ROCK_H = 239;
export const ROCK_SHAPE: readonly [number, number][] = [
  [63, 0], [69, 0], [80, 96], [88, 114], [106, 239], [2, 239], [28, 133], [38, 114], [42, 95],
];

/** For each column of a ground strip, how far down from its top edge the solid part starts. */
export function groundProfile(scene: Phaser.Scene, frameName: string): Uint8Array {
  const frame = scene.textures.getFrame('sheet', frameName);
  const canvas = document.createElement('canvas');
  canvas.width = frame.cutWidth;
  canvas.height = frame.cutHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const src = frame.source.image as CanvasImageSource;
  ctx.drawImage(src, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tops = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height - 1 && data[(y * width + x) * 4 + 3] < 128) y++;
    tops[x] = y;
  }
  return tops;
}

/**
 * Copies every atlas frame into its own texture, keyed by frame name. The pack's atlas has no
 * padding, so sprites drawn straight from it pick up hairlines from their neighbours when scaled,
 * and tiled strips show seams. Standalone textures clamp at their own edges instead.
 */
export const STRIP_PAD = 4;

export function unpackAtlas(scene: Phaser.Scene, key: string) {
  const atlas = scene.textures.get(key);
  for (const name of atlas.getFrameNames()) {
    if (scene.textures.exists(name)) continue;
    const f = atlas.get(name);
    // Ground strips tile sideways, and the tiling wraps vertically too; clear rows above and below
    // stop it blending their solid bottom edge into the top one.
    const pad = name.startsWith('ground') ? STRIP_PAD : 0;
    const tex = scene.textures.createCanvas(name, f.cutWidth, f.cutHeight + pad * 2)!;
    tex.context.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, pad, f.cutWidth, f.cutHeight);
    tex.refresh();
  }
}
