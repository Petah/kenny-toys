import * as Phaser from 'phaser';
import { padAtlas } from '@shared/atlas';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import type { Tile } from './board';

const TILES = '2D assets/Letter Tiles Redux/Tilesheet';
const UI = 'Audio/Interface Sounds/Audio';
const IMPACT = 'Audio/Impact Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  pick: [1, 2, 3, 4].map((n) => `${UI}/select_00${n}.ogg`),
  unpick: [`${UI}/back_001.ogg`],
  word: [1, 2, 3].map((n) => `${UI}/confirmation_00${n}.ogg`),
  pop: [1, 2, 3].map((n) => `Audio/Digital Audio/Audio/pepSound${n}.ogg`),
  wrong: [`${UI}/error_004.ogg`],
  land: [0, 1, 2, 3, 4].map((n) => `${IMPACT}/impactWood_light_00${n}.ogg`),
  thud: [0, 1, 2].map((n) => `${IMPACT}/impactPlank_medium_00${n}.ogg`),
  stone: [0, 1, 2].map((n) => `${IMPACT}/impactMining_00${n}.ogg`),
  wild: ['Audio/Digital Audio/Audio/powerUp2.ogg'],
  mix: [1, 2].map((n) => `${UI}/scratch_00${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  warn: [`${UI}/glitch_001.ogg`],
  record: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_01.ogg'],
  level: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_00.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'game_over', 'new_highscore', 'level_up', 'power_up'] as const;
export type Voice = (typeof VOICES)[number];

/**
 * The pack's tile styles, by what they mean here: wooden letters, cream while picked, green
 * once the pick spells a word, a red diamond doubles the word, a purple star is any letter,
 * and a dark skull block is stone.
 */
export const STYLE = {
  letter: 'J',
  picked: 'B',
  valid: 'E',
  double: 'D',
  wild: 'H',
  stone: 'G',
} as const;

export const styleKey = (style: string) => `tiles${style}`;

export function preloadAssets(scene: Phaser.Scene) {
  for (const s of new Set(Object.values(STYLE))) {
    scene.load.atlasXML(`${styleKey(s)}:raw`, kenney(`${TILES}/tilesheet_Style${s}.png`), kenney(`${TILES}/tilesheet_Style${s}.xml`));
  }
  preloadSfx(scene, SFX);
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Mishief Stroll.ogg'));
}

export function unpackAssets(scene: Phaser.Scene) {
  for (const s of new Set(Object.values(STYLE))) padAtlas(scene, `${styleKey(s)}:raw`, styleKey(s));
}

/** The texture and frame that draw a tile, given whether it's picked and whether the pick is a word. */
export function tileFrame(t: Tile, picked: boolean, valid: boolean): [string, string] {
  if (t.kind === 'stone') return [styleKey(STYLE.stone), 'tile_skull.png'];
  if (t.kind === 'wild') return [styleKey(picked && valid ? STYLE.valid : STYLE.wild), 'tile_star.png'];
  const frame = `tile${t.letter}.png`;
  if (picked) return [styleKey(valid ? STYLE.valid : STYLE.picked), frame];
  return [styleKey(t.kind === 'double' ? STYLE.double : STYLE.letter), frame];
}
