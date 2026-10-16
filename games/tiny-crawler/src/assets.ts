import type * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import { createPixelFont, drawFontSheet } from '@shared/pixelfont';

export const SHEET = 'tiles';
export const FONT = 'pixel';
const RPG = 'Audio/RPG Audio/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const RETRO = 'Audio/Retro Sounds 2/Audio';

export const SFX = {
  step: [0, 1, 2, 3].map((n) => `${RPG}/footstep0${n}.ogg`),
  swing: [`${RPG}/knifeSlice.ogg`, `${RPG}/knifeSlice2.ogg`],
  hit: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactPunch_medium_00${n}.ogg`),
  thud: [0, 1].map((n) => `Audio/Impact Sounds/Audio/impactSoft_heavy_00${n}.ogg`),
  hurt: [`${RETRO}/hurt1.ogg`],
  block: [`${RPG}/beltHandle1.ogg`],
  chest: [`${RPG}/creak1.ogg`, `${RPG}/metalLatch.ogg`],
  coins: [`${RPG}/handleCoins.ogg`, `${RPG}/handleCoins2.ogg`],
  potion: [`${RPG}/bookFlip1.ogg`],
  weapon: [`${RPG}/drawKnife1.ogg`],
  door: [`${RPG}/doorOpen_1.ogg`],
  bump: [`${UI}/error_005.ogg`],
  level: [`${RETRO}/upgrade1.ogg`],
  dead: [`${RETRO}/lose2.ogg`],
  click: [`${UI}/click_001.ogg`],
  mimic: [`${UI}/confirmation_003.ogg`],
  stairs: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_03.ogg'],
  over: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_06.ogg'],
  voiceOver: ['Audio/Voiceover Pack/Audio (Female)/game_over.ogg'],
  voiceBest: ['Audio/Voiceover Pack/Audio (Female)/new_highscore.ogg'],
} satisfies SfxGroups;

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.spritesheet(SHEET, kenney('2D assets/Tiny Dungeon/Tilemap/tilemap_packed.png'), { frameWidth: 16, frameHeight: 16 });
  preloadSfx(scene, SFX);
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Infinite Descent.ogg'));
}

const FONT_CHARS = "!'+,-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function createAssets(scene: Phaser.Scene) {
  // Kenney Pixel at 16px puts every pixel on a whole pixel: capitals seven tall, outlined dark.
  drawFontSheet(scene, `${FONT}:sheet`, { family: 'Kenney Pixel', size: 16, chars: FONT_CHARS, tile: 12, charsPerRow: 16, baseline: 9, outline: '#1d1620' });
  createPixelFont(scene, FONT, { image: `${FONT}:sheet`, tile: 12, chars: FONT_CHARS, charsPerRow: 16, offset: { x: 0, y: 0 }, overlap: 1, space: 4 });
  // A little heart and coin for the HUD, drawn pixel by pixel.
  pixelArt(scene, 'heart', ['.XX.XX.', 'XRRXRRX', 'XRRRRRX', 'XRRRRRX', '.XRRRX.', '..XRX..', '...X...'], { X: '#1d1620', R: '#e8473a' });
  pixelArt(scene, 'heartEmpty', ['.XX.XX.', 'XGGXGGX', 'XGGGGGX', 'XGGGGGX', '.XGGGX.', '..XGX..', '...X...'], { X: '#1d1620', G: '#5a4c58' });
  pixelArt(scene, 'coin', ['.XXX.', 'XYYYX', 'XYWYX', 'XYYYX', '.XXX.'], { X: '#1d1620', Y: '#f5c400', W: '#fff4a0' });
  pixelArt(scene, 'spark', ['X'], { X: '#ffffff' });
}

function pixelArt(scene: Phaser.Scene, key: string, rows: string[], colours: Record<string, string>) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, rows[0].length, rows.length)!;
  const ctx = tex.context;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!colours[ch]) return;
    ctx.fillStyle = colours[ch];
    ctx.fillRect(x, y, 1, 1);
  }));
  tex.refresh();
}
